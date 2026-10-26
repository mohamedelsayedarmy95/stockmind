# STOCKMIND — SERIES 13 CONTRACT: Owner guard lock order, seat serialization, shadow evidence windows, administrative errors and balance truth

> العقد ده بيوصف **اللي الكود بيضمنه فعلاً** بعد Series 13، وحدود الضمان. بيعدّل عقد Series 11 (`SERIES_11_ENFORCEMENT_ADMISSION_CONTRACT.md`) في ترتيب الأقفال بس، وكل اللي مش مذكور هنا من عقد Series 11 لسه سارٍ.
> **مش إذن بتفعيل `enforce` ولا ببروفة enforce.** الافتراضي `CAPABILITY_MODE=shadow`. Production: NO-GO.
> الفرع: `hardening/series13-authority-observability` (من `feature/series12-standalone-qa` @ `6df3ec9`). الأدلة: `docs/handoff/series13-evidence/`. التقرير: `SERIES_13_AUTHORITY_OBSERVABILITY_REPORT.md`.

## 1. نطاق التغيير

| الجزء | الملفات | نوعه |
|---|---|---|
| N-1 trigger آخر Owner | `src/migrations/1792620000000-OwnerGuardLockOrder.ts` (**migration جديدة forward-only**) | DB |
| N-1 قفل المقاعد | `member-lock.ts` (`lockCompanySeats`)، `membership.service.ts`، `auth.service.ts`، `entitlements.service.ts` (تعليق) | backend |
| N-2 نوافذ الأدلة | `capability-shadow.service.ts` (جديد، الكلاس اتنقل من `capability.service.ts` واتعمله re-export)، `domain/authorization/shadow-window.ts` (جديد)، `permissions.guard.ts`، `warehouse-access.service.ts`، `shadow-diagnostics.guard.ts` + `shadow-diagnostics.controller.ts` (جداد)، `rbac.module.ts`، `http-logger.options.ts`، `scripts/shadow-evidence.mjs` (جديد) | backend + أداة |
| N-3 أخطاء الإدارة | `mobile/src/domain/admin-errors.ts` (جديد)، `team-actions.ts`، `capabilities.ts`، `app/team.tsx`، `app/team-access.tsx`، `app/warehouse/new.tsx`، اللغات | mobile |
| R-37 حقيقة الرصيد | `mobile/src/domain/balance-truth.ts` (جديد)، `app/movement/[productId].tsx`، `app/product/[productId].tsx`، `OnlineWarehouseStock.tsx`، `api-repositories.ts`، اللغات | mobile |

لا اعتماديات جديدة، لا تغيير في `package.json`/lockfiles، لا تغيير في بيانات حقيقية.

## 2. ترتيب الأقفال العالمي (بعد Series 13)

| الخطوة | القفل | مين ياخده | الوضع |
|---|---|---|---|
| 0 | قفل عضوية الشركة `hashtextextended('stockmind:company-members:' || company_id, 0)` (advisory، **عادل**) | إجراءات العضوية **و trigger آخر Owner** (جديد) | exclusive؛ re-entrant جوه نفس الـ transaction |
| 0b | قفل مقاعد الشركة `hashtextextended('stockmind:company-seats:' || company_id, 0)` (advisory، **عادل**، **جديد**) | قبول دعوة، إعادة تفعيل عضو *محذوف* | exclusive |
| 1 | صف الـ company | كل اللي بيكتب تحت الشركة | `FOR KEY SHARE` / `FOR SHARE`. `FOR UPDATE` **فقط** لتدوير الـ generation (لازم يستبعد كل كتابة) |
| 2 | أقفال الأعضاء (`lockMembers`) | زي Series 11 | exclusive للهدف، shared للـ actor |
| 3 | صفوف الأعضاء | | تصاعدي |
| 4 | المخازن / الـ inventory | | تصاعدي |

**قاعدة جديدة مُثبتة بالقياس:** `FOR UPDATE` على صف الشركة **ممنوع** على أي حاجة غير الـ rotation. مش بس لأنه بيتجوّع ورا سيل `KEY SHARE`: **`lock_timeout` مابيحدّهوش**، لأن كل `KEY SHARE` جديد بيبدأ انتظار جديد (اتقاس: `lock_timeout=1500ms` والانتظار وصل 8.1 ثانية وماخلصش غير لما السيل وقف).

| المسار | قبل Series 13 | بعد Series 13 |
|---|---|---|
| UPDATE صف Owner نشط (الـ trigger) | `companies FOR UPDATE` **بعد** خطوات 2 و3 (عكس الترتيب) | قفل العضوية (خطوة 0؛ no-op لأن الإجراء ماسكه) |
| reactivate عضو محذوف | قفل العضوية + `companies FOR UPDATE` | قفل العضوية + **قفل المقاعد** |
| accept-invitation | صف الدعوة + `companies FOR UPDATE` | صف الدعوة + **قفل المقاعد** |
| تدوير الـ generation | `companies FOR UPDATE` | **بدون تغيير** (حد معروف: بيتجوّع تحت سيل كتابات؛ إجراء مشغّل نادر وعليه flag) |

**ليه مفيش cycle:** الـ trigger بياخد مفتاح خطوة 0 اللي إجراء العضوية ماسكه من الأول، فمش بيستنى حاجة جديدة جوه التطبيق. قفل المقاعد مابيتاخدش غير من قبول الدعوة (اللي مابياخدش أقفال أعضاء) ومن إعادة التفعيل (بعد خطوة 0 وقبل خطوة 2)، فمحدش بيستنى في الاتجاه العكسي. **حدود الادعاء:** ده إثبات بالترتيب + سيناريوهات حتمية + ضغط محدود، مش إثبات إن النظام "خالي من الـ deadlock" في كل الحالات.

## 3. ثابت آخر Owner في قاعدة البيانات (`users_guard_last_owner`، migration `1792620000000`)

الـ trigger: `BEFORE UPDATE OF is_owner, status, company_id, role OR DELETE ON users` (الـ `role` **جديد**).

لما الصف القديم Owner نشط:
1. **DELETE لشركة كاملة (cascade)** → مسموح (زي ما كان).
2. **بيفضل Owner نشط في نفس الشركة:** لو دوره كان `Admin` وبقى غيره → **مرفوض** `owner_requires_admin_role` (SQLSTATE `23514`). الـ Owner والـ Admin مع بعض، زي سياسة التطبيق. (عشان تنزّل Owner لازم تشيل `is_owner` في نفس الـ statement، وساعتها البند 3 بيطبّق.)
3. **بيفقد المقعد** (status مش active، `is_owner=false`، شركة تانية، أو delete):
   - تحت **`REPEATABLE READ`** → مرفوض `owner_change_requires_read_committed` (SQLSTATE `55000`): الـ snapshot ممكن يكون أقدم من تغيير متزامن، فالفحص مايبقاش صحيح (اتثبت قبل الإصلاح: جلستين RR شالوا الـ Owners الاتنين).
   - ياخد قفل العضوية (خطوة 0)، وبعدين لازم يفضل Owner **شرعي** تاني: `is_owner AND status='active' AND role='Admin'`؛ غير كده → `last_active_owner`.
   - `READ COMMITTED` (التطبيق و psql الافتراضي) بيقرأ من جديد بعد القفل. `SERIALIZABLE` محمي بالـ SSI بتاع PostgreSQL (اتجرّب: التاني بياخد `40001`).

الترجمة في التطبيق: `last_active_owner` → 409 `LAST_OWNER`؛ `owner_requires_admin_role` → 409 `INVALID_TRANSITION` (السياسة بترفض قبله، ده backstop).

**إجراء المشغّل (SQL مباشر، synthetic/غير إنتاجي فقط):** شغّل تحت `READ COMMITTED`. ولو عايز تتسلسل مع التطبيق من الأول: `SELECT pg_advisory_xact_lock(hashtextextended('stockmind:company-members:' || '<company-uuid>'::uuid::text, 0));` أول statement في الـ transaction. من غيره الـ trigger بياخد القفل بعد قفل صف العضو؛ مع إجراء عضوية متزامن من التطبيق ممكن يحصل deadlock **بيتكشف ويتلغى** (مش انتظار مفتوح).

## 4. Migration `1792620000000` (OwnerGuardLockOrder)

- **forward-only**: `1792600000000` فضلت زي ما اتطبّقت؛ الجديدة بتعمل `CREATE OR REPLACE FUNCTION` + إعادة إنشاء الـ trigger. **ما بتلمسش أي صف.**
- `down()` بترجّع دالة وtrigger الـ Series 09 بالحرف (مافيش بيانات؛ بيرجّع العيوب اللي اتثبتت). **مايتعملش على Production أبداً** (`migration:revert` ممنوع على Production زي ما هو).
- مُختبر: ترقية من schema الـ Series 12 (12 migration + أعضاء synthetic) بتشغّل الجديدة بس، والأعضاء بنفس الـ hash؛ تثبيت جديد (13) = نفس تعريف الدالة والـ trigger بالحرف؛ down ثم up = نفس الحالة.
- الـ boot (`migrationsRun: true`) هيشغّلها لوحده على أي بيئة بتقوم بالكود ده. **مااتشغلتش على أي قاعدة حقيقية.**

## 5. نوافذ أدلة الـ shadow (N-2)

### 5.1 النموذج
- كل process ليها `instance.id` عشوائي (UUID) + `pid` + `startedAt`. **restart = instance جديد** ونافذة رقم 1 `openedBy: process-start`.
- النافذة: `id`، `sequence`، `label` (اختياري، `[A-Za-z0-9._:-]{1,64}`)، `openedAt`، `openedBy` (`process-start | operator | reset`)، `closedAt`، `closeReason` (`rolled | reset | shutdown`).
- عدّادات دقيقة: `compared`, `equal`, `expectedDifferences`, `unexpectedDifferences`, `errors`, `incomplete`.
- تفصيل دقيق: `incompleteByReason` (`no-principal`, `principal-not-active`, `no-company`, `model-not-wired`)، `errorsBySource` (`permission`, `scope`)، `unexpectedByReason`، `unexpectedByRoute`، `expectedByRoute`، `modes.guardedByMode` (كل طلب محروس في **كل** الأوضاع).
- عينات محدودة **بدون حذف صامت**: أول 100 unexpected (`unexpectedKept: first`) + `unexpectedDropped`؛ آخر 50 expected + `expectedDropped`.
- سطور اللوج المنظمة (`capability-shadow-unexpected|incomplete|error`) فيها `instance` و`window`؛ ميزانية 100 لكل نوع لكل نافذة، والزيادة بتتعد في `logging.suppressed`.
- `previousWindows`: ملخص آخر 5 نوافذ مقفولة (بالحكم بتاعها). نافذة فيها مشاكل **مابتتمسحش**: بتتقفل وتتسجّل.

### 5.2 الحكم (`judgeWindow`، pure)
| الحكم | الشرط |
|---|---|
| `UNEXPECTED_DIFFERENCES` | `unexpectedDifferences > 0` (فشل) |
| `INCONCLUSIVE` | أي `incomplete` أو `errors`، أو الوضع مكانش `shadow` وقت الفتح/الحكم، أو أي طلب اتقرر برّه shadow خلال النافذة، أو العدّادات مش متطابقة |
| `NO_EVIDENCE` | مفيش مقارنة خالص (السكوت مش parity) |
| `CLEAN` | مقارنات حصلت، كلها equal أو expected بمنحة صريحة، ومفيش دليل ناقص |

`parityObserved = (verdict === CLEAN)` وده **عن الـ process دي والنافذة دي بس**. `reasons` بتطلع كل الأسباب مرتبة بالخطورة (مفيش سبب بيداري على التاني).

### 5.3 قنوات القراءة
1. **اللوج (السجل الدائم):** سطر `capability-shadow-window-closed` (JSON واحد، من غير العينات) عند كل قفل نافذة وعند الـ shutdown؛ وسطر `capability-shadow-window-progress` كل `CAPABILITY_SHADOW_REPORT_INTERVAL_MS` (الافتراضي 15 دقيقة، `0` = مقفول، المدى 10s..24h).
2. **مسار تشخيص للمشغّل المحلي فقط:**
   - `GET /api/v1/internal/capability-shadow` → تقرير النافذة الحالية (`Cache-Control: no-store`).
   - `POST /api/v1/internal/capability-shadow/window` `{label?}` → يقفل الحالية (التقرير النهائي بيرجع وبيتسجل) ويفتح الجاية.
   - **الشروط الثلاثة لازم مع بعض:** `SHADOW_DIAGNOSTICS_TOKEN` متظبط (≥ 32 حرف؛ **مش متظبط افتراضياً**)، الـ TCP peer = loopback (`127.0.0.1`/`::1`/`::ffff:127.0.0.1`، من الـ socket مش `req.ip`/`X-Forwarded-For`)، والهيدر `X-Shadow-Diagnostics-Token` مطابق (مقارنة ثابتة الزمن على digest).
   - أي رفض = **404 نفس بتاع الـ router** (`Cannot GET …`). JWT أي tenant (حتى الـ Owner) مش طريق دخول: الأدلة عابرة للشركات.
   - `@ApiExcludeController` (مش في الـ Swagger)، `@SkipAudit` (مش في audit_logs بتاع أي شركة)، الهيدر متشال من اللوج (`REDACTED_LOG_PATHS`).
3. **الأداة:** `node scripts/shadow-evidence.mjs open <label>` → … → `close`: بتحفظ التقرير النهائي + `.sha256`؛ exit `0` = CLEAN فقط، `2` = أي حكم تاني، `3` = **مايتوثقش فيه** (`RESTART_DETECTED` لو الـ instance اتغير، `WINDOW_ROLLED_ELSEWHERE` لو حد تاني قفل النافذة)، `64/65` = استخدام/وصول. بترفض أي base URL مش loopback (التوكن مايتبعتش لبرّه).

### 5.4 الخصوصية
التقرير مافيهوش: id العضو (بدله `subject` = HMAC-SHA256 بمفتاح عشوائي لكل process، أول 16 hex: ثابت جوه الـ process، مش قابل للربط بين process وتانية)، إيميل، JWT، توكن التشخيص، أي body أو قيمة، التكلفة. رسالة الخطأ **مابتتسجلش** (ممكن تردّد مدخلات): اسم الكلاس والـ code بس. فيه: routes، أسماء capabilities، ids المخازن، أسماء الـ profiles.

### 5.5 مصدر الوقت (F13-05)
صلاحية المنحة قرار قاعدة بيانات: الـ loader بيفلتر بـ `now()` بتاع الـ statement، وبيرجّع نفس القيمة كـ `Principal.asOf` (نص timestamptz). الـ classifier بيعيد فحص `valid_from` / `valid_until` **عند `asOf`** (مش بساعة التطبيق) ومقارنة بالميكروثانية (`epochMicros`). `input.now` الصريح (الاختبارات) لسه أولى. `asOf` داخلي: مش في أي response ولا في `accessVersion`.

### 5.6 الحدود (مكتوبة في كل تقرير)
ذاكرة بس ولكل process: restart بيضيّع النافذة المفتوحة (سطر الـ shutdown/closed هو السجل). **مفيش تجميع بين instances:** بروفة على أكتر من instance لازم تقرأ كل instance لوحدها وتطابق الـ ids. مش audit trail ولا monitoring.

## 6. أخطاء الإدارة على الموبايل (N-3)

`mobile/src/domain/admin-errors.ts` → `adminFailure(status, code, surfaceKey)`:

| الاستجابة | `kind` | النص | `tone` | تكرار لاحقاً؟ | إعادة قراءة |
|---|---|---|---|---|---|
| 503 + `AUTHORITY_BUSY` | `busy` | `admin.error.authorityBusy` ("في تغيير تاني… محصلش أي تغيير — جرّب تاني بعد شوية") | warning | أيوه (الشخص يقرر) | أيوه |
| أي + `SCOPED_GRANTS_PRESENT` | `grant-conflict` | `admin.error.scopedGrantsPresent` (بيوجّه لـ «صلاحيات المخازن») | error | لا | أيوه |
| 502/503/504 من غير code | `unavailable` | `admin.error.unavailable` | warning | أيوه | لا |
| مفيش رد | `network` | نص الشاشة (`team.error.network` / `access.error.network`) | warning | أيوه | لا |
| غير كده | `refused` | خريطة الشاشة القديمة (Series 09/10) بدون تغيير | error | لا | أيوه |

- الشاشات: Team، صلاحيات المخازن، مخزن جديد (CP-4). **التطبيق مابيبعتش الطلب تاني لوحده**: الـ mutations `retry: false` (مختبر statically)، والـ HTTP client مابيعيدش غير بعد refresh الـ 401.
- `busy`: المسودة بتفضل (صلاحيات المخازن/المخزن الجديد)، والقائمة بتتقري تاني، والزرار متاح تاني. مفيش رسالة نجاح في أي `onError`.
- `SCOPED_GRANTS_PRESENT` بيطلع بس من الـ legacy `PUT /team/members/:id/warehouses`، و**ولا شاشة في الموبايل بتنادي عليه** (اتأكدنا بالبحث). الربط موجود دفاعياً ومختبر.

## 7. حقيقة الرصيد (R-37)

`mobile/src/domain/balance-truth.ts` → `resolveBalance({online, productId, warehouseId, sync, query})`:

| الحالة | امتى | النص (EN / AR) |
|---|---|---|
| `confirmed` (server/device) | رقم السيرفر الحالي (أو دفتر الجهاز أوفلاين)؛ **0 المؤكد صفر حقيقي** | `Current balance: N` / `الرصيد الحالي: N` |
| `last-known` | من آخر مزامنة ناجحة لكن آخر poll فشل أو بيتعاد البناء | `Last known balance: N · last confirmed HH:MM` / `آخر رصيد معروف: N · آخر تأكيد …` |
| `loading` | لسه مفيش رد ومفيش فشل | `… loading…` / `… بيتحمّل…` |
| `unknown:unreachable` | السيرفر مش متاح ومفيش مزامنة | `Current balance: unknown — the server can't be reached` |
| `unknown:no-access` | 403/404 أو المزامنة اترفضت (حتى لو فيه cache: **مايتعرضش**) | `not available for this warehouse` |
| `unknown:mismatch` | الرد لمنتج/مخزن تاني (**عمره ما بيتاخد**) | `unknown` |
| `unknown:invalid` | رقم مش مقروء | `unknown` |

- بعد snapshot: منتج من غير صف = **0 مؤكد** لحد آخر revision، إلا لو الطلب المباشر رد على نفس المنتج.
- الصرف أونلاين: `issuableOnline` من رصيد **معروف** بس (المجهول = مفيش صرف، ورسالة "الصرف محتاج رصيد معروف" بدل "1 لـ 0")؛ الصرف المتطابور بيقلل، **الاستلام المتطابور عمره ما بيزوّد** الرصيد أو الحد.
- قائمة مخزون المخزن: `warehouseListState` بيفرّق loading / unreachable / empty / empty-last-known / no-access (قبل كده: "Loading…" للأبد لو أول مزامنة فشلت).
- `ApiStockRepository.availability` بيرمي خطأ لرقم مش مقروء بدل ما يحوّله 0.

## 8. ما لم يتغيّر عمداً
- `CAPABILITY_MODE` الافتراضي `shadow`؛ `enforce` ماتفعّلش في أي مكان.
- سياسة العضوية، الـ classifier بتاع Series 11، الـ API العام، الـ entitlements (لسه مش enforced)، Series 07 recovery، Series 09 privacy، QA boundary بتاع Series 12.
- R-18/R-19/R-20 سياسات، مش منفّذة.

## 9. حدود معروفة
- تدوير الـ generation لسه `FOR UPDATE` على الشركة: بيتجوّع تحت سيل كتابات، و`lock_timeout` مابيحدّهوش (نفس آلية القياس فوق). إجراء مشغّل نادر وعليه flag؛ مااتصلحش هنا (يحتاج تصميم fence مختلف).
- SQL مباشر بالتوازي مع إجراء عضوية لنفس الشركة: deadlock ممكن **بيتكشف** (مش انتظار مفتوح)؛ الإجراء في §3 بيمنعه.
- الأدلة in-memory لكل process (§5.6).
- الضغط والأداء اتقاسوا محلياً بس (PG 15.19 على نفس الجهاز).
