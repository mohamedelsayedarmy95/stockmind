# STOCKMIND — ORGANIZATION, ROLES & PERMISSIONS SPEC (RBAC + scoped grants + context)

> **الحالة:** تصميم مقترح (Series 08). **مفيش حاجة هنا منفّذة.** كل بند ليه عمود "الوضع الحالي" بيشاور على `STOCKMIND_CODE_TO_CAPABILITY_GAP_MATRIX.md` (يُرمز له بـ **GM:<id>**).
> القرارات المعمارية والبدائل: `STOCKMIND_ARCHITECTURE_DECISIONS.md` (ADR A, B). التدفقات والحالات: `STOCKMIND_MOVEMENT_GOVERNANCE_SPEC.md`.
> **قاعدة حاكمة:** كل عنصر UI مرتبط بعملية مدعومة ومصرّح بها ومختبَرة. مفيش صلاحية بتتعرض وهي مش ممكنة، ومفيش صلاحية بتتفرض بالـ UI بس.

---

## 1. المبادئ

1. **Default-deny:** أي مورد/عملية غير مذكورة صراحةً في الـ grants = مرفوضة. الرفض لمورد غير مصرّح = **404 مطابق لمورد غير موجود** (النمط المعتمد حالياً في `assertCanUse`).
2. **السيرفر هو المرجع:** الـ UI وكاش الأوفلاين نصائح. التفويض بيتحسب من قاعدة البيانات داخل الطلب (والأفضل داخل الـ transaction للعمليات الحرجة، زي ما حصل في S1 Series 07).
3. **السلطة = هوية أساسية + grants بنطاق + قيود سياقية.** مش دور واحد ضخم.
4. **أقل صلاحية:** الدعوة والمنح بيبدأوا بأقل مجموعة؛ مفيش تصعيد ذاتي: **ما تقدرش تمنح قدرة أكبر مما تملكه** (ولا بنطاق أوسع).
5. **المالية منفصلة عن التشغيل:** رؤية التكلفة/التقييم قدرة مستقلة، مش تلقائية لأي دور تشغيلي (حتى Manager).
6. **كل تغيير في الصلاحيات حدث مُراجَع:** من منح، لمن، بأي نطاق، متى، بأي إصدار سياسة.

## 2. الهرم التشغيلي (الحالي مقابل المستهدف)

| المستوى | الحالي | المستهدف | ملاحظات |
|---|---|---|---|
| Organization | `companies` (GM:C1) | نفسه + `is_owner` على عضو + (لاحقاً) `memberships` | عضوية متعددة: **مدروسة، مش مُنفَّذة** (ADR A) |
| Warehouse | `warehouses` + `warehouse_access` للـ Staff (GM:C7) | نفسه + grants بقدرات ونطاق (§4) | Manager حالياً = كل المخازن (GM:C6 يتعارض مع المطلوب) |
| Zone / Bin / Location | محلي في الموبايل بس (GM:P5) | جدول `locations` اختياري (شجرة) | **اختياري**: مخزن بدون locations بيشتغل كما هو. موقع ≠ صلاحية افتراضياً؛ grant على location حالة لاحقة (§4.3) |
| Item (SKU) | `products` على مستوى الشركة (GM:P1) | نفسه؛ **رؤية الكتالوج** قرار منتج (Q-04) | الرؤية الافتراضية الحالية: كل SKU للشركة لكل عضو |
| UOM / Packaging | `units_of_measure` (GM:P3) | + UOM على الحركة | الكمية المرجعية دايماً base |
| Lot / Serial | محلي (GM:P4) | لاحقاً، لأصناف يحدّدها العميل | |
| Stock position / Movement / Task | `product_warehouse`، `stock_movements` (GM:L1) | + positions بالموقع/اللوت، + tasks | |

**هوية الموظف:** كل موظف حساب خاص به (email فريد) — موجود فعلياً عبر الدعوات (GM:C10). **ممنوع** مشاركة حساب المالك. جلسة refresh واحدة لكل مستخدم (GM:A5) — موظف واحد بجهازين محتاج تحقق (UNVERIFIED).

## 3. الأدوار والهويات (3.3 في التفويض) — تصنيف بدل تضخيم الـ schema

| المفهوم المطلوب | الكيان المقترح | يتحوّل لـ schema الآن؟ | ملاحظة |
|---|---|---|---|
| Organization Owner | **علم `is_owner`** على Admin (لا دور جديد) | نعم (صغير، S1) | حماية "آخر Owner"، نقل ملكية بتأكيد |
| Organization Admin | الدور الحالي `Admin` | موجود | |
| Warehouse Manager / Moderator | **profile `warehouse_manager`** على grant بنطاق مخازن | نعم (S1–S2) | الـ `Manager` الحالي يفضل "مدير على مستوى الشركة" للتوافق |
| Shift Supervisor | profile `supervisor` (operator + تحويلات + موافقات صغرى) | لاحقاً (S3+) | |
| Warehouse Member / Operator | الدور `Staff` + profile `operator` (= السلوك الحالي بالظبط) | موجود (profile صريح في S1) | |
| Auditor | profile `auditor` (قراءة حركات وتدقيق، بدون تكلفة افتراضياً) | لاحقاً (S5) | |
| Accountant / Finance Viewer | profile `finance_viewer` (`item.view_cost`, `finance.view_valuation`) | لاحقاً (S0 يضع `item.view_cost` فقط) | |
| Risk / Approval Officer | قدرة `approval.decide` **بحدود** (نوع/كمية/قيمة) | مع الـ approval engine (S3) | مش دور شامل |
| Transfer Custodian | **ليس دوراً**: *actor خاص بعملية* على transfer (المرسِل/الناقل/المستلم) | مع transfers (S4) | الهوية المخوّلة تتحدد بالـ grants على المصدر/الوجهة + تعيين على العملية |
| Scoped API Service Identity | نوع principal منفصل (`service_accounts`) بمفاتيح، لا دخول تفاعلي | **لا** الآن (Enterprise لاحقاً) | |

**التمييز المطلوب:** *fixed system roles* (Admin/Manager/Staff، موجودة) ≠ *permission profiles* (حزم قدرات نظامية بإصدار) ≠ *scoped grants* (ربط مستخدم + profile + نطاق + مدة) ≠ *temporary delegation* (grant بـ `valid_until` وبمنح من حامل القدرة، مع حد أقصى المدة) ≠ *operation-specific actors* (مرتبطين بعملية).

### 3.1 جداول مقترحة (مبدئية — ADR B)

- `permission_profiles(id, key, version, capabilities[], is_system, company_id NULL للنظامية)`
- `access_grants(id, company_id, user_id, profile_id/profile_version, scope_type ∈ {organization, warehouse, location}, scope_id, valid_from, valid_until, granted_by, revoked_at, revoked_by, reason)`
- `members.status ∈ {invited, active, suspended, removed}`، `members.token_version`
- **التوافق:** `warehouse_access` الحالي يتحوّل **منطقياً** لـ grant `operator` على المخزن (لا حذف ولا تغيير بيانات في الخطوة الأولى؛ view/dual-read).

## 4. حدود الخصوصية (Owner / Manager / Staff)

| العنصر | Owner/Admin | Manager (شركة) | Warehouse Manager (scoped) | Operator/Staff | Finance viewer | Auditor |
|---|---|---|---|---|---|---|
| المخازن | كل المخازن | كل المخازن (حالياً) | المخازن المُسنَدة فقط | المخازن المُسنَدة فقط | حسب النطاق | حسب النطاق |
| اكتشاف وجود مخزن/SKU/حركة غير مُسنَدة | — | — | **ممنوع** (404) | **ممنوع** (404) | ممنوع | ممنوع |
| الكميات المؤكدة | ✔ | ✔ | ✔ في نطاقه | ✔ في نطاقه | ✔ للقراءة | ✔ للقراءة |
| تاريخ الحركات + **اسم المنفّذ** | ✔ | ✔ | ✔ | ✔ في نطاقه (أسماء الزملاء مقبولة؟ Q-05) | ✔ | ✔ |
| تكلفة الشراء / التقييم | ✔ (`view_cost`) | **ليس تلقائياً** | **ليس تلقائياً** | ✘ | ✔ | ✘ افتراضياً |
| سجل التدقيق | ✔ | ✔ نطاقه | ✔ نطاقه | ✘ (نشاطه فقط "عملياتي") | ✘ | ✔ |
| إدارة الفريق/المنح | ✔ | ✘ (حالياً) | ضمن نطاقه وبحدود قدراته | ✘ | ✘ | ✘ |
| السياسات | ✔ | قراءة | قراءة نطاقه | ✘ | ✘ | قراءة |

> **الوضع الحالي ضد هذا الجدول:** (أ) Manager بيشوف كل المخازن؛ (ب) التكلفة تتسلّم لكل حامل `VIEW_PRODUCT` بالقراءة الثابتة (GM:P2، D1)؛ (ج) الكتالوج للكل (GM:P1)؛ (د) مفيش قراءة للـ audit (GM:U3).

## 5. مواصفة الصلاحيات

**قواعد مشتركة** (تُطبَّق على كل صف فيه "عام"):
- **التنفيذ على السيرفر** بـ `CapabilityGuard` (`@RequireCapability('stock.issue', { warehouse: 'body.warehouseId' })`) فوق الحرّاس الحاليين، مع إعادة فحص داخل الـ transaction للعمليات التي تكتب الـ ledger (نمط `assertAccess` في `StockReplacementService`).
- **Offline عام:** الجهاز بيحتفظ بنسخة من القدرات (`GET /me/capabilities`: profile + نطاقات + `policy_version` + `expires_at`) للـ UI فقط. العمليات المسموح تتحط في الـ outbox؛ **السيرفر بيعيد التفويض عند الاستلام**؛ الرفض (403/404) ← `NEEDS_REVIEW`/`no-access` (موجود، GM:L11)؛ لا تنفيذ بالتخمين.
- **Revocation عام:** يسري على **أول طلب جديد** بعد الـ commit (grants بتتقرأ من DB). للـ role claim القديم (GM:A4): `token_version` يُبطل الـ access token فوراً عند تعليق/إزالة/تغيير دور. على الجهاز: كاش المخزن يتمسح عند `denied` (موجود)، ويتمسح كاش الـ capabilities، وعناصر الـ outbox المتأثرة تتحوّل لمراجعة.
- **Audit عام:** كل رفض تفويض على عملية حساسة + كل تغيير منح/دور/سياسة بيتسجل (من/ماذا/نطاق/نتيجة/correlation id). الرفض بدون كشف سبب مفصّل للعميل.

| ID | المورد · الإجراء | الحاملون الافتراضيون | النطاق والقيود السياقية | نقطة التنفيذ (سيرفر) | UI / Offline خاص | Audit خاص | اختبارات سلبية |
|---|---|---|---|---|---|---|---|
| `org.view` | Organization · عرض | كل الأعضاء | شركته | JWT + company | — | — | NT-01 |
| `org.manage` | Organization · تعديل الاسم/العملة/tax_id | Owner/Admin | شركته | مستجد (لا endpoint حالياً) | — | ✔ | NT-02 |
| `org.owner_transfer` | نقل الملكية | Owner | تأكيد مزدوج + 2FA حديث | مستجد | online فقط | ✔✔ | NT-03 |
| `warehouse.view` | Warehouse · عرض | حسب grant | مخازن النطاق فقط | `WarehouseService.findAll(viewerId)` ✔ موجود | قائمة تتفلتر | — | NT-04, NT-05 |
| `warehouse.create` | إنشاء مخزن | Owner/Admin، Manager (CREATE_WAREHOUSE حالياً) | حدود plan (`assertCanAddWarehouse`) + **سياسة CP-4** (§8) | `PermissionsGuard` ✔ | wizard "من ياخد الصلاحية؟" | ✔ | NT-06 |
| `warehouse.update` | تعديل | Owner/Admin/Manager | نطاقه | ✔ موجود (على مستوى الشركة) | — | ✔ | NT-07 |
| `warehouse.archive` | إيقاف/حذف | Owner/Admin | لا رصيد/عمليات معلّقة | `DELETE_WAREHOUSE` ✔ (Admin) | تأكيد | ✔✔ | NT-08 |
| `location.view` / `location.manage` | مواقع داخل المخزن | warehouse_manager+ | مخزنه | مستجد | اختياري | ✔ | NT-09 |
| `item.view` | الكتالوج | كل من له grant | **قرار Q-04** (كتالوج مشترك أم scoped بالـ SKU) | `VIEW_PRODUCT` ✔ (شركة كلها) | — | — | NT-10 |
| `item.create/update/archive` | تعديل الكتالوج | Manager/Admin | الشركة | `CREATE/UPDATE/DELETE_PRODUCT` ✔ | — | ✔ | NT-11 |
| `item.view_cost` | رؤية سعر التكلفة | Owner/Admin، finance_viewer، grant صريح | **حقل مُصفّى في DTO**؛ يغيب تماماً (مش `null`) بدون القدرة | مستجد (S0): DTO حاجب | — | ✔ (قراءة) | **NT-12** |
| `item.set_cost` | تعديل التكلفة | Owner/Admin، finance | تاريخ تغييرات | مستجد | online | ✔✔ | NT-13 |
| `stock.view_balance` | الأرصدة | حسب grant | مخازن النطاق | `@WarehouseScoped` ✔ | — | — | NT-14 |
| `stock.view_movements` | تاريخ الحركات | حسب grant | النطاق؛ خيار "حركاتي فقط" للـ operator | `@WarehouseScoped` ✔ (scoped list موجود) | — | — | NT-15 |
| `stock.receive` | استلام | operator+ | مخزن grant؛ حدود كمية/سياسة | `STOCK_INBOUND` ✔ | outbox ✔ | حركة + مصدر | NT-16 |
| `stock.issue` | صرف | operator+ | مخزن grant؛ **سياسة موافقة** (S3) | `STOCK_OUTBOUND` ✔ | outbox ✔ | ✔ | NT-17 |
| `stock.relocate` | نقل داخلي | operator+ | مخزن + مواقع | مستجد | outbox (لاحقاً) | ✔ | NT-18 |
| `transfer.initiate` | طلب تحويل | supervisor+ | **المصدر** | مستجد (الفوري الحالي = `STOCK_TRANSFER` Manager/Admin ✔) | online/outbox | ✔ | NT-19 |
| `transfer.dispatch` | تسليم من المصدر | custodian/operator على المصدر | المصدر | مستجد | outbox (خطوة idempotent) | ✔ شاهد | NT-20 |
| `transfer.receive` | استلام في الوجهة | operator على **الوجهة** | الوجهة | مستجد | outbox | ✔ شاهد | NT-21 |
| `transfer.resolve_discrepancy` | حسم فرق | manager على الطرفين أو org | الطرفان | مستجد | online فقط | ✔✔ | NT-22 |
| `stocktake.create/count/review/post` | جرد | create: manager؛ count: operator؛ review/post: manager + فصل | مخزن/موقع | مستجد | count في outbox؛ post online | ✔ | NT-23 |
| `adjustment.request` | طلب تسوية | operator/supervisor | سبب إلزامي | مستجد (الحالي: `STOCK_ADJUSTMENT` مباشر Manager/Admin ✔) | outbox كـ request | ✔ | NT-24 |
| `adjustment.post` | تسوية مباشرة | manager (حدود) | حدود كمية/قيمة؛ **فصل عن الطالب** فوقها | `STOCK_ADJUSTMENT` ✔ | online | ✔✔ | NT-25 |
| `approval.decide` | قرار موافقة | approver/manager | **ليس المبادر**؛ نطاق + حدود؛ إصدار السياسة | مستجد | **online فقط** | ✔✔ | NT-26, NT-27 |
| `approval.override` | تجاوز طارئ | owner/admin (+ 2FA حديث) | سبب نصي + نطاق زمني | مستجد | online فقط | ✔✔✔ + إشعار | NT-28 |
| `approval.delegate` | تفويض مؤقت | حامل القدرة | مدة قصوى؛ لا تصعيد | مستجد | online | ✔ | NT-29 |
| `finance.view_valuation` | تقييم المخزون | owner/admin، finance | نطاق مالي | مستجد | — | ✔ (قراءة) | NT-30 |
| `audit.view` | قراءة التدقيق | owner/admin، auditor، manager (نطاقه) | نطاق؛ لا يشمل أسرار | مستجد (`VIEW_AUDIT_LOG` بلا endpoint) | — | ✔ (قراءة التدقيق نفسها) | NT-31 |
| `team.view` | قائمة الأعضاء | owner/admin، manager (نطاقه) | الأسماء/الأدوار فقط، لا emails لغير المخوّل | `MANAGE_USERS` حالياً | — | — | NT-32 |
| `team.invite` | دعوة | owner/admin، warehouse_manager (≤ قدراته) | حدود plan (seats) | `createInvitation` ✔ (Admin) | — | ✔ | NT-33 |
| `team.assign_scope` | منح مخازن/قدرات | owner/admin، warehouse_manager (≤ نطاقه وقدراته) | **ممنوع التصعيد** | `setWarehouseAccess` ✔ (Staff فقط) | — | ✔ | **NT-34** |
| `team.change_role` / `team.suspend` / `team.remove` | دورة حياة العضو | owner/admin | حماية آخر Owner | **مستجد (غير موجود)** (GM:C12) | online | ✔✔ | NT-35, NT-36 |
| `team.revoke_sessions` | إنهاء جلسات | owner/admin، المستخدم نفسه | — | `terminate-all` ✔ (نفسه فقط) | — | ✔ | NT-37 |
| `policy.view/edit/publish` | سياسات الموافقة | view: manager؛ edit/publish: owner/admin | إصدارات؛ لا تعديل بأثر رجعي | مستجد | online | ✔✔ | NT-38 |
| `recovery.rotate_generation` | history generation | Owner/Admin | flag + سبب + تأكيد (+ 2FA step-up مقترح) | `MANAGE_RECOVERY` ✔ (S07) | online | ✔✔ | موجود في S07 |
| `recovery.replace` | تعويض عملية ضايعة | نفس صلاحية الحركة | مخزن grant؛ نفس كمية الإيصال | `stock-replacement.service` ✔ | شاشة المراجعة | ✔ provenance | موجود في S07 |

## 6. التحويل بين المخازن: تفويض الطرفين

1. **الطلب/الإرسال** يتفوّض على **المصدر**؛ **الاستلام** يتفوّض على **الوجهة**؛ لا أحد يقدر يستلم في وجهة ما عنده فيها `transfer.receive`.
2. مستخدم عنده المصدر فقط يشوف حالة التحويل (مُرسل/استُلم/فرق) واسم الوجهة (لازم لسلسلة العهدة) **لكن لا أرصدة ولا SKUs الوجهة**.
3. الحسم (فرق) محتاج نطاق على الطرفين أو دور على مستوى الشركة.
4. التفويض بيتفحص **داخل الـ transaction** لكل خطوة (تعديل صلاحية بين الخطوات بيمنع الخطوة التالية)، مش مرة واحدة عند البدء.
5. الوضع الحالي: `STOCK_TRANSFER` (Manager/Admin) + `@WarehouseScoped` للطرفين (GM:C8) — **ده الحد الأدنى الصحيح ويُحفَظ** للتحويل الفوري.

## 7. Revocation و stale-data

| الحالة | السلوك المطلوب | الوضع الحالي |
|---|---|---|
| سحب grant مخزن | أول طلب بعده 404؛ الكاش المحلي للمخزن يتمسح؛ عناصر outbox تتحوّل لمراجعة | ✔ (GM:C7, GM:U7, اختبار `operation-lookup`/`recovery-integrity`) |
| تعليق/إزالة عضو | كل الـ tokens تبطل فوراً (`token_version`)، الـ refresh يتلغى، الأجهزة تعمل sign-out عند أول طلب | ✘ NOT_PRESENT (GM:C12, A4) |
| تغيير دور | يسري فوراً (مش بعد 15 دقيقة) | ✘ (claim) |
| انتهاء تفويض مؤقت | `valid_until` بيتقرأ على السيرفر؛ الـ UI بيخفي القدرة عند الانتهاء المحلي لكن السيرفر هو القرار | مستجد |
| إيصالات/بيانات محلية لمستخدم أُزيل | تتمسح عند أول اتصال؛ لا وصول بعد sign-out | جزئي (sign-out بيمسح الكاش) |
| إشعارات | لا تحمل تكلفة أو أسماء؛ payload = "في نشاط" + id معتم | ✘ الحالي بيحمل `productId`/الكمية (GM:U6) |

## 8. إقفال CP-4 (مخزن جديد غير ظاهر للـ Staff) — **تصميم، بدون تنفيذ**

**المشكلة:** `warehouse_access` بيتملّى مرة وقت migration `1792560000000`؛ مخزن جديد مفيش حد من الـ Staff بياخده، ومفيش UI للمنح (GM:C9).
**البدائل:**
- (أ) منح تلقائي لكل Staff عند إنشاء مخزن — **مرفوض**: يوسّع الوصول بصمت ويكسر least-privilege.
- (ب) سؤال صريح عند الإنشاء ("مين ياخد الصلاحية؟") مع الافتراضي = **لا أحد** + شاشة الفريق — **موصى به كقاعدة**.
- (ج) خاصية على العضو `access_mode ∈ {listed, all_current_and_future}` افتراضياً `listed`، والمنح التلقائي بيحتاج فعل صريح من Admin على هذا العضو — **اختياري لاحقاً** لبيئات صغيرة (قرار Q-06).
**الهجرة والتوافق:** لا تغيير بيانات: كل grant حالي = `operator` + `listed`. لا تغيير في سلوك أي عميل قديم (الـ API الحالي `PUT /team/members/:id/warehouses` يفضل). السلوك الجديد يظهر فقط بعد إصدار شاشة الفريق.
**اختبارات سلبية:** NT-39 (Staff بمنح محدد **لا** يشوف مخزن جديد)، NT-40 (إنشاء مخزن بغير Owner/Admin/Manager مرفوض)، NT-41 (منح لا يوسّع قدرات أكتر من حامل المنح).

## 9. استراتيجية الهجرة والتوافق (RBAC)

1. **Shadow mode:** `CapabilityGuard` بيشتغل بجانب `PermissionsGuard` الحالي ويسجّل أي اختلاف (من غير ما يغيّر قرار) على بيانات الاختبارات؛ الهدف **صفر اختلاف** قبل التحويل.
2. `GET /me/capabilities` (إضافة فقط) — الموبايل بيستخدمه لبناء التنقل؛ عميل قديم بيتجاهله.
3. الأدوار الحالية بتتحوّل لـ profiles بالـ migration **بدون** تغيير سلوك (Admin=all، Manager=company-wide warehouse_manager، Staff=operator على grants الحالية).
4. أي قدرة جديدة بتتضاف **مغلقة افتراضياً** (default-deny) حتى لو أضافت وظيفة جديدة.
5. لا حذف لجداول `roles/permissions` القديمة في هذه المرحلة؛ تتقرّر مصيرها في ADR B.

## 10. مصفوفة الاختبارات السلبية (NT) — كل صف اختبار آلي مطلوب قبل تفعيل القدرة

| ID | العبارة المطلوب إثباتها |
|---|---|
| NT-01 | مستخدم شركة A لا يقرأ أي مورد لشركة B (الشركة، المخازن، SKUs، حركات، فريق) — 404 |
| NT-02/03 | Staff/Manager لا يعدّل الشركة ولا ينقل الملكية؛ نقل الملكية بدون 2FA حديث مرفوض |
| NT-04/05 | Staff لا يرى مخزناً غير مُسنَد في القائمة ولا بالـ id؛ الرد = رد "غير موجود" |
| NT-06 | إنشاء مخزن بدون الصلاحية، أو فوق حد الـ plan عند التفعيل، مرفوض |
| NT-07/08 | تعديل/حذف مخزن خارج النطاق أو برصيد ≠ 0 مرفوض |
| NT-09 | location خارج نطاق grant غير مرئي |
| NT-10 | (حسب قرار Q-04) SKU غير مرتبط بنطاق المستخدم غير مرئي أو القرار الصريح بالرؤية المشتركة موثّق ومُختبَر |
| NT-11 | Staff لا ينشئ/يعدّل/يحذف منتجاً |
| **NT-12** | **أي رد منتج (قائمة/تفاصيل/تعبئة) لمستخدم بلا `item.view_cost` لا يحتوي مفتاح `costPrice` إطلاقاً؛ ولا في audit/notification/cache** |
| NT-13 | تعديل التكلفة بدون `item.set_cost` مرفوض ومسجَّل |
| NT-14/15 | رصيد/حركات مخزن غير مُسنَد = 404؛ operator في وضع "حركاتي فقط" لا يرى حركات الغير |
| NT-16/17 | استلام/صرف في مخزن غير مُسنَد = 404 ولا أثر في الـ ledger؛ بعد سحب الـ grant أثناء جلسة مفتوحة الطلب التالي مرفوض |
| NT-18 | relocate خارج نطاق المواقع مرفوض |
| NT-19..22 | تحويل: لا إنشاء بدون المصدر؛ لا استلام بدون الوجهة؛ مستخدم المصدر لا يرى أرصدة الوجهة؛ حسم الفرق بدون الطرفين مرفوض؛ تغيّر الصلاحية بين الخطوات يمنع الخطوة التالية |
| NT-23 | جرد: لا يرحّل (post) نفس من عدّ؛ operator لا يرى الكميات النظرية لو السياسة "جرد أعمى" |
| NT-24/25 | الطالب لا يعتمد تسويته؛ تسوية فوق الحد من غير موافقة مرفوضة |
| NT-26/27 | **المبادر لا يوافق على طلبه (حتى لو عنده القدرة)**؛ موافقة بإصدار سياسة قديم/منتهي/خارج النطاق مرفوضة؛ موافقتان متزامنتان = قرار واحد |
| NT-28 | override بدون سبب/2FA حديث مرفوض؛ كل override يظهر في audit وإشعار للـ Owner |
| NT-29 | تفويض لا يتجاوز قدرات المفوِّض ولا مدته القصوى؛ بعد الانتهاء يُرفض |
| NT-30 | `finance.view_valuation` غير متاح بدونه؛ الأرقام لا تظهر في تقارير/exports |
| NT-31 | قراءة audit بدون الصلاحية أو خارج النطاق مرفوضة؛ لا أسرار في الرد |
| NT-32 | emails الأعضاء لا تظهر لغير المخوّل |
| NT-33 | دعوة تتجاوز seats/plan (عند التفعيل) أو تمنح قدرة أعلى من الداعي مرفوضة |
| **NT-34** | **منح نطاق أو قدرة خارج ما يملكه المانح مرفوض (لا تصعيد)** |
| NT-35/36 | تعليق/إزالة عضو: tokens القديمة ترفض فوراً؛ لا يمكن إزالة آخر Owner؛ outbox المعلّق للمستخدم المزال لا يُنفَّذ |
| NT-37 | terminate-all لا يؤثر على مستخدم آخر |
| NT-38 | تعديل سياسة بأثر رجعي على طلبات قائمة مرفوض (الطلب مربوط بإصدار) |
| NT-39..41 | CP-4 (§8) |
| NT-42 | لا يمكن لمن عنده `stock.issue` فقط الصرف من مخزن ثانٍ عبر replacement/lookup/changes (تجاوز بمسار جانبي) |
| NT-43 | الإشعار/الكاش/الـ outbox لا يحوي تكلفة ولا أسماء غير مخوّلة |
