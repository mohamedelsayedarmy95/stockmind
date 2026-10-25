# STOCKMIND — SERIES 11 CONTRACT: Authorization admission, lock protocol and shadow classification

> هذا العقد يصف **ما يضمنه الكود فعلاً** بعد Series 11 (التصليب الأمني للـ capability engine)، وحدود الضمان، وشروط القبول قبل أي *بروفة enforce غير إنتاجية*.
> **مش إذن بتفعيل `enforce`.** الافتراضي يفضل `CAPABILITY_MODE=shadow`. Production: NO-GO.
> الفرع: `hardening/series11-authorization-admission` (من `feature/series10-scoped-access` @ `7e695d8`).

## 1. نطاق التغيير
تصليب فقط: لا ميزات، لا migration، لا اعتماديات، لا تغيير في الموبايل. الملفات الرئيسية: `member-lock.ts`، `access-grant.service.ts`، `membership.service.ts`، `team.service.ts` (legacy endpoint)، `warehouse.service.ts` (CP-4)، `stock.service.ts` (ترتيب القفل)، `capabilities.constant.ts` (CAPABILITY_MODE)، `shadow-classifier.ts` (جديد)، `capability.service.ts` (shadow service)، `permissions.guard.ts`، `warehouse-access.service.ts`، `app.module.ts`، `main.ts`.

## 2. بروتوكول الأقفال (الترتيب العالمي)

كل transaction بتغيّر أو بتعتمد على سلطة (authority) عضو بتلتزم بالترتيب ده بالظبط:

| الخطوة | القفل | الوضع |
|---|---|---|
| 1 | صف الـ company | `FOR UPDATE` لإجراءات العضوية ولتدوير الـ generation؛ `FOR KEY SHARE` / `FOR SHARE` لكل الباقي (المنح، الكتابات، التعويض، CP-4) |
| 2 | **أقفال الأعضاء كمجموعة واحدة** (`lockMembers`)، بترتيب `id` تصاعدي (canonical = lowercase) | **exclusive** لكل عضو بتتغيّر سلطته، **shared** لكل عضو بيعتمد عليه الـ transaction (الـ actor). المجموعة بتتدمج قبل الأخذ: exclusive بيكسب، فمفيش shared→exclusive upgrade |
| 3 | صفوف الأعضاء | تصاعدي |
| 4 | المخازن / الـ inventory | تصاعدي |

- **ليه ده بيمنع الـ cycle:** أي transactionين بيتنازعوا على قفل بيتنازعوا أولاً على *أصغر* مفتاح مشترك بينهم؛ اللي بياخده بيكمل (ومش محتاج حاجة أصغر من اللي معاه)، والتاني بيستنى. مفيش طريق يخلّي A ينتظر B وB ينتظر A.
- **مفتاح القفل canonical:** `'stockmind:member:' || $1::uuid::text` — الـ UUID بحروف كبيرة في الـ URL ونفسه بحروف صغيرة في الـ token بقوا قفل واحد (قبل Series 11 كانوا مفتاحين مختلفين: ثغرة).
- **مدة الانتظار محدودة:** كل transaction سلطة بتبدأ بـ `lock_timeout` (`AUTHORITY_LOCK_TIMEOUT_MS`، الافتراضي 10 ثواني، من 100ms لـ 120s). انتهاء المهلة أو اختيار الـ DB لضحية deadlock بيرجع **503 `AUTHORITY_BUSY`** قابل لإعادة المحاولة، والـ transaction بيتعمله rollback كامل (مفيش أثر جزئي).
- **التحقق من الـ tenancy قبل أي قفل:** هدف من شركة تانية بيرجع 404 فوراً من غير ما ياخد قفل (قبل Series 11 كان ممكن admin من شركة تانية يتحبس خلف قفل عضو في شركتك).
- **ما بنادّعيش:** إن الـ 64-bit hash مفيهوش تصادم نظرياً (لو حصل، أعضاء مش مرتبطين بيستنوا بعض بس — مش بيفوّت قفل)، وإن مفيش ازدحام أقفال تحت حمل غير مقاس.

### المسارات وما بتأخده
| المسار | company | locks (الـ actor مشترك + الهدف حصري) | actor re-authorized جوه الـ tx |
|---|---|---|---|
| `PUT /team/members/:id/access` | KEY SHARE | actor S + target X | ✔ `MANAGE_USERS` (+ anti-escalation) |
| `PUT /team/members/:id/warehouses` (legacy) | KEY SHARE | actor S + target X | ✔ `MANAGE_USERS` (**جديد**: قبل كده لا) + role/status/warehouses بيتعاد قراءتهم جوه الـ tx |
| `POST /warehouses` مع `initialAccess` (CP-4) | KEY SHARE | actor S + **كل** الأهداف X دفعة واحدة | ✔ `CREATE_WAREHOUSE` (**جديد**) + `MANAGE_USERS` لكل هدف |
| suspend / reactivate / remove / role / revoke-sessions | FOR UPDATE | actor S + target X | ✔ (policy على صف الـ actor المقفول) |
| كتابة مخزون / تحويل / تعويض | KEY SHARE (**جديد** للكتابة/التحويل) / SHARE | member S | ✔ `assertActorAuthorized` |
| تدوير الـ generation | FOR UPDATE | member S | ✔ `MANAGE_RECOVERY` |

## 3. ضمانات الـ linearization
لكل زوج (منح، سحب سلطة الـ actor):
1. **لو الـ transaction بتاعة المنح أخدت أقفالها الأول:** السحب بيستنى لحد ما المنح تعمل commit أو rollback. المنح اتفوّضت على سلطة سليمة وقت الـ commit، والسحب بيسري بعدها.
2. **لو السحب عمل commit الأول:** المنح بتشوفه (الـ actor بيتحمّل من الـ DB جوه الـ tx بعد القفل) وبترفض (401/403) من غير أي أثر (مفيش صف، مفيش event).
3. **مفيش حالة ثالثة:** مفيش منح بتعمل commit على سلطة اتسحبت بـ commit سابق.
- **اللي بيتعمله commit قبل السحب بيفضل** (مفيش ادّعاء إلغاء رجعي).
- ينطبق على: demote→Staff، demote→Manager، suspend، remove، revoker بيتبع البروتوكول خارج الـ service، الـ legacy endpoint، CP-4 (بالأهداف المتعددة).
- **حدود:** القراءات (GET) بتتفوّض عند وصول الطلب وبتتغيّر مع أول طلب جديد؛ إنشاء مخزن *من غير* `initialAccess` ما زال معتمد على الفحص عند الـ guard (نافذة milliseconds، مش financial/stock write) — موثّق في §11.

## 4. اكتشافات Series 11 (مؤكّدة بإعادة إنتاج على كود Series 10 قبل الإصلاح)
| # | الاكتشاف | الحالة |
|---|---|---|
| **F11-01** | منح بتعمل commit بعد ما سلطة الـ actor اتسحبت بـ commit سابق (4 أنواع سحب + revoker البروتوكول + المسار الـ legacy) | **CONFIRMED** (دليل: `series11-evidence/before-fix-reproduction.txt`) → مصلّح |
| F11-01b | المسار الـ legacy مفيهوش أي إعادة تفويض للـ actor جوه الـ tx | **CONFIRMED** → مصلّح |
| F11-05 | مفتاح القفل من نص الـ URL: UUID بحروف كبيرة = قفل مختلف عن اللي الكتابات بتأخده | **CONFIRMED** → مصلّح (canonical) |
| F11-06 | admin من شركة تانية بيتحبس خلف قفل عضو مش بتاعه (القفل قبل فحص الـ tenancy) | **CONFIRMED** → مصلّح |
| F11-07 | deadlock حقيقي بين كتابة مخزون (member S ← company key-share) وإجراء عضوية (company X ← member X)، بيرجع 500 للكتابة | **CONFIRMED** (`deadlock detected` في `claimIdempotencyKey`) → مصلّح (company ثم member في الكتابة والتحويل) |
| F11-08 | الـ legacy `PUT .../warehouses` كان بيسيب منح بنطاق (warehouse_manager) من غير ما يقول، لو ما اتذكرتش في الطلب | **CONFIRMED** → بيرفض بـ 409 `SCOPED_GRANTS_PRESENT` |
| F11-02 | `CAPABILITY_MODE` غلط كان بيختار `off` بصمت | **CONFIRMED** (كود) → مصلّح (§5) |
| F11-04 | shadow كان بيصنّف أي فرق "expected" لو العضو عنده أي grant | **CONFIRMED** (كود + اختبارات) → مصلّح (§6) |

## 5. `CAPABILITY_MODE` (F11-02)
| القيمة | السلوك |
|---|---|
| غير موجود أو فاضي/مسافات | `shadow` (الافتراضي الموثّق) |
| `off` | تفويض legacy فقط، **اختيار مشغّل صريح**؛ بيتسجل في اللوج وقت التشغيل |
| `shadow` | legacy بيقرر، الجديد بيتحسب ويتقارن |
| `enforce` | الـ capability model بيقرر، fail closed |
| أي حاجة تانية (`enfroce`, `on`, `true`…) | **رفض**: الـ `ConfigModule.validate` بيرمي `CapabilityModeError` قبل ما الـ DB تتلمس؛ ولو القيمة اتغيّرت تحت process شغال، أي قرار بيفشل مغلقاً (مفيش fallback لـ off/shadow/enforce) |
- الحروف الكبيرة والمسافات محتملة (`" ENFORCE "` = enforce). رسالة الخطأ محدودة (24 حرف) ومطبوعة فقط.
- **الافتراضي لسه `shadow`.** مفيش تغيير في أي إعداد إنتاج.

## 6. تصنيف فروق الـ shadow (F11-04)
الفرق **expected** فقط لو: الـ model الجديد بيسمح بـ capability C على مخزن W بينما legacy بيمنع، **وفيه grant نشط (`access_grant`) على W بالظبط بيحمل C بالظبط** (وC warehouse-level ومعروفة). كل الباقي **unexpected**:
- اللي legacy سمح بيه والجديد منعه (`legacy-allowed-scoped-denied`).
- توسّع مفيش grant بيفسّره (مخزن تاني، capability تانية، org/financial، توسّع دور) (`unjustified-expansion`).
- capability مش في الكتالوج (`unknown-capability`)، عضو من شركة تانية (`cross-tenant`)، فرق مفيش حاجة تفسّره (`unexplained`).
- grant منتهي/مسحوب/لسه ما بدأش مبيفسّرش حاجة (بيتعاد التحقق من النافذة وقت التصنيف).
- **مفيش principal / مفيش model / مفيش company في الـ token** = `incomplete` (مش parity ومش equal). فشل الحساب = `errors`.
- الـ ring بيحتفظ بآخر 50 فرق بمعرّفات فقط (route, userId, capabilities, warehouseIds, verdict, reason, justifiedBy, unexplained)؛ مفيش token ولا body ولا قيم.
- **الـ telemetry كافية لبروفة غير إنتاجية؟** لبروفة محكومة: نعم، بشرط تفريغ `snapshot()` ولوج `capability-shadow-unexpected` في نهاية كل جولة. **لقرار إنتاج: لا** — العدّادات في ذاكرة العملية، بتتصفّر مع إعادة التشغيل، مش مجمّعة بين instances، ومفيش retention ولا alerting.

## 7. الرجوع (rollback) بين الأوضاع
| الانتقال | الأثر (مُختبَر: `capability-shadow.pg.spec` — "F11 rollback") |
|---|---|
| `enforce → shadow/off` | **تضييق فقط**: كل ما legacy بيسمح بيه كان الـ model الجديد بيسمح بيه برضه (اتفحص على 6 personas × 18 طلب). بيفقد الـ scoped manager كل ما جاله من grant (مخزنه الوحيد بيبقى 404، التسوية/التحويل 403)، الـ personas legacy بدون أي تغيير |
| `off/shadow → enforce` | الإضافات = بالظبط تأثير الـ grants على مخازنها (wmOnly: مخزنه، رصيده، inbound؛ wmMixed: `changes` على w3). التحويل لسه محتاج الـ capability على الطرفين |
| الـ grants وقت الـ rollback | **بتفضل في الـ DB** (dormant). الـ admin بيشوفها بـ `effective:false` وبـ `profiles[].available:false`؛ **بترجع تشتغل تلقائياً عند الرجوع لـ enforce** — لازم مراجعتها قبل التفعيل مرة تانية (شرط في §12) |
| `/me/capabilities` | بيرجّع نظرة legacy خارج enforce (`engine.enforced:false`) فالموبايل بيتنقل حسب اللي السيرفر فعلاً بيطبّقه؛ الكاش 300s + تحديث عند الرفض وعند foreground |
| عمليات أوفلاين قديمة | السيرفر بيعيد الحكم عليها دايماً (A10)؛ مفيش ثقة في الـ snapshot |
| إنشاء `warehouse_manager` خارج enforce | مرفوض (`PROFILE_NOT_ENFORCED`)؛ مفيش grant "وهمي" |
- **الرجوع من enforce قرار مشغّل مقصود**، مش fallback تلقائي؛ فيه أثر أمني (تضييق وصول مدراء المخازن) ويتعلن لهم. مفيش تحويل تلقائي بين الأوضاع في الكود.

## 8. تغطية enforce (F11-03)
(الجدول بالأرقام الفعلية في التقرير §6؛ العلاقة بين الـ fixture المجمّد وبديله مُلزَمة بـ `tests/unit/enforce-coverage.spec.ts`.)

## 9. الاختبارات الجديدة
`authority-linearization.pg.spec.ts` (F11-01/05/06/07/08 + أقفال + مهلة)، `shadow-classifier.spec.ts` + `capability-shadow.service.spec.ts` (F11-04)، `capability-mode.spec.ts` (F11-02)، `enforce-coverage.spec.ts` (F11-03)، توسعة `capability-shadow.pg.spec.ts` (rollback).

## 10. ما لم يتغيّر عمداً
لا migration (12/12)، لا اعتماديات، لا موبايل، الافتراضي `shadow`، Manager العالمي كما هو، `item.set_cost` موثّق وغير منفَّذ، R-18/R-19/R-20 سياسة غير منفَّذة.

## 11. حدود معروفة (مش مصلّحة هنا)
- إنشاء مخزن بدون `initialAccess` وكتابات الكتالوج/المنتجات بتعتمد على فحص الـ guard وقت الطلب (نافذة milliseconds)؛ الكتابات المالية/المخزون جوه الـ tx.
- لا اختبار على قاعدة بعيدة أو حمل إنتاجي؛ لا اختبار جهاز؛ لا مراجعة خارجية.
- الـ shadow telemetry في الذاكرة فقط (§6).

## 12. معايير القبول المقترحة لبروفة enforce *غير إنتاجية* مستقبلية (مش تفويض)
(انظر التقرير §15.)
