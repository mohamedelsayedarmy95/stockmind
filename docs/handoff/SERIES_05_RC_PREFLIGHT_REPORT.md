# STOCKMIND — SERIES 05: RC ADMISSION PREFLIGHT REPORT

> **التاريخ:** 2026-10-24 (Egypt Standard Time) · **الفرع:** `preflight/series05-rc-admission` · **Worktree:** `D:\Projects\StockMind-wt\series05-rc-preflight`
> **الأساس (baseline):** `integration/series04` @ `84faa31` (آخر commit كود فيه `d69f6e8`).
> **الصلاحية:** preflight للتطوير فقط، في worktree معزول. **GO تقني هنا ≠ إذن بدمج أو نشر.** مفيش merge، ولا push على branches محمية، ولا deploy، ولا AAB، ولا لمس لـ Production أو لـ `main` المتّسخ حصل.
> التصنيفات: `VERIFIED` (اتنفّذ/اتأكد فعلاً) · `PARTIAL` · `UNVERIFIED` · `CONFIRMED` (خطر ثابت بدليل) · `HYPOTHESIS` (استنتاج من قراءة الكود، ما اتجرّبش).

---

## 0. الخلاصة والقرار

| | القرار |
|---|---|
| **RC ADMISSION** | **CONDITIONAL GO** — الكود المتكامل صالح تقنياً يبقى أساس الـ RC الجاي، **بشروط قبل أي promotion** (تحت). |
| **PRODUCTION** | **NO-GO** (بدون تغيير). محتاج preflight وموافقة منفصلين. |

**ليه مش GO كامل:** مفيش عيب بيمنع الدخول كـ"candidate"، لكن في 3 حاجات لازم تتحسم قبل ما الـ candidate يتعمله promotion أو يلمس Production:

1. **خط الـ production hotfix (`bb071ed`) مش جزء من تاريخ الـ candidate ولا الـ RC.** الإصلاحات الأمنية الستة اتعمل لها re-implementation (مش cherry-pick)، والدمج الآلي بيدّي **11 conflict**. التكافؤ السلوكي ثابت بالأدلة (قسم 2-ج) لكن استراتيجية الـ promotion لسه ما اتقرّرتش. → **CP-1**.
2. **الـ migrations الجديدة فيها مخاطر لازم تتقفل قبل ما تشتغل على Production:** اعتماد ضمني على امتداد `uuid-ossp`، و`down()` بيمسح بيانات ويعيد توسيع صلاحيات Staff، و rollback التطبيق بيسيب حركات بلا `revision`. كلها اتأكدت باختبارات (قسم 3). → **CP-2**.
3. **ملفات الـ Director المتّسخة في `D:\Projects\StockMind` بتتعارض مع الـ candidate** (3 ملفات، قسم 2-و). لازم أي دمج يتم في worktree نضيف وبقرار منه.

**اللي مش شرط للـ RC لكن شرط لتفعيل المخازن المشتركة/الـ online على Production:** safeguards الاسترداد S1+S2 (runbook قسم 11)، وتجربة صلاحيات المخازن الجديدة (قسم 5)، وتجميد قدر الـ entitlements قبل أي enforcement.

---

## 1. خط الأساس في Git (VERIFIED)

| Ref | SHA | ملاحظة |
|---|---|---|
| `integration/series04` | `84faa31` | متزامن مع origin؛ آخر commit كود `d69f6e8`، وكل اللي بعده `docs/` + `AGENTS.md` فقط (`git diff --name-only d69f6e8 HEAD`) |
| `rc4/release-candidate` | `1447ade` | commit واحد مش في الـ candidate (اختبار فقط، قسم 2-ب) |
| Production (reported) | `release/prod-hotfix-f4` = `bb071ed` | الـ ref موجود على origin بنفس الـ SHA؛ إن Render بيشغّله فعلاً = **UNVERIFIED** (ما اتصلناش بـ Production) |
| `main` المحلي | `45d9e18` | متّسخ؛ **متقدّم 3 commits على `origin/main` (`5b32df3`)** ومش مرفوعة |

| المقارنة | الفرق (يسار/يمين) | Merge base |
|---|---|---|
| candidate ↔ RC | 30 / 1 | `cf5a881` |
| candidate ↔ production | 79 / 6 | `ec4c5db` |
| RC ↔ production | 50 / 6 | `ec4c5db` |
| candidate ↔ `origin/main` | 53 / 0 | `5b32df3` (جزء من تاريخه) |
| candidate ↔ `main` المحلي | 50 / 0 | `45d9e18` (جزء من تاريخه) |

**الـ 3 commits المحلية في `main` (غير مرفوعة):** `6967d46` (Firebase FCM)، `bcf5832` (deployment checklist + Redis scaffold)، `45d9e18` (Redis caching). **موجودة في الـ RC والـ candidate، ومش في Production.** كاش Redis الحقيقي = UNVERIFIED (التدهور الآمن بدون `REDIS_URL` متغطي بالاختبارات).

**الـ dry-run للدمج** (في الفرع المعزول فقط، وانعمله `merge --abort` فوراً، والحالة رجعت `e20cf93` نضيفة):
- RC → candidate: **تلقائي بدون conflicts** (VERIFIED).
- `bb071ed` (production) → candidate: **11 conflict** — `src/app.module.ts`، `firebase.service.ts`، `auth.service.ts`، `stock.service.ts`، `auth.controller.ts`، `audit-log.interceptor.ts` + 5 ملفات اختبار (add/add) (VERIFIED).

---

## 2. Preflight A — تكامل ومطابقة

**أ) حجم التغيير RC → candidate:** 123 ملف، **صفر حذف** (إضافات فقط): `src` 37 · `tests` 20 · `mobile` 48 · `docs` 17 · `AGENTS.md`. migrations جديدة: اتنين فقط.
**اعتماديات وإعدادات:** `package.json`، `package-lock.json`، `mobile/package.json`، `mobile/package-lock.json`، `mobile/app.json`، `mobile/eas.json`، `tsconfig*.json`، `nest-cli.json` = **مطابقة تماماً للـ RC** → مفيش drift (VERIFIED).

**ب) commit الـ RC الوحيد `1447ade`** (ترتيب سلسلة الـ ledger بـ `running_balance`): التغيير نفسه موجود في `tests/integration/tenant-concurrency.pg.spec.ts:103` (`ORDER BY running_balance DESC`). `git cherry` بيقول "+" لأن الـ patch-id مختلف، لكن الدمج التلقائي نضيف → **متمثّل دلالياً** (VERIFIED).

**ج) تكافؤ الإصلاحات الأمنية الستة لـ Production** (الـ patch-id وحده مضلّل لأن الإصلاحات اتعاد تنفيذها في خط الـ RC):

| Commit | الإصلاح | الدليل على وجوده في الـ candidate | الحالة |
|---|---|---|---|
| `104b3e3` | patch `compression`/`proxy-addr` | patch-id مطابق | VERIFIED |
| `3849f93` | A1: refresh tokens مرة واحدة + قابلة للإلغاء | patch-id مطابق؛ spec الـ candidate = spec الـ production + سطر واحد (arg في الـ constructor) | VERIFIED |
| `bb071ed` | A3: 2FA على كل مسارات الدخول + حد تخمين OTP | spec الـ candidate = spec الـ production + سطر constructor واحد (5/5 عناوين اختبار)، وبيعدّي ×3 | VERIFIED (بالـ spec) |
| `64f73b9` | إخفاء credentials من الـ logs والـ audit | **اختبارا الـ production الاتنين (`audit-log.redaction` 6 + `http-logger.redaction` 1) اتشغّلوا بدون أي تعديل على كود الـ candidate ونجحوا 7/7** | VERIFIED |
| `e4cac4c` | F4: منع تسريب بيانات المستخدم في سجل الحركات | `movement-response.dto.ts` مطابق للـ production؛ spec الـ candidate شامل لكل عناوين اختبارات الـ production (8/8) + 5 زيادة (cache) | PARTIAL: spec الـ production الأصلي ما اشتغلش (خطأ تجهيز Nest بسبب تغيّر الـ providers)، لكن نسخة الـ candidate (13 اختبار) بتعدّي |
| `586c0a9` | Google login: إيميل verified فقط + token غلط = 401 | التنفيذ اتغيّر (من Firebase Admin إلى `google-auth-library`) والقاعدة موجودة (`email_verified !== true` ← 401) في `firebase.service.ts:95`؛ 4/4 عناوين اختبار | PARTIAL: بالقراءة + spec؛ تسجيل الدخول بـ Google على الجهاز = UNVERIFIED |

محاولة تشغيل الـ specs الأصلية للـ production على كود الـ candidate: 2 من 6 اشتغلوا ونجحوا؛ 3 فشلوا في الترجمة بـ `TS2554: Expected 11 arguments, but got 10` (الـ constructor بتاع `AuthService` زاد parameter للـ entitlements) = **تغيّر في الشكل مش في السلوك**؛ 1 فشل في تجهيز Nest. اتنظّفت الملفات المؤقتة (الفرع نضيف).
**النتيجة:** مفيش إصلاح أمني من الستة ظاهر إنه ناقص. لكن Git مش عارف كده → الـ 11 conflict.

**د) كود أمني اتغيّر في الـ candidate** (إضافي فوق الـ RC): `warehouse-access.service/guard`، `team.service/controller`، `operation-lookup.service`، `@SkipAudit`، `accept-invitation`، `entitlements.service`، `stock.service` (+269). اتقرأوا (قسم 5)؛ ما لقيتش مشكلة في المنطق الأساسي.

**هـ) وظائف dev-preview لازم تفضل مقفولة خارج التطوير** (VERIFIED بالقراءة): `ONLINE_MODE_DEV_PREVIEW = __DEV__ && EXPO_PUBLIC_ONLINE_MODE === '1' && Boolean(EXPO_PUBLIC_API_BASE_URL)`؛ كل الاستخدامات (login، onboarding/mode، settings، `_layout`، repository-provider، account-scope) تمر عليه. الـ release build ما يقدرش يفعّله. جهة السيرفر: الـ endpoints الجديدة بتتفعّل مع أي deploy (إضافية ومتوافقة للخلف)، و`ENTITLEMENTS_ENFORCED` لازم يساوي `'true'` حرفياً وإلا مقفول، والـ Swagger بـ opt-in.

**و) بيانات غير محفوظة في Git قد تتعرض للخطر بخطوات الإصدار:**

| المسار في `D:\Projects\StockMind` | حالته في main | في الـ candidate | الخطر |
|---|---|---|---|
| `DEPLOYMENT_CHECKLIST.md` | معدّل | tracked، **محتوى مختلف** | merge/checkout يرفض أو يكتب فوقه |
| `tests/integration/notification.flow.spec.ts` | معدّل | tracked، **محتوى مختلف** | نفس الشيء |
| `tests/integration/stock-cache.invalidation.spec.ts` | untracked | tracked، **محتوى مختلف** | "untracked files would be overwritten" |
| `PHASE_7_CHECKLIST.md`، `scripts/` (4 ملفات)، `.ai-handoff/`، اللوجو | untracked | **مش موجودة** | آمنة من الدمج (لكن غير مدعومة بنسخة) |

→ **ماتدمجش ولا تعمل checkout في `D:\Projects\StockMind`.** اعمل نسخة احتياطية أو commit لنسختك على فرع خاص، والـ Director يقرر أي نسخة تفضل لكل ملف من التلاتة.

---

## 3. Preflight B — أمان الـ migrations (PostgreSQL 15.19 مؤقتة فقط، بيانات synthetic)

الاختبار الجديد `tests/integration/rc-admission.migration.pg.spec.ts` (8 اختبارات، بقواعد بيانات scratch خاصة بيه) + الاختبارات الموجودة.

| الفحص | النتيجة |
|---|---|
| ترتيب واكتمال: schema الـ **Production** (أول 4 migrations) ← الـ candidate (4 migrations زيادة) في تشغيلة واحدة | VERIFIED: ترتيب `FCM → TOTP → SharedWarehouse → Entitlements`، وتشغيلة تانية = لا شيء pending |
| الصفوف القديمة | VERIFIED: عدد الصفوف في الجداول الست القديمة ثابت، وصف الـ 2FA محفوظ (`last_totp_step` = NULL) |
| backfill صلاحيات Staff | VERIFIED: كل Staff ياخد **كل مخازن شركته فقط**، صفر grants لـ Admin/Manager، **صفر grants عابرة للشركات** |
| backfill الـ revisions | VERIFIED: لكل مخزن 1..n بدون فجوة/تكرار/NULL، بترتيب `(created_at, id)` (حتى مع تساوي التوقيت)، و`stock_revision` = n، والمخزن الفاضي = 0 |
| الـ constraints | VERIFIED: `uq_warehouse_access_user_warehouse`، `uq_team_invitations_token_hash`، `pk_stock_idempotency_keys`، `chk_companies_*`، ودعوة بدور Admin مرفوضة |
| entitlements | VERIFIED: كل الشركات الحالية `free/active/default` |
| up/down/up | بينفّذ بنجاح (الموجود + الجديد) — **لكن `down()` مدمّر، انظر تحت** |

**مخاطر مدمّرة/حرجة (CONFIRMED باختبارات توصيفية — بتسجل الخطر، مش سلوك مرغوب):**

| # | الخطورة | الوصف |
|---|---|---|
| M1 | **عالية (لو اتنفّذ `down()`)** | `down()` بتاع `1792560000000` بيمسح `warehouse_access` و`team_invitations` و`stock_idempotency_keys` (الإيصالات اللي المصالحة بتعتمد عليها)، و`1792570000000` بيمسح بيانات الـ plan. وبعد `up()` تاني، **أي Staff اتضيّقت صلاحيته لمخزن واحد بياخد كل مخازن الشركة من جديد (توسيع صلاحيات)**. فيه "execute successfully" لكنه **مش آمن للإنتاج**. |
| M2 | متوسطة | `1722345600000-CreateUserFcmTokenTable` بيستخدم `uuid_generate_v4()` من غير ما ينشئ امتداد `uuid-ossp`. في التطبيق الفعلي، TypeORM بيثبّته وقت الاتصال (17 entity بـ uuid)، لكن على قاعدة بيانات خالية بدون ده الـ migration **بيفشل والـ batch كله يتراجع ذرّياً** (مفيش حالة نص-مطبّقة). موجود على Production = **UNVERIFIED** (محتاج فحص قراءة فقط `pg_extension` بواسطة مشغّل مصرّح). |
| M3 | متوسطة | **rollback التطبيق لإصدار قديم** بيكتب حركات بلا `revision` ولا بيزوّد `stock_revision`؛ بعد الرجوع للجديد، `getChanges` (`revision > since`) **ما بيرجّعهاش أبداً**. تعليق الـ migration "rollback التطبيق مش محتاج تغيير schema" **ناقص**. الإصلاح (SQL) اتجرّب وشغّال، وفي الـ runbook قسم 8. |
| M4 | منخفضة/HYPOTHESIS | backfill الـ revisions عبارة عن `UPDATE` واحد على كل `stock_movements` داخل transaction واحدة: على جداول كبيرة هيطوّل الـ lock. ما اتقاسش (بيانات الإنتاج صغيرة على الأرجح). |
| M5 | منخفضة/HYPOTHESIS | `migrationsRun: true`: الـ deploy = migrate تلقائي، وبدون advisory lock لو في أكتر من instance بيقوم في نفس اللحظة. instance واحد على Render المجاني. |
| M6 | تصميم | الفهرس `idx_stock_movements_warehouse_revision` **مش unique**؛ تفرّد `(warehouse_id, revision)` بيعتمد على بروتوكول القفل فقط. |

**اكتشاف في الاختبارات نفسها (اتصلّح، قسم 6):** `shared-warehouse.migration.pg.spec.ts` كان بيفشل (`uuid_generate_v4() does not exist`) لو اشتغل لوحده أو اتجدول قبل spec بيشغّل التطبيق — اعتماد خفي على ترتيب الـ specs. حصل فعلاً في تشغيلة كاملة (خطأ 3 اختبارات).

**اللي ما اتجرّبش:** نسخة Neon حقيقية أو إصدار PG بتاعها، حجم بيانات كبير، instance تانية متزامنة، `migration:revert` على أي بيئة غير المؤقتة.

---

## 4. Preflight C — سلامة المخزون وPlan الاسترداد (P0)

الخط الأساسي المحفوظ: **عملية confirmed ما تتبعتش تاني أوتوماتيك لمجرد غيابها من السيرفر المستعاد** (`applyLookup`: `absent` ← `NEEDS_REVIEW · history-changed`، وما بيتحوّلش لـ PENDING).

| السيناريو | الدليل | الحالة |
|---|---|---|
| الـ restore بيمسح حركة confirmed (ومعاها الـ key) | `operation-lookup.pg.spec` ("a restore that erases the movement AND its key record: absent") + جهاز Series 04 | VERIFIED (PG + جهاز) |
| أرقام revision بتتعاد | `sync-cursor-reset.pg.spec` ("after a restore that reuses revision numbers" ← snapshot + `reset:true`) | VERIFIED (PG) |
| ردود الـ lookup الأربعة | `operation-lookup.pg.spec` (8) + `outbox-reconcile.test.ts` | VERIFIED |
| سحب صلاحية المخزن | `operation-lookup.pg.spec` ("after access … revoked: unavailable") | VERIFIED (PG)؛ العرض "never plainly confirmed" unit |
| timeout / ردود غامضة | `outbox.test.ts` + سيرفر بطيء 45s على الجهاز (Series 04) | VERIFIED (unit + جهاز) |
| الإيصال بيتحفظ أو بيمرّ عليه 7 أيام | `prune` / `CONFIRMED_RETENTION_MS` (7 أيام، حد 500) | PARTIAL: بالتصميم والقراءة؛ الأقدم مش بيتصالح (حد موثّق) |
| re-entry بشري | `reentryDraft` (مفتاح جديد + ملاحظة بالأصل) + جهاز Series 04 | VERIFIED |
| restore بيتعكس لاحقاً ← duplicate محتمل | `applyLookup`/`recheckCandidates` بيشتغلوا على `CONFIRMED` فقط: عنصر `history-changed` **ما بيتعاد فحصه أبداً** | **CONFIRMED (من الكود):** الجهاز مش هيعرف إن الأصل رجع |
| cursor أقدم من نقطة الـ restore والـ anchor سليم | لا reset؛ الإيصالات الضايعة تتعرف عند بدء التطبيق فقط | HYPOTHESIS (استنتاج من `getChanges`، ما اتجرّبش) |

**المخرج:** `docs/handoff/STOCKMIND_DATABASE_RECOVERY_RUNBOOK.md` (قسم 11 فيه S1–S6 بمعايير قبول). **ما اتنفّذش history-epoch.** حكمي: **مفيش blocking finding للـ RC admission** (الـ online dev preview فقط). لكن **S1 (إعادة فحص الأصل قبل الـ re-entry)** و**S2 (restore marker من السيرفر)** شروط قبل تفعيل المخازن المشتركة على Production. الـ human-only re-entry مقبول للتطوير، **مش** سياسة Production معتمدة.

---

## 5. Preflight D — الأمان وبوابات المنتج

| البوابة | الدليل | الحالة | الفجوة |
|---|---|---|---|
| عزل الـ tenant | `tenant-concurrency` (شركة تانية ما تقدرش تقرأ/تكتب)، `operation-lookup` (لا بيكشف عمليات غيره)، `shared-warehouse` (دعوة بمخزن شركة تانية = 404)، backfill بدون grants عابرة | VERIFIED | ما فيش اختبار مخصص عبر الشركات لـ `GET /stock/changes/:w` و`/team/members` (الكود بيفلتر بـ `company_id` في كل استعلام) → PARTIAL |
| RBAC بنطاق المخزن + السحب | `shared-warehouse` ("Staff sees and uses only W1"، "a grant change applies to the very next request")؛ الصلاحية بتتقرا من DB في كل طلب (`WarehouseAccessService`) | VERIFIED. 9 routes عليها `@WarehouseScoped` (6 في stock و3 في warehouses)، والباقي (movements / lookup / قائمة المخازن) بيفلتر بالنطاق جوه الـ service (فحص بالقراءة) | الـ product reads ما بتعرضش كميات لكل مخزن؛ الإشعارات للمستخدم الفاعل فقط (قراءة) |
| الدعوات: انتهاء وإستخدام مرة | استخدام مرة ✔ ، إلغاء ✔ ، **انتهاء ما كانش متغطي** ← **اتضاف الاختبار ده في Series 05** (`refuses an expired invitation…`، 13/13) | VERIFIED الآن | مطابقة الإيميل **case-sensitive** (`users.email … UNIQUE` والدعوة ما بتوحّدش الحروف) → HYPOTHESIS: `Alice@x` و`alice@x` ممكن حسابين؛ مش جديد (التسجيل نفسه كده). مفيش قيد يمنع دعوتين معلّقتين لنفس الإيميل |
| dispatch متزامن / invariants | "10 parallel dispatches of 15 against 100: 6 accepted"، "two members dispatching at once never oversell" | VERIFIED | |
| إعادة المحاولة idempotent | "5 concurrent requests with one key: one movement"، 422 لمفتاح بنفس الطلب المختلف | VERIFIED | |
| sync cursor / snapshot / reset | `sync-cursor-reset.pg.spec` (6 اختبارات منها قارئ متزامن) | VERIFIED | |
| الـ audit | الكتابات متسجّلة، والـ lookup (`@SkipAudit`) لا ("no audit row is written for lookups")؛ الإخفاء: specs الـ production بتعدّي | VERIFIED | |
| علم الـ entitlements | مقفول افتراضياً (`=== 'true'`)؛ "rollout is safe"، "enforced: free plan … 402"، "concurrent acceptances cannot exceed the seats" | VERIFIED | **كل الشركات الحالية `free` (1 seat/1 warehouse)** — لو اتفعّل الـ enforcement بدون تثبيت plan للعملاء الحاليين هيمنع الإضافات. **ما اتفعّلش.** |
| إيصالات الجهاز وعزل الحسابات | `outbox.test.ts` ("never offers one account's intents to another account"، "yields no scope for a mismatched user") | VERIFIED (unit) | طبقة الـ runtime (`mobile/src/sync/*`) **مفيهاش اختبارات آلية** (Jest بيغطي `src/domain` فقط) ← الدليل جهاز Series 03–04 فقط |
| **توافق صلاحيات المخازن (جديد)** | `warehouse.service.create()` ما بيمنحش حاجة؛ الـ migration بتمنح Staff المخازن **الموجودة وقت الـ rollout** فقط | **CONFIRMED (قراءة):** مخزن جديد بعد الـ rollout **مش ظاهر للـ Staff الحاليين** لحد ما Admin يمنحه، **ومفيش UI** للمنح (API فقط) | قرار منتج (CP-4) |

**غير موجود (مؤكد، مش بيتدّعى):** واجهة إدارة الفريق على الموبايل، billing، multi-org، Viewer role، iOS، اختبار جهازين.
**ملاحظات خارج النطاق:** اتصال الـ DB بـ `ssl: { rejectUnauthorized: false }` لما `DB_SSL=true` (موجود كمان في production `bb071ed` = قديم، لا يتحقق من شهادة السيرفر)؛ مساعد الذكاء الاصطناعي بيبعت نص المستخدم لمزوّد خارجي (Hugging Face) — يتأكد من سياسة الخصوصية.

---

## 6. Preflight E — التحقق الفعلي

**البيئة:** Windows 11، Node `v26.7.0`، npm `11.19.0`، PostgreSQL `15.19` (cluster مؤقت `127.0.0.1:55433`، قواعد `stockmind_gate_s05_*`)، Jest 30.4.1 (backend) / 29.7.0 (mobile). لا `.env` اتقرأ، ولا Production، ولا Neon.

| الفحص | الأمر | النتيجة |
|---|---|---|
| Backend TypeScript | `npx tsc --noEmit -p tsconfig.json` | exit 0 (على `84faa31` ثم على الشجرة النهائية `e20cf93`) |
| Backend build نضيف | `npm run build` (بعد إزالة `dist`؛ الـ worktree جديد فمفيش `tsbuildinfo` قديم) | exit 0؛ `dist/main.js` موجود و8 migrations مترجمة |
| Mobile TypeScript | `cd mobile; npx tsc --noEmit` | exit 0 |
| Mobile Jest | `cd mobile; npx jest` | **14/14 suites، 203/203** |
| Backend PG — baseline على الـ candidate بدون تعديل (`84faa31`) | `backend-gate.ps1 … stockmind_gate_s05_pf1` | **41/41 suites، 255/255**، exit 0، 85.6 ث |
| Backend PG — بعد إضافة الاختبارات (`5184831`) | `…_pf2` | **فشل:** 41 نجحت / 1 فشل، 260/263 — `shared-warehouse.migration.pg.spec` (3 اختبارات) `uuid_generate_v4() does not exist` |
| تشخيص الفشل | تشغيل الـ spec لوحده على قاعدة جديدة | فشل 3/3 قبل الإصلاح ← نجح 3/3 بعد (`…_dep1` ثم `…_dep2`) |
| Backend PG — **الشجرة النهائية، 3 تشغيلات متتالية على قواعد جديدة** | `…_fin1/2/3` | **42/42 suites، 264/264** في كل تشغيلة، exit 0 ×3 |
| spec الجديد لوحده | `…_mig3` | 8/8 |
| specs الـ production غير المعدّلة | `jest --testPathPatterns prodcheck` (ملفات مؤقتة اتمسحت) | 2 suites نجحوا (7/7)؛ 4 ما اشتغلوش (TS2554 ×3 + تجهيز Nest) — characterized، قسم 2-ج |
| جهاز | — | **لم يتم**: ما اتغيّر أي كود تطبيق. أدلة Series 04 لسه سارية |

**الـ 264 = 255 + 8 (rc-admission) + 1 (انتهاء الدعوة).** اللوجات: `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_s05_*.log` و`s05-final3.summary.txt`.

**ملاحظة صدق:** التشغيلة الكاملة بعد إضافة الاختبارات **فشلت فعلاً** (`…_pf2`). ما اتعادتش لحد ما تخضر؛ اتحلّلت لسببها الجذري (اعتماد خفي على ترتيب الـ specs، موجود قبل Series 05)، واتصلّح harness الاختبارات فقط، ثم 3 تشغيلات متتالية خضرا. الـ baseline الأخضر (`pf1`) كان نتيجة ترتيب جدولة محظوظ.

**تعديلات اتعملت على الفرع (كلها اختبارات فقط، بدون كود تطبيق أو migration):**
- `5184831` — spec جديد `rc-admission.migration.pg.spec.ts` + اختبار انتهاء الدعوة في `shared-warehouse.pg.spec.ts`.
- `e20cf93` — `shared-warehouse.migration.pg.spec.ts` بقى بيثبّت `uuid-ossp` بنفسه (بيتحمّل مثبّت متزامن)، + إثبات SQL إصلاح الـ NULL revisions.

---

## 7. مخاطر مؤكدة مقابل فرضيات

| | مؤكد (CONFIRMED) | فرضية (HYPOTHESIS) / غير متحقق (UNVERIFIED) |
|---|---|---|
| Migrations | M1 `down()` مدمّر + توسيع صلاحيات؛ M2 `uuid-ossp`؛ M3 NULL revisions؛ M6 فهرس غير unique | M4 قفل backfill على جداول كبيرة؛ M5 instances متزامنة؛ وجود `uuid-ossp` على Production |
| Git/إصدار | Production مش ancestor (11 conflict)؛ 3 commits محلية غير مرفوعة داخل RC؛ 3 ملفات متّسخة بتتعارض | Render بيشغّل `bb071ed` فعلاً |
| استرداد | عنصر `history-changed` ما بيتعادش فحصه؛ إيصالات 7 أيام فقط | cursor أقدم من الـ restore؛ نافذة "الإيصال القديم يفضل confirmed" لحد بدء التطبيق |
| منتج | مخازن جديدة مش ظاهرة للـ Staff + مفيش UI؛ كل الشركات `free` | الإيميل case-sensitive |
| تغطية | runtime الموبايل بلا اختبارات آلية | Google Sign-In/AI محلياً؛ iOS؛ جهازين؛ Redis حقيقي؛ online transfer على الجهاز |

---

## 8. مراحل تصحيحية مقترحة (ولا واحدة بدأت)

| # | المرحلة | تمنع إيه | معايير القبول (مختصرة) |
|---|---|---|---|
| **CP-1** | مصالحة خط الإصدار مع production hotfix + استراتيجية الـ promotion | RC promotion | قرار موثّق (بناء branch release من الـ candidate بدل دمج `bb071ed`، أو دمج بحل الـ 11 conflict)؛ مصفوفة تكافؤ الإصلاحات الستة موقّعة (قسم 2-ج كأساس)؛ مفيش force-push؛ gates ×3 |
| **CP-2** | تقوية الـ migrations (تحتاج تغيير migrations ← gates ×3 + بروفة) | Production deploy | (أ) `1722345600000` بـ `gen_random_uuid()` أو إنشاء الامتداد؛ (ب) `down()` يرفض لو في بيانات إلا بمتغير صريح؛ (ج) حماية/إصلاح NULL revisions (فحص boot أو إصلاح تلقائي)؛ (د) فهرس unique جزئي `(warehouse_id, revision)` بعد فحص التكرار؛ (هـ) بروفة على نسخة schema الإنتاج (بموافقة الـ Director) |
| **CP-3** | S1 + S2 من الـ runbook | تفعيل المخازن المشتركة/online في Production | حسب runbook قسم 11 |
| **CP-4** | صلاحيات المخازن الجديدة | تفعيل online للفرق | قرار منتج (منح تلقائي للـ Staff أو شاشة منح في الموبايل) + اختبارات |
| **CP-5** | تثبيت plans للعملاء الحاليين قبل أي enforcement | تفعيل `ENTITLEMENTS_ENFORCED` | grandfathering + اختبار + موافقة |
| **CP-6** | تحقق: جهازين، iOS، Redis، online transfer | الإصدار العام | حسب الموارد المتاحة |

---

## 9. الـ blockers حسب المستوى

- **Blockers لـ RC admission:** لا يوجد.
- **شروط قبل RC promotion:** CP-1، والتعامل الآمن مع الـ 3 ملفات المتّسخة، وقرار مصير الـ 3 commits المحلية (Redis/FCM/checklist) اللي هتتنشر مع الـ RC.
- **Blockers لـ Production:** CP-2 كامل، و CP-1، وموافقات الإصدار المنفصلة (AAB/Play/Production deploy تظل ممنوعة بدون أمر).
- **Blockers لتفعيل الـ online/المخازن المشتركة:** CP-3، CP-4، CP-5.

---

## 10. التوصية والقرار المطلوب

**RC ADMISSION: CONDITIONAL GO.** التوصية الفنية: اعتماد `integration/series04` (+ اختبارات هذا الفرع) كأساس الـ RC الجاي، **بدون** دمج أو deploy الآن.
**القرار المطلوب من الـ Director (واحد):** اعتماد **Series 06 = "مصالحة خط الإصدار + تقوية الـ migrations" (CP-1 + CP-2)** في فرع جديد من `preflight/series05-rc-admission`، مع تحديد الأساس: *الاقتراح: بناء release line من الـ candidate وعدم دمج `bb071ed` آليّاً*. أو تعديل النطاق.

---

## 11. اللي ما اتعملش

لا جهاز، لا Production/Neon، لا Redis حقيقي، لا iOS، لا جهازين، لا Council/موديل خارجي، لا AAB/Play، لا merge فعلي، لا تغيير في الاعتماديات أو التطبيق أو الـ migrations، ولا history-epoch.

---

## ملحق: الحالة النهائية

- Worktree: `D:\Projects\StockMind-wt\series05-rc-preflight` (فرع `preflight/series05-rc-admission`). `node_modules` junctions لقراءة الاعتماديات من worktrees تانية.
- خدمات: PostgreSQL المؤقت اتوقف في آخر الشغل؛ القواعد المؤقتة `stockmind_gate_s05_*` اتحذفت.
- مفيش ملفات اتعدّلت في `D:\Projects\StockMind` (main) ولا في `integration/series04`.
