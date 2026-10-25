# STOCKMIND — MOVEMENT GOVERNANCE SPEC (حركات، موافقات، عهدة، 12 workflow)

> **الحالة:** تصميم مقترح (Series 08). **لا شيء منفّذ.** الجزء الموجود فعلاً في الكود مُعلَّم **[موجود]** مع إحالة لـ `STOCKMIND_CODE_TO_CAPABILITY_GAP_MATRIX.md` (GM:…). الصلاحيات في `STOCKMIND_ORGANIZATION_RBAC_SPEC.md` (RBAC)، والقرارات في `STOCKMIND_ARCHITECTURE_DECISIONS.md` (ADR).
> **القاعدة:** محاسبة الكميات (ledger مخزون) منفصلة عن المحاسبة المالية. التقييم علاقة صريحة (حقل/تكامل) مش دفتر أستاذ داخل StockMind.

---

## 1. خمس مراحل مختلفة لازم متتخلطش

| المرحلة | المعنى | أين تعيش | تأثير على الرصيد |
|---|---|---|---|
| **Proposed** | نية مستخدم (طلب) | `operation_requests` (جديد)؛ على الجهاز كـ intent قبل المزامنة | **صفر** (أو حجز `reserved` للصرف) |
| **Approved** | قرار سلطة مخوّلة، مربوط بإصدار سياسة ومدة صلاحية | نفس السجل + `approval_decisions` | صفر (الحجز قائم) |
| **Executed (physical)** | الفعل الفيزيائي حصل (استلمت/سلّمت) — شهادة المنفّذ | attestation على الطلب | حسب وضع الترحيل (§3.4) |
| **Posted / Confirmed** | حركة في الـ ledger بـ revision | `stock_movements` **[موجود]** | **الوحيد** اللي بيغيّر الرصيد المؤكد |
| **Rejected / Canceled / Expired** | نهاية بدون ترحيل | الطلب | الحجز بيتحرر |

**ما هو موجود اليوم [موجود]:** مرحلة واحدة مدمجة: Proposed→Posted في transaction واحدة (`inbound/outbound/adjustment/transfer`)، مع طابور أوفلاين للاستلام/الصرف (`outbox`). ده **يفضل المسار الافتراضي** (straight-through) ومايتغيّرش.

## 2. مخطط الحركة (movement schema) لكل نوع

**الموجود [موجود]** (GM:L5): `product_id`, `warehouse_id`, `user_id` (المنفّذ المصادَق), `movement_type` ∈ {INBOUND, OUTBOUND, TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT}, `reference_type` ∈ {PURCHASE, SALE, COUNT, TRANSFER}, `reference_id` (uuid)، `quantity_change`، `running_balance`، `notes`، `revision`، `created_at` (وقت السيرفر).

**المستهدف (إضافات nullable، backward compatible):**

| الحقل | استلام | صرف | تحويل | تسوية/جرد | مرتجع | ملاحظة |
|---|---|---|---|---|---|---|
| `product_id`, `quantity` (base) | إلزامي | إلزامي | إلزامي | إلزامي (signed) | إلزامي | **الكمية المرجعية دايماً base** |
| `uom_id` + `uom_quantity` | اختياري | اختياري | اختياري | — | اختياري | تحويل بـ `conversion_factor_to_base` على السيرفر؛ السجل يحتفظ بالأصل والمُحوَّل |
| المصدر / الوجهة | وجهة | مصدر | مصدر + وجهة | مخزن | وجهة | location اختياري |
| `initiator_id` | = المنفّذ عادةً | = المنفّذ | مبادر | طالب | مبادر | **[موجود]** كـ `user_id` للمنفّذ؛ المبادر الحالي = المنفّذ |
| `approver_id` | حسب السياسة | حسب السياسة | حسب السياسة | **غالباً** | حسب السياسة | **المبادر ≠ المعتمد** إلزامي |
| `executor_id` | | | مرسِل/مستلم | عدّاد | | منفّذ فيزيائي (قد يختلف عن المبادر) |
| `counterparty` | مورد | عميل/مشروع/مستلم | — | — | عميل | نص + معرّف اختياري (دليل جهات لاحقاً) |
| `reason_code` + `notes` | اختياري | **مقترح**: purpose code | — | **إلزامي** | **إلزامي** | `REASON_REQUIRED` موجود محلياً في `mobile/src/domain/events.ts` (Adjust, Dispose, Return…) |
| `document_ref` | رقم فاتورة/PO | أمر بيع/مشروع | رقم النقل | رقم الجرد | رقم المرتجع | حقل حر مفهرس، لا تحقق خارجي |
| `captured_at` (وقت الجهاز) | ✔ | ✔ | ✔ | ✔ | ✔ | **ادّعاء** مع `server_received_at`؛ **لا يُستخدم للترتيب ولا لحسم العهدة** |
| `server_posted_at` | ✔ | ✔ | ✔ | ✔ | ✔ | = `created_at` الحالي |
| `idempotency_key` / `request_id` | ✔ | ✔ | ✔ | ✔ | ✔ | `request_id` **unique** على الحركة = منع الترحيل المزدوج |
| `history_generation` | ✔ | ✔ | ✔ | ✔ | ✔ | **[موجود]** في الرد (Series 07) |
| `unit_cost` / `valuation_ref` | مع `item.view_cost` | — (يُحسب) | — | قيمة التسوية | | **يظهر فقط لمن يملك القدرة**؛ التقييم (FIFO/avg) خارج النطاق الأول |
| `evidence[]` | اختياري/حسب المخاطر | اختياري | **عند الاستلام/فرق** | **عند فرق كبير** | عند الضرر | مرفقات بسياسة (§6) |

## 3. محرك الموافقات (التصميم)

### 3.1 السياسة (versioned policy)
- `policies(id, company_id, version, rules jsonb, effective_from, created_by, published_at)`؛ **append-only بإصدارات**؛ كل طلب بيتربط بـ `policy_version` وقت إنشائه.
- قاعدة = (نوع العملية، نطاق مخزن/تصنيف/حساسية، شرط كمية/قيمة، **المطلوب**: none | single_approval | two_step | dual_control، أهلية المعتمد، مهلة الانتهاء، وضع الترحيل).
- **الافتراضي الموصى به (مش "موافقة على كل صرف"):** استلام وصرف عادي ≤ حد المخزن = straight-through؛ تسوية/إتلاف/مرتجع = موافقة؛ صرف فوق حد كمية/قيمة أو لتصنيف حساس = موافقة؛ تحويل = تأكيد استلام (§4). **كل ده إعدادات**، وافتراضي الشركة الحالية = "كما هو اليوم" (لا موافقات).

### 3.2 حالات الطلب (state machine)

`DRAFT`(جهاز فقط) → `SUBMITTED` → { `AUTO_APPROVED` | `PENDING_APPROVAL` } → `APPROVED` → (`EXECUTED`) → `POSTED`
نهايات: `REJECTED` · `CANCELED` (المبادر قبل الترحيل) · `EXPIRED` (مهلة موافقة أو مهلة تنفيذ) · `POST_FAILED` (رصيد/سياسة تغيّرت — يحتاج موافقة مستخدم جديدة، **مفيش تنفيذ جزئي تلقائي**).

| من → إلى | من يملك | شرط | أثر |
|---|---|---|---|
| SUBMITTED → AUTO_APPROVED | النظام | السياسة بتقول none | ينتقل لترحيل مباشرة (المسار الحالي) |
| SUBMITTED → PENDING_APPROVAL | النظام | السياسة تتطلب | **حجز** الكمية للصرف (§3.3)؛ إشعار للمعتمدين المؤهلين |
| PENDING → APPROVED | معتمد مؤهل، **≠ المبادر** | سياسة بنفس الإصدار، ضمن الحدود والنطاق، **online** | سجل قرار (unique طلب+معتمد) |
| PENDING → REJECTED | معتمد مؤهل | سبب إلزامي | الحجز يتحرر |
| PENDING/APPROVED → CANCELED | المبادر أو Admin | قبل POSTED | الحجز يتحرر |
| PENDING/APPROVED → EXPIRED | النظام (server time) | تعدّى المهلة | الحجز يتحرر؛ إشعار |
| APPROVED → EXECUTED | المنفّذ المخوّل | attestation (اختياري حسب السياسة) | — |
| APPROVED/EXECUTED → POSTED | النظام داخل transaction | §3.4 | حركة + revision؛ الحجز يتحول لحركة |
| APPROVED → POST_FAILED | النظام | رصيد غير كافٍ/صلاحية سُحبت/سياسة ألغيت | طلب جديد بموافقة جديدة |

### 3.3 منع الصرف الزائد المتزامن
- الصرف المعلّق على موافقة بيعمل **حجز** في `product_warehouse.reserved_quantity` (العمود **موجود** GM:P6 بدون كاتب) تحت **نفس ترتيب الأقفال الحالي** (قفل المخزن ثم صف المخزون).
- **تعديل لازم عند بناء الميزة:** فحص الرصيد في `StockService.applyMovementInTransaction` حالياً `base_quantity + change ≥ 0`؛ لازم يبقى `base − reserved ≥ qty` للصرف، وإلا الصرف المباشر ياكل الكمية المحجوزة. (**اختبار إلزامي:** صرف مباشر ⟂ حجز.)
- `available = base − reserved` أصلاً بتتبعت في `getChanges` (موجود).

### 3.4 الترحيل (posting) — ذرّي ومرّة واحدة
Transaction واحدة: قفل صف الطلب (`FOR UPDATE`) + صف المخزون + المخزن ← تحقق: الحالة APPROVED/EXECUTED، لم تنتهِ، **الكمية = المعتمدة بالظبط**، الصلاحية سارية (إعادة فحص RBAC)، الرصيد كافٍ ← إدخال الحركة (`request_id` **unique**) ← تحرير الحجز ← POSTED ← حدث `domain_events`. تكرار التنفيذ ← نفس الحركة (replay). **مفيش double posting.**
**وضعان (قرار Q-07):** `post_on_execution` (افتراضي للصرف: الـ ledger يتبع الواقع الفيزيائي؛ الموافقة = تصريح بمهلة) و`post_on_approval` (للتسوية/نتيجة الجرد: مفيش فعل فيزيائي).

### 3.5 Offline
| الحالة | القاعدة |
|---|---|
| إنشاء طلب أوفلاين | مسموح (intent مثل الـ outbox). **الجهاز بيتوقع** حاجة الموافقة من نسخة سياسة محلية (`policy_version` + انتهاء) للتنبيه فقط |
| قرار السيرفر عند الاستلام | **السيرفر هو اللي بيقرر.** لو الجهاز عمله straight-through لكن السياسة الحالية تطلب موافقة ← السيرفر **يحوّله لطلب PENDING** ويرد `outcome: pending_approval` (الاتجاه الآمن: لا ترحيل بدون موافقة مطلوبة) |
| موافقة/رفض/override | **online فقط**، بوقت السيرفر، لا تُخزَّن كنية محلية |
| تنفيذ طلب معتمد | attestation idempotent (`request_id + step`) ممكن تتأخر في outbox؛ الترحيل نفسه سيرفر |
| ما يُعرض للمدير | حركات **مؤكدة** فقط؛ طلبات الأجهزة غير المتصلة **مش ظاهرة له** (ولا ندّعي رؤية فورية للأجهزة غير المتصلة) |

### 3.6 قواعد الحسم (مرفوضة صراحةً)
- ❌ **Last-write-wins** لترحيل مخزون أو لملكية عهدة.
- ❌ **تنفيذ جزئي تلقائي** لكمية معتمدة (يحتاج موافقة جديدة).
- ❌ **وقت الجهاز** كمرجع للترتيب أو لحسم العهدة (`captured_at` ادّعاء فقط، مع تنبيه skew).
- ✔ الترتيب = ترتيب commit في السيرفر (revision لكل مخزن + `domain_events.seq`).

## 4. العهدة (Transfer custody) — ADR F

**الحالي [موجود] (GM:L3):** تحويل فوري: ساقين في transaction واحدة. بيفضل كوضع `instant` (سياسة) للتوافق.
**المستهدف (`custody` mode):**

| الحالة | من يغيّرها | شرط | الـ ledger |
|---|---|---|---|
| `REQUESTED` | مبادر على المصدر | `transfer.initiate` | — (أو حجز) |
| `APPROVED` (إن لزم) | معتمد | سياسة | — |
| `DISPATCHED` | مرسِل (custodian) على **المصدر** | attestation + (دليل اختياري) | `TRANSFER_OUT` على المصدر **و** الكمية تدخل **in-transit** |
| `IN_TRANSIT` | — | — | الكمية خارج `available` في الطرفين، ظاهرة كـ "في الطريق" |
| `RECEIVED` | مستلم على **الوجهة** (≠ المرسِل) | الكمية = المرسَلة | `TRANSFER_IN` على الوجهة؛ in-transit يتصفّر |
| `RECEIVED_DISCREPANCY` | مستلم | الكمية ≠ المرسَلة + سبب + دليل | يُرحَّل المستلَم فعلاً؛ **الفرق يبقى in-transit "متنازع عليه"** |
| `RESOLVED` | مخوّل على الطرفين | قرار موثّق (تسوية بموافقة، إعادة عدّ، مطالبة) | تسوية مسجّلة، **لا تعديل تلقائي** |
| `CANCELED` | مبادر/مخوّل | قبل DISPATCHED | تحرير |
| `RETURNED` | مستلم/مخوّل | بعد DISPATCHED | ساق عكسية |

**Invariant يُختبَر كـ property:** مجموع (on-hand كل المخازن) + (in-transit) **ثابت** عبر أي تسلسل تحويلات. **لا تعارض عهدة:** استلامان متزامنان ← `unique(transfer_line, step=RECEIVE)` تحت قفل؛ الثاني `already-received`. **مفيش LWW ولا وقت جهاز.**

## 5. الـ 12 workflow

**تصنيف الأولوية (حسب الاعتماد لا الحجم):** **P0** موجود ويُقوّى · **P1** يعتمد على الأساس (RBAC + دورة حياة الأعضاء) · **P2** يعتمد على P1 · **P3** يعتمد على locations.
جدول أولى: 1 (P0)، 2 (P0)، 12 (P0)، 11 (P1)، 10 (P1)، 6 (P1)، 5 (P2)، 3 (P2)، 8 (P2)، 9 (P2)، 7 (P2)، 4 (P3).

> **قالب كل بند:** الحالات · المخوّلون · المسار السليم · الرفض/الانتهاء/timeout · أوفلاين · التزامن/idempotency · أثر الـ ledger · audit/دليل · ما يراه المستخدم · أثر الاسترداد · اختبارات مطلوبة.

### W1 — Supplier receipt (P0، **[موجود]** + تحسينات)
- **الحالات:** `PENDING(outbox) → CONFIRMED`؛ (مستقبلاً) `EXPECTED(PO) → PARTIAL → COMPLETE` اختياري.
- **المخوّلون:** `stock.receive` على المخزن.
- **سليم:** إدخال SKU/كمية (+مورد/مرجع) ← POST بـ Idempotency-Key ← رصيد جديد وإيصال.
- **رفض/timeout:** 403/404 بدون أثر؛ timeout ← نفس المفتاح (**[موجود]** `outbox`).
- **أوفلاين:** **مدعوم** (outbox)؛ لا يظهر مؤكداً حتى يؤكده السيرفر (**[موجود]**).
- **تزامن:** idempotency (**[موجود]**)؛ مفيش حد أقصى.
- **ledger:** INBOUND +q، revision، `reference_type=PURCHASE`.
- **audit:** حركة + audit HTTP + (مستقبلاً) `domain_events`.
- **المستخدم:** "في الانتظار / مؤكد" بدقة (**[موجود]**).
- **استرداد:** S1/S2 (Series 07) لو السجل ضاع.
- **اختبارات:** موجودة (PG ×3)؛ المضاف: مرجع المستند، UOM، قيود الكمية بالسياسة، NT-16.

### W2 — Customer / project issue (P0، **[موجود]** + مساءلة)
- **الحالات:** `PENDING → CONFIRMED` (straight-through)؛ مع سياسة: `PROPOSED → PENDING_APPROVAL → APPROVED → EXECUTED → POSTED`.
- **المخوّلون:** `stock.issue`؛ معتمد حسب السياسة (≠ المبادر).
- **سليم:** SKU/كمية + **جهة مستلمة + غرض (purpose) + مرجع** ← (موافقة إن لزم) ← ترحيل.
- **رفض/انتهاء:** رصيد غير كافٍ 409 (**[موجود]**)؛ REJECTED/EXPIRED بتحرر الحجز.
- **أوفلاين:** الصرف العادي مدعوم؛ الصرف الخاضع للموافقة = طلب فقط (لا ترحيل أوفلاين).
- **تزامن:** حجز تحت قفل (§3.3)؛ منع الصرف الزائد المتزامن.
- **ledger:** OUTBOUND −q.
- **audit:** المبادر/المعتمد/المنفّذ/المستلم/الغرض.
- **المستخدم:** "بانتظار موافقة المدير — لسه مش خارج من المخزون".
- **اختبارات:** NT-17, NT-26/27؛ property: صرفان متزامنان لا يتجاوزان المتاح.

### W3 — Inter-warehouse transfer (P2)
- **الحالات:** §4 (instant أو custody).
- **المخوّلون:** مصدر/وجهة منفصلين (RBAC §6).
- **سليم:** طلب ← (موافقة) ← dispatch ← in-transit ← receive.
- **رفض/timeout:** مهلة استلام ← تنبيه + تصعيد (لا إلغاء تلقائي بعد dispatch).
- **أوفلاين:** dispatch/receive attestations في outbox بمفاتيح؛ الحسم سيرفر.
- **تزامن:** `unique(transfer_line, step)`؛ لا LWW.
- **ledger:** OUT عند dispatch، IN عند receive، in-transit محفوظ.
- **audit/دليل:** مرسِل + مستلم + صور اختيارية عند الفرق.
- **المستخدم:** "في الطريق (مؤكد من السيرفر)" ≠ "مُرسَل محلياً".
- **اختبارات:** NT-19..22؛ property الحفظ؛ تزامن استلامين.

### W4 — Internal relocation (P3)
- **الحالات:** `PENDING → POSTED`.
- **مخوّل:** `stock.relocate` + مواقع نفس المخزن.
- **أثر:** لا تغيير كمية المخزن، تغيّر position (location) فقط؛ **لا يُعامَل كتغيير كمية** (مبدأ `QUANTITY_AFFECTING` المحلي: `Relocate` ليس منها).
- **يعتمد على:** جدول `locations` + positions (ADR C). **لا يُبنى قبله.**
- **أوفلاين:** مدعوم لاحقاً (idempotent).
- **اختبارات:** مجموع positions = رصيد المخزن؛ لا موقع من خارج النطاق.

### W5 — Stocktake / cycle count (P2)
- **الحالات:** `PLANNED → COUNTING → SUBMITTED → REVIEWED → POSTED | CANCELED`.
- **المخوّلون:** create/review/post: manager (**post ≠ من عدّ**)؛ count: operator.
- **سليم:** فتح جلسة لنطاق (مخزن/موقع/تصنيف) ← عدّ (اختياري "أعمى": لا يرى الكمية النظرية) ← فروقات ← مراجعة ← ترحيل **تسويات** (ADJUSTMENT مرجعها الجرد) بموافقة حسب العتبات.
- **أوفلاين:** العدّ مدعوم (جلسة محلية، إرسال idempotent)؛ الترحيل online.
- **تزامن:** لقطة "الكمية النظرية" وقت فتح الجلسة بـ `revision`؛ لو تحرّك المخزون أثناء الجرد ← الفرق يُحسب على الحركات اللاحقة (cut-off صريح)، **لا overwrite**.
- **ledger:** فروقات فقط، لا استبدال أرصدة.
- **اختبارات:** حركة أثناء الجرد؛ فصل المُرحِّل؛ جرد أعمى لا يسرّب النظري.

### W6 — Stock adjustment (P1)
- **الحالات:** `PROPOSED → PENDING_APPROVAL → APPROVED → POSTED`.
- **مخوّلون:** request: supervisor/manager؛ approve ≠ الطالب؛ سبب إلزامي.
- **الحالي [موجود]:** مباشر للـ Manager/Admin بـ `reason`→notes (GM:L4).
- **أوفلاين:** طلب فقط.
- **ledger:** ADJUSTMENT ± مع `reason_code`.
- **audit:** طالب + معتمد + سبب + قيمة (لمن يملك `finance`).
- **اختبارات:** NT-24/25؛ تسوية فوق العتبة بدون موافقة مرفوضة.

### W7 — Customer return (P2)
- **الحالات:** `PROPOSED → INSPECTED → ACCEPTED_TO_STOCK | QUARANTINE | REJECTED`.
- **ملاحظة:** `Return` موجود كنوع **UNWIRED** محلياً. السيرفر: لا شيء.
- **ledger:** قبول ← INBOUND بمرجع الصرف الأصلي؛ حجر ← يحتاج حالة quarantine (**NOT_PRESENT**، ADR C) فيتأجل.
- **أوفلاين:** تسجيل الاستلام مدعوم؛ القرار online.
- **اختبارات:** مرتجع > المصروف الأصلي مرفوض؛ مرجع الصرف في نفس الشركة.

### W8 — Custody handover (P2)
- **تعريف:** نقل مسؤولية عن بضاعة/أصل بين شخصين (ورديات، عُهدة، مندوب) **بدون** تغيير مخزن.
- **الحالات:** `HANDOVER_REQUESTED → ACCEPTED | DISPUTED | EXPIRED`.
- **مخوّلون:** المُسلِّم + المستلِم (**بالاسم، مصادَق، كلاهما**).
- **قاعدة حاسمة:** الملكية بتنتقل **فقط** بقبول المستلِم المصادَق (online أو attestation مُرحَّلة)؛ **وقت الجهاز لا يحسم**؛ نزاع ← يبقى مع المُسلِّم حتى الحسم.
- **ledger:** لا حركة كمية؛ `custody_events` (مرتبطة بـ `domain_events`).
- **اختبارات:** قبول مزدوج متزامن؛ مستلم غير مصادَق مرفوض.

### W9 — Discrepancy investigation (P2)
- **الحالات:** `OPEN → UNDER_REVIEW → RESOLVED(adjusted|claimed|written_off|no_issue) | ESCALATED`.
- **مصادر:** فرق استلام تحويل، فرق جرد، `duplicate-risk` من الاسترداد (**[موجود]** كإشارة على الموبايل).
- **مخوّل:** manager/auditor؛ القرار المالي بموافقة.
- **قاعدة:** لا إغلاق تلقائي، لا تعديل ledger بدون قرار موثّق؛ الأدلة تُربط بالقضية.
- **اختبارات:** إغلاق بدون سبب مرفوض؛ فصل المحقق/المسوّي.

### W10 — Temporary permission delegation (P1)
- **الحالات:** `GRANTED → ACTIVE → EXPIRED | REVOKED`.
- **مخوّل:** حامل القدرة (≤ قدراته، مدة قصوى، سبب).
- **تنفيذ:** `access_grants.valid_until`؛ السيرفر هو القرار؛ الأوفلاين: الـ UI يخفي عند الانتهاء المحلي لكن الطلبات تتحقق سيرفر.
- **اختبارات:** NT-29؛ عملية بدأت أثناء التفويض وانتهت قبل الترحيل ← تُرفض.

### W11 — Versioned policy update (P1)
- **الحالات:** `DRAFT → PUBLISHED(version n+1, effective_from) → SUPERSEDED`.
- **مخوّل:** owner/admin (+ تأكيد).
- **قاعدة:** لا أثر رجعي؛ الطلبات القائمة تفضل على إصدارها حتى تنتهي أو يُعاد طلبها؛ الأجهزة تحمل `policy_version`.
- **اختبارات:** NT-38؛ تغيير السياسة أثناء طلب معلّق.

### W12 — Disaster recovery / reconciliation (P0، **[موجود]** Series 04–07)
- **الموجود:** كشف تغيّر التاريخ، `lookup`، S1 تعويض ذرّي، S2 generation + rotation (GM:L9–L11)، runbook v0.3.
- **ما يفضل:** بروفة تشغيلية على قاعدة غير إنتاجية؛ 2FA step-up للـ rotation؛ تدريب؛ جهازين؛ قرار سياسة المشغّل (انظر الـ roadmap، Milestone R).
- **حدود صريحة:** restore بيرجّع الـ generation والـ provenance (عقد Series 07 §5–6)؛ الكشف مش تلقائي.

## 6. الأدلة والمرفقات (evidence) — بحسب المخاطر

- **اختياري/بدون** للعمليات البسيطة؛ **مطلوب** لفرق استلام تحويل، فرق جرد فوق عتبة، ضرر، مرتجع تالف.
- التخزين: object storage مع URL موقّع قصير + hash للملف في `domain_events` (التفاصيل ADR G: الاحتفاظ والخصوصية).
- **لا مرفقات إلزامية للحركات العادية** (قيد قابلية الاستخدام: هدف "أقل من 3 لمسات" يُقاس، مش يتجاوز الضمانات).

## 7. سجل الأحداث (`domain_events`) — أساس الـ audit والـ feed

`(id, company_id, seq, aggregate_type, aggregate_id, event_type, payload jsonb, actor_user_id, approver_user_id, occurred_at (server), device_captured_at (claim), correlation_id, policy_version, history_generation, prev_hash?, hash?)`
- يُكتب **في نفس transaction** العملية (على عكس `audit_logs` الحالي best-effort — GM:U1).
- **append-only** بـ trigger يمنع UPDATE/DELETE (النمط الموجود في `history_generation_events`).
- الـ hash chain اختياري ومربوط بتثبيت خارجي (ADR G) — **tamper-evidence وليس إثباتاً قانونياً**.
