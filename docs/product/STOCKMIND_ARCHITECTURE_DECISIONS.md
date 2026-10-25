# STOCKMIND — ARCHITECTURE DECISIONS (ADR A–J) + قرارات الـ Director المعلّقة

> **الحالة:** مقترحات (Series 08، توثيق فقط). **مفيش ADR هنا "مقبول" — كلها Proposed لحد ما الـ Director يقرر.**
> كل ADR: السياق (دليل من الكود: GM = `STOCKMIND_CODE_TO_CAPABILITY_GAP_MATRIX.md`) · البدائل · القرار المفضّل · المقايضات · تكلفة التنفيذ والتشغيل · ما هو غير محسوم.
> **ممنوع أي ادّعاء:** "إثبات قانوني"، "immutability تشفيرية"، "exactly-once". اللي بيتوفّر بالفعل: at-least-once + idempotency (exactly-once-effect داخل تاريخ DB واحد)، وtamper-*evidence* لو اتبنى.
> **تقدير التكلفة:** وحدات نسبية (S ≈ أيام قليلة، M ≈ 1–2 أسبوع، L ≈ شهر+) لمهندس واحد مع الاختبارات المعتادة (PG ×3 + mobile). **فرضيات تقدير، مش التزامات.**

---

## ADR-A — الهرم التنظيمي (Organization / Warehouses / Locations / Users)

**السياق:** `companies` هي المؤسسة (GM:C1)؛ `users.email` unique عالمياً و`company_id` على المستخدم (GM:C2) ⇒ عضوية شركة واحدة. لا Owner (GM:C3). المواقع (stores/storage units) محلية في الموبايل فقط (GM:P5).
**البدائل:** A1 الإبقاء على عضوية واحدة + `is_owner` + locations اختيارية. A2 جدول `memberships` الآن (مستخدم × منظمة). A3 منظمات هرمية (أب/ابن).
**القرار المفضّل:** **A1 الآن، بتصميم يسهّل A2.**
- Owner = علم على Admin (+ حماية آخر Owner، نقل ملكية بتأكيد).
- `locations(id, company_id, warehouse_id, parent_id, type, code, name, is_active)` **اختياري** (مخزن بلا مواقع بيشتغل كما هو)؛ شجرة بـ adjacency + `path` نصي.
- **قاعدة تصميم للكود الجديد:** ما يقرأش `users.company_id` إلا عبر طبقة سياق (token/tenant context) — عشان الانتقال لـ memberships يبقى تعديل موضعي.
**دراسة A2 (مش تنفيذ):** تحتاج (1) `memberships(user_id, company_id, role/profile, status)`، (2) إن الـ token يحمل "المنظمة النشطة" وتبديلها يصدر token جديد، (3) دعوة مستخدم موجود، (4) فصل الهوية (email/2FA/جلسات) عن العضوية، (5) فوترة/plans لكل منظمة، (6) `TenantSubscriber`/middleware يقرأوا المنظمة النشطة من الـ token (أصلاً بيقروها من الـ claim — GM:C1)، (7) موبايل: scope key جاهز (`session-scope`) + محوّل منظمات. المخاطر: الإيميل الفريد الحالي، وتجديد الـ refresh، وتسرّب بين المنظمات في الكاش.
**المقايضات:** A1 أرخص وأسرع ولا يمنع A2؛ A2 الآن يعقّد كل خدمة قبل ما يكون في عميل بيطلبه. A3 غير مبرَّر بدليل.
**التكلفة:** A1: S (Owner) + M (locations، **بعد** الأساس). A2: L. **التشغيل:** لا تكلفة جديدة.
**غير محسوم:** Q-01 (متى A2)، Q-03 (Owner/نقل ملكية).

## ADR-B — التفويض (RBAC + scoped grants + context؛ default-deny)

**السياق:** أدوار ثابتة Admin/Manager/Staff (GM:C4)؛ الدور من الـ JWT claim (GM:A4)؛ جداول roles/permissions موجودة وغير مستخدمة فعلياً (GM:C5)؛ Manager = كل المخازن (GM:C6، يتعارض)؛ grants مخازن لـ Staff بس بلا قدرات (GM:C7)؛ لا دورة حياة أعضاء (GM:C12)؛ `costPrice` بيتسلّم للكل (GM:P2؛ قراءة ثابتة).
**البدائل:** B1 إبقاء الـ enum وإضافة أدوار جديدة. **B2 RBAC + profiles بإصدار + `access_grants` بنطاق ومدة + قيود سياقية، التنفيذ في `CapabilityGuard` default-deny.** B3 محرك سياسات خارجي (OPA/Cerbos/OpenFGA). B4 ABAC كامل.
**القرار المفضّل:** **B2.**
1. `permission_profiles` نظامية (`operator` = السلوك الحالي للـ Staff بالظبط)، `access_grants(user, profile, scope, valid_until)`، `members.status`، `token_version`.
2. **shadow mode:** الحارس الجديد يسجّل اختلافه عن `PermissionsGuard` الحالي ولا يغيّر القرار حتى صفر اختلاف.
3. **حقل التكلفة:** allowlist DTO للمنتج (نفس نمط `MovementResponseDto` الموجود) + `item.view_cost`؛ الغياب التام للمفتاح بدل `null`.
4. **الـ revocation:** `token_version` يُبطل الـ access token فوراً؛ lookup خفيف لكل طلب (حالة العضو + الإصدار) أو كاش قصير بـ invalidation — **يتقاس**.
5. **جلسات per-device** (GM:A5/D7): قرار منفصل بعد اختبار جهازين.
6. مصير `roles/permissions` القديمة: **تتجمّد** (لا كتابة جديدة) وتُحذف في migration لاحقة بعد ما profiles تثبت (Q).
**المقايضات:** B2 يضيف جداول ونقطة enforcement واحدة بدل 10 decorators؛ يعطي مرونة بلا تعقيد محرك خارجي. B3 قوي لكن تشغيل وخدمة إضافية (تكلفة/نوم) وتعلّم — **مؤجّل لحد حاجة Enterprise فعلية**. B1 بيتفجّر مع كل طلب تخصيص.
**التكلفة:** S0 (حجب التكلفة) = S. دورة حياة الأعضاء + `token_version` = M. profiles + grants + `/me/capabilities` + shadow = L. **التشغيل:** استعلام إضافي لكل طلب (يُقاس؛ Neon free-tier حساس للـ latency).
**غير محسوم:** Q-02 (معنى Manager)، Q-04 (كتالوج)، Q-05 (أسماء الزملاء)، Q-06.

## ADR-C — النطاق المخزني (تطوير الـ ledger الحالي)

**السياق:** ledger single-entry مع رصيد جاري و`product_warehouse.base_quantity` وrevision لكل مخزن وunique `(warehouse, revision)` (GM:L1/L8)؛ الحركات بالـ base بدون UOM (GM:P3)؛ `reserved_quantity` بدون كاتب (GM:P6)؛ لا in-transit/quarantine (GM:P7)؛ لا قيد DB على immutability (GM:L2). **مخطط الأحداث المحلي (UWOS) على الموبايل** يقول صراحةً إنه "لم يُبنَ" على السيرفر (`docs/event-schema.md`) وبيقلب الـ invariant (الأحداث هي الحقيقة).
**البدائل:** C1 تطوير تدريجي للـ ledger الحالي. C2 event-sourcing/double-entry كامل على السيرفر. C3 هجين (ledger + `domain_events` للـ audit/feed فقط).
**القرار المفضّل:** **C1 + `domain_events` (C3).** مفيش إعادة كتابة.
- **UOM على الحركة** (`uom_id`, `uom_quantity`) مع التحويل على السيرفر؛ الـ base يفضل المرجع.
- **Positions:** `stock_positions(product, warehouse, location?, lot?, status ∈ available|quarantine|damaged, qty)` تُحدَّث **في نفس الـ transaction** وتُطابَق باختبار property: مجموع positions = `base_quantity`. بدون مواقع = position واحد ضمني (مخازن اليوم).
- **Reservations:** استخدام `reserved_quantity` الموجود؛ **تعديل فحص الصرف إلى `base − reserved`** (الحالي `base + change ≥ 0`).
- **In-transit:** من جدول `transfers` (مش مخزن وهمي)، invariant الحفظ.
- **Quarantine/تالف:** حالة على position، مش مخزن (عشان ما يلوّثش المنح والفلترة).
- **قيود DB مقترحة:** بحث `CHECK` في كل الـ migrations (`src/migrations`) **ما لقاش أي قيد على الأرصدة** (القيود الموجودة: دور الدعوة، plan، حالة الاشتراك فقط) ⇒ عدم السالبية **مفروضة بالتطبيق** (`applyMovementInTransaction` بيرمي `Insufficient stock`) مش بالقاعدة. المقترح: `CHECK (base_quantity >= 0)` و`reserved_quantity <= base_quantity` (migration تتأكد قبلها بفحص بيانات الإنتاج — NOT RUN)، منع UPDATE/DELETE على `stock_movements` بـ trigger، `unique(request_id)`.
**لماذا مش C2:** عكس invariant يلمس كل التدفقات المختبَرة (Series 03–07)، والـ ledger الحالي بيحقق الثوابت المطلوبة (ترتيب، idempotency، مصالحة). **المحاسبة المالية خارج النطاق** (حقول تقييم + تكامل لاحقاً).
**التكلفة:** UOM M · positions/locations L · reservation+فحص available M · trigger/CHECK S (مع اختبار شامل لا يوجد تحديث مشروع) · **التشغيل:** حجم الجداول (positions/events) غير مقاس — **UNVERIFIED**.
**غير محسوم:** Q-07 (وضع الترحيل)، أصناف lot/serial (حسب ICP).

## ADR-D — محرك الموافقات

**السياق:** لا شيء على السيرفر (GM: NOT_PRESENT). حقول `approvedBy/status` موجودة في الـ schema المحلي فقط. `reserved_quantity` أساس حجز.
**البدائل:** D1 flags لكل ميزة. **D2 `operation_requests` + `approval_decisions` + `policies` بإصدار + حجز.** D3 محرك workflow خارجي.
**القرار المفضّل:** **D2** كما في `STOCKMIND_MOVEMENT_GOVERNANCE_SPEC.md` §3: حالات صريحة، المبادر ≠ المعتمد، سياسة مربوطة بإصدار، حجز للصرف، ترحيل ذرّي بـ `request_id` unique، **الموافقة online فقط**، والسيرفر هو اللي يحوّل straight-through لـ pending لو السياسة اتغيّرت.
**الافتراضي:** "كما هو اليوم" (لا موافقات) — ما يتفعّلش إلا بسياسة صريحة.
**المقايضات:** تعقيد حالات وإشعارات ↔ ضمان عدم الترحيل بدون تصريح. D3 غير مبرّر لحجم الحالة.
**التكلفة:** L (جداول + endpoints + حجز + موبايل inbox + اختبارات تزامن). **التشغيل:** إشعارات (FCM مجاني)، لا خدمة جديدة.
**يعتمد على:** ADR-B (هوية الأعضاء وقدرة `approval.decide`)، ADR-G (domain_events).

## ADR-E — Activity feed والإشعارات

**السياق:** `GET /stock/changes/:warehouseId` (cursor، revision، `userId`) هو feed مرتّب لكل مخزن (GM:L8)؛ لا feed إداري (GM:U5)؛ FCM بيروح لأجهزة المنفّذ نفسه بـ `productId`+كمية (GM:U6)؛ الخدمة المجانية على Render بتنام (~42 ث cold start مقاس — الـ master §A).
**البدائل:** E1 دمج feeds المخازن المصرّح بها على العميل. E2 `domain_events` + endpoint `/feed` على السيرفر. E3 SSE/WebSocket. E4 push فقط.
**القرار المفضّل:** **مرحلتين.** (1) **E1 + FCM كإشارة** (بدون بنية جديدة). (2) E2: `domain_events` (ADR-G) + `GET /feed` بـ keyset على `(occurred_at, id)` مدموج على السيرفر **بدون sequence عالمي** (تفادي قفل شركة كاملة)؛ أحداث الموافقات بترتيب خاصها (حجمها صغير).
**E3 مؤجّل** لحد وجود instance دائم (عتبة الترقية الموثّقة في الـ master §A).
**دلالات:** الإشعار ≠ الحقيقة؛ الـ feed = حركات **مؤكدة** فقط؛ لا ادّعاء رؤية لحظية لأجهزة غير متصلة؛ payload الإشعار بلا تكلفة/أسماء/كميات.
**التكلفة:** E1 S–M · E2 M · FCM مجاني · E3 تكلفة تشغيل instance دائم (**غير مقدّرة**).

## ADR-F — عهدة التحويل (Transfer custody)

**السياق:** تحويل فوري ذرّي (GM:L3)؛ لا in-transit؛ تفويض الطرفين صحيح (GM:C8).
**البدائل:** F1 إبقاء الفوري فقط. **F2 جدول `transfers` متعدد الخطوات (request → dispatch → in-transit → receive/discrepancy) كوضع اختياري بسياسة.** F3 "مخزن in-transit" وهمي.
**القرار المفضّل:** **F2** (الفوري يفضل افتراضياً). حالات وinvariants في الـ governance spec §4: attestations مزدوجة بمستخدمين مختلفين، `unique(line, step)` تحت قفل، **مفيش LWW ولا وقت جهاز**، الفرق = قضية مفتوحة بلا تعديل تلقائي، و property الحفظ.
**لماذا مش F3:** بيلوّث قائمة المخازن والمنح والفلترة ويعمل أرصدة "وهمية" في الـ sync.
**التكلفة:** L. **غير محسوم:** مهلة استلام وتصعيدها (سياسة)، هل الناقل خارجي هوية؟ (مؤجّل).

## ADR-G — التدقيق والثقة الإثباتية

**السياق:** `audit_logs` request-level، best-effort، خارج transaction الحركة، بدون append-only/hash chain (GM:U1/U2)؛ لا endpoint قراءة (GM:U3)؛ append-only فعلي الوحيد: `history_generation_events`؛ hash chain الوحيد محلي على الجهاز (`event-hash.ts`).
**البدائل:** G1 كما هو. **G2 `domain_events` في نفس الـ transaction + trigger منع UPDATE/DELETE + (اختياري) دور DB للتطبيق بلا صلاحية UPDATE/DELETE.** G3 + hash chain لكل شركة. G4 + تثبيت خارجي دوري (digest موقّع في تخزين بـ object-lock أو خدمة timestamp). G5 WORM كامل.
**القرار المفضّل:** **G2 الآن**؛ G3 عند طلب عميل مؤسسي؛ G4 اختياري بقرار مكتوب؛ G5 غير مبرَّر.
**حدود صريحة (لازم تتكتب لأي عميل):**
- **tamper-evidence مش tamper-proof:** مشغّل بصلاحيات DB (أو مزوّد القاعدة، Neon) يقدر يعيد كتابة الصفوف **والسلسلة** إلا لو في تثبيت خارجي مستقل.
- **restore بيكسر استمرارية السلسلة:** تُقسَّم السلسلة per **history generation**؛ حدث الـ rotation (موجود) هو نقطة الربط الموثّقة.
- **مفيش ادّعاء "حجّة قانونية"**: قبول الأدلة يختلف بالولاية؛ يحتاج مراجعة قانونية قبل أي ادّعاء تسويقي.
- **الخصوصية:** الأحداث تحمل `actor_user_id` (مش أسماء)، جدول ربط قابل للإخفاء عند طلب المحو؛ المرفقات بدورة حياة منفصلة؛ جداول احتفاظ (Q-13) تحترم الـ 7 أيام للإيصالات على الجهاز وفترة الـ restore.
**التكلفة:** G2 M · G3 M · G4 M + تشغيل التخزين (غير مقدّر). **غير محسوم:** Q-09.

## ADR-H — معمارية معلومات الموبايل

**السياق:** 5 تبويبات ثابتة لكل الأدوار؛ الدور ظاهر في Settings فقط (GM:M1)؛ ما فيش شاشات team/approvals/transfers (ملحق A).
**البدائل:** H1 تطبيق واحد متكيّف مع القدرات. H2 تطبيقان (Manager/Employee). H3 لوحة ويب للمالك.
**القرار المفضّل:** **H1** (تنقل من `GET /me/capabilities`، عنصر بلا قدرة = غير موجود، شاشة Today للموظف). H3 **فرضية للتحقق بمقابلات** (مش كود). التفاصيل: `STOCKMIND_ENTERPRISE_UX_BLUEPRINT.md`.
**التكلفة:** M لهيكل التنقل + L لباقي الشاشات تدريجياً. **المخاطر:** مصفوفة اختبار بحسب persona (Jest لا يغطي UI — الدرس من Series 07: bug i18n اتكشف على الجهاز فقط؛ مطلوب component tests أو اختبار جهاز لكل شاشة جديدة).

## ADR-I — الهجرة والإطلاق التدريجي

**المبادئ:** additive فقط؛ `down()` fail-closed (النمط الموجود)؛ **default = السلوك الحالي**؛ كل ميزة خلف flag/سياسة؛ shadow mode قبل أي تغيير قرار تفويض؛ لا تغيير بيانات في الخطوة الأولى (grants الحالية تُقرأ كـ profile `operator`).
**التوافق مع العملاء:** هيدر `X-App-Version` + `min_supported_version` من السيرفر (جديد، إضافة) — عميل أقدم من الحد يتلقى رسالة تحديث بدل سلوك غير آمن؛ الـ API القديم يفضل شغّال (إضافات nullable). **عميل قديم مع سياسة موافقات مفعّلة:** السيرفر يحوّل الكتابة لـ pending (الاتجاه الآمن) ويرد برمز يفهمه العميل القديم كـ "قيد المراجعة" (**يلزم اختبار توافق**).
**العملاء الحاليين:** Free/Pro/Business — plans كما هي (`PLANS`)؛ لا قيد جديد بدون `ENTITLEMENTS_ENFORCED`.
**التكلفة:** مضمّنة في كل شريحة (S لكل flag). **غير محسوم:** Q-17.

## ADR-J — الاعتمادية وسلامة الإصدار

**السياق (من Series 06–07):** R12 TLS؛ rotation يدوي بلا step-up ولا بروفة؛ restore reversal عبر تواريخ (L1)؛ عملاء قدام (L4)؛ فحص Neon المسبق ما اتنفّذش؛ release line؛ جهازين/عربي/Google/Redis/iOS.
**القرار:** **تُقفل بمرحلة تشغيلية مستقلة (Milestone R)** بتفويضات صريحة (بيئة غير إنتاجية)، **مش** تتخلط مع تطوير الميزات؛ السجل الكامل في الـ roadmap §6.
**مبادئ:** step-up (2FA حديث) لأي rotation/override/نقل ملكية؛ minimum supported version قبل أي ميزة تغيّر دلالات الكتابة؛ لا Production قبل بروفة restore + قياس.
**التكلفة:** R = M (قرارات/تفويضات أكتر من كود).

---

## قرارات الـ Director المعلّقة (مع الافتراضي الموصى به)

| # | القرار | الافتراضي الموصى به | يعطّل مين |
|---|---|---|---|
| Q-01 | عضوية متعددة المنظمات: متى؟ | **لاحقاً** (بعد عميل يطلبها) | ADR-A2 |
| Q-02 | معنى `Manager`: يفضل "شركة كلها" + نضيف `warehouse_manager` بنطاق؟ | **نعم** (توافق) | RBAC S2 |
| Q-03 | Owner: علم + نقل ملكية بتأكيد/2FA | نعم | S1 |
| Q-04 | رؤية الكتالوج: مشترك على مستوى الشركة أم مقيّد بنطاق SKU | **مشترك** (بيانات ماستر غير حساسة) + إخفاء التكلفة | NT-10 |
| Q-05 | هل الموظف يشوف أسماء زملائه في حركات مخزنه | **نعم** داخل نطاقه (مساءلة) | privacy |
| Q-06 | `access_mode = all_current_and_future` | **لاحقاً/اختياري** | CP-4 |
| Q-07 | وضع الترحيل الافتراضي للصرف | `post_on_execution` | approvals |
| Q-08 | تأثيرات الاحتفال (Confetti) في بيئة العمل | تُراجَع/تُخفَّف | UX |
| Q-09 | تثبيت خارجي للـ audit (G4) | **لا الآن** | ADR-G |
| Q-10 | step-up للـ rotation/override | **نعم** | Milestone R |
| Q-11 | الـ ICP الأولي | FMCG موزّع صغير/متوسط بمخزنين–خمسة (§Bible) | commercial |
| Q-12 | تعبئة الـ tiers (قدرات لكل plan) | مقترح في الـ Bible، بدون أسعار | commercial |
| Q-13 | جداول الاحتفاظ (audit/idempotency/evidence) | تُحدَّد مع S5 | G |
| Q-14 | الإقامة الجغرافية للبيانات | افتراضي إقليمي واحد، تقييم لاحقاً | enterprise |
| Q-15 | سياسة الموافقات الافتراضية | "لا موافقات" | approvals |
| Q-16 | مزوّد تخزين المرفقات | تأجيل لحد S6 | evidence |
| Q-17 | سياسة min supported version | هيدر + حد أدنى مع رسالة تحديث | ADR-I |
| Q-18 | الـ release line (Series 06 §8) | الخيار A (ملاحظة: **بدون تنفيذ**) | Production |

---

## حالة القرارات بعد أمر Series 09 (2026-10-25)

الـ Director اعتمد Q-01..Q-18 كاتجاه ملزم في أمر Series 09 (التنفيذ لـ S0 + S1 فقط). الترقيم أدناه هو ترقيم الجدول أعلاه، وما اتنفّذ منها فعلاً:

| القرار | ما اتعتمد | الحالة في Series 09 |
|---|---|---|
| Q-01 multi-org | مؤجَّل | لم يُنفَّذ |
| Q-02 معنى Manager | يفضل "شركة كلها"؛ لا تغيير صامت | **مُطبَّق:** لا تغيير في نطاق المخازن؛ ترقية Staff→Manager/Admin تتطلب تأكيداً صريحاً "يشوف كل المخازن" |
| Q-03 Owner | `is_owner` منفصل عن الدور، آخر Owner نشط محمي، **نقل الملكية مؤجَّل**، الملكية القديمة من دليل موثوق وإلا fail closed | **مُطبَّق:** backfill عند Admin واحد فقط؛ trigger في DB؛ المالك لا يغيّر دوره؛ شركة بلا owner = لا إجراءات على Admins (إجراء مشغّل للعلاج) |
| Q-04 الكتالوج | مشترك؛ لا re-scoping الآن | لم يُنفَّذ (+ التكلفة اتخفت: S0) |
| Q-05 أسماء الزملاء | ظاهرة داخل المخزن المصرّح | لم يُنفَّذ |
| Q-06 `access_mode` | لا منح تلقائي لـ Staff (CP-4 في S2) | **مُطبَّق بالاتجاه:** التخفيض لـ Staff أو الإزالة بيمسحوا المنح؛ الإرجاع بيبدأ بلا مخازن |
| Q-07 / Q-15 الموافقات | الكتابة المباشرة، "لا موافقات" | لم يتغيّر |
| Q-08 UX | تجربة هادئة | **مُطبَّق** في الصياغة والواجهة |
| Q-09 تثبيت audit خارجي | لا ادّعاء tamper-proof | **مُطبَّق:** `membership_events` append-only بـ trigger على UPDATE فقط، ومكتوب صراحةً |
| Q-10 step-up | معيار لتدفقات مستقبلية، غير منفّذ | لم يُنفَّذ (الإجراءات الحرجة هنا بتأكيد في الطلب نفسه فقط) |
| Q-11 / Q-12 ICP والـ tiers | Free/Pro/Business/Enterprise كما هي | لم يتغيّر (إلا إن seat الـ plan بقى يستثني الأعضاء المحذوفين) |
| Q-13 / Q-14 / Q-16 | لا retention مدمّر، لا ادّعاء residency، لا تغيير تخزين الأدلة | لم يُنفَّذ |
| Q-17 min client version | مستقبلي؛ لا كسر صامت للعملاء | **مُطبَّق:** إضافات فقط، والتوكنز القديمة بلا `tv` تفضل شغّالة |
| Q-18 release line | الخيار A غير مفوَّض للتنفيذ | لم يُنفَّذ |

**قرارات صغيرة اتخذت أثناء التنفيذ (للمراجعة):** `item.view_cost` Admin فقط افتراضياً (Manager لا تلقائياً، حسب RBAC spec)؛ كتابة التكلفة عند الإنشاء متاحة للـ Manager؛ إزالة العضو تحتفظ بالصف (history منسوب) وتحرر الـ seat؛ إعادة تفعيل المحذوف مسموحة (بيرجع بلا منح)؛ الإيميل المحذوف لا يُدعى من جديد (الإرجاع = reactivate).

---

## حالة ADR-B / H / I بعد Series 10

- **ADR-B (B2):** مُنفَّذ بالشكل المفضّل: profiles بإصدار + `access_grants` بنطاق ومدة + محرك مركزي default-deny + **shadow mode** (`CAPABILITY_MODE`). `roles/permissions` القديمة **مجمّدة وشغّالة** (لا كتابة جديدة من التطبيق؛ تُستخدم للتفويض المالي الصريح) — قرار حذفها لسه مفتوح. المقايضة اللي ظهرت: استعلامين إضافيين لكل طلب (أُقيسا: انظر contract §13 / `s2-perf.json`).
- **ADR-H (H1):** تطبيق واحد متكيّف مع القدرات: مُنفَّذ للتنقل والأزرار الرئيسية وشاشة صلاحيات المخازن؛ شاشة "Today" للموظف ولوحة المدير **لم تُنفَّذ**. تحذير ADR-H (Jest لا يغطي UI) لسه قائم: اتضاف **عقد UI** (اختبار يقرأ مصدر الشاشات) لكن مفيش component tests ولا اختبار جهاز.
- **ADR-I:** الهجرة additive + `down()` fail-closed + **default = السلوك الحالي** + shadow قبل أي تغيير قرار: مُحترم. `min_supported_version` لسه مستقبلي (Q-17).
- **قرارات Director بعد Series 09 (سياسة، غير منفَّذة):** R-18 تنظيف audit (محجوب على Production)، R-19 ملكية legacy بدليل ومشغّل، R-20 رفض مالي افتراضي للـ Manager. تفاصيل ومراجع في العقد §12.
