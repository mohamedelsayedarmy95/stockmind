# STOCKMIND — SERIES 10 REPORT: Scoped Access (S2: Capability Profiles, Scoped Grants, Adaptive Navigation, CP-4)

> الفرع: `feature/series10-scoped-access` (worktree `D:\Projects\StockMind-wt\series10-scoped-access`) من `d24719d` (آخر HEAD لـ Series 09، متطابق مع `origin` وقت البدء). **لا merge، لا Production/Neon، لا AAB، ولا أي تفاعل مع جهاز Huawei أو adb.**
> العقد التقني: `SERIES_10_CAPABILITY_AUTHORIZATION_CONTRACT.md`. الأدلة: `series10-evidence/`.

## 1. الحكم
**ENGINEERING PASS — PHYSICAL DEVICE DEFERRED** (على بيئة تطوير فقط).

| الجزء | الحكم | ملاحظة |
|---|---|---|
| المحرك (Capability engine) | **PASS** مع حد صريح | الافتراضي **shadow** (القديم هو اللي يقرر)؛ `enforce` متاح ومختبَر بالكامل لكن **مش مفعّل في أي مكان** كإعداد افتراضي. |
| Warehouse Manager المحدود بنطاق | PASS تحت `enforce` فقط | تحت shadow/off الـ grant موجود لكن بلا أثر، والـ API بيرفض إنشاءه (لا تحكّم وهمي). |
| CP-4 + إدارة المنح (backend) | PASS | ذرّي ومختبَر. |
| الموبايل | منطق + شاشات: PASS على Jest/tsc؛ **الجهاز: DEFERRED — DIRECTOR PHYSICAL ACCESS REQUIRED** | مفيش component tests. |
| TOCTOU | PASS (3 سيناريوهات + ضغط) | مع اكتشاف ثلاث مشاكل أقفال اتصلحت (§5). |
| Production | **NO-GO** | بدون تغيير. |

## 2. اللي اتبنى
- **Migration `1792610000000`:** `permission_profiles` (إصدارات immutable)، `access_grants` (مخزن، مدة، سحب، FKs مركّبة tenant-safe، grant نشط واحد لكل عضو ومخزن)، `access_grant_events` (append-only)، `down()` fail-closed. `warehouse_access` القديم **ما اتنسخش**: dual-read كـ grant `operator` ضمني.
- **Engine:** مقيِّم نقي بنظرتين (`legacy` = القرار قبل Series 10 حرفياً، `scoped` = الجديد)، default-deny، `canAll` للتحويل (المصدر والوجهة)، `mayGrantProfile` ضد التصعيد. `CAPABILITY_MODE=off|shadow|enforce` تتقرأ كل طلب؛ مراقب shadow بعدادات وفروق "مقصودة/غير مقصودة".
- **Profiles:** `operator v1` (= Staff الحالي بالظبط، parity مُثبت على كل persona × قدرة × مخزن، وعلى بيانات legacy المعاد بناؤها)؛ `warehouse_manager v1` (= operator + تسوية + تحويل + تعديل بيانات المخزن على مخازنه). **ما فيهوش:** تكلفة، فريق، كتالوج، إنشاء/حذف مخزن، recovery.
- **الإدارة:** `GET /team/access-profiles`، `GET|PUT /team/members/:id/access` (استبدال المجموعة + `expectedVersion` + سبب)، أحداث. المسار القديم `PUT .../warehouses` شغّال ويسجّل أدلة.
- **CP-4:** مخزن جديد = لا أحد؛ `initialAccess` اختياري وذرّي، غير المخوّل يترفض ومفيش مخزن بيتعمل.
- **`GET /me/capabilities`:** وصف لسلطة العضو الفعلية (بيرجّع نظرة legacy خارج enforce)، `accessVersion`، `no-store`.
- **التفويض داخل الـ transaction:** `assertActorAuthorized` في الحركات/التحويل/التعويض/التدوير، تحت **قفل عضو عادل** (advisory) + `FOR SHARE`.
- **الموبايل:** snapshot في الذاكرة فقط، تنقل متكيّف، أزرار حسب القدرة، شاشة `team-access`، نموذج CP-4، إشارة تحديث عند رفض السيرفر، عقد UI.

## 3. Global Manager مقابل Scoped Warehouse Manager
| | Manager (عالمي) | Warehouse manager (محدود) |
|---|---|---|
| الهوية | دور `Manager` | دور `Staff` + grant |
| المخازن | كلها (بدون تغيير) | المخازن المُسنَدة فقط (غيرها 404 مطابق لمخزن غير موجود) |
| كتالوج، إنشاء مخزن | ✔ | ✘ |
| تسوية/تحويل | ✔ | ✔ على مخازنه؛ التحويل يحتاج الطرفين |
| فريق/منح/recovery/تكلفة | ✘ (التكلفة ✘ منذ Series 09) | ✘ |
لا حاجة اتحلّت بمنح الدور العالمي: `@Roles` الوحيد (`register-device`: ADMIN, STAFF) بيعدّي Staff أصلاً.

## 4. الاختبارات (الأرقام الفعلية، آخر commit مختبَر `2bb0053`)
| الفحص | النتيجة |
|---|---|
| Backend `tsc` / build نضيف | exit 0 / exit 0، `dist/main.js` ✓، **12/12 migrations** |
| **Backend PG كامل ×3 على قواعد جديدة** (الوضع الافتراضي = shadow) | **57 suites passed + 3 skipped · 459 passed + 3 skipped** في كل تشغيلة، exit 0 ×3 (Series 09: 54 / 395 → **+3 suites، +64 اختبار**) |
| تشغيلة إضافية بـ `CAPABILITY_MODE=enforce` على كل suites القديمة | 55 suites · 438 passed، exit 0 (استُثنى `movement-history.security` ×2: بتركّب controllers بدون النموذج، فـ enforce بيرفض بتصميمه؛ الثاني fixture إنتاج مجمّد) |
| `capability-evaluator.spec.ts` (وحدة) | 28 |
| `scoped-access.pg.spec.ts` (HTTP، enforce) | 25 |
| `capability-shadow.pg.spec.ts` (off/shadow/enforce) | 6 |
| `release-safety.migration.pg.spec.ts` | 29 (24 + 5 جدد: seed=constants، parity نطاق الأعضاء، FKs tenant-safe، immutability، down() fail-closed) |
| Mobile `tsc` + Jest | exit 0 · **20 suites، 308 tests** (Series 09: 18 / 273) |

**Negative controls:** backend 14 (N1–N14)، mobile 8 (MM1–MM8) — كلها أحمر في النهاية. **اتنين ما اتمسكوش من أول مرة** (صدق): N6 (شكل أول = mutant مكافئ؛ استبدلته بشكل أقوى فاتعمل hang وفشل 3 اختبارات) وN14 (fail-open عند غياب النموذج كان مغطّى بحارس المخزن؛ اتضاف اختبار على endpoint بلا مخزن فاحمرّ). التفاصيل: `series10-evidence/negative-controls*.txt`.

## 5. أخطاء حصلت وانصلحت (مفصّلة بصدق)
1. **تجويع (starvation) لسحب الصلاحية:** `FOR UPDATE` على صف العضو ممكن يستنى للأبد خلف سيل `FOR SHARE` متداخل — اختبار الضغط اتجمّد 240 ثانية. الحل: قفل advisory عادل لكل عضو.
2. **Deadlock حقيقي** (اتكشف بـ 500 في `PUT access`): إدخال مفتاح الـ idempotency بيعمل `KEY SHARE` على صف العضو (عبر الـ FK) قبل قفل العضو الجديد. الحل: قفل العضو أول خطوة في كل transaction كتابة. بعدها 0 deadlocks في الضغط.
3. **عيب كامن من Series 09:** عكس ترتيب أقفال بين **التعويض** (عضو ثم company) و**تغيير العضوية** (company ثم عضو). اتصلح بترتيب موحّد (company ← عضو ← مخازن). **ما حصلش في تشغيلات Series 09**، لكن كان ممكن في الإنتاج بنسبة نادرة.
4. **اختبار `recovery-integrity` كان بيعد حركات قاعدة البيانات كلها** (مش الشركة)، فبقى هش مع أي spec بيكتب بالتوازي. اتحصر على شركة الـ spec.
5. خطأ اقتباس في اختبار الـ cross-contract لم يكشفه `tsc` (الاختبارات خارج tsconfig) وكشفته الـ suite الكاملة؛ اتصلح.
6. 4 fixtures اتعدّلت بسبب تغيير constructor/queries (permissions guard، DI، stock-cache، movement-history)؛ الـ guard بقى يقبل غياب النموذج (`@Optional`) فـ fixtures الإنتاج المجمّدة ما اتلمستش (enforce بيرفض عند غيابه).
7. 429 من الـ throttler في اختبارات الضغط والقياس (100/دقيقة) ← استُبدل storage الـ throttler داخل الـ specs دي فقط.

## 6. الأمان — النتائج
- **A1–A10:** كلها مغطّاة باختبارات (خريطة في العقد §13). لا تصعيد: Staff/scoped/Manager لا يمنحون؛ مفوَّض بـ `MANAGE_USERS` مش بيمنح أكتر مما يملك ولا على مخزن مش بتاعه؛ لا تعديل ذاتي.
- **عزل:** مخزن خارج النطاق = 404 مطابق لمخزن غير موجود (قوائم، id، رصيد، sync، lookup، replacement، تحويل — وكل وجهة تحويل)؛ شركة تانية = 404.
- **مالي:** لا profile ولا Manager ولا Staff بيشوف التكلفة؛ NT-12 أخضر؛ تفويض صريح بدور مخصّص **على مستوى الشركة** ومعروض بصدق في `/me/capabilities`؛ `item.set_cost` **موثّق بتصميم هجرة، وغير منفَّذ**، وإنشاء المنتج بتكلفة للـ Manager كما هو.
- **TOCTOU:** سحب grant أو تغيير دور بيـcommit أثناء انتظار كتابة ← الكتابة ترفض بدون أثر في الـ ledger؛ كتابات جارية بتخلص قبل السحب؛ بعد السحب كل الكتابات الجديدة 404 (ضغط: 4 كتّاب، 12 سحب/منح متتالي، **0 deadlock**). العمليات اللي اتعملها commit قبل السحب **باقية** (مفيش ادّعاء إلغاء).

## 7. الأداء (محلي، نفس الجهاز، `s2-perf.json`؛ مش قابل للتعميم على Production)
| | القيمة |
|---|---|
| طلب محروس (`GET /stock/balance`) وسيط | off 3.58 ms · shadow 6.67 ms (**+3.09**، p95 +3.6) · enforce 5.17 ms (**+1.59**، p95 +1.67) |
| `GET /me/capabilities` | وسيط 3.17 ms (مالك) / 3.27 ms (scoped)، p95 ≈ 4.2 ms |
| استعلام الـ grants على 12,000 grant | `Bitmap Index Scan: ix_access_grants_user_active`، تنفيذ 0.155 ms، round-trip وسيط 0.55 ms (p95 0.75) |
| كتابة مخزون وحدها | وسيط 9.5 ms، p95 10.8 |
| كتابة أثناء سحب/منح متكرر (4 كتّاب) | وسيط 9.9 ms، p95 26.8، p99 35.8؛ ردود: 335×201، 705×404؛ **0 deadlock** |
| طلب سحب/منح الإدارة | وسيط 27 / 36 ms |
**ملاحظة:** shadow أغلى من enforce لأنه بيحسب القديم والجديد معاً؛ على قاعدة بعيدة كل استعلام بيزيد زمن الشبكة.

## 8. الجهاز
**DEFERRED — DIRECTOR PHYSICAL ACCESS REQUIRED.** ما اتلمسش الـ Huawei ولا adb، ولا استُخدم emulator. سيناريوهات مؤجلة (UNVERIFIED على جهاز): التنقل حسب الدور على كل persona، شاشة `team-access`، نموذج CP-4، سحب منحة أثناء جلسة مفتوحة، outbox بعد سحب، العربي/RTL.

## 9. Git
- الفرع `feature/series10-scoped-access`؛ commits: `5a24c17` (backend core) · `807676a` (اختبارات + قفل عادل) · `a8a6ab3` (mobile) · `d33b2f6` (عقد + docs + negative controls) · `2bb0053` (إصلاح اختبار) · `33c3039` (gate + perf) ثم commits التوثيق والـ handoff. **آخر commit كود: `a8a6ab3` (mobile) / `807676a` (backend). آخر commit مختبَر: `2bb0053`.** حالة الرفع في الرد النهائي.

## 10. المخاطر المتبقية وعوائق Production
1. **`enforce` غير مفعّل عالمياً** — قرار Director + بروفة على بيانات حقيقية غير إنتاجية بصفر فروق shadow غير مقصودة؛ لسه ما اتعملتش على بيانات حقيقية.
2. **R-18** تنظيف `audit_logs` القديمة (سياسة معتمدة، **منفَّذ: لا**، محجوب على Production). **R-19** ملكية legacy (سياسة معتمدة: دليل + مشغّل؛ **منفَّذ: لا**). **R-20** التكلفة: رفض افتراضي منفَّذ؛ نطاق مخزن مالي وـ`item.set_cost` **غير منفَّذين**.
3. التفويض المالي الصريح حالياً **على مستوى الشركة** (دور مخصّص) — ممنوع وصفه كمحدود بمخزن.
4. نافذة قصيرة: تفويض طلب بدأ قبل لحظة السحب بملّي ثانية (ما بين الـ guard والـ transaction) بيتحكم فيها الفحص داخل الـ transaction للكتابات؛ القراءات مش مغطّاة داخل transaction (بتتغير من أول طلب جديد).
5. تكلفة shadow (+3 ms محلياً) ولازم تتقاس على قاعدة بعيدة قبل أي نشر.
6. لا اختبار جهاز ولا component tests ولا جهازين؛ D7 (refresh واحد لكل مستخدم).
7. باقي عوائق الإصدار (Production NO-GO): R12 (TLS)، بروفة restore/rotation، release line (الخيار A غير منفَّذ)، فحص Neon المسبق، مراجعة خارجية، ترقية الأجهزة.
8. جدول `permission_profiles` القديمة `roles/permissions` مجمّد وشغّال؛ قرار حذفه مؤجل.

## 11. الخطوة التالية المقترحة (واحدة، توصية مش تفويض)
**بروفة shadow على نسخة بيانات حقيقية غير إنتاجية (مع تفويضك) + اختبار الجهاز لـ Series 09 و10 بحضورك** قبل أي تفعيل `enforce`؛ ولو عاوز شريحة ميزة بدلها: S3 (بيانات المساءلة + `domain_events`) لأنها تعتمد على الهوية والصلاحيات اللي اتبنت.
