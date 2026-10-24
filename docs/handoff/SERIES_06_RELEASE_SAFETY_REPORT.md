# STOCKMIND — SERIES 06: RELEASE-LINE RECONCILIATION & MIGRATION SAFETY HARDENING

> **التاريخ:** 2026-10-24 (Egypt Standard Time) · **الفرع:** `hardening/series06-release-safety` · **Worktree:** `D:\Projects\StockMind-wt\series06-release-safety`
> **الصلاحية:** CP-1 + CP-2 فقط، فرع تطوير معزول. **مفيش merge، ولا deploy، ولا إنشاء branch release، ولا لمس Production/Neon، ولا AAB/Play، ولا Council/موديل خارجي.**
> التصنيفات: `VERIFIED` (اتنفّذ واتأكد) · `PARTIAL` · `UNVERIFIED` · `CONFIRMED` · `HYPOTHESIS` (استنتاج ما اتجرّبش).
> **تحذير:** كل اختبارات قاعدة البيانات على PostgreSQL 15.19 مؤقتة وببيانات synthetic. إعادة بناء "Production" هنا **تقدير** لشكل الـ schema المبلّغ عنه، مش دليل على حالة Neon الحقيقية.

---

## 0. الخلاصة

| | النتيجة |
|---|---|
| **CP-1 (تكافؤ إصلاحات Production)** | **PASS — 6 من 6** بدليل تنفيذي لكل واحد + negative control لكل واحد. المصفوفة: `SERIES_06_PRODUCTION_EQUIVALENCE_MATRIX.md`. |
| **CP-2 (أمان الـ migrations)** | **PASS** للنقاط A–E في حدود الاختبار الـ synthetic. اتنفّذ: حذف الاعتماد على `uuid-ossp`، `down()` fail-closed، trigger+إصلاح+unique index للـ revisions، ومقارنة schema بين 3 أنواع بيئات. |
| **الاختبارات** | Backend على PostgreSQL حقيقية، 3 تشغيلات متتالية على قواعد جديدة بعد آخر تعديل: **50 suites / 313 tests في كل تشغيلة، exit 0**. `tsc` وbuild النضيف exit 0. Mobile: `tsc` exit 0، Jest **14/14 suites، 203/203**. |
| **جاهزية الـ RC** | **جاهز لتخطيط تنفيذ الـ release line** (CP-1 وCP-2 PASS) — بشرط قرارات الـ Director (قسم 8). **ما اتدمجش حاجة.** |
| **جاهزية Production** | **NO-GO** (بدون تغيير). الـ blockers في قسم 7. |

---

## 1. خط الأساس في Git (VERIFIED)

| | |
|---|---|
| الأساس | `preflight/series05-rc-admission` @ `e517d82` (متزامن مع origin وقت البدء؛ لا كود اتغيّر بعد `e20cf93`) |
| الفرع الجديد | `hardening/series06-release-safety` (اتأكد إن الاسم والمسار ما كانوش مستخدمين) |
| **Commits الكود/الاختبارات** | `d12b810` (migrations + spec) · `ba16cec` (اختبارات التكافؤ) · `9b1f9dd` (تعليق في migration فقط، بدون تغيير سلوك) |
| **Baseline الاختبارات النهائية** | `9b1f9dd` والشجرة نضيفة وقت التشغيل (مسجّل في `s06-final3.summary.txt`)؛ فرق `ba16cec`..`9b1f9dd` تعليق فقط |
| Commits بعده | docs فقط (التقرير، المصفوفة، الـ runbook، الـ bridge، الـ master) — شوف `git log 9b1f9dd..HEAD` |
| Refs المحمية | `integration/series04` `84faa31` · `rc4/release-candidate` `1447ade` · `main` `45d9e18` · production `bb071ed`: **ما اتغيّروش** |
| الحزم/الـ lockfiles/الإعدادات | `package.json`، `package-lock.json`، `mobile/package*.json`، `app.json`، `eas.json`، `tsconfig*.json`، `nest-cli.json`، `jest.config.js`: **مطابقة لـ `e517d82`** (`git diff --stat` فاضي) |

---

## 2. الملفات اللي اتغيّرت وليه

| الملف | التغيير | ليه |
|---|---|---|
| `src/migrations/1722345600000-CreateUserFcmTokenTable.ts` | `uuid_generate_v4()` ← `gen_random_uuid()` + تعليق | شيل الاعتماد على امتداد `uuid-ossp` (A) |
| `src/migrations/1792560000000-SharedWarehouseFoundation.ts` | `down()` بتفحص قبل أي تعديل وترفض لو هتخسّر بيانات + تعليق | منع فقد الدعوات/الإيصالات/الصلاحيات وتوسيع صلاحيات Staff (B) |
| `src/migrations/1792570000000-CompanyEntitlements.ts` | نفس الحماية لبيانات الـ plan | (B) |
| `src/migrations/1792580000000-StockRevisionGuard.ts` (جديد) | فحص تكرار، إصلاح NULL revisions، trigger، unique partial index | (C) و(D) |
| `src/shared/db/migration-guards.ts` (جديد) | `UnsafeDownMigrationError` و`refuseIfDataWouldBeLost` | رسالة موحّدة ودقيقة؛ **خارج** مجلد `migrations/` عشان الـ glob ما يحمّلهوش كـ migration |
| `tests/integration/release-safety.migration.pg.spec.ts` (جديد، 17 اختبار) | يحل محل `rc-admission.migration.pg.spec.ts` (Series 05، اتشال) | بيحوّل الاختبارات التوصيفية للمخاطر إلى اختبارات حماية |
| `tests/equivalence/production-bb071ed/*.spec.ts` (8 ملفات، 40 اختبار) | specs الـ production الأصلية + فحص الـ lockfile + فحص wiring | CP-1 |
| `docs/handoff/series06-evidence/equivalence-adaptation-diff.txt` | دليل مولَّد: إن التعديلات setup فقط | CP-1 |
| `docs/handoff/` (تقرير، مصفوفة، runbook، bridge، master) | توثيق | — |

**ما اتساب كما هو عمداً:** كل كود التطبيق (controllers/services/entities/DTOs)، الموبايل، الاعتماديات، الـ API، وأي migration غير الثلاثة المذكورين.

---

## 3. CP-1 — ملخص (التفاصيل في المصفوفة)

| # | الإصلاح (production) | commit الـ candidate | الاختبار | النتيجة |
|---|---|---|---|---|
| 1 | F4 credentials في سجل الحركات (`e4cac4c`) | `2a14630` | `movement-history.security.spec` | 8/8 |
| 2 | إخفاء credentials من logs/audit (`64f73b9`) | `b1177c8`, `13f1325` | `audit-log.redaction` + `http-logger.redaction` + wiring | 6/6 + 1/1 + 2/2 |
| 3 | Google: إيميل verified وإلا 401 (`586c0a9`) | `13f1325` | `google-login.security.spec` | 5/5 |
| 4 | تصحيح `compression`/`proxy-addr` (`104b3e3`) | `eaceca2` (patch-id مطابق) | `deps-lockfile.spec` | 3/3 |
| 5 | A1 refresh tokens مرة واحدة (`3849f93`) | `f460d15` (patch-id مطابق) | `refresh-token.rotation.spec` | 6/6 |
| 6 | A3 2FA على كل مسارات الدخول (`bb071ed`) | `83f1126` | `auth.second-factor.spec` + wiring | 8/8 + 1/1 |

- الاختبارات: 8 suites، **40 tests، 40 نجحوا**.
- **تعديلات setup فقط**: صفر assertion اتشال أو اتعدّل (دليل مولَّد). أول تشغيل بدون أي تعديل كشف السبب الحقيقي لفشل 4 specs (constructor/providers/stub)، مش تراجع في السلوك.
- **Negative control:** تشيل كل حماية في الكود فالـ spec يبقى أحمر (M1–M6: 2/5، 2/6، 5/6، 1/1، 3/8، 6/8 فشلوا).
- **كل اختلاف production** = 6 commits / 15 ملف، وكلهم مربوطين بدليل.
- **استراتيجية الـ release line:** الخيار A (دمج `-s ours` على branch جديد ثم fast-forward) موصى به؛ بدائل وأدلة (21 conflict hunk في 11 ملف للدمج اليدوي) في المصفوفة §7. **ما اتنفّذش.**

---

## 4. CP-2 — أمان الـ migrations

### A) الاعتماد على `uuid-ossp` (migration `1722345600000`)

- **الحقائق (VERIFIED):** الـ migration الوحيد اللي بيستخدم `uuid_generate_v4()`؛ كل migration تانية بتولّد ids (Phase1 وPhase2 وPhase4 وSamlSso وSharedWarehouse) بتستخدم `gen_random_uuid()`. مفيش migration بينشئ الامتداد؛ التطبيق وأداة CLI بيثبّتوه وقت الاتصال لأن فيهم entities بـ uuid. لذلك كان بيشتغل عادةً ويفشل على اتصال "عاري". المشروع محتاج PostgreSQL 13+ أصلاً (الـ migration الأول `Phase1Foundation` بيستخدم `gen_random_uuid()`)، فالتغيير مبيضيفش شرط جديد.
- **أين اتطبّق؟** كود production (`bb071ed`) فيه 4 migrations فقط، يعني FCM مش جزء منه (حسب المبلّغ؛ حالة Neon الفعلية **UNVERIFIED**). اتطبّق على قواعد التطوير/الـ RC المحلية.
- **تتبّع الـ executor (VERIFIED):** TypeORM `0.3.31` بيتتبّع بالاسم والـ timestamp، من غير checksum. اختبار البيئة "القديمة": الـ migration ما اتعادش تشغيله، وبقى الفرق الوحيد في الـ schema هو قيمة default لعمود `user_fcm_tokens.id`.
- **بدائل اتقيّمت:** (1) تعديل مكانه [اتنفّذ]؛ (2) migration إضافية بـ timestamp أقدم تنشئ الامتداد — **تقنياً ممكنة** (اختبرتها: TypeORM `0.3.31` بينفّذ migration أقدم بعد ما أحدث منها اتنفّذ، **عكس اللي كنت فاكره**، فصححت الاستنتاج)، لكنها بتبقي الاعتماد وبتحتاج صلاحية `CREATE EXTENSION` وبتعتمد على سلوك مرتبط بإصدار؛ (3) migration إضافية لاحقة ما تنفعش (بتتنفّذ بعد FCM)؛ (4) توثيق فقط.
- **ليه التعديل في مكانه آمن:** الفرق في تعبير الـ default فقط، وكلاهما بيولّد UUID v4 (اتجرّب على إدخال تحت الـ default القديم والجديد)؛ ما حصلش drift آخر (اختبار مقارنة schema: **fresh = upgraded-from-production**، و**environment القديم مطابق عدا `user_fcm_tokens.id`**).
- **متبقي:** `CREATE TABLE` (مش `IF NOT EXISTS`) لو الجدول موجود قبل كده ← الـ migration يفشل والـ batch يتراجع. اتحط فحصه ضمن القايمة المسبقة (runbook §13). ما غيّرتش ده في الكود عمداً (تقليل إعادة كتابة التاريخ).

### B) `down()` المدمّر — fail-closed

| Migration | بترفض (قبل أي تعديل) لو… | رسالة الخطأ |
|---|---|---|
| `1792560000000` | في دعوات؛ أو idempotency records؛ أو صلاحيات مخازن مختلفة عن الافتراضي (ضيّقة، أو لدور تاني، أو مخزن اتفتح بعد الـ rollout ومتمنحش للـ Staff) | بتسمّي **إيه** هيضيع (عدد)، وتنتهي بـ "Nothing was changed"، وبتوجّه لـ backup/fix-forward وللـ runbook |
| `1792570000000` | أي شركة plan/status/expiry/source غير الافتراضي | نفس الصيغة |
| `1792580000000` | — (مش مدمّرة) | بتشيل trigger/index/function فقط |

- **VERIFIED:** بعد الرفض، digest كامل لـ (grants، دعوات، keys، شركات، مخازن، حركات، سجل الـ migrations) **مطابق** لما قبله؛ صلاحيات Staff ما اتوسّعتش؛ الجداول والـ migration record لسه موجودين. مفيش override عن قصد.
- الـ down المسموح (قاعدة بدون بيانات الميزات) بيشتغل وبيتأكد إن `up()` بعده بيرجع نفس الافتراضي بالظبط، لا أكتر.
- **حد مقصود:** أرقام الـ revisions بتتعاد حسابها بعد `down→up`؛ الأجهزة بتكتشف ده بالـ anchor وتعمل reset، فما منعتش الـ down بسببها. ما فيش "reversible downgrade" مصطنع.

### C) NULL revisions بعد rollback التطبيق

- **الاستراتيجية (VERIFIED):** (1) trigger `BEFORE INSERT` يملأ revision ناقصة بنفس بروتوكول التطبيق (زيادة العداد تحت قفل صف المخزن)، ومبيلمسش حركة بتحدد revision بنفسها (التطبيق الحالي) فمفيش ترقيم مرتين؛ (2) إصلاح داخل الـ migration لأي NULL موجود: فوق كل رقم اتصدر، بترتيب `(created_at, id)`، والأرقام المصدّرة قبل كده ما بتتغيّرش أبداً؛ (3) unique partial index.
- **الأدلة:** حركة بلا revision بتاخد `counter+1` وتظهر في delta ✔ · 12 كاتب بأسلوب التطبيق + 12 بأسلوب قديم متزامنين: أرقام فريدة ومتتالية، والعداد = max ✔ · إدخال تكرار مرفوض ✔ · نفس الرقم في مخزن تاني مسموح ✔ · الإصلاح لا يفقد حركات (العدد ثابت) ✔ · الـ suite الكاملة (concurrency/idempotency/cursor) خضرا مع الـ trigger شغال.
- **"No invented ordering":** الترتيب الوحيد المُصدَر هو ترتيب الإدخال تحت القفل (للجديد) أو `(created_at, id)` (للـ NULL الموجودة بالفعل، قاعدة حتمية وموثقة، مش ترتيب الـ commit الحقيقي المجهول).
- **ما بقاش غير مدعوم:** rollback التطبيق **كاستراتيجية رجوع** ما زالت **غير مدعومة**: الإصدار القديم مايعرفش الـ idempotency ولا صلاحيات المخازن ولا الدعوات. بقت "وضع متدهور مؤقت" لحد fix-forward (runbook §8).
- **HYPOTHESIS:** transfers قديمة متعاكسة متزامنة ممكن تعمل deadlock على قفل صفوف المخازن (PostgreSQL يقتل واحدة). التطبيق الحالي بيقفل بترتيب الـ id.

### D) Unique partial index على `(warehouse_id, revision)`

- اتضاف داخل `1792580000000` **بعد** فحص تكرار مسبق: لو التكرار موجود الـ migration بترفض قبل أي تعديل وتسمّي الأزواج (VERIFIED ومعاه إن الإصلاح ما اشتغلش قبل الفحص).
- **ثلاث حالات اتجرّبت:** بيانات legacy بعد backfill (الـ index اتبنى) · كتابة متزامنة (24 كاتب) · تكرار موجود (رفض نضيف ثم نجاح بعد حله).
- **المفاضلة المقصودة:** تكرار موجود = boot يفشل بدل ما يكمّل بتكامل مكسور. ما اتبدّلتش الـ index القديم (غير unique) — إضافة فقط.

### E) توافق البيئات

| البيئة | النتيجة |
|---|---|
| إعادة بناء baseline الـ production (4 migrations + بيانات: شركتين، أدوار، مخازن، حركات، 2FA) ← الـ candidate في تشغيلة واحدة، **من غير uuid-ossp** | VERIFIED: ترتيب `FCM → TOTP → SharedWarehouse → Entitlements → Guard`، الصفوف الستة القديمة ثابتة، تشغيلة تانية = لا شيء |
| تثبيت جديد (9 migrations من الصفر) | VERIFIED |
| بيئة اتشغّل فيها نص FCM القديم | VERIFIED: بتتحدّث بدون إعادة تشغيل FCM |
| تطابق الـ schema (columns/indexes/constraints/triggers) | VERIFIED: fresh = upgraded؛ old = upgraded عدا default عمود واحد |
| invariants الصلاحيات | VERIFIED: Staff داخل شركتهم فقط؛ صفر grants لـ Admin/Manager؛ صفر عابرة للشركات؛ ما اتغيّرتش بالـ migration الجديدة |

---

## 5. التحقق الفعلي

**البيئة:** Windows 11، Node `v26.7.0`، npm `11.19.0`، TypeORM `0.3.31`، PostgreSQL `15.19` (cluster مؤقت `127.0.0.1:55433`)، Jest 30.4.1 / 29.7.0. لا `.env` اتقرأ.

| الفحص | الأمر | النتيجة |
|---|---|---|
| Backend TypeScript | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| Backend build نضيف | حذف `dist` ثم `npm run build` | exit 0؛ `dist/main.js`؛ **9 migrations** و`shared/db/migration-guards.js` مترجمين |
| Mobile TypeScript | `cd mobile; npx tsc --noEmit` | exit 0 |
| Mobile Jest | `cd mobile; npx jest` | **14/14 suites، 203/203** |
| التكافؤ | `npx jest --testPathPatterns tests/equivalence` | **8 suites، 40 tests** |
| Migrations spec | `backend-gate.ps1 … release-safety.migration.pg.spec.ts` | **17/17** |
| **Backend PG كامل ×3 (بعد آخر تعديل)** | `backend-gate.ps1` على قواعد جديدة `stockmind_gate_s06_fin1/2/3` | **50/50 suites، 313/313 tests** في كل تشغيلة، exit 0 ×3 (≈33 ث لكل واحدة) |
| الحزم/الـ lockfiles | `git diff --stat e517d82 HEAD -- package*.json …` | فاضي (مطابقة) |

الحساب: Series 05 كان 42 suite / 264 اختبار؛ **−1 suite/−8** (الـ spec القديم اتشال) **+1/+17** (release-safety) **+8/+40** (equivalence) = **50 / 313** ✓.

اللوجات: `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_s06_*.log` و`s06-final3.summary.txt`.

**Negative controls لمرحلة الـ migrations (تعديل سطر ← الـ spec أحمر ← استعادة الملف، اتأكد بـ hash):** N1 رجوع الـ default إلى `uuid_generate_v4()` ← 16/16 فشلوا · N2 تعطيل الـ guards ← 4 فشلوا · N3 الـ trigger لا يفعل شيئاً ← 3 · N4 index غير unique ← 8 · N5 إلغاء فحص التكرار ← 6.

**الأخطاء اللي حصلت أثناء التطوير (كلها أخطاء في كتابتي للاختبارات، مش في المنتج، واتصلّحت قبل تشغيلات الـ gate النهائية):**
1. `TS2345` في helper نوع الـ parameter في الـ spec الجديد.
2. تفسير PowerShell لـ `${...}` داخل here-string كتب template literal فاضي فكسر اختبار (اتصلح بالـ editor).
3. تجربة M6 الأولى ما اتترجمتش (تعديل بيكسر النوع) فما أثبتتش حاجة؛ اتعادت بتعديل سليم.
4. مسار `__dirname` للـ glob في copy الـ F4 بعد نقل الملف (ميكانيكي).
5. سكربت تعديل الـ runbook اتقرا بترميز غلط (مفيش تأثير على الـ repo؛ اتعاد).
6. **تصحيح استنتاج:** كنت فاكر إن TypeORM بيرفض migration بـ timestamp أقدم؛ اختبرت وطلع غير صحيح، فاتصحح التقييم (قسم A).
**ولا تشغيلة كاملة فشلت، ولا flaky ظهر، ولا تشغيلة اتشالت من التقرير.**

---

## 6. المخاطر المتبقية (مسجّلة صراحةً)

| # | الخطورة | الحالة | الوصف |
|---|---|---|---|
| R1/R2 | عالية | **لسه مفتوح** (غير منفّذ، مقصود) | restore يتعكس بعد re-entry ← duplicate؛ عنصر `history-changed` ما بيتعادش فحصه. محتاج **S1 + S2** (runbook §11) قبل أي تفعيل للمخازن المشتركة. الـ re-entry البشري سلوك تطوير، مش سياسة Production. |
| R7 | متوسطة | **لسه مفتوح** | مخزن بيتعمل بعد الـ rollout مش ظاهر للـ Staff الحاليين ومفيش UI للمنح. دلوقتي كمان **بيمنع `down()`** (مقصود). قرار منتج (CP-4). |
| R8 | متوسطة | **لسه مفتوح** | كل الشركات الحالية `free` (1 seat / 1 warehouse)؛ `ENTITLEMENTS_ENFORCED` لازم `=== 'true'`. تفعيله بدون تثبيت plans للعملاء الحاليين يمنع الإضافات. **ما اتفعّلش.** (CP-5) |
| R12 | عالية قبل Production | **لسه مفتوح — قرار مطلوب** | `ssl: { rejectUnauthorized: false }` لما `DB_SSL=true` في **مكانين** (`src/app.module.ts` و`src/config/data-source.ts`)، **مطابقين تماماً في production `bb071ed`**: التشفير شغال لكن هوية السيرفر مش متحقق منها (عرضة لـ MITM على المسار). ما قدرتش أختبر `rejectUnauthorized: true` ضد Neon (ما اتصلناش به): هل سلسلة شهادة Neon موثوقة عند Node = **UNVERIFIED**. المسار المقترح لمرحلة مستهدفة: متغير بيئة صريح، اختباره ضد **branch غير إنتاجي** بموافقتك، وماينتقلش للـ default إلا بعد التجربة. كمان: `data-source.ts` فيه fallback لبيانات اتصال محلية افتراضية (dev فقط). |
| جديد-1 | منخفضة | HYPOTHESIS | deadlock محتمل لو إصدار قديم عمل transfers متعاكسة متزامنة (قسم 4-C). |
| جديد-2 | متوسطة | CONFIRMED (مقصود) | `1792580000000` بترفض الـ boot لو في تكرار revisions. الفحص المسبق (runbook §13/§3-ب) مطلوب. |
| جديد-3 | متوسطة | UNVERIFIED | القايمة المسبقة (إيه اتطبّق على Neon، وجود جدول FCM، إصدار PG، الصلاحيات، تكرار) **لم تُنفَّذ** — محتاجة مشغّل مصرّح. |
| جديد-4 | منخفضة | HYPOTHESIS | أول boot بأكتر من instance بدون advisory lock حوالين الـ migrations (instance واحدة على Render المجاني). |
| جديد-5 | منخفضة | CONFIRMED | `register()` بيسجّل رسالة الخطأ والـ stack (ممكن تحمل إيميل من رسالة قيد DB) — خصوصية، مش credentials. |
| — | — | UNVERIFIED | Google Sign-In على الجهاز بعد تغيير مسار التحقق؛ iOS؛ جهازين؛ Redis حقيقي؛ حالة Production الفعلية. |

---

## 7. جاهزية RC مقابل Production

**RC (تخطيط تنفيذ الـ release line): READY — بشروط.** CP-1 PASS (6/6)، CP-2 PASS، 3 تشغيلات PostgreSQL خضرا، mobile سليم، حزم/lockfiles ثابتة. شروط التنفيذ: قرارات قسم 8.

**Production: NO-GO.** Blockers:
1. تنفيذ الـ release line نفسه (لسه ما اتعملش) + موافقة الـ Director على الاستراتيجية.
2. قايمة الفحص المسبق على Neon (جديد-3) ونسخة احتياطية/restore point قبل أول boot.
3. قرار R12 (TLS) وتقييمه ضد بيئة غير إنتاجية.
4. S1 + S2 قبل تفعيل المخازن المشتركة/الـ online؛ CP-4 (منح المخازن) وCP-5 (plans).
5. التعامل مع ملفاتك المتّسخة في `main` والـ 3 commits المحلية (FCM/Redis/checklist).
6. تحقق: جهازين، iOS، Redis، Google Sign-In، online transfer.
7. AAB/Google Play/Production deploy: ممنوعة بدون أمر منفصل.

---

## 8. قرارات مطلوبة من الـ Director (قبل أي عملية إصدار)

1. **استراتيجية الـ release line:** الخيار A (موصى به) أم B/D (المصفوفة §7)؟ ومعاها **تجميد أي hotfix جديد** على فرع production لحد التنفيذ.
2. **ملفاتك المتّسخة** (3 ملفات بتتعارض) و**الـ 3 commits المحلية** غير المرفوعة اللي هتتنشر مع الـ RC.
3. **تفويض فحص قراءة فقط** على Production/Neon بالقايمة (runbook §13) بواسطة مشغّل مصرّح.
4. **R12:** تفويض تقييم `rejectUnauthorized: true` ضد branch غير إنتاجي.
5. **أي مرحلة تالية** (قسم 9).

---

## 9. مرحلة تالية مقترحة (توصية فقط — مش مُصرَّح بها)

**Series 07 — Recovery safeguards S1 + S2** (runbook §11): (S1) إعادة فحص الأصل قبل الـ re-entry، (S2) restore marker/history epoch من السيرفر، مع قرار CP-4 (منح المخازن) في نفس الحزمة.
- **ليه:** هو أكبر فجوة تقنية باقية قدام تفعيل المخازن المشتركة (R1/R2)، ومستقل عن ميكانيكا الـ release line اللي محتاجة موافقاتك أنت.
- **حدود:** فرع جديد من `hardening/series06-release-safety`، بدون merge أو deploy أو Production، وgates كاملة ×3.
- **قبول:** معايير S1/S2 في runbook §11 + اختبارات domain وPG وجهاز + تحديث الـ bridge.

---

## ملحق: المراجع

`docs/handoff/SERIES_06_PRODUCTION_EQUIVALENCE_MATRIX.md` · `docs/handoff/STOCKMIND_DATABASE_RECOVERY_RUNBOOK.md` (v0.2) · `docs/handoff/series06-evidence/` · `docs/handoff/SERIES_05_RC_PREFLIGHT_REPORT.md` · `docs/handoff/STOCKMIND_AI_BRIDGE.md`.
