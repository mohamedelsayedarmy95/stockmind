# STOCKMIND — SERIES 13 REPORT: Authorization safety, shadow observability & operational truth

> الفرع: `hardening/series13-authority-observability` (worktree `D:\Projects\StockMind-wt\series13-authority-observability`) من `feature/series12-standalone-qa` @ `6df3ec9`.
> العقد: `SERIES_13_CONCURRENCY_AND_TELEMETRY_CONTRACT.md`. الأدلة: `docs/handoff/series13-evidence/` + لوجات `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_s13_*`.
> **بدون merge، بدون Production/Neon، بدون AAB/Play، بدون enforce في أي بيئة، بدون موديل خارجي.** كل البيانات synthetic على PostgreSQL 15.19 مؤقتة (`127.0.0.1:55433`).

## 0. الحكم

| البند | الحكم |
|---|---|
| **SERIES 13** | **ENGINEERING PASS** للنطاق — **Huawei DEFERRED** (الموبايل مش متوصل طول السلسلة؛ التحقق على الجهاز اتعمل على الـ emulator). Production: **NO-GO** (بدون تغيير). مش إذن بتفعيل enforce |
| N-1 (trigger آخر Owner) | **CONFIRMED بإعادة إنتاج حتمية → FIXED** بـ migration forward-only `1792620000000`؛ + 3 عيوب مرتبطة اتأكدت واتصلحت (F13-02 انتظار غير محدود لـ `companies FOR UPDATE`، F13-03 تنزيل الـ Owner الوحيد بـ SQL، F13-04 `REPEATABLE READ` يشيل الـ Owners) |
| N-2 (أدلة shadow) | **FIXED**: نوافذ أدلة قابلة للقراءة برّه الـ process، بحكم محافظ، وقناة تشخيص للمشغّل المحلي بس؛ + F13-05 (إنذار unexpected كاذب بسبب الساعة) اتكشف واتصلح |
| N-3 (أخطاء الإدارة) | **FIXED** ومتأكد على الـ emulator بـ AUTHORITY_BUSY حقيقي (رسالة صح، مفيش إعادة إرسال، الإعادة اليدوية نجحت) |
| R-37 (الرصيد المجهول) | **FIXED من السبب الجذري** ومتأكد على الـ emulator (unknown / confirmed / last-known / استلام متطابور مايزوّدش، بالعربي والإنجليزي) |
| البوابات | Backend PG ×3 على قواعد جديدة **69 suites + 4 skipped / 620 + 4** كل مرة؛ enforce **68 + 4 / 612 + 4**؛ build نضيف 13/13؛ Mobile tsc 0 + Jest **24 / 389**؛ **29/29 negative controls RED**؛ QA APK **21/21 فحص** |
| الافتراضي | `CAPABILITY_MODE=shadow` بدون تغيير؛ `enforce` ماتفعّلش في أي بيئة |

## 1. نقطة البداية (متحقَّق قبل أي تغيير)

| البند | النتيجة |
|---|---|
| الفرع الأساسي | `feature/series12-standalone-qa` = `6df3ec9` = `origin` (نفس الـ SHA)، شجرة نضيفة؛ `git diff --name-only d63cfbe 6df3ec9` كله تحت `docs/` |
| `main` (Director) | 7 تغييرات غير مـcommit **ما اتلمستش** |
| worktree Series 13 | اتعمل جديد: `git worktree add -b hardening/series13-authority-observability … 6df3ec9`؛ `node_modules` (backend) junction لـ `shared-warehouse`، و`mobile/node_modules` junction لـ `series04-integration` (tsc/Jest) — نسخة حقيقية اتعملت قبل بيلد QA (§11) |
| Series 12 worktree | **ما اتلمسش** (قراءة فقط) |
| المساحة | C: 40.5 GB، D: 96 GB فاضيين (قبل البدء) |
| Nemotron | تقريره موجود في `D:\StockMind_Backups\Maintenance\` — **ما اتقراش ولا اتنفّذ منه حاجة** (§15) |

## 2. N-1 — trigger آخر Owner وترتيب الأقفال: **CONFIRMED → FIXED**

**التحقيق (قبل أي تغيير):** `users_guard_last_owner` (migration `1792600000000`) بياخد `SELECT … FROM companies … FOR UPDATE` جوه الـ UPDATE بتاع صف العضو، يعني **بعد** خطوتي 2 و3 (أقفال الأعضاء وصفوفهم). أي كتابة مخزون/منحة/تعويض بتاخد صف الشركة shared (خطوة 1) وبعدين تستنى قفل العضو. ده عكس الترتيب الموثّق في Series 11.

**إعادة الإنتاج الحتمية** (`tests/integration/owner-guard-lock-order.pg.spec.ts`، HTTP حقيقي، `deadlock_timeout=1s`، التفاصيل والجراف في `series13-evidence/n1-reproduction.md`):

| السيناريو | قبل (كود Series 12) | بعد |
|---|---|---|
| Owner B بيكتب مخزون و Owner A بيعلّقه (الـ suspension هي اللي بتكتشف) | **503 AUTHORITY_BUSY**، الكتابة 201، **deadlocks +1** | 200؛ الكتابة **401 ACCESS_REVOKED** ومتسجلتش؛ 0 deadlocks |
| نفسه (الكتابة هي اللي بتكتشف) | **الكتابة 500**، deadlocks +1 | 200 / 401 |
| B بيعدّل مخازن Staff و A بيعلّق B | **503**، deadlocks +1 | 200 / 401، الصفوف زي ما هي |
| تعليق Owner تحت سيل key-share من أعضاء تانيين (`lock_timeout=1.5s`) | **8.2 ث ومخلصش غير لما السيل وقف** (الـ timeout ماحدّوش) | 11 ms |
| إعادة تفعيل عضو محذوف / قبول دعوة تحت نفس السيل | **8.2 / 8.3 ث** بنفس الطريقة | 14 / 239 ms |
| 3 Owners بيعلّقوا بعض في دايرة + 6 كتابات، 6 جولات | **5xx في أول جولة** | 0 × 5xx، 0 × 503، Owner واحد على الأقل دايماً |
| SQL: تنزيل الـ Owner الوحيد لـ Staff | **اتعمل commit: صفر Owner شرعي** | `owner_requires_admin_role` |
| SQL: جلستين `REPEATABLE READ` شالوا الـ Owners الاتنين | **الاتنين commit: صفر Owner** | `owner_change_requires_read_committed` |
| SQL: `SERIALIZABLE` | آمن (SSI `40001`) | زي ما هو |
| شركة تانية ماسكة أقفالها | مستقلة (10 ms) | مستقلة (20 ms) |

**الإصلاح (migration جديدة forward-only `1792620000000-OwnerGuardLockOrder`):**
1. الـ trigger بيتسلسل على **قفل العضوية العادل** (`stockmind:company-members:<company>`، خطوة 0) بدل صف الشركة. إجراء العضوية ماسكه من الأول (re-entrant = مفيش انتظار جديد)، وأي SQL مباشر بيتسلسل معاه.
2. `role` اتضاف لأعمدة الـ trigger: Owner نشط **مايقدرش يسيب دور Admin** وهو لسه Owner (زي السياسة)؛ والـ Owner الباقي لازم يكون **شرعي** (`is_owner AND active AND Admin`).
3. تغيير مقعد Owner تحت `REPEATABLE READ` مرفوض (الفحص هناك مش صحيح منطقياً).
4. **قفل مقاعد عادل جديد** (`stockmind:company-seats:<company>`) لقبول الدعوة وإعادة تفعيل المحذوف بدل `companies FOR UPDATE` (نفس عيب التجويع غير المحدود، اكتشاف مرتبط F13-02).

**البدائل اللي اتدرست واترفضت (بأدلة):**
- *اللي كان مقترح في الـ mandate كاحتمال: "مراجعة ترتيب أقفال الـ transaction"* — يعني ياخد إجراء العضوية `companies FOR UPDATE` في الأول (خطوة 1): **مرفوض** لأنه بيرجّع F11-09 بالظبط (Series 11 قاس تجويع 9:45 دقيقة)، وقسنا هنا إن `lock_timeout` مابيحدّهوش أصلاً.
- `FOR NO KEY UPDATE` على صف الشركة: مابيتعارضش مع `KEY SHARE` لكنه بيتعارض مع `FOR SHARE` بتاع التعويض (اللي بياخده قبل قفل العضو) → نفس الـ cycle مع التعويض. **مرفوض.**
- قفل صفوف الـ Owners التانيين `FOR KEY SHARE`: مابيتعارضش مع `NO KEY UPDATE` فمفيش تسلسل → صفر Owners ممكن. **مرفوض.**
- شيل الـ trigger والاعتماد على سياسة التطبيق: بيكسر "SQL مباشر مايعدّيش الثابت". **مرفوض.**

**ترتيب الأقفال بعد الإصلاح:** العقد §2. **مفيش cycle متكشف في النطاق المختبر**؛ ده **مش** ادعاء إن النظام خالي من الـ deadlock عموماً.

## 3. Migration: fresh / upgrade / down

`tests/integration/series13-owner-guard.migration.pg.spec.ts` (3 اختبارات، قواعد scratch خاصة بيه):
- **ترقية** من schema Series 12 (12 migration + أعضاء synthetic: شركة Owner واحد + Manager/Staff، شركة Owners اتنين، عضو موقوف): بتشغّل `OwnerGuardLockOrder1792620000000` **بس**؛ hash صفوف الأعضاء **مطابق** قبل وبعد؛ الدالة الجديدة متركّبة والـ trigger عليه `role`؛ القاعدة الجديدة شغالة على البيانات المترقية.
- **تثبيت جديد** (13): نفس نص الدالة ونفس تعريف الـ trigger بالحرف زي المترقّية.
- **down()**: بيرجّع دالة وtrigger Series 09 بالحرف (بيانات صفر)، و`up()` تاني = حالة التثبيت الجديد.
- لم تُشغَّل على أي قاعدة حقيقية.

## 4. N-2 — أدلة shadow قابلة للملاحظة: **FIXED (observable, trustworthy within its stated limits)**

**قبل:** `snapshot()` مالوش أي caller في `src/` (اتأكد على `6df3ec9`)، `incomplete` عدّاد بس، الـ ring بيرمي القديم بدون عدّ، `reset()` من غير أثر، ومفيش هوية process أو فترة.

**بعد (العقد §5):** نوافذ أدلة لكل process (instance id عشوائي، window id/sequence/label/openedBy/closeReason)، عدّادات دقيقة + تفصيل `incomplete` و`errors` بالسبب و`unexpected` بالسبب والـ route، عينات محدودة **والزيادة بتتعد** (أول 100 unexpected محفوظين)، سطور لوج منظمة بميزانية والزيادة بتتعد، حكم محافظ `CLEAN / UNEXPECTED_DIFFERENCES / INCONCLUSIVE / NO_EVIDENCE` (CLEAN بس لما فيه مقارنات ومفيش فرق غير مبرَّر ومفيش دليل ناقص والوضع shadow طول النافذة — والـ guard بيعدّ كل طلب في كل وضع). قنوات: سطر لوج `capability-shadow-window-closed` عند القفل والـ shutdown (السجل الدائم)، progress دوري، ومسار تشخيص **للمشغّل المحلي بس** (token ≥ 32 + loopback socket + header؛ أي رفض = 404 الـ router؛ JWT أي tenant مش طريق)، وأداة `scripts/shadow-evidence.mjs` بتحفظ التقرير + SHA-256 وبترفض تثق في نافذة عدّت restart.

**ملاحظات فعلية (HTTP، `series13-evidence/n2-shadow-evidence.md`):** legacy traffic = CLEAN (31/31 equal)؛ منحة scoped = expected وCLEAN؛ توسيع غير مبرّر (loader بيعامل Staff كـ Manager) = **UNEXPECTED_DIFFERENCES** (7)؛ principal ناقص = INCONCLUSIVE (15 incomplete)؛ model بيفشل = INCONCLUSIVE (15 errors) والـ e-mail اللي في رسالة الخطأ مش موجود في أي تقرير/لوج؛ الإجابات نفسها legacy في كل نافذة. الأداة: CLEAN exit 0 بـ SHA-256 متحقق، وبعد restart حقيقي للتطبيق: **`RESTART_DETECTED` exit 3** وسطر الـ shutdown اتسجّل.

**البدائل:** endpoint تحت JWT لـ Admin الشركة — **مرفوض** (الأدلة عابرة للشركات = تسريب cross-tenant). خدمة telemetry خارجية — مرفوضة بالـ mandate ومش لازمة. لوج بس من غير قناة تحكم — مايسمحش بفتح/قفل نافذة على لحظة محددة من أداة بروفة؛ اتعمل الاتنين.

**عيوب اتكشفت وصلحت أثناء البوابات (مش مخفية):**
- عدّ الطلب في الـ guard كان برّه أي `try`، فـ shadow service مكسور/جزئي كان بيحوّل طلب مسموح لـ 500 (5 suites unit فشلوا في تشغيلة كاملة). دلوقتي معزول: **الـ telemetry عمرها ما تغيّر قرار صلاحية** (`2b7f4e8`).
- **F13-05 (موجود من Series 11، اتكشف هنا):** تشغيلة كاملة فشلت مرة في `capability-shadow.pg.spec`: منحة scoped لسه معمولة اتصنّفت **unexpected**. التشخيص (2 من 8 تشغيلات معزولة، `series13-evidence/n2-clock-skew-diagnosis.jsonl`): الـ loader بيفلتر المنح بـ `now()` بتاع الـ DB، والـ classifier كان بيعيد الفحص بساعة التطبيق، وعلى Windows ساعة Node كانت **متأخرة 6–15 ms** عن PostgreSQL (`valid_from 22:41:59.076` والتصنيف عند `…59.070`). يعني **إنذار كاذب** في البوابة اللي محتاجة صفر unexpected. الإصلاح: الـ loader بيرجّع `now()` بتاع نفس الـ statement كـ `Principal.asOf` (داخلي، مش في أي response ولا في `accessVersion`)، والـ classifier بيحكم بيه بدقة الميكروثانية. بعده: 10/10 (`6b53988`).

## 5. N-3 — أخطاء الإدارة على الموبايل: **FIXED**

العقد §6. `adminFailure` بيفرّق: **AUTHORITY_BUSY** (مؤقت: تحذير "محصلش أي تغيير — جرّب تاني بعد شوية"، إعادة قراءة، المسودة محفوظة) / **SCOPED_GRANTS_PRESENT** (تعارض حقيقي: خطأ بيوجّه لـ «صلاحيات المخازن»، مش قابل للتكرار) / الخادم مش متاح (503 من غير code) / الشبكة / باقي الرفض بخرايط Series 09–10 زي ما هي. متوصل في Team وصلاحيات المخازن والمخزن الجديد (CP-4). **مفيش إعادة إرسال تلقائية** (الـ mutations `retry:false` والـ client بيعيد بعد 401 بس — مختبر statically)، ومفيش نجاح في أي `onError`. `SCOPED_GRANTS_PRESENT` مابيطلعش غير من الـ legacy PUT اللي مفيش شاشة بتناديه (بحث) — الربط دفاعي.

## 6. R-37 — الرصيد المجهول مش صفر: **FIXED (root cause)**

**السبب الجذري (كود، مش نص):** شاشة الاستلام/الصرف كانت بتحسب `onHand = synced ?? query ?? 0` — أي فشل/تحميل/عدم وصول = الرقم **0**، ونفس الحاجة في كارت التحويل (`balance ? … : 0`) و`availability` (`Number(x) || 0`)، وقائمة المخزن كانت بتقول "Loading…" للأبد لو أول مزامنة فشلت، والصرف بيقول "من 1 لـ 0".

**الإصلاح:** نموذج domain pure (`balance-truth.ts`، العقد §7): confirmed (0 حقيقي) / last-known بوقته / loading / unknown (unreachable, no-access, mismatch, invalid). مايعرضش رقم مخزن تاني أبداً، ومايعرضش رقم مخزن الصلاحية اتشالت منه حتى من الـ cache، والصرف من رصيد **معروف** بس، و**الاستلام المتطابور عمره ما بيزوّد** الرقم أو الحد. اتطبّق على Receive/Dispatch، كارت التحويل، قائمة مخزون المخزن.

## 7. بدائل هندسية أفضل اتعملت (ملخص الانحرافات)

| المقترح | ليه أضعف | البديل | الأثر | الدليل | الحدود |
|---|---|---|---|---|---|
| "مراجعة ترتيب الأقفال" بتقديم `companies FOR UPDATE` | بيرجّع F11-09 + غير محدود بـ `lock_timeout` | الـ trigger على قفل العضوية (خطوة 0) | مفيش تغيير API؛ أخطاء SQL جديدة للمشغّل | §2، negative controls B1/B2 | SQL متزامن مع إجراء تطبيق ممكن يعمل deadlock **بيتكشف** |
| (غير مذكور) قبول الدعوة/إعادة التفعيل على `FOR UPDATE` | نفس التجويع غير المحدود | قفل مقاعد عادل | نفس السلوك، أسرع تحت حمل | B7/B8، اختبار سباق المقعد الأخير | — |
| endpoint shadow للـ Admin | تسريب cross-tenant | operator-only (token+loopback+404) + لوج + أداة | مسار جديد مقفول افتراضياً | allowlist test، B12/B13 | per-process |
| ربط الأخطاء بنص لكل شاشة | تكرار ونصوص بتختلف | `adminFailure` مشترك + `admin.error.*` | الخرايط القديمة زي ما هي | M5–M7، M9 | — |
| تعديل نص "0" | الرقم الكاذب بيفضل جوه | نموذج domain + حد صرف من رصيد معروف | الصرف بدون رصيد معروف ممنوع (كان حده 0 أصلاً) | M1–M4، M8 | — |
| اختبار CP-4 Series 11 بترتيب عشوائي | flaky (3/10 فشل على كود ما اتغيّرش) | الترتيبين متبنيين ومتختبرين | اختبار فقط | 6/6 بعد | — |
| إعادة فحص صلاحية المنحة بساعة التطبيق (Series 11) | إنذار unexpected كاذب لمنحة عمرها < 16 ms | وقت الـ DB بتاع الـ snapshot (`asOf`) بدقة µs | تصنيف shadow بس؛ القرارات زي ما هي | 10/10 بعد، B19 | `asOf` غايب لو مفيش صفوف (مفيش منح أصلاً) |

## 8. الأمان والتوافق الخلفي

- مفيش تغيير في عقد API العام ولا في أي استجابة موجودة؛ الإضافات: مساران operator مقفولين افتراضياً، أكواد خطأ DB جديدة لـ SQL المشغّل، وسطور لوج جديدة.
- الخصوصية المالية (Series 09): التكلفة مش في أي تقرير/لوج shadow (اختبار بقيمة sentinel)، ومفيش تغيير في DTOs.
- العزل بين الشركات: مفاتيح الأقفال لكل شركة؛ اختبار استقلال؛ الأدلة مش متاحة لأي tenant.
- Series 07 / 10 / 11 / 12: الـ suites بتاعتهم كلها جزء من التشغيلات الكاملة (§10)؛ حدود QA بتاعة Series 12 مختبرة في Jest (build-boundary) وفي فحص الـ APK (§11).
- الافتراضي `CAPABILITY_MODE=shadow`؛ `enforce` ماتفعّلش في أي بيئة (تشغيلة enforce = Jest على قاعدة مؤقتة بس).

## 9. Migrations
| البيئة | النتيجة |
|---|---|
| تثبيت جديد (13) | PASS |
| ترقية من Series 12 (12 → 13) ببيانات synthetic | PASS، صفوف الأعضاء مطابقة |
| down ثم up | PASS، تعريفات مطابقة بالحرف |
| build نضيف | نضيف: مسح `*.tsbuildinfo` و`dist`، `nest build` exit 0، `dist/main.js` موجود، **13/13 migrations متترجمة** (منها `1792620000000`)، والملفات الجديدة في `dist` |

## 10. الاختبارات والـ negative controls (الأرقام الفعلية)

**Backend (PostgreSQL 15.19 مؤقتة، قاعدة جديدة لكل تشغيلة، `backend-gate.ps1`، `--maxWorkers=2`)، آخر commit كود مختبَر `6b53988`:**

| التشغيلة | Suites | Tests | Exit | Log |
|---|---|---|---|---|
| كاملة 1 (default shadow) | 69 passed + 4 skipped (73) | 620 passed + 4 skipped (624) | 0 | `stockmind_gate_s13_gate_1.log` |
| كاملة 2 | 69 + 4 | 620 + 4 | 0 | `…_gate_2.log` |
| كاملة 3 | 69 + 4 | 620 + 4 | 0 | `…_gate_3.log` |
| كاملة `CAPABILITY_MODE=enforce` (الملف المجمّد بس مُستثنى) | 68 + 4 | 612 + 4 | 0 | `…_enforce_full.log` |
| الملف المجمّد لوحده تحت enforce | 1 failed | 6 failed (**كلهم 403 = fail closed**، صفر 5xx) / 2 passed | 1 (متوقع) | `…_enforce_frozen.log` |
| perf صريحة (`capability-perf` + `authority-lock-perf`) | 2 | 2 | 0 | §12 |

- مقابل Series 11 (64 + 4 / 560 + 4): **+5 suites، +60 اختبار**. الـ 4 skipped = نفس الشرطيات (`capability-perf`, `authority-lock-perf` اتشغّلوا صراحةً تحت؛ `s0-cost-exposure.repro`, `auth-lookup.perf` **ما اتشغّلوش**، زي Series 11).
- suites جديدة: `owner-guard-lock-order.pg` (12)، `series13-owner-guard.migration.pg` (3)، `shadow-observability.pg` (7)، `shadow-window` unit (6 حالات/12 اختبار)، `capability-shadow.window` unit (16)؛ واتمدّت: `entitlements.pg` (+1 سباق المقعد الأخير)، `capability-shadow.service` (+1)، `shadow-classifier` (+4)، `http-logger.redaction`، `tenant-middleware.auth-contract` (+1)، `authority-linearization.pg` (CP-4 بقى الترتيبين).
- **قبل التشغيلات النهائية، فشل حقيقي اتلقط واتصلح (مش re-run لحد ما يخضر):** (1) أول تشغيلة كاملة `82bda9d`: 5 suites/17 اختبار — telemetry برّه `try` + allowlist الـ @Public + CP-4 flaky (§4، §7). (2) تشغيلة 3 على `2b7f4e8`: 1 اختبار — F13-05 (فرق الساعة) اتشخّص بـ instrumentation مؤقت (2/8)، اتصلح، 10/10.
- **flakes متوصّفة بالتكرار:** CP-4 القديم 3/10 فشل على كود ما اتغيّرش → بعد التصليح 6/6؛ `capability-shadow.pg` 2/8 → بعد F13-05 10/10.
- **Build:** نضيف (`*.tsbuildinfo` و`dist` اتمسحوا): `nest build` exit 0، `dist/main.js` موجود، **13/13 migrations متترجمة**.

**Mobile:** `tsc` 0؛ Jest **24 suites / 389 اختبار** على `f7847ed` (آخر commit موبايل) (Series 12: 22/359).

**Negative controls (`_local-tools\scripts\s13-negative-controls.ps1`، `series13-evidence/negative-controls.txt`):** كل control بيشيل حماية واحدة، يشغّل الاختبارات اللي المفروض تمسكها، ويرجّع الملف بالبايتات الأصلية ويتأكد إن الـ worktree نضيف.
| Control | الحماية اللي اتشالت | اتمسك؟ |
|---|---|---|
| B1 | الـ trigger يرجع لـ `companies FOR UPDATE` | **RED** (2: deadlock مع كتابة الـ Owner) |
| B2 | مفتاح قفل الـ trigger مختلف عن التطبيق | **RED** (SQL ماستناش قفل العضوية) |
| B3 | قاعدة Owner يفضل Admin | **RED** (2) |
| B4 | `role` برّه أعمدة الـ trigger | **RED** |
| B5 | رفض `REPEATABLE READ` | **RED** |
| B6 | Owner غير Admin يتحسب باقي | **RED** |
| B7 | قبول الدعوة على `companies FOR UPDATE` | **RED** (تجويع تحت السيل) |
| B8 | إعادة تفعيل المحذوف على `companies FOR UPDATE` | **RED** |
| B9 | قبول الدعوة من غير أي تسلسل للمقاعد | **RED** (2: مقاعد زيادة؛ سباق بطبيعته) |
| B10 | الحكم يتجاهل `incomplete` | **RED** (4) |
| B11 | id العضو يطلع في التقرير بدل الاسم المستعار | **RED** |
| B12 | الـ guard يثق في `req.ip` بدل الـ socket | **RED** |
| B13 | التشخيص مفتوح بتوكن أقصر من 32 | **RED** |
| B14 | الزيادة في العينات ماتتعدّش | **RED** |
| B15 | عضو مش active يتقارن | **RED** |
| B16 | هيدر التوكن مش redacted في اللوج | **RED** |
| B17 | الـ guard مابيعدّش الأوضاع | **RED** |
| B18 | الحكم يتجاهل طلبات برّه shadow | **RED** (2) |
| B19 | الـ classifier يرجع لساعة التطبيق | **RED** |
| B20 | الـ telemetry برّه `try` (تقدر تغيّر قرار) | **RED** (15 في 3 suites) |
| M1 | الرصيد المجهول = 0 | **RED** (3) |
| M2 | رقم مخزن تاني يتعرض | **RED** |
| M3 | الاستلام المتطابور يزوّد حد الصرف | **RED** |
| M4 | رقم مخزن الصلاحية اتشالت منه يتعرض من الـ cache | **RED** |
| M5 | AUTHORITY_BUSY يتعامل كـ generic | **RED** (2) |
| M6 | تعارض المنح يتقال قابل للتكرار | **RED** (2) |
| M7 | mutations الإدارة بتعيد لوحدها | **RED** |
| M8 | شاشة الحركة ترجع للرقم الخام | **RED** |
| M9 | خريطة Team تنسى AUTHORITY_BUSY | **RED** |

**النتيجة: 29/29 RED.** أول تشغيلة للـ harness كان فيها عيب (قائمة الاختبارات اتبعتت كـ argument واحد: 12 control ماشغّلوش أي اختبار واتعلّموا GREEN غلط، وB13 ماكانش بيتـcompile) — اتصلح الـ harness (ومابقاش يقول GREEN لو مفيش اختبار اشتغل) واتعادت الـ 12 كلها، مكتوب في ملف الأدلة.

## 11. الموبايل: QA build والجهاز

**هوية التوقيع (قبل أي بيلد):** المفتاح موجود في `_local-tools\qa-signing\` (`stockmind-qa.p12` + كلمة سر DPAPI + بصمة الشهادة)؛ بصمة الشهادة `65b206f5…4b72` = بصمة الـ APK المتثبّت من Series 12؛ hash ملف الـ keystore نفسه قبل وبعد البيلدات **مطابق** (ما اتولّدش ولا اتغيّر). مفيش مفتاح ولا كلمة سر في Git. **توصية:** نسخة احتياطية مشفّرة لمجلد `qa-signing` كله (الـ DPAPI مربوط بحساب Windows ده: نسخة الملفات لوحدها مش هتفك على جهاز تاني).

**البيلد:** `node_modules` حقيقي اتنسخ من Series 12 (نفس الـ lockfile بالبايت؛ 96,101 ملف / 3.58 GB؛ **من غير** `npm ci` أو كاش npm). `qa-build.ps1 -Online` (نفس معاملات APK الـ Series 12): بيلدين، الاتنين 21/21 فحص: (1) `stockmind-qa-429003-a4890bd.apk` (SHA-256 `0e0ae153…4ea9`) اتجرّب على الـ emulator؛ (2) **النهائي `stockmind-qa-429032-f7847ed.apk`** — SHA-256 **`25b1d9184dc369d2658ed813baad930ef5db8f4a6005531c961970dfe1cdab24`**، 141,648,860 bytes، versionCode **429032** (> 428472 المتثبّت = ترقية في مكانها)، versionName `1.0.0-qa.f7847ed`، مش debuggable، Hermes bundle `7d65dea3…011b` (2,975,012 bytes)، cleartext لـ `127.0.0.1` بس، الموقِّع `65b206f5…4b72`، Online Preview `http://127.0.0.1:3000/api/v1`. **AAB: لأ. cloud/EAS: لأ.**

**الـ emulator (`emulator-5554`، Android 10، AVD `stockmind_qa_api29`):** التحديث بـ `qa-install.ps1 -Serial emulator-5554` = `install -r` (`firstInstallTime` زي ما هو = بيانات QA محفوظة؛ نجاح `-r` = نفس التوقيع). backend Series 13 مؤقت على **بورت 3013** (لأن 3000 ماسكه backend الـ Series 12 من امبارح — **ما اتلمسش**)، و`adb reverse tcp:3000 tcp:3013` **على الـ emulator بس**؛ قاعدة `stockmind_qa_s13` synthetic؛ `AUTHORITY_LOCK_TIMEOUT_MS=2000`.

| الفحص | المُلاحظ | الدليل |
|---|---|---|
| يفتح من غير Metro | فتح على البيانات الأوفلاين الموجودة؛ Settings: `Build 1.0.0-qa.a4890bd` | — |
| R-37: كارت التحويل والسيرفر مش متاح (قبل أي مزامنة) | **"Current balance: unknown — the server can't be reached"** (برتقالي) بدل 0 | `emulator/r37-1-…png` |
| R-37: نفس الشاشة بعد الرجوع | "Current balance: 40" (W2 رز = 40 مزروعة) | `r37-2-…png` |
| R-37: الاستلام متزامن | "Current balance: 100" (`movement-balance-confirmed`) | `r37-3-…png` |
| R-37: بعد قطع الاتصال وفشل الـ poll | قائمة المخزن: "Offline · figures from 2:26:09 AM"؛ الاستلام: **"Last known balance: 100 · last confirmed 2:26:09 AM"** (`movement-balance-last-known`) | `r37-4-…png` |
| R-37: استلام +5 أوفلاين | "Saved on this device… not in stock until confirmed"؛ الرصيد فضل last-known 100 و"Pending +5" منفصل | `r37-5-…png` |
| بعد الرجوع | اتسلّم **مرة واحدة**: 105، rev 3، "+5 by you"؛ الـ ledger على السيرفر: inbound 100 (rev 1) + inbound 5 (rev 3) بس | `r37-6-…png` + استعلام |
| **N-3: AUTHORITY_BUSY حقيقي** (قفل عضو الـ Staff ماسكه psql 60 ث، Owner بيعلّق Staff) | **"Another change to this access is in progress. Nothing was changed — try again in a moment."** (برتقالي)، Staff فضل Active | `n3-1-…png` |
| مفيش إعادة إرسال تلقائية | بعد فك القفل (60 ث) + 12 ث: Staff `active`، `token_version 0`، **0 membership events** | استعلام |
| إعادة يدوية | نجحت: "QA Staff (synthetic) is suspended…"؛ وبعدين reactivate رجّعته Active | `n3-2-…png` |
| نافذة الأدلة طول الجلسة | نفس الـ instance، **CLEAN**: 39 compared / 39 equal، 26 طلب محروس كلهم shadow | `emulator/shadow-window-emulator-session.json` |
| **عيب اتكشف على الـ emulator** | سطر الرصيد الطويل وسطر الـ Pending في صف مابيلفّش → مقصوصين من الطرفين | `r37-5-…png` → اتصلح `f7847ed` — واتأكد على البيلد النهائي: السطرين ظاهرين كاملين وملفوفين (`r37-7-…png`)، وبالعربي RTL (`r37-8-…png`: «آخر رصيد معروف: 50 · آخر تأكيد …» و«مستنية +2 · لسه متأكدتش»)؛ والـ +2 اتسلّم مرة واحدة بعد الرجوع (52، rev 4) |

**الـ Huawei:** **DEFERRED** — الموبايل **مش متوصل** طول Series 13 (`adb devices` مفيهوش غير الـ emulator)؛ مفيش أي أمر اتبعت له، و`io.stockmind.app` / `io.stockmind.app.qa` عليه ما اتلمسوش. التثبيت عليه محتاج توصيله بحضورك: `mobile\scripts\qa-install.ps1 -Serial <serial>` (هيعمل `install -r` بنفس التوقيع؛ بيانات QA بتفضل).

## 12. الأداء والتزاحم (محلي)

**A/B على نفس الجهاز ونفس الوقت** (Series 12 `6df3ec9` مقابل Series 13 `6b53988`، متبادلين مرتين؛ `capability-perf` + `authority-lock-perf`؛ PostgreSQL 15.19 على نفس الجهاز؛ HTTP؛ `series13-evidence/perf-ab-series12-vs-13.json`). worktree الـ Series 12 اتأكد إنه ما اتغيّرش (`git status` فاضي قبل وبعد):

| القياس (median ms) | S12 a | S13 a | S12 b | S13 b |
|---|---|---|---|---|
| قراءة محروسة `off` | 4.65 | 4.57 | 4.47 | 5.02 |
| `shadow` | 7.13 | 7.20 | 6.94 | 7.67 |
| `enforce` | 6.53 | 6.53 | 6.37 | 6.96 |
| **shadow يزوّد** | 2.48 | 2.63 | 2.47 | 2.66 |
| enforce يزوّد | 1.88 | 1.97 | 1.90 | 1.94 |
| منحة لوحدها | 13.5 | 12.8 | 13.0 | 14.4 |
| منحة تحت 4 كتّاب + عضوية | 52.8 | 51.6 | 51.9 | 50.8 |
| إجراء عضوية تحت ضغط | 22.3 | 22.3 | 22.9 | 22.7 |
| كتابة مخزون تحت ضغط (median / p95) | 54.7 / 83.9 | 53.4 / 75.9 | 55.0 / 80.5 | 53.5 / 77.9 |
| deadlocks / AUTHORITY_BUSY | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

- **تكلفة نوافذ الأدلة:** ≈ **+0.17 ms** median في وضع shadow (عدّ وتصنيف لكل نافذة). مفيش فرق ملحوظ في `off`/`enforce` ولا في المنح والعضوية والكتابات.
- الأرقام المطلقة أعلى من تقرير Series 11 (مثلاً off 3.6 ms هناك) **لكن نفس الزيادة ظاهرة على كود Series 12 في نفس اللحظة** = ظروف الجهاز، مش الكود.
- أثر N-1 تحت تزاحم حقيقي: تعليق Owner تحت سيل key-share من **≥ 8.2 ث (غير محدود)** لـ **11 ms**؛ إعادة تفعيل محذوف من 8.2 ث لـ 14 ms؛ قبول دعوة من 8.3 ث لـ 239 ms (§2).
- محلي بس، HTTP تسلسلي للقراءات؛ **مش قابل للتعميم على Production/Neon**.

## 13. المخاطر والحدود المتبقية

| # | الخطر/الحد | الحالة |
|---|---|---|
| 1 | **تدوير الـ history generation** لسه `companies FOR UPDATE`: بيتجوّع تحت سيل كتابات و`lock_timeout` **مابيحدّهوش** (نفس الآلية المقاسة في N-1). إجراء مشغّل نادر، Admin + flag | **مفتوح** (محتاج تصميم fence مختلف؛ خارج النطاق) |
| 2 | SQL مباشر بالتوازي مع إجراء عضوية من التطبيق لنفس الشركة: deadlock **بيتكشف ويتلغى** (مش انتظار مفتوح). إجراء المشغّل الموثّق (العقد §3) بيمنعه | موثّق |
| 3 | `owner_change_requires_read_committed`: أي سكربت مشغّل تحت `REPEATABLE READ` بيغيّر مقعد Owner هيترفض (مقصود) | موثّق |
| 4 | migration `1792620000000` اتختبرت على synthetic بس؛ **مااتشغلتش على Neon/Production**؛ بتشتغل لوحدها عند أي boot بالكود ده | حد معروف |
| 5 | أدلة الـ shadow in-memory لكل process؛ مفيش تجميع بين instances؛ مش audit/monitoring | حد معروف (العقد §5.6) |
| 6 | قراءة وكتابة مسار التشخيص من غير rate limit خاص غير الـ throttler العام؛ مقفول افتراضياً وloopback بس | مقبول للبروفة المحلية |
| 7 | `SCOPED_GRANTS_PRESENT` على الموبايل مربوط دفاعياً بس (مفيش شاشة بتنادي الـ legacy PUT) | موثّق |
| 8 | الموبايل: مفيش component tests؛ التحقق من الشاشات = Jest للـ domain + فحص static + الـ emulator (§11) | حد معروف |
| 9 | Series 11 N-4 (`enforce-coverage.spec` بيقارن العناوين بس) | **مفتوح، بدون تغيير** |
| 10 | الضغط والأداء محلي على نفس الجهاز؛ ادعاء "مفيش deadlock" محصور في السيناريوهات المختبرة | حد معروف |
| 11 | R-18/R-19/R-20 سياسات غير منفّذة؛ R12 (TLS) مفتوح؛ عوائق Production من Series 05–11 زي ما هي | بدون تغيير |
| 12 | فرق ساعة التطبيق عن الـ DB (اتقاس 6–15 ms على Windows). اتصلح في الـ classifier. باقي المقارنات في `src/` (بحث `git grep`): انتهاء الـ plan، انتهاء الدعوة (TTL 7 أيام)، وقت انتهاء دعوة جديدة — حدود بالأيام، فالـ ms مالهاش أثر إلا في نفس لحظة الحد | مقبول؛ موثّق |

## 14. Git

- **الفرع:** `hardening/series13-authority-observability` (worktree `D:\Projects\StockMind-wt\series13-authority-observability`) من `6df3ec9`. **مش متدمج في أي حاجة.**
- **commits الكود:** `48de62c` N-1 (migration + seat lock + اختبارات) · `e60b90d` N-2 · `7f47a36` N-3 + R-37 (موبايل) · `82bda9d` اختبارات إضافية · `2b7f4e8` عزل الـ telemetry + allowlist + CP-4 · `6b53988` F13-05 (**آخر commit backend**) · `f7847ed` لفّ سطر الرصيد (**آخر commit موبايل = آخر commit كود**).
- **المختبَر:** backend PG ×3 + enforce + perf + negative controls على `6b53988` (الـ backend ماتغيّرش بعده)؛ Mobile tsc/Jest على `f7847ed`؛ الـ APK النهائي من `f7847ed`.
- **docs بعد كده بس:** `a4890bd` + commit التقرير/الـ handoff (`git diff --name-only f7847ed HEAD` = تحت `docs/` بس).
- 60 ملف، +3197/−198 (قبل التقرير والـ handoff). اعتماديات (`package*.json`): **صفر**. migrations: **+1** (13 إجمالاً).
- الرفع بدون force — النتيجة في الرد النهائي (`git ls-remote --heads origin hardening/series13-authority-observability`).
- `main` المتّسخ (7 ملفات) وworktree الـ Series 12: **ما اتلمسوش** (`git status` للـ Series 12 فاضي قبل وبعد).

## 15. التنسيق مع Nemotron (مهمة منفصلة)

مهمة Nemotron 3 Ultra (تدقيق التخزين وصيانة كاش محدودة عبر FCC/OpenRouter) **منفصلة تماماً عن Series 13**. ما اتقراش تقريره (`D:\StockMind_Backups\Maintenance\STORAGE_AUDIT_REPORT_2026-10-25.md`) ولا اتنفّذ أي توصية منه، ومفيش أي تنظيف أو حذف أو تغيير بيئة من ناحيتي. **مش معروف لي** إذا كان نفّذ أي حاجة (الـ mandate بيقول حالة التنفيذ ماتتفترضش). التداخل الوحيد الممكن: نسخة `mobile/node_modules` (§11) اتعملت بنسخ ملفات من worktree Series 12 (قراءة) **من غير** `npm ci` (مفيش استخدام لكاش npm)، والمساحة اتقاست قبل البيلد.

## 16. البروفة اللاحقة (synthetic shadow/enforce)

**أيوه، ممكن تتقترح بمسؤولية دلوقتي — كبروفة synthetic محلية، مش على بيانات حقيقية، ومش تفعيل.** الشرطين اللي كانوا مانعينها (Mission 00 N-1 وN-2) اتقفلوا بأدلة. اللي البروفة لازم تلتزم بيه (مقترح، يحتاج تفويض مستقل):
1. backend محلي واحد (`qa-local-backend.ps1` أو ما يعادله) على قاعدة `stockmind_qa_*` synthetic، و`SHADOW_DIAGNOSTICS_TOKEN` عشوائي للجلسة بس.
2. `scripts/shadow-evidence.mjs open <step>` → traffic محدد مسبقاً (شخصيات Owner/Manager/Staff + scoped grants) → `close`. **قبول الخطوة = `trusted: true` + `CLEAN` + `compared` ≥ حد متفق عليه + `guardedByMode` كله shadow**. أي `INCONCLUSIVE` أو `UNEXPECTED_DIFFERENCES` = وقف وتحقيق، مش إعادة لحد ما تخضر.
3. بعد CLEAN: خطوة `enforce` على **نفس القاعدة المؤقتة فقط**، بمعايير Series 11 §15، ثم الرجوع لـ shadow والتأكد إن الـ grants رجعت dormant.
4. **خارج البروفة:** أي بيانات حقيقية، Neon، Production، أكتر من instance (الأدلة مش متجمعة).
5. يفضّل قبلها: إصلاح أو قبول موثّق لخطر §13 #1 (تدوير الـ generation)، لأنه إجراء مشغّل ممكن البروفة تحتاجه.

## 17. قرارات محتاجة الـ Director

1. **مراجعة ودمج:** الفرع `hardening/series13-authority-observability` مش متدمج في أي حاجة. أي merge (في `main` أو RC أو release) قرارك.
2. **تفويض البروفة synthetic** (§16) — مش متفوّضة ومااتعملتش.
3. **migration `1792620000000`** على أي بيئة حقيقية مستقبلاً (هتشتغل لوحدها مع الـ boot): محتاجة قرار rollout + نسخة احتياطية + تشغيل checklist الـ runbook §13 الأول.
4. **تدوير الـ history generation** (خطر §13 #1): تصليح في سلسلة جاية ولا قبول موثّق كإجراء مشغّل نادر.
5. ****الـ Huawei:** تثبيت `stockmind-qa-429032-f7847ed.apk` لما توصّله بحضورك (`qa-install.ps1 -Serial <serial>`، `install -r`، نفس التوقيع)، وفحص سريع لنفس السيناريوهات (رصيد مجهول/آخر معروف، تحذير AUTHORITY_BUSY)**
6. **تنظيف التخزين (Nemotron):** أي تنظيف محتاج مراجعة تقريره وتفويضك؛ Series 13 ماعملتش أي تنظيف.
