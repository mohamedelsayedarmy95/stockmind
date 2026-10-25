# STOCKMIND — SERIES 11 REPORT: Authorization admission, concurrency safety & security hardening

> الفرع: `hardening/series11-authorization-admission` (worktree `D:\Projects\StockMind-wt\series11-authorization-admission`) من `feature/series10-scoped-access` @ `7e695d8`. **بدون merge، بدون Production/Neon، بدون AAB، وبدون أي تفاعل مع جهاز Huawei أو adb.**
> العقد: `SERIES_11_ENFORCEMENT_ADMISSION_CONTRACT.md`. الأدلة: `series11-evidence/`.

## 0. الحكم

| البند | الحكم |
|---|---|
| **SERIES 11** | **PASS** للنطاق (تصليب + أدلة) على بيئة تطوير؛ الجهاز **DEFERRED** |
| **حكم القبول لـ enforce** | **READY FOR NON-PRODUCTION ENFORCE REHEARSAL** — بشروط §15. **ده مش إذن بتفعيل `enforce`، ومش حكم على Production (NO-GO).** |
| الافتراضي | `CAPABILITY_MODE=shadow` (بدون تغيير) |

سبب الحكم ومحدوديته: كل ثغرة سلطة/تزامن لقيناها اتثبتت بإعادة إنتاج على كود Series 10 واتصلحت بدليل أخضر + negative control أحمر. **اللي لسه ناقص** (ولذلك البروفة قبل أي حاجة تانية): تشغيل shadow على بيانات حقيقية غير إنتاجية، قياس على قاعدة بعيدة، اختبار جهاز، مراجعة خارجية، وتليمتري دائم.

## 1. نقطة البداية والنطاق (متحقَّق)
- `feature/series10-scoped-access` @ `7e695d8`، نضيف، متزامن مع `origin`؛ آخر commit مختبَر لـ Series 10 `2bb0053` (سلف حقيقي للـ HEAD)؛ كود backend `807676a`/mobile `a8a6ab3`.
- worktree جديد بعد فحص تصادم الأسماء (لا فرع ولا مسار ولا remote بنفس الاسم). `node_modules` junctions زي Series 10.
- النطاق: تصليب فقط. **مفيش migration، مفيش اعتماديات (`package*.json` و`tsconfig*` بدون تغيير)، مفيش تغيير في `mobile/`** (مُتحقَّق بـ `git diff`).

## 2. F11-01 — إلغاء سلطة الـ actor المانح أثناء المنح

**إعادة الإنتاج (قبل الإصلاح، Series 10 @ `7e695d8`، PostgreSQL حقيقية، HTTP):** المنح بتتوقف (parked) جوه الـ transaction بعد ما الـ actor اتفوّض، والسحب بيتبعت: **السحب عمل commit والمنح لسه شغالة** في كل الأنواع الأربعة (demote→Staff، demote→Manager، suspend، remove) وفي revoker بيتبع البروتوكول، وفي الـ legacy endpoint. وفي الـ legacy: **السحب عمل commit الأول والـ legacy رجّع 200 وكتب الصفوف** (مفيش إعادة تفويض جوه الـ tx أصلاً). الدليل: `series11-evidence/before-fix-reproduction.txt` (14 فشل من 22 قبل الإصلاح؛ بعد الإصلاح كلها أخضر).

**السبب الجذري:** `applyForMember` كان بيقفل **الهدف** فقط وبيحمّل الـ actor **من غير قفل**؛ والـ legacy endpoint مفيهوش فحص actor جوه الـ tx؛ وإجراءات العضوية كانت بتتسلسل على صف الشركة ومش على الـ actor.

**الإصلاح (§3 البروتوكول):** الـ actor بياخد قفل **shared** للـ transaction كلها، الهدف **exclusive**، كمجموعة مرتبة؛ الـ actor بيتحمّل بعد القفل من الـ DB؛ الـ legacy وCP-4 بيعيدوا التفويض جوه الـ tx.

**النتيجة المُثبتة (27 اختبار حتمي في `authority-linearization.pg.spec.ts`، كلها أخضر):**
| السيناريو | النتيجة |
|---|---|
| الـ actor اتسحب أثناء منح جارية (demote→Staff / →Manager / suspend / remove) | السحب **بيستنى** (مش committed وقت ما المنح parked، بيتفحص من اتصال تالت)، المنح 200 ثم السحب 200 |
| revoker بيتبع البروتوكول خارج الـ service | بيستنى على قفل الـ actor (`waitersOnMember = 1`) |
| legacy `PUT .../warehouses` | نفس الضمان + الـ actor بيتعاد تفويضه جوه الـ tx |
| الـ actor اتسحب **بعد الـ guard وقبل أي قفل** (PUT access / legacy / CP-4؛ السحب = demote→Manager لأن Manager بيحتفظ بكل صلاحيات المخزن ويفقد `MANAGE_USERS` فقط) | **401/403، مفيش صف ولا event ولا مخزن** |
| CP-4 بأكتر من هدف | الـ actor محجوز لحد الـ commit؛ رفض هدف غير مؤهل = مفيش مخزن ولا grant ولا evidence |
| فشل validation (profile غلط) | rollback + الأقفال بتتحرر فوراً |
| شركة تانية (3 endpoints) | 404 فوراً **من غير قفل** (قبل: بتتحبس) |
| Owners متبادلين (suspend كل واحد للتاني) | واحد ينجح (200)، التاني يترفض، بدون deadlock/5xx |
| 60 منحة متعاكسة actor/target + 40 جولة سباق `lockMembers` على اتصالات خام | صفر deadlock، صفر `AUTHORITY_BUSY` |
| انتظار قفل ممسوك أكتر من المهلة | 503 `AUTHORITY_BUSY` في الوقت المحدد، لا أثر، وبعد التحرير نفس الطلب ينجح |

## 3. أقفال actor/target والترتيب العالمي
انظر العقد §2 (الجدول الكامل). الخلاصة: `[قفل عضوية الشركة (لإجراءات العضوية)] ← company (KEY SHARE/SHARE) ← أقفال الأعضاء كمجموعة بترتيب id تصاعدي (actor S / target X، exclusive بيكسب، لا upgrade) ← صفوف ← مخازن`. مفتاح القفل canonical (lowercase)، ومهلة `lock_timeout` على كل transaction سلطة، وضحية deadlock أو انتهاء مهلة = 503 `AUTHORITY_BUSY` بدل 500.

## 4. ضمانات الـ linearization
(العقد §3.) لا منح بتعمل commit على سلطة اتسحبت بـ commit سابق؛ اللي اتعمله commit قبل السحب بيفضل. **حدود:** القراءات، إنشاء مخزن بدون `initialAccess`، كتابات الكتالوج = فحص الـ guard وقت الطلب.

## 5. F11-02 — حماية `CAPABILITY_MODE`
مفقود/فاضي → `shadow`؛ `off|shadow|enforce` (بغض النظر عن الحروف والمسافات) → كما هي؛ **أي قيمة تانية → رفض**: `parseCapabilityMode` بيرمي `CapabilityModeError`؛ بيتفحص عند import الـ `AppModule` (البيئة الحقيقية) وفي `ConfigModule.validate` (قيمة من `.env`) **قبل ما TypeORM يتصل**؛ وتحت process شغال أي قرار بيفشل مغلقاً (الـ guard مبيستدعيش legacy). **اكتشاف أثناء الشغل:** `ConfigModule.forRoot` في النسخة دي `async` فالـ validation وحدها بتتحول لـ unhandled rejection مش لخطأ متزامن — ولذلك اتضاف فحص متزامن وقت الـ import كمان. 23 اختبار (`capability-mode.spec.ts`) يشمل 13 قيمة غلط، حدود رسالة الخطأ، الـ startup، والـ runtime. `off` الصريح بيشتغل كـ legacy (واتفحص). الافتراضي لسه `shadow`.

## 6. F11-03 — تغطية enforce

**تشغيلة enforce كاملة:** `CAPABILITY_MODE=enforce` لكل الـ suites، **63 suite نجحت + 4 skipped، 552 اختبار نجح + 4 skipped، exit 0** (بدون الملف المجمّد الوحيد). **الملف المجمّد تحت enforce لوحده:** 6 فشلوا (اترفضوا) و2 عدّوا = **fail closed، مش مفتوح**.

**العلاقة بين الـ fixture المجمّد وبديله (Option B في الـ mandate، مبرَّرة):** الـ fixture (8 اختبارات) بيركّب الـ controller بدون capability model عمداً (مرآة خط الإنتاج) ومحظور تعديله. بديله `tests/unit/movement-history.security.spec.ts` بيحمل **نفس الـ 8 عناوين حرفياً** + 5 اختبارات cache، بـ model مبني من مستخدم الطلب، وبيعدّي تحت shadow **وenforce**. `enforce-coverage.spec.ts` (10 اختبارات) بيفشل لو بديله فقد أي عنوان.

| Invariant | suites اللي بتحمله تحت enforce (اختبارات) |
|---|---|
| تفويض حركات المخزون | `scoped-access.pg` (25: قراءات/كتابات/تحويل/تعويض/مزامنة)، `authority-linearization.pg` (27)، `shared-warehouse.pg` (13)، `tenant-concurrency.pg` (3)، handlers وحدات |
| تاريخ الحركات | `movement-history.security` بديل (13) + `enforce-coverage` (10)، `operation-lookup.pg` (8)، `scoped-access.pg` |
| نطاق المخزن/العضوية | `scoped-access.pg`، `shared-warehouse.pg`، `access-lifecycle.pg` (15)، `membership-policy` (14) |
| الخصوصية المالية | `financial-privacy.pg` (14)، `scoped-access.pg` (A7) |
| تعويض الاسترجاع + history generation | `recovery-integrity.pg` (32)، `sync-cursor-reset.pg` (6) |
| عزل الشركات | `tenant-concurrency.pg`، `tenant-middleware.auth-contract` (28)، `scoped-access.pg`، `authority-linearization` (tenancy) |
| الإبطال/السحب | `access-lifecycle.pg`، `scoped-access.pg` (A5/A6)، `authority-linearization` |
| Idempotency | `shared-warehouse.pg`، `stock-cache.consistency` (10)، `authority-linearization` (كتابات parked على مفتاحها)، `recovery-integrity.pg` |
| قواعد بيانات legacy المُعاد بناؤها | `release-safety.migration.pg` (29)، `shared-warehouse.migration.pg` (3) |
| توافق الـ API | `health.contract`، `stock-balance.contract`، `stockmind.test.ts`، `swagger-exposure` |

**suites بتختار وضعها بنفسها** (فمش دليل enforce في تشغيلة enforce): `permissions.guard.spec` (off عمداً)، `capability-mode.spec`، `capability-shadow.pg.spec` (فيها خطوات enforce). **Skipped الأربعة (شرطية، وما اتحسبوش passed في العدّ):** `capability-perf` و`authority-lock-perf` (اتشغّلوا صراحةً لوحدهم: نجحوا 1/1 و1/1 وطلّعوا JSON)، `s0-cost-exposure.repro` و`auth-lookup.perf` (**ما اتشغّلوش في Series 11**؛ أدلة Series 09).

## 7. F11-04 — تصنيف فروق الـ shadow
تصنيف نقي في `shadow-classifier.ts`: expected فقط لو grant نشط على نفس المخزن بنفس الـ capability (النافذة بتتعاد). الحالات التسع المطلوبة اتغطت: (1) grant على W1 لا يفسّر W2؛ (2) capability X لا تفسّر Y؛ (3) ما فقده legacy = unexpected؛ (4) capability مجهولة؛ (5) cross-tenant؛ (6) grant منتهي/مسحوب/لم يبدأ؛ (7) مفيش model/principal/company = `incomplete` وليس parity (والحساب الفاشل = `errors`)؛ (8) فرق grant `warehouse_manager` صحيح = expected مع تسمية الـ grant؛ (9) الـ ring واللوج بمعرّفات فقط. 17 + 13 اختبار وحدة + تحقق تكاملي (ring entry فيه `justifiedBy` بالـ grant بالظبط). **كفاية التليمتري:** كافية لبروفة غير إنتاجية محكومة، **مش** لقرار إنتاج (في الذاكرة، per-process، بتتصفّر، مفيش aggregation/alerting).

## 8. الرجوع (rollback)
(العقد §7.) مُختبَر على 6 personas × 18 طلب × (enforce, off, shadow, enforce): الرجوع **يضيّق فقط** (ما بيسمح بيه legacy ⊆ ما كان بيسمح بيه enforce)؛ shadow = off حرفياً؛ الرجوع لـ enforce بيرجّع نفس الإجابات؛ الإضافات عند التفعيل = تأثير الـ grants بالظبط. الـ grants بتفضل dormant (`effective:false` للأدمن) وبترجع تلقائياً مع enforce ← لازم مراجعتها قبل أي تفعيل تاني. **مفيش fallback تلقائي.** الرجوع قرار مشغّل بأثر أمني معروف (مدراء المخازن يفقدوا مخازنهم).

## 9. اختبارات سلبية وعيوب اكتُشفت
**Negative controls** (`negative-controls.txt`، 4 جولات): **23 تعريف**. جولة 1 (16): 13 أحمر و**3 ما اتمسكوش** (N1، N4، N6) — اتسجلوا بصدق وسببهم: حماية مكرّرة (طبقتين) فكانت "mutants مكافئة"، واختبار deadlock أعمى (بيدوّر على رسالة DB الخام والـ deadlock بقى يترجم لـ `AUTHORITY_BUSY`)، ومفيش اختبار بيسحب الـ actor *قبل* القفل. اتصلحوا باختبارات جديدة وتعريفات أدق. **الحالة النهائية:** كل حماية فردية = أحمر، **ما عدا** (أ) N4a/N4b: الـ canonical key فيه طبقتين كل واحدة لوحدها كافية (إزالة الاتنين N4c = أحمر)، (ب) N6c: إعادة تفويض `CREATE_WAREHOUSE` في CP-4 defence-in-depth لأن `MANAGE_USERS` لكل هدف بيغطيها (كل من يملك MANAGE_USERS بيملك CREATE_WAREHOUSE) — **مكافئ بالتصميم**. وجولة 4: N17 (إرجاع `FOR UPDATE` على صف الشركة) = أحمر (305s، بسبب التجويع نفسه).

**عيوب في الـ harness نفسه لقيناها (مش في الكود):** parker كان بيمسك key-share على الشركة فبيمنع السحب بنفسه (اتغيّر لقفل صف `warehouse_access`)؛ `remove` محتاج `{confirm:true}` (اتكشف بإعادة تشغيل الحالة منفردة وعلى الكود القديم)؛ `Promise.race` typing؛ سباق migrations لما suite perf اتنين اتشغّلوا مع بعض على DB جديدة (موجود قبل Series 11، **مش مصلّح**: انظر §13).

## 10. الأوامر والنتائج الفعلية (آخر commit مختبَر `4547af9`، PostgreSQL 15.19 مؤقتة، بيانات synthetic)
| الفحص | النتيجة |
|---|---|
| `npx tsc --noEmit` (backend) | exit 0 |
| build نضيف (مسح `dist` و`*.tsbuildinfo`) | exit 0، `dist/main.js` ✓، **12/12 migrations**، `member-lock.js` و`shadow-classifier.js` ✓ |
| **Backend كامل ×3 (shadow الافتراضي، DB جديدة لكل مرة)** | **64 suites نجحت + 4 skipped · 560 اختبار نجح + 4 skipped · exit 0 ×3** (Series 10: 57/459 + 3 → **+7 suites، +101 اختبار**) |
| تشغيلة enforce كاملة | 63 suites · 552 اختبار · exit 0 (الملف المجمّد الوحيد مُستثنى — §6) |
| الملف المجمّد تحت enforce | 6 فشل (رفض) / 2 عدّى = fail closed |
| Mobile `tsc` + Jest | exit 0 · **20 suites، 308 اختبار** (= Series 10؛ `mobile/` بدون تغيير) |
| اختبارات التحويل بين الأوضاع | `capability-shadow.pg` 7/7 (بينهم اختبار rollback الجديد) |
> الأرقام ×3 و enforce من `gate-s11.ps1` على `4547af9`؛ تشغيلات سابقة على commits أقدم (`8f5bfe3`: 62/546) اتبدّلت بعد كل تغيير كود.

## 11. الأداء والتزامن (محلي، نفس الجهاز، HTTP تسلسلي؛ **مش** قابل للتعميم على Production)
**مقارنة بنفس workload Series 10** (`capability-perf`، 600 طلب لكل وضع):
| | Series 10 | Series 11 |
|---|---|---|
| طلب محروس off (وسيط/p95 ms) | 3.58 / 4.97 | 3.61 / 5.18 |
| shadow | 6.67 / 8.57 (+3.09) | 5.80 / 7.59 (**+2.19**) |
| enforce | 5.17 / 6.64 (+1.59) | 5.34 / 7.28 (+1.72) |
| `/me/capabilities` owner / scoped | 3.17 / 3.27 | 3.28 / 3.37 |
| كتابة لوحدها | 9.51 / 10.8 | 9.87 / 12.0 |
| كتابة أثناء سحب/منح متكرر (وسيط / p95 / p99) | 9.94 / 26.8 / 35.8 | 9.40 / 27.4 / 36.2 |
| طلب سحب (وسيط) | 27.2 | 29.7 |
| طلب منح (وسيط) | 36.1 | **42.7** (+6.5: قفل شركة + أقفال مرتبة + عدّ الأعضاء) |
| deadlocks | 0 | 0 |
shadow أرخص (principal واحد لمقارنة النطاق بدل اتنين).

**workload جديد (`authority-lock-perf`، 4 كتّاب متواصلين على الهدف + منح + إجراءات عضوية):** منحة لوحدها: 100 عينة، وسيط 10.96 ms (p95 15.2). تحت التزاحم (60 جولة): منحة وسيط 40.1 (p95 47.8، max 62)، إجراء عضوية وسيط 16.8 (p95 22.5)، كاتب وسيط 40.1 (p95 61، max 103، **262 كتابة كلها 201**). عيّنات الانتظار (كل 5ms، 381 عينة): `advisory` 449، `transactionid` 222، `tuple` 63 (تراكمي عبر الـ backends)؛ **deadlocks = 0** (`pg_stat_database`)، **`AUTHORITY_BUSY` = 0**. **حدود:** عينات صغيرة، قاعدة محلية، توزيع انتظار الأقفال غير مقاس لكل طلب (فقط نهاية-لنهاية)، مفيش workload مشابه في Series 10 للمقارنة.

**اكتشاف التجويع (F11-09):** القياس كشف إن إجراء عضوية استنّى 9 د 45 ث تحت 4 كتّاب (`FOR UPDATE` على صف الشركة غير عادل ضد الـ key-share). اتصلح (قفل عضوية عادل)، واختبار "الإجراءات العاجلة مش بتتجوّع" بيقيس 5 إجراءات (suspend/reactivate/revoke-sessions/role + suspend للكاتب نفسه) تحت كتابة متواصلة: كلها 200 في < 4s.

## 12. الملفات المتغيرة (31 ملف، +2322/−97 قبل التقرير والعقد النهائيين وتحديثات الـ handoff)
كود: `app.module.ts`، `main.ts`، `capabilities.constant.ts`، `capability-evaluator.ts` (حقول نافذة الـ grant)، `shadow-classifier.ts` (جديد)، `capability.service.ts`، `permissions.guard.ts`، `warehouse-access.service.ts`، `member-lock.ts`، `access-grant.service.ts` (+حقل `effective`)، `membership.service.ts`، `team.service.ts`، `warehouse.service.ts`، `stock.service.ts`. اختبارات جديدة: `authority-linearization.pg`، `authority-lock-perf.pg`، `shadow-classifier`، `capability-shadow.service`، `capability-mode`، `enforce-coverage`، `member-lock`، `access-grant.lock-order`؛ معدّلة: `capability-shadow.pg` (+rollback)، `capability-evaluator` (قيمة غلط ترمي)، `movement-history.security` (model للطلب)، `stock-cache.consistency` (fake يعرف key-share). وثائق وأدلة: هذا التقرير، العقد، `series11-evidence/`.

## 13. المخاطر المتبقية
1. **`enforce` ما اتجرّبش على بيانات حقيقية** (حتى غير إنتاجية)؛ الأدلة synthetic.
2. تليمتري shadow في الذاكرة فقط (§7).
3. `FOR UPDATE` على صف الشركة لسه في: تدوير الـ generation (عملية مشغّل، بلا مهلة)، قبول الدعوة (بلا مهلة)، إعادة تفعيل عضو محذوف (بمهلة). مش سحب سلطة، لكن ممكن يتجوّعوا تحت كتابة متواصلة.
4. كتابات الكتالوج/إنشاء مخزن بدون `initialAccess` والقراءات = فحص guard وقت الطلب.
5. `AUTHORITY_LOCK_TIMEOUT_MS` الافتراضي 10s قرار منتج لم يُراجَع؛ تحت حمل أعلى ممكن 503 قابل لإعادة المحاولة (الواجهة الحالية ما بتتعامل معاه بشكل خاص — UNVERIFIED على الجهاز).
6. لا قياس على قاعدة بعيدة؛ تكلفة shadow/enforce هناك أعلى (كل استعلام = round trip).
7. **سباق migrations عند إقلاع نسختين على قاعدة جديدة** (لوحظ في الـ harness: `pg_class_relname_nsp_index`)؛ `migrationsRun:true` — لو أكتر من instance بيقلعوا معاً على نفس القاعدة. **UNVERIFIED في الإنتاج**، خارج النطاق.
8. لا اختبار جهاز/RTL، لا component tests للموبايل، لا مراجعة خارجية.
9. الاختبارات الحتمية بتتحكم في الترتيب بأقفال/صفوف بيمسكها الاختبار؛ مفيش ادّعاء بتغطية كل تداخل زمني.

## 14. عوائق Production (بدون تغيير + ما اتضاف)
Production = **NO-GO**. كل عوائق Series 10 باقية: R-18 (تنظيف `audit_logs`، سياسة معتمدة غير منفَّذة)، R-19 (ملكية legacy بدليل ومشغّل)، R-20 (`item.set_cost` غير منفَّذ؛ الرفض الافتراضي منفَّذ)، R12 (TLS)، بروفة restore/rotation، release line (الخيار A غير منفَّذ)، فحص Neon المسبق، ترقية الأجهزة، D7. **وإضافة:** تليمتري دائم/monitoring، قياس على قاعدة بعيدة، وسباق المigrations متعدد النسخ (§13.7).

## 15. معايير القبول المقترحة لبروفة enforce *غير إنتاجية* (مستقبلية؛ تفويض مستقل مطلوب)
**شروط مسبقة (من الـ Director):** (أ) تفويض صريح ببيئة غير إنتاجية ونسخة بيانات (لا Neon/Production إلا بإذن منفصل)؛ (ب) تحديد قيمة `AUTHORITY_LOCK_TIMEOUT_MS`؛ (ج) إخطار مدراء المخازن بأثر الرجوع؛ (د) نسخة البيانات مش فيها `audit_logs` قديمة بتكاليف نصية (R-18) وملكية كل شركة موثّقة (R-19).
**بوابات الدخول:** 1) الـ commit نفسه: backend ×3 + enforce + mobile أخضر؛ 2) مرحلة shadow على النسخة بتغطي كل personas وroutes الحقيقية: **0 unexpected، 0 errors، 0 incomplete**، وكل expected متتبّع لـ grant موجود ومُراجَع (بتفريغ `snapshot()` ولوج `capability-shadow-unexpected` بعد كل جولة)؛ 3) قياس زمن shadow/enforce على قاعدة بعيدة ضمن ميزانية متفق عليها؛ 4) تمرين رجوع فعلي enforce→shadow: تضييق فقط + مراجعة الـ grants الـ dormant؛ 5) سيناريو سحب أثناء حمل (كتّاب متواصلين) بزمن محدود و0 deadlock؛ 6) تكرار الاختبارات الحتمية 3× بدون flake.
**بوابات الخروج:** لا فرق unexpected، لا `AUTHORITY_BUSY` غير مفسَّر، نتائج موثّقة بأرقام، وقرار منفصل من الـ Director قبل أي خطوة أبعد.

## 16. الجهاز
**DEFERRED — DIRECTOR PHYSICAL ACCESS REQUIRED.** ما اتلمسش الـ Huawei ولا adb ولا emulator. مفيش ادّعاء RTL أو جهاز.

## 17. التوصية التالية (واحدة)
**بروفة shadow ثم enforce على نسخة بيانات غير إنتاجية بتفويض منك** وفق §15، مع اختبار جهاز لـ Series 09–11 بحضورك — قبل أي ميزة جديدة.
