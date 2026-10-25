# STOCKMIND — SERIES 09 AUTHORIZATION & PRIVACY CONTRACT (S0 + S1)

> عقد تقني (API + DB + سلوك العميل) لـ **S0 الخصوصية المالية (`item.view_cost`)** و**S1 دورة حياة العضو والإبطال الفوري**.
> الحالة: **منفَّذ ومختبَر على بيئة تطوير فقط** (PostgreSQL مؤقتة 15، بيانات synthetic، بدون جهاز). **Production = NO-GO.**
> الكود هو المرجع؛ الملف ده بيوصفه. كل جملة "مضمون" ليها اختبار مذكور في §10.
> المصطلحات: *member* = صف في `users` تابع لشركة. *revocation* = إنهاء قدرة عضو على استخدام بيانات الشركة. *owner* = علامة ملكية (metadata) منفصلة عن دور Admin.

---

## 1. النموذج في أربعة أسطر

1. **التكلفة:** أي رد منتج بيعدّي على allowlist (`toProductResponse`). مفتاح `costPrice` **غايب تماماً (مش `null`)** إلا لو المستدعي معاه `item.view_cost` (Admin افتراضياً؛ Manager وStaff لا تلقائياً؛ منح صريح بدور مخصّص مدعوم).
2. **العضو:** `users.status` (`active|suspended|removed`) + `users.token_version` + `users.is_owner`. كل طلب مصادَق بيقرأ صف العضو من الـ DB (status، token_version، الشركة، **الدور**) — الـ claims في الـ JWT مجرد هوية.
3. **الإبطال:** تعليق/إزالة/تغيير دور/إنهاء جلسات = `token_version + 1` (وتصفير الـ refresh hash حيث يلزم) في transaction واحدة. أي access token قديم بيترفض في **أول طلب بعدها** بـ `401 {code:'ACCESS_REVOKED'}`.
4. **الحماية:** سياسة نقية (`membership-policy.ts`) بتقرر مين يعمل إيه في مين، و**trigger في الـ DB** بيحمي "آخر Owner نشط" حتى لو اتعدّى التطبيق. كل تغيير بيتسجّل في `membership_events` (append-only).

---

## 2. تغييرات الـ DB (migration واحدة، additive): `1792600000000-AccessLifecycle`

| العنصر | الوصف |
|---|---|
| `users.status text NOT NULL DEFAULT 'active'` + `CHECK ck_users_status` | الأعضاء الحاليين كلهم `active`. |
| `users.token_version integer NOT NULL DEFAULT 0` | التوكنز القديمة (بدون `tv`) تُعامل كـ `0` فتفضل شغّالة لحد أول إبطال. |
| `users.is_owner boolean NOT NULL DEFAULT false` | **Backfill من دليل موثوق فقط:** شركة فيها **Admin واحد بالظبط** ← هو المالك (حسابات Admin بتتولّد من `register` فقط، اللي بينشئ الشركة). شركة فيها 0 أو ≥2 Admin ← **تفضل بدون owner (fail closed)**. |
| `users.status_changed_at / status_changed_by` | آخر تغيير حالة. |
| trigger `trg_users_guard_last_owner` (+ دالة) | يرفض (`last_active_owner`) أي UPDATE/DELETE يخلّي شركة عندها owner نشط بدون owner نشط؛ بيعمل serialization على صف الشركة (`FOR UPDATE`) فتعديلين متزامنين مش بيعدّوا الاتنين. حذف الشركة نفسها (cascade) مسموح. |
| index `ix_users_company_active_owner` | partial على المالكين النشطين. |
| `membership_events` | append-only (trigger بيمنع `UPDATE`): الشركة، actor، target (id + email snapshot بدون FK)، النوع (`suspend|reactivate|remove|change_role|revoke_sessions`)، من/إلى (status, role)، `sessions_revoked`، السبب، metadata، الوقت. |
| `down()` | **fail-closed**: بيرفض قبل أي تعديل لو في membership event، أو عضو موقوف/محذوف، أو `token_version > 0`، أو owner مش قابل للاشتقاق من قاعدة "Admin واحد". الرجوع = restore backup أو fix-forward. |

الـ migrations بقت **11**. لا تغيير في أي migration سابقة. **اعتماديات: صفر تغيير.**

### Legacy ownership (شركات بدون owner)
شركة بعد الـ migration بدون owner = غامضة (0 أو ≥2 Admin). **النتيجة:** أي Admin فيها **مش** يقدر يوقف/يحذف/يغيّر دور Admin تاني، ولا يرقّي حد لـ Admin (`OWNER_REQUIRED`). لسه يقدر يدير Manager وStaff. **العلاج:** إجراء مشغّل (خارج التطبيق) يحدد الـ owner من دليل (مثلاً سجل التسجيل/الاتفاقية) بـ `UPDATE users SET is_owner = true WHERE id = <founder>` — الـ trigger ما بيمنعش ده. **لا تُشتق الملكية من أقدم Admin أو غيره بدون دليل.** نقل الملكية **مؤجَّل** (Q-03).

---

## 3. S0 — الخصوصية المالية

### 3.1 الاستغلال (قبل الإصلاح — مُثبت تشغيلياً)
`docs/handoff/series09-evidence/s0-before-fix.json` (PG حقيقية، HTTP حقيقي، قيمة synthetic `7351.25`):

| الاستدعاء | Admin | Manager | **Staff** | شركة تانية |
|---|---|---|---|---|
| `GET /products` | يظهر | يظهر | **يظهر** | لا شيء |
| `GET /products/:id` | يظهر | يظهر | **يظهر** | 404 |
| `POST /products`، `PATCH`، `POST …/image` (الرد) | يظهر | يظهر | — (403) | — |
| `audit_logs` | **4 صفوف فيها القيمة بالنص الصريح** (request + response) | | | |

الخلاصة: **D1 مؤكد**، وإضافة **D10** (جديد): الـ audit كان بيسرّب القيمة ويكسر التشفير في التخزين لأي حد يقرأ `audit_logs`.

### 3.2 بعد الإصلاح — `s0-after-fix.json`
- `costPrice` موجود لـ Admin فقط، غايب (key absent) لـ Manager وStaff على: list، detail، create، update، image upload.
- `Vary: Authorization` على `GET /products` و`GET /products/:id`؛ `Cache-Control: private, max-age=60` كما هو (بقى آمن لأن الجسم per-caller).
- `audit_logs`: **0** صف فيه القيمة؛ المفتاح محفوظ بقيمة `[REDACTED]` (طبقتين: interceptor + sink).
- الـ DTO allowlist: ما فيش عمود جديد في `Product` بيتسرّب لحد ما يتضاف عمداً. اتشال `deletedAt/deletedBy` من الرد (داخلي).

### 3.3 القرارات
- **Manager لا يملك `item.view_cost` تلقائياً** (RBAC spec §64). **أثر:** Manager كان بيشوف التكلفة قبل كده؛ دلوقتي لا. ده تضييق مقصود وبيحتاج إبلاغ العملاء. المنح الصريح: دور مخصّص فيه `item.view_cost` (`role_permissions` + `user_roles`) — مُختبَر.
- **Manager يحتفظ بالكتابة عند الإنشاء** (`POST /products` بـ `costPrice`) من غير ما يشوفها راجعة (compat). Staff لا يقدر ينشئ منتجات أصلاً.
- `PATCH /products/:id` **ما بيقبلش `costPrice`** (كان كده قبل Series 09: `forbidNonWhitelisted` → 400). ما اتغيّرش.
- اسم الصلاحية `item.view_cost` (نمط dotted من الـ RBAC spec)، بينما باقي الصلاحيات الحالية SCREAMING_SNAKE — فرق شكلي مقبول لحد توحيد التسمية.

---

## 4. S1 — دورة الحياة والإبطال

### 4.1 الطلب المصادَق (`JwtStrategy.validate`)
بعد التحقق من التوقيع والانتهاء: `SELECT company_id, role, status, token_version FROM users WHERE id = $1` (PK، index scan، بدون cache):
- الصف مش موجود ← 401.
- `status ≠ active` ← `401 {code:'ACCESS_REVOKED'}`.
- `companyId` (claim) ≠ `company_id` (صف) ← 401.
- `tv` (claim؛ غايب = 0) ≠ `token_version` ← `401 {code:'ACCESS_REVOKED'}`.
- الدور = **من الصف** (claim الدور مبقاش يمنح أي حاجة).
**التكلفة المقيسة:** +0.33 ms وسيط (+0.18 ms عند p95) على نفس الجهاز؛ على قاعدة بعيدة تضيف زمن الرحلة الشبكية (1–20 ms). مفيش cache عمداً (cache = تأخير إبطال).

### 4.2 تسجيل الدخول والتجديد
- Login/2FA/Google/SAML: بعد صحة الهوية، عضو غير نشط ← `403 {code:'ACCESS_REVOKED'}` (مش "invalid credentials"، ومش قبل التحقق من كلمة السر).
- `POST /auth/refresh-token`: عضو غير نشط ← `401 {code:'ACCESS_REVOKED'}` **قبل** فحص الـ hash المصفَّر (علشان العميل يفرّق).
- الـ access token الجديد بيحمل `tv`. تغيير كلمة السر و"إنهاء كل الجلسات" الذاتي بقوا بيرفعوا `token_version` كمان (إبطال فوري بدل انتظار 15 دقيقة).

### 4.3 الإجراءات (`TeamController`، كلها `MANAGE_USERS`)
| Endpoint | الأثر |
|---|---|
| `POST /team/members/:id/suspend` | `status=suspended`، `tv+1`، refresh hash = NULL. الصلاحيات تفضل (قابل للإرجاع). |
| `POST /team/members/:id/reactivate` | `status=active` (من suspended/removed). **مفيش إحياء توكنز قديمة.** من `removed` بياخد seat (فحص الـ plan). |
| `POST /team/members/:id/remove` + `{confirm:true}` | `status=removed`، `tv+1`، refresh=NULL، **مسح warehouse_access وuser_roles** (مفيش صلاحية بترجع بالصمت). الصف بيفضل (history منسوب). بيحرّر seat. |
| `POST /team/members/:id/revoke-sessions` | `tv+1` + refresh=NULL؛ الحساب نشط. مسموح على النفس. |
| `PATCH /team/members/:id/role` `{role, acknowledgeCompanyWideAccess?}` | `tv+1` (refresh يفضل: التطبيق بيجدّد بهدوء). الترقية لـ Manager/Admin تتطلب `acknowledgeCompanyWideAccess:true`. التخفيض لـ Staff بيمسح الصلاحيات (يبدأ بلا مخازن). |
| `GET /team/members/:id/events` | آخر 50 حدث (الأحدث أولاً). |
| `GET /team/members` | بقى فيه `status`, `isOwner`, `statusChangedAt`. |

### 4.4 السياسة (من `membership-policy.ts`، كل قاعدة ليها اختبار)
- الفاعل لازم يكون نشط (`ACTOR_NOT_ACTIVE`)؛ **لا ذاتي** (suspend/remove/reactivate/role) (`CANNOT_MODIFY_SELF`)؛ إنهاء جلساتك مسموح.
- أي إجراء على **عضو Admin** يتطلب إن الفاعل **owner** (`OWNER_REQUIRED`). ترقية أي حد لـ Admin: owner فقط.
- **آخر owner نشط** مش بيتوقف/يتحذف (`LAST_OWNER`)؛ المالك **لا يغيّر دوره** في الإصدار ده (`INVALID_TRANSITION`) — نقل الملكية مؤجَّل.
- تحويلات مش منطقية (`INVALID_TRANSITION`/`NO_CHANGE`/`TARGET_NOT_ACTIVE`/`ROLE_REQUIRED`).
- HTTP: سلطة 403، حالة 409، طلب ناقص 400. الشركة التانية و`id` مش موجود = **404 متطابق**.

### 4.5 الإبطال أثناء الكتابة (الفجوة بين الـ guard والـ commit)
`assertActorActive`: `SELECT … FROM users WHERE id AND status='active' FOR SHARE` **جوه transaction** كل من: الحركات (`applyMovementInTransaction` + `transfer`)، التعويض (`assertAccess`)، وتدوير الـ generation. التعليق يحتاج قفل exclusive على صف العضو، فإما: (أ) اتعمل commit قبل ← الكتابة ترفض ومفيش حركة، أو (ب) كتابة شغّالة ← التعليق يستنى لحد commit الكتابة (الكتابة حصلت قبل التعليق). **مفيش كتابة مرتّبة بعد commit التعليق.** ترتيب الأقفال: الشركة ← الأعضاء (بالـ id) ← المخازن (بالـ id)؛ الحركات بتاخد عضو (`SHARE`) ثم مخازن فقط.
**حد معروف:** تغيير الدور (مش التعليق) بيتطبق من أول طلب جديد؛ طلب كتابة اتجاز الـ guard بنفس الدور القديم ممكن يكمل (ملّي ثانية). الفحص جوه الـ transaction بيتحقق من الحالة (active) مش الدور.

---

## 5. العميل (الموبايل)

- **Team screen** (`app/team.tsx`، Admin + online): قايمة، حالة، دور، علامة Owner؛ الأزرار من `availableActions` (مرآة نقية للسياسة لعرض الأزرار فقط — السيرفر هو المرجع)؛ كل إجراء مدمّر بتأكيد بلغة واضحة؛ الترقية لـ Manager/Admin بتأكيدين وتقول "يشوف كل المخازن"؛ كل كود رفض من السيرفر ليه رسالة عربي/إنجليزي.
- **Outbox:** `401 ACCESS_REVOKED` بقى **مش** "جلسة منتهية": العملية تتحول `REJECTED` (أو `NEEDS_REVIEW` لو محاولة سابقة ممكن تكون سُجّلت) بسبب `access-revoked`، **وباقي طابور الحساب بيتحجز كمان بدون أي محاولة إرسال**. مفيش إرسال تلقائي بعد إعادة التفعيل؛ الشخص يختار "جرّب تاني بدون تعديل" (نفس الـ id/key/payload) أو "امسح". ممنوع الإرسال التلقائي حتى لو سجّل دخول تاني.
- **الدخول:** خروج بسبب إبطال بيظهر رسالة هادئة على شاشة الدخول ("الصلاحية اتغيّرت… العمليات المحفوظة متحفوظة ومحدش هيبعتها لوحده")؛ دخول مرفوض بسبب الإيقاف له رسالته. **لا wipe لأي بيانات.**
- التوافق: عملاء قدام (قبل Series 09) بيشوفوا 401/403 عادي؛ مفيش كسر صامت لأي endpoint موجود (الإضافات فقط، و`costPrice` غايب لغير المخوَّلين).

---

## 6. الأمان والخصوصية — ما الذي لم يتغيّر وما الحدود

- لا RLS (العزل بالتطبيق: `TenantMiddleware`/`TenantSubscriber`) — بدون تغيير.
- ما فيش ادعاء tamper-proof: `membership_events` append-only بـ trigger على `UPDATE` فقط (الحذف ممكن لمستخدم DB؛ cascade الشركة مسموح).
- `audit_logs` القديمة (قبل Series 09) **لسه ممكن تحتوي تكلفة بالنص الصريح** في أي بيئة اشتغل فيها الإصدار القديم. **تنظيفها خطوة مشغّل منفصلة** (UPDATE يمسح مفتاح `costPrice` من `old_values/new_values` بعد backup) — **ما اتنفّذتش** (مفيش Production/Neon، ومفيش تنظيف مدمّر بدون تفويض). `VIEW_AUDIT_LOG` أصلاً بلا endpoint قراءة (D9) فالتعرّض عبر SQL/تقارير فقط.
- لا secrets في الأدلة: كل القيم synthetic. لا `.env` اتقرأ.

---

## 7. ما اتأجّل عمداً (خارج التفويض)

نقل الملكية، multi-org، profiles مدير مخزن بنطاق (Q-02)، step-up للإجراءات الحرجة، approvals، retention، min client version، تنظيف audit القديم، فرض الإصدار الأدنى للعملاء، endpoint قراءة audit، UI تاريخ الأحداث على الموبايل (الـ API موجود).

---

## 8. الواجهات والأكواد (مرجع سريع)

| كود | HTTP | المعنى |
|---|---|---|
| `ACCESS_REVOKED` | 401 (طلب/refresh) / 403 (login) | العضو موقوف/محذوف أو الجلسات اتبطلت |
| `OWNER_REQUIRED` | 403 | الإجراء ده للمالك فقط |
| `ACTOR_NOT_ACTIVE` | 403 | الفاعل نفسه مش نشط |
| `CANNOT_MODIFY_SELF` | 409 | |
| `LAST_OWNER` | 409 | آخر مالك نشط (السياسة أو الـ trigger) |
| `INVALID_TRANSITION`, `NO_CHANGE`, `TARGET_NOT_ACTIVE` | 409 | |
| `ACKNOWLEDGEMENT_REQUIRED`, `ROLE_REQUIRED` | 400 | |

---

## 9. إجراءات تشغيل (للمشغّل، غير منفّذة)

1. **بعد النشر على بيئة فيها بيانات:** افحص الشركات بدون owner: `SELECT c.id, count(*) FILTER (WHERE u.role='Admin') admins, count(*) FILTER (WHERE u.is_owner) owners FROM companies c JOIN users u ON u.company_id=c.id GROUP BY c.id HAVING count(*) FILTER (WHERE u.is_owner)=0;` وحدّد الـ owner من دليل.
2. **تنظيف audit القديم** (اختياري، بعد backup وموافقة): انظر §6.
3. **بلّغ المديرين (Manager)** إن رؤية التكلفة اتسحبت منهم افتراضياً وإن المنح بدور مخصّص.

---

## 10. خريطة الاختبارات (كل "مضمون" هنا ← اختبار)

| الضمان | الاختبار |
|---|---|
| NT-12: لا `costPrice` key لغير المخوَّل في أي رد منتج، Vary، audit، التشفير في التخزين، منح صريح/سحبه | `tests/integration/financial-privacy.pg.spec.ts` (14) |
| إثبات الاستغلال قبل/بعد | `tests/integration/s0-cost-exposure.repro.pg.spec.ts` → `series09-evidence/s0-{before,after}-fix.json` |
| تعليق/إزالة/إنهاء جلسات/تغيير دور فوري؛ refresh/login؛ replay idempotent؛ claim دور مزوّر؛ `tv` خاطئ؛ شركة تانية؛ owner-only؛ شركة بلا owner؛ الفجوة داخل الـ transaction (كتابة + تدوير) | `tests/integration/access-lifecycle.pg.spec.ts` (15) |
| قواعد السياسة كلها | `tests/unit/membership-policy.spec.ts` (14) |
| الـ migration: backfill، trigger، تزامن، down() fail-closed، تطابق schema fresh/legacy | `tests/integration/release-safety.migration.pg.spec.ts` (24) |
| تكلفة البحث لكل طلب | `tests/integration/auth-lookup.perf.pg.spec.ts` → `series09-evidence/s1-auth-lookup-perf.json` |
| الموبايل: outbox/إبطال، أزرار الفريق، رموز الأخطاء، تغطية اللغتين، منع تكرار مفاتيح i18n | `mobile/src/domain/access-revocation.test.ts`, `team-actions.test.ts`, `replacement.test.ts` (guard) |
| Negative controls (8 + 1) | `series09-evidence/negative-controls.txt` |
