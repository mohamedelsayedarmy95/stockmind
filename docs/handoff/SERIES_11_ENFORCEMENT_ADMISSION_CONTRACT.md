# STOCKMIND — SERIES 11 CONTRACT: Authorization admission, lock protocol and shadow classification

> هذا العقد يصف **ما يضمنه الكود فعلاً** بعد Series 11 (تصليب الـ capability engine)، وحدود الضمان، وشروط القبول قبل أي *بروفة enforce غير إنتاجية*.
> **مش إذن بتفعيل `enforce`.** الافتراضي يفضل `CAPABILITY_MODE=shadow`. Production: NO-GO.
> الفرع: `hardening/series11-authorization-admission` (من `feature/series10-scoped-access` @ `7e695d8`). الأدلة: `docs/handoff/series11-evidence/`.

## 1. نطاق التغيير
تصليب فقط: لا ميزات، **لا migration (12/12)**، لا اعتماديات، لا تغيير في الموبايل. الملفات الرئيسية: `member-lock.ts`، `access-grant.service.ts`، `membership.service.ts`، `team.service.ts` (legacy endpoint)، `warehouse.service.ts` (CP-4)، `stock.service.ts` (ترتيب القفل)، `capabilities.constant.ts` (CAPABILITY_MODE)، `shadow-classifier.ts` (جديد)، `capability.service.ts` (shadow service)، `permissions.guard.ts`، `warehouse-access.service.ts`، `app.module.ts`، `main.ts`.

## 2. بروتوكول الأقفال (الترتيب العالمي)

كل transaction بتغيّر سلطة عضو أو بتعتمد عليها بتلتزم بالترتيب ده:

| الخطوة | القفل | الوضع |
|---|---|---|
| 0 | قفل عضوية الشركة (advisory، **عادل**) — إجراءات العضوية فقط | exclusive. بيسلسل إجراءات العضوية لنفس الشركة (قاعدة آخر Owner بتعدّ الـ owners) |
| 1 | صف الـ company | `FOR KEY SHARE` / `FOR SHARE` لكل اللي بيكتب تحت الشركة (منح، كتابات، تحويل، تعويض، CP-4). `FOR UPDATE` **فقط** للـ rotation، ولأخذ مقعد (إعادة تفعيل عضو *محذوف*، قبول دعوة). **ممنوع** لإجراءات السحب العاجلة (انظر F11-09) |
| 2 | **أقفال الأعضاء كمجموعة واحدة** (`lockMembers`) بترتيب `id` تصاعدي (canonical = lowercase) | **exclusive** لكل عضو بتتغيّر سلطته، **shared** لكل عضو بيعتمد عليه الـ transaction (الـ actor). المجموعة بتتدمج قبل الأخذ (exclusive بيكسب) فمفيش shared→exclusive upgrade |
| 3 | صفوف الأعضاء | تصاعدي (بعد الخطوة 2 أي transactionين بيتنازعوا بيكونوا اتسلسلوا على قفل عضو) |
| 4 | المخازن / الـ inventory | تصاعدي |

- **ليه ده بيمنع الـ cycle:** أي transactionين بيتنازعوا على قفل بيتنازعوا أولاً على *أصغر* مفتاح مشترك؛ اللي بياخده بيكمل (ومش محتاج حاجة أصغر من اللي معاه) والتاني بيستنى. مفيش طريق A ينتظر B وB ينتظر A. (مُثبت بـ: اختبار ترتيب على recorder + 40 جولة سباق على اتصالات خام + 60 منحة متعاكسة؛ ومُجرَّب بـ negative control: ترتيب غير مرتب = أحمر.)
- **مفتاح القفل canonical:** `'stockmind:member:' || $1::uuid::text`، والـ JavaScript بيحوّل لـ lowercase قبل الترتيب. (طبقتين: كل واحدة لوحدها كافية؛ شالهم الاتنين = أحمر.)
- **مدة الانتظار محدودة:** كل transaction سلطة بتبدأ بـ `lock_timeout` (`AUTHORITY_LOCK_TIMEOUT_MS`، الافتراضي **10 ثواني**، من 100ms لـ 120s؛ قيمة خارج المدى = الافتراضي). انتهاء المهلة أو اختيار الـ DB لضحية deadlock بيرجع **503 `AUTHORITY_BUSY`** (قابل لإعادة المحاولة) والـ transaction بيتعمله rollback كامل.
- **الـ tenancy قبل أي قفل:** هدف من شركة تانية = 404 فوراً من غير قفل (قبل Series 11 كان admin من شركة تانية يتحبس خلف قفل عضو في شركتك).
- **ما بنادّعيش:** إن الـ 64-bit hash مفيهوش تصادم (لو حصل، أعضاء مش مرتبطين بيستنوا بعض؛ مش بيفوّت قفل)، ولا إن مفيش انتظار تحت حمل أعلى من المقاس.

### المسارات
| المسار | company | locks (actor مشترك + هدف حصري) | actor re-authorized جوه الـ tx |
|---|---|---|---|
| `PUT /team/members/:id/access` | KEY SHARE | actor S + target X | ✔ `MANAGE_USERS` + anti-escalation |
| `PUT /team/members/:id/warehouses` (legacy) | KEY SHARE | actor S + target X | ✔ `MANAGE_USERS` (**جديد**) + role/status/warehouses بيتعاد قراءتهم جوه الـ tx |
| `POST /warehouses` + `initialAccess` (CP-4) | KEY SHARE | actor S + **كل** الأهداف X دفعة واحدة | ✔ `CREATE_WAREHOUSE` (**جديد**، defence-in-depth) + `MANAGE_USERS` لكل هدف |
| suspend / remove / role / revoke-sessions | **لا صف company** (قفل العضوية العادل) | actor S + target X | ✔ policy على صف الـ actor المقفول |
| reactivate عضو *محذوف* | قفل العضوية + `FOR UPDATE` (مقعد) | actor S + target X | ✔ |
| كتابة مخزون / تحويل | **KEY SHARE (جديد)** ثم member S | member S | ✔ `assertActorAuthorized` |
| تعويض | SHARE ثم member S | member S | ✔ |
| تدوير الـ generation | `FOR UPDATE` | member S | ✔ `MANAGE_RECOVERY` |

## 3. ضمانات الـ linearization
لكل زوج (منح، سحب سلطة الـ actor):
1. **لو منح أخدت أقفالها الأول:** السحب بيستنى لحد ما المنح تعمل commit أو rollback — بتتفوّض على سلطة سليمة، والسحب بيسري بعدها.
2. **لو السحب عمل commit الأول:** المنح بتشوفه (الـ actor بيتحمّل من الـ DB جوه الـ tx بعد القفل) وبترفض (401/403) من غير أي أثر (مفيش صف، مفيش event، مفيش مخزن).
3. **مفيش حالة ثالثة.** اللي اتعمله commit قبل السحب بيفضل (مفيش إلغاء رجعي).
- مُغطّى لـ: demote→Staff، demote→Manager، suspend، remove، revoker بيتبع البروتوكول خارج الـ service، الـ legacy endpoint، CP-4 (أهداف متعددة)، **وسحب بيحصل بعد الـ guard وقبل أخذ أي قفل** (3 مسارات).
- **حدود:** القراءات (GET) بتتفوّض عند وصول الطلب؛ إنشاء مخزن بدون `initialAccess` وكتابات الكتالوج بتعتمد على فحص الـ guard (نافذة milliseconds)؛ الكتابات المالية/المخزون جوه الـ tx.

## 4. اكتشافات Series 11 (كلها مؤكّدة بإعادة إنتاج أو اختبار أحمر على الكود القديم)
| # | الاكتشاف | الحالة |
|---|---|---|
| **F11-01** | منح بتعمل commit بعد ما سلطة الـ actor اتسحبت (4 أنواع سحب + revoker البروتوكول + المسار الـ legacy) | **CONFIRMED** (`before-fix-reproduction.txt`) → مصلّح |
| F11-01b | المسار الـ legacy مفيهوش إعادة تفويض للـ actor جوه الـ tx (سحب بيـcommit أول ومع ذلك الـ legacy رجّع 200) | **CONFIRMED** → مصلّح |
| F11-05 | مفتاح القفل من نص الـ URL: UUID بحروف كبيرة = قفل مختلف عن اللي كتابات العضو بتأخده | **CONFIRMED** → مصلّح |
| F11-06 | admin من شركة تانية بيتحبس خلف قفل عضو مش بتاعه | **CONFIRMED** → مصلّح |
| F11-07 | deadlock حقيقي بين كتابة مخزون (member S ثم company key-share) وإجراء عضوية (company FOR UPDATE ثم member X)؛ 500 للكتابة | **CONFIRMED** (`deadlock detected` في `claimIdempotencyKey`) → مصلّح |
| F11-08 | الـ legacy `PUT .../warehouses` كان بيسيب منح بنطاق من غير ما يقول | **CONFIRMED** → 409 `SCOPED_GRANTS_PRESENT` |
| **F11-09** | **تجويع (starvation)**: إجراء عضوية عاجل (suspend…) استنّى 9 د 45 ث ولسه (4 كتّاب متواصلين) لأن `FOR UPDATE` على صف الشركة مش عادل ضد الـ key-share اللي كل كتابة ماسكاه | **CONFIRMED** بالقياس → مصلّح (قفل عضوية عادل بدل صف الشركة) |
| F11-02 | `CAPABILITY_MODE` غلط كان بيختار `off` بصمت | **CONFIRMED** → مصلّح (§5) |
| F11-04 | shadow بيصنّف أي فرق "expected" لو العضو عنده أي grant | **CONFIRMED** → مصلّح (§6) |

## 5. `CAPABILITY_MODE` (F11-02)
| القيمة | السلوك |
|---|---|
| غير موجود أو فاضي/مسافات | `shadow` (الافتراضي الموثّق) |
| `off` | تفويض legacy فقط، **اختيار مشغّل صريح** (بيتسجل في اللوج وقت التشغيل) |
| `shadow` | legacy بيقرر، الجديد بيتحسب ويتقارن |
| `enforce` | الـ capability model بيقرر، fail closed |
| أي حاجة تانية (`enfroce`, `on`, `true`, أحرف full-width…) | **رفض**: خطأ عند import الـ `AppModule` (قيمة البيئة الحقيقية) و`ConfigModule.validate` (قيمة جاية من `.env`) قبل ما الـ DB تتلمس؛ وتحت process شغال أي قرار بيفشل مغلقاً (مفيش fallback) |
- الحروف الكبيرة والمسافات مقبولة (`" ENFORCE "` = enforce). رسالة الخطأ محدودة (24 حرف) ومطبوعة فقط.
- **الافتراضي لسه `shadow`.** مفيش تغيير في أي إعداد إنتاج.

## 6. تصنيف فروق الـ shadow (F11-04)
الفرق **expected** فقط لو: الـ model الجديد بيسمح بـ capability C على مخزن W بينما legacy بيمنع، **وفيه grant نشط (`access_grant`) على W بالظبط بيحمل C بالظبط** (C warehouse-level ومعروفة). كل الباقي **unexpected**:
- اللي legacy سمح بيه والجديد منعه؛ توسّع مفيش grant بيفسّره (مخزن تاني، capability تانية، org/financial، توسّع دور)؛ capability مش في الكتالوج؛ عضو من شركة تانية؛ فرق مفيش حاجة تفسّره.
- grant منتهي/مسحوب/لسه ما بدأش مبيفسّرش حاجة (النافذة بتتعاد وقت التصنيف).
- **مفيش principal / model / company في الـ token** = `incomplete` (مش parity ومش equal). فشل الحساب = `errors`.
- الـ ring (آخر 50 فرق) بمعرّفات فقط: route, userId, capabilities, warehouseIds, verdict, reason, justifiedBy, unexplained. لا token ولا body ولا قيم (مُختبَر).
- **الـ telemetry كافية؟** لبروفة **غير إنتاجية** محكومة: نعم، بشرط تفريغ `snapshot()` ولوج `capability-shadow-unexpected` بعد كل جولة. **لقرار إنتاج: لا** — عدّادات في ذاكرة العملية، بتتصفّر مع إعادة التشغيل، مش مجمّعة بين instances، ومفيش retention ولا alerting.

## 7. الرجوع (rollback) بين الأوضاع
| الانتقال | الأثر (مُختبَر: `capability-shadow.pg.spec` — "F11 rollback"، 6 personas × 18 طلب × 4 أوضاع) |
|---|---|
| `enforce → shadow/off` | **تضييق فقط**: كل ما legacy بيسمح بيه كان الـ model الجديد بيسمح بيه. الـ scoped manager بيفقد كل ما جاله من grant (مخزنه الوحيد 404، التسوية/التحويل 403)؛ الـ personas legacy بدون أي تغيير |
| `off/shadow → enforce` | الإضافات = بالظبط تأثير الـ grants على مخازنها (wmOnly: مخزنه ورصيده وinbound؛ wmMixed: `changes` على w3). التحويل لسه محتاج الـ capability على الطرفين |
| الـ grants وقت الـ rollback | **بتفضل في الـ DB (dormant)**. الـ admin بيشوفها بـ `effective:false` وبـ `profiles[].available:false`؛ **بترجع تشتغل تلقائياً عند الرجوع لـ enforce** ← لازم مراجعتها قبل التفعيل مرة تانية |
| `/me/capabilities` | بيرجّع نظرة legacy خارج enforce (`engine.enforced:false`)؛ الموبايل بيتنقل حسب اللي السيرفر بيطبّقه (كاش 300s + تحديث عند الرفض/foreground) |
| عمليات أوفلاين قديمة | السيرفر بيعيد الحكم عليها دايماً (A10) |
| إنشاء `warehouse_manager` خارج enforce | مرفوض (`PROFILE_NOT_ENFORCED`) |
- **الرجوع من enforce قرار مشغّل مقصود** وليه أثر أمني (تضييق وصول مدراء المخازن، يتعلنوا)، **مش fallback تلقائي**؛ مفيش تحويل تلقائي بين الأوضاع في الكود.

## 8. تغطية enforce (F11-03)
- الـ suite الكاملة اتشغّلت تحت `CAPABILITY_MODE=enforce` (63 suite، 552 اختبار) **باستثناء ملف واحد**: الـ fixture المجمّد `tests/equivalence/production-bb071ed/movement-history.security.spec.ts` (8 اختبارات) — بيركّب الـ controller بدون الـ capability model (خط الإنتاج مفيهوش model)، فالـ guard تحت enforce **بيرفض بالتصميم**. اتشغّل لوحده تحت enforce: **6 فشلوا (اترفضوا)، 2 عدّوا (الرفض/المسار المغلق)** = fail closed.
- **التغطية البديلة المُلزَمة:** `tests/unit/movement-history.security.spec.ts` (مشتق، model مبني من مستخدم الطلب) بيحمل **نفس الـ 8 عناوين حرفياً** ويشتغل أخضر تحت shadow وenforce؛ و`enforce-coverage.spec.ts` بيفشل لو أي عنوان اختفى منه.
- suites بتثبّت وضعاً مختلفاً بنفسها (مش بتختبر enforce في تشغيلة enforce): `permissions.guard.spec` (off عمداً)، `capability-mode.spec` (بتغيّر البيئة)، و`capability-shadow.pg.spec` (بتتنقل بين الأوضاع وفيها خطوات enforce).
- الجدول invariant ← suites في التقرير §6.

## 9. ما لم يتغيّر عمداً
لا migration، لا اعتماديات، لا موبايل، الافتراضي `shadow`، Manager العالمي كما هو، `item.set_cost` موثّق وغير منفَّذ، R-18/R-19/R-20 سياسة غير منفَّذة.

## 10. حدود معروفة (مش مصلّحة هنا)
- إنشاء مخزن بدون `initialAccess` وكتابات الكتالوج بتعتمد على فحص الـ guard وقت الطلب.
- `FOR UPDATE` على صف الشركة لسه موجود في: تدوير الـ generation (عملية مشغّل بعد restore)، قبول الدعوة، إعادة تفعيل عضو محذوف (مقعد). دول **مش سحب سلطة**، لكنهم ممكن يستنوا تحت كتابة متواصلة؛ الأخيرة محدودة بـ `AUTHORITY_BUSY`، الباقي غير محدود المهلة.
- لا قياس على قاعدة بعيدة أو حمل إنتاجي؛ لا اختبار جهاز؛ لا مراجعة خارجية.
- الـ shadow telemetry في الذاكرة فقط (§6).
- الاختبارات الحتمية بتتحكم في الترتيب عبر أقفال/صفوف يمسكها الاختبار (مش عبر نقاط توقف في الكود)؛ مفيش ادّعاء إن كل تداخل زمني ممكن اتجرّب.

## 11. معايير القبول المقترحة لبروفة enforce *غير إنتاجية* مستقبلية (مش تفويض)
انظر التقرير §15.
