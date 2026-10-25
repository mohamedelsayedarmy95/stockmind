# STOCKMIND — SERIES 07 RECOVERY CONTRACT (S1 + S2)

> عقد تقني (API + DB + سلوك العميل) لـ **Recovery Safeguards S1 (Safe Replacement)** و**S2 (History Generation)**.
> الحالة: **منفَّذ ومختبَر على بيئة تطوير فقط** (PostgreSQL مؤقتة، بيانات synthetic، Huawei debug build). **Production = NO-GO.**
> الكود هو المرجع؛ الملف ده بيوصفه. كل جملة "مضمون" هنا ليها اختبار مذكور في §10.
> أمر المصطلحات: *history* = السجل الحالي لقاعدة البيانات (ledger + key records). *generation* = هوية السجل اللي العملاء بيتزامنوا معاه.

---

## 1. النموذج في سطرين

- **S2:** لكل شركة `history_generation` (UUID عشوائي، يُقارَن بالتساوي فقط). بيتغيّر **فقط** بإجراء مشغّل موثَّق ومُسجَّل (rotation). العميل بيبعت آخر generation شافه مع الـ cursor؛ اختلافه = snapshot + reset **حتى لو أرقام الـ revisions اتكرّرت**.
- **S1:** العملية اللي السجل فقدها (`absent`) ما بتتبعتش تاني. الإنسان بيقرر "عوّضها"، والسيرفر بيقرر **جوه transaction واحدة** (مش lookup سابق): لو الأصل موجود أو غامض أو الـ generation قديم أو الصلاحية اتشالت ← رفض. النجاح = **حركة جديدة** بمفتاحها هي + provenance دائم.

## 2. تغييرات الـ DB (migration واحدة، additive): `1792590000000-RecoveryIntegrity`

| العنصر | الوصف |
|---|---|
| `companies.history_generation uuid NOT NULL DEFAULT gen_random_uuid()` | الشركات الحالية بتاخد قيمة عشوائية مميزة (مفيش `uuid-ossp`). |
| `warehouses.history_floor_revision bigint NOT NULL DEFAULT 0` | revision المخزن وقت آخر rotation (أرضية للعملاء القدام). |
| `history_generation_events` | سجل append-only لكل rotation: الشركة، generation السابق/الجديد، actor، السبب، `warehouse_floors`، الوقت. Trigger بيمنع `UPDATE` (الـ `DELETE` متاح عشان `ON DELETE CASCADE` لحذف شركة). |
| `stock_replacements` | provenance: الشركة، المخزن، actor، `original_key`، `original_movement_id`، `original_claim` (jsonb: ما قاله العميل)، `replacement_key`، `replacement_movement_id`، `generation_at_decision`، `original_status='absent'`، السبب، الوقت. **UNIQUE(company, actor, original_key)** و**UNIQUE(company, actor, replacement_key)**. أعمدة الحركات **بلا FK** عمداً: الدليل لازم يعيش بعد الحركة. |
| `down()` | **fail-closed** (زي Series 06): بيرفض قبل أي تعديل لو في rotation أو replacement أو `history_floor_revision > 0`. مفيش override. الرجوع = restore backup أو fix-forward. |

الـ migrations بقت **10**. لا تغيير في الـ migrations السابقة. (اختبار: schema parity بين fresh / production-reconstructed / old-FCM، و19 اختبار migration.)

## 3. تغييرات الـ API

### 3.1 `GET /stock/changes/:warehouseId?since&anchor&generation&limit`
- الرد دايماً فيه `generation`. لما `reset:true` فيه `resetReason`: `generation | floor | ahead | anchor`.
- `Cache-Control: no-store`. الـ `generation` جزء من الـ body ← الـ ETag بيتغيّر معاه؛ **304 مش بيخبّي تغيّر generation** (اختبار: `If-None-Match` قديم بعد rotation ← 200 بالـ generation الجديد).
- قواعد: (1) `generation` مُرسَل ≠ الحالي ← snapshot + reset (`generation`). (2) مفيش `generation` (عميل قديم) و`since < history_floor_revision` ← snapshot + reset (`floor`) مرة واحدة. (3) باقي القواعد القديمة (`ahead`, `anchor`) كما هي. `generation` غلط الشكل ← 400.

### 3.2 `POST /stock/operations/lookup` (قراءة فقط، مش بيتسجّل في الـ audit)
- الرد بقى `{ generation, operations[] }` (الحقل `operations` كما كان).
- حالات جديدة: `indeterminate/superseded` (اتعوّضت؛ مع `replacement:{key,movementId,present}`)، و`present/coexisting-replacement` (الأصل والتعويض الاتنين في الـ ledger الآن؛ مع `replacement` أو `replacementOf`). عميل قديم بيشوف `superseded` كـ **indeterminate** (مش `absent`) فمش بيعرض re-entry.
- نفس حدود الأمان: شركة المستخدم + عمليات المستخدم نفسه؛ حركة في مخزن مفقود الصلاحية = `unavailable` من غير تفاصيل.

### 3.3 `POST /stock/replacements/inbound|outbound`
- صلاحية نوع الحركة (`STOCK_INBOUND`/`STOCK_OUTBOUND`) + `@WarehouseScoped('body.warehouseId')`. هيدر **`Idempotency-Key` إلزامي** (= مفتاح التعويض نفسه، مختلف عن `originalKey`).
- الـ body (validation صارم، `forbidNonWhitelisted`): `originalKey`, `originalMovementId` (**إلزامي**: دليل إن العملية اتأكدت قبل كده), `productId`, `warehouseId`, `quantity` (نفس كمية الأصل), `expectedGeneration`, `acknowledge: true` (القرار البشري), واختياري: `receiptRevision`, `receiptConfirmedAt`, `receiptGeneration`. الحقول دي **ادعاءات العميل** وبتتسجّل كده (`original_claim.claimedByClient`).
- نجاح: `201 { outcome:'replaced', id, productId, warehouseId, userId, movementType, quantityChange, runningBalance, notes, revision, createdAt, historyGeneration, replacement:{originalKey, originalMovementId, generationAtDecision, decidedAt} }`. تكرار نفس الطلب ← نفس الرد + `replayed:true`. نفس المفتاح بجسم مختلف ← `422`.
- رفض (كلها `409` + `code` + `details`، ومفيش أي حاجة اتسجّلت): `stale-generation` (+`currentGeneration`)، `original-present`، `original-indeterminate` (+`reason`)، `original-unavailable`، `already-replaced` (+`replacementKey`)، `insufficient-stock`، `in-progress`. غير كده: `400` (validation / مفتاح ناقص / نفس مفتاح الأصل)، `401`، `403/404` (صلاحية/مخزن)، `422`.
- الملاحظة على الحركة بتتولّد في السيرفر: `Replacement of action <8 chars> (absent from server history after a restore)` (العميل مش بيكتب نص حر).
- بيطلق نفس الـ events والـ push بتاعة أي استلام/صرف (الـ audit interceptor كمان بيسجّل الـ POST).

### 3.4 `POST /stock/{inbound,outbound,...}` (موجودة)
- الرد بقى فيه `historyGeneration` (الـ generation وقت الـ commit؛ بيتخزّن في الـ idempotent response فالـ replay بيرجّع نفس القيمة). إضافة فقط.

### 3.5 Rotation: `POST /recovery/history-generation/rotate` و`GET /recovery/history-generation`
- Authenticated، صلاحية **`MANAGE_RECOVERY`** (Admin فقط؛ مش في Manager/Staff)، وبـ **env `RECOVERY_OPERATIONS_ENABLED=true`** وإلا `403 code:'recovery-disabled'` (الافتراضي مقفول). مفيش endpoint بلا auth.
- Body: `reason` (20–500 حرف) + `confirm: "ROTATE_HISTORY_GENERATION"` حرفياً.
- بيعمل في transaction واحدة: يقفل صف الشركة `FOR UPDATE`، يقفل مخازن الشركة بترتيب الـ id، يسجّل `history_floor_revision = stock_revision`، يولّد generation عشوائي جديد، يضيف سطر في `history_generation_events` (actor + reason + floors). الرد: `{previousGeneration, generation, warehouseFloors}`.
- `GET`: الـ generation الحالي + آخر 20 حدث.

### 3.6 أخطاء مهيكلة
`GlobalExceptionFilter` بيمرّر `code` (و`details` فقط **مع** `code`) — الاستثناءات التانية (مثلاً health 503 اللي فيه driver messages) ما بتتغيّرش (اتكشف بالاختبار الموجود `health.contract.spec`).

## 4. الـ transaction والـ concurrency (S1)

داخل `StockReplacementService.replace` — transaction واحدة (READ COMMITTED، مع locks صريحة):

1. **Claim مفتاح التعويض** في `stock_idempotency_keys` (`ON CONFLICT DO NOTHING`). تكرار/تزامن بنفس المفتاح بيستنى على الـ unique index ثم بيرجّع الرد المخزَّن (replay). جسم مختلف ← 422.
2. **ملكية** المنتج والمخزن للشركة (404 وإلا).
3. **صلاحية المخزن داخل الـ transaction:** الدور بيتقرأ، وللـ Staff صف `warehouse_access` بيتقفل `FOR SHARE` (سحب صلاحية متزامن بيستنى أو بيتشاف).
4. **الـ generation:** `companies.history_generation … FOR SHARE` لازم = `expectedGeneration` (الـ rotation بياخد نفس الصف `FOR UPDATE` فمفيش تعويض بيعدّي عبر التبديل).
5. **سياج مفتاح الأصل (fence):** `INSERT` لصف tombstone في `stock_idempotency_keys` بمفتاح الأصل (`request_hash` = sha256 لـ `superseded:<مفتاح التعويض>`، فأي طلب حقيقي بنفس المفتاح بعدها بيفشل 422). الـ unique key هو الـ **test-and-set الذرّي**: لو الأصل اتسجّل قبل كده الإدخال بيتعارض وبيتقيّم السجل الموجود (present / indeterminate / unavailable / already-replaced) ← رفض؛ لو لسه ما اتسجّلش فالـ tombstone دلوقتي بيمنعه.
6. **فحص الـ ledger بمعرّف الحركة** من الإيصال (حالة: key record اتنضّف والحركة فضلت).
7. **الكتابة العادية** (`applyMovementInTransaction`): bump الـ revision تحت قفل المخزن، قفل صف المخزون، فحص الرصيد (insufficient ← رفض)، إدخال الـ ledger، تحديث الرصيد. ثم صف `stock_replacements`، ثم تحديث الـ tombstone بمعرّف التعويض، ثم تخزين الرد، ثم `COMMIT`. أي فشل ← rollback كامل (الـ claim والـ fence بيختفوا).

**ترتيب الـ locks:** companies(share) ← warehouse_access(share) ← warehouses(update، بترتيب الـ id) ← product_warehouse. الـ rotation: companies(update) ← warehouses(update بترتيب الـ id). الكتابة العادية: warehouses ← product_warehouse فقط. مفيش دورة ← مفيش deadlock (اختبار mixed-load: تعويضات + rotations + كتابات + transfers + syncs متزامنة، صفر 5xx).

## 5. الضمانات — بالتحديد

**مضمونة داخل تاريخ قاعدة بيانات واحد** (وكلها مختبَرة على PG حقيقية):
- G1 العملية الأصلية بتتعوّض **مرة واحدة** بالكتير (unique + fence) — حتى مع 8 طلبات متزامنة بمفاتيح مختلفة: حركة واحدة و7 × `already-replaced`.
- G2 **مفيش تعويض والأصل موجود** (بسجل المفتاح أو بمعرّف الحركة)، ولو الأصل رجع بين المراجعة والإرسال.
- G3 تكرار نفس الطلب (ضغطتين، رد ضايع، إعادة تشغيل التطبيق) = حركة واحدة.
- G4 طلب الأصل المتأخر بعد التعويض بيتـرفض (422) ومش بيتنفّذ؛ وسباق الأصل مقابل التعويض (12 جولة): واحد بس بيكسب، والمخزون بيتحرك مرة.
- G5 الـ generation القديم مرفوض؛ الـ rotation والتعويض المتزامنين مفيهمش 5xx وكل تعويض متسجّل تحت الـ generation اللي شافه.
- G6 صلاحية المخزن بتتقرأ جوه الـ transaction؛ مفيش lookup/تعويض عبر شركات أو مخازن أو مستخدمين (كل مفاتيح العمليات per-user).
- G7 كل تعويض ليه provenance دائم (من، إمتى، تحت أنهي generation، إيه اللي ادّعاه العميل، وأي حركة عوّضته) + سطر audit.
- G8 مفيش حذف ledger ولا reversal ولا تغيير رصيد بدون قرار؛ الـ lookup للقراءة فقط.

**غير مضمونة / مش ممكنة بالمعمارية الحالية (I8):**
- L1 **استرجاع صورة قديمة من القاعدة بيرجّع معاها الـ provenance والـ tombstone والـ generation كمان.** تفرّد الـ DB محلي لتاريخ واحد؛ مفيش منع لتكرار عبر تواريخ فيزيائية مختلفة. اللي موجود: *كشف* (lookup بيرجّع `coexisting-replacement` لما الأصل والتعويض الاتنين موجودين، والـ runbook فيه استعلام للمشغّل) وإجراءات مشغّل (§7).
- L2 لو المشغّل **نسي** الـ rotation بعد restore: مفيش حاجة بتكتشف ده. العملاء بيرجعوا لآليات Series 03–04 (anchor/cursor/فحص بدء التشغيل)، والتعويض لسه بيتحقق من "الأصل غائب" لكن من غير حاجز generation.
- L3 السيرفر **ما بيقدرش يتحقق** من تفاصيل عملية مش عنده (النوع/الكمية/المنتج هي ادعاء العميل). التعويض مش بيدّي صلاحية جديدة: بيقدر يعمله بس اللي معاه صلاحية الحركة العادية، في مساحة مفاتيحه هو، ونفس الكمية المسجّلة في الإيصال.
- L4 العملاء القدام: ممكن يعملوا re-entry عادي (حركة جديدة بمفتاح جديد) والسيرفر مش بيعرف يربطها بالأصل. بيتقلّل بأن `superseded` بتظهر لهم indeterminate (مفيش زرار re-entry)، وبـ reset الـ floor. عميل بلا anchor وبلا generation واقف **بالظبط** على الـ floor مش بيتكشف.
- L5 الإيصالات على الجهاز بتتحفظ **7 أيام**؛ عملية أقدم مش بتتتبّع.
- L6 مفيش step-up (2FA) لـ rotation، ومفيش مسار SQL مختبَر للـ rotation لو الـ API نفسه مش متاح بعد restore (المسار الموثّق = الـ endpoint).
- L7 rollback التطبيق لإصدار أقدم لسه degraded mode مش رجوع آمن (Series 06).

## 6. نموذج الثقة لـ generation (I8)

- الـ generation **بيتخزّن في نفس قاعدة البيانات**، فاستعادة نقطة زمنية بترجّعه هو كمان. **مفيش ادّعاء إن marker قاعدة البيانات بيكتشف restore تلقائياً.**
- اللي بيوفّره: طريقة صريحة ومُوثَّقة تقول "حصل restore": **المشغّل بيعمل rotation بعد الـ restore وقبل فتح الـ API للمستخدمين.** القيمة الجديدة عشوائية فمستحيل تساوي أي قيمة في أي صورة قديمة؛ كل عميل شاف generation تاني بيتّعامل معاه كتاريخ مختلف.
- المقارنة بالتساوي: restore لصورة أقدم من rotation سابق بيرجّع generation قديم؛ العملاء اللي شافوا الأحدث بيشوفوا اختلاف ويعيدوا البناء.
- مفيش endpoint بلا auth؛ مفيش rotation بدون flag + Admin + سبب + تأكيد حرفي؛ الأحداث append-only.

## 7. سلوك العميل (Mobile)

حالات رد السيرفر عن العملية الأصلية وإيه اللي بيحصل:

| الحالة | سلوك التطبيق |
|---|---|
| `present` + مطابق | verified؛ لو كانت lost ← ترجع CONFIRMED (القرار البشري المعلّق بيتسقط لو لسه ما اتبعتش). |
| `present` + `coexisting-replacement` | **REPLACED مع `duplicate-risk`**: ما بيتحذفش ولا بيتجاهل بصمت؛ رسالة "قول للمدير، ماتعدّلش المخزون بنفسك". |
| `absent` | NEEDS_REVIEW `history-changed`؛ **مفيش إعادة إرسال تلقائي أبداً**؛ التعويض متاح بس بعد فحص حديث (≤ دقيقتين) في نفس الشاشة. |
| `indeterminate` / `unavailable` | التعويض **مش متاح** + شرح (اسأل المدير/المشغّل)؛ الإيصال "unverifiable". |
| `superseded` | REPLACED (اتعوّضت قبل كده، حتى من جهاز تاني). |
| generation قديم (409 `stale-generation`) | القرار بيتلغي (مفيش حاجة اتسجّلت)، فحص جديد، قرار جديد بمفتاح جديد. |
| إيصال أقدم من 7 أيام | مش بيتتبّع (محذوف بالـ retention). |
| timeout / شبكة / 5xx / 408 | **UNKNOWN**: المفتاح يتحفظ؛ التطبيق بيسأل السيرفر بمفتاح التعويض نفسه (قراءة فقط) فيحسمها REPLACED أو READY؛ إعادة الإرسال بضغطة المستخدم وبنفس الطلب بالظبط. |
| 401 / 429 | READY بنفس المفتاح. |
| offline | الفحص يفشل "No answer from the server" ← الزرار مش بيظهر؛ ولا حاجة اتغيّرت. |

- القرار والمفتاح بيتكتبوا على الديسك (MMKV مشفّر) **قبل** الإرسال؛ بعد kill للتطبيق: SENDING ← UNKNOWN بنفس المفتاح. مفتاح جديد **بس** بعد رفض بيثبت إن مفيش حاجة اتسجّلت.
- الرصيد المؤكد (من السيرفر) معروض **منفصل** عن الإيصال القديم؛ الإيصال عمره ما بيتجمع على الرصيد.
- الـ cursor (اللي فيه الـ generation) محفوظ per-account في الكاش؛ تغيّر generation = reset + إعادة فحص كل الإيصالات؛ delta بـ generation تاني بيترفض وبيتاخد snapshot في نفس الـ poll. تغيير الحساب بيمنع تطبيق نتيجة على حساب تاني.
- UX: تأكيد بشري صريح (Alert)، ضغطتين = قرار واحد، لا حالة "Confirmed" مضلّلة، نصوص عربي/إنجليزي. الـ biometric gate ما اتلمسش.
- اتشال المسار القديم غير المحمي (`reentryDraft` / `reentryOf`) — كان بيعمل حركة جديدة بدون أي حاجز في السيرفر.

## 8. التوافق والـ rollout

1. **Backend أولاً** (additive): العملاء الحاليين بيشوفوا حقول زيادة وبس. الـ Series 06 migrations ما اتلمسوش.
2. **Mobile بعد كده:** العميل الجديد على سيرفر قديم: مفيش `generation` ← بيتصرّف زي ما كان (الفحص بيقول "not supported" ولا يعرض التعويض).
3. عميل قديم على سيرفر جديد: بيتجاهل الحقول؛ reset الـ floor مرة بعد كل rotation؛ مفيش re-entry لعملية superseded.
4. التفعيل في الإنتاج: **ممنوع الآن** (NO-GO). الـ rotation متوقف ما لم `RECOVERY_OPERATIONS_ENABLED=true` على نشر بعينه.
5. rollback: `down()` fail-closed؛ بعد أول rotation/تعويض الرجوع = restore أو fix-forward.

## 9. إجراء المشغّل بعد restore (ملخص — التفاصيل في الـ runbook §14)

1. وقف الـ API. 2. استعادة. 3. فحوصات §3 في الـ runbook. 4. **تشغيل الـ API بـ `RECOVERY_OPERATIONS_ENABLED=true` مع حجب المستخدمين (أو لحظة مغلقة)، دخول Admin، `POST /recovery/history-generation/rotate` بسبب مكتوب (من/إيه/نقطة الـ restore/رقم الحادثة).** 5. إعادة الـ flag لـ false. 6. فتح الـ API. 7. فحص الأزواج المتعايشة (استعلام §15).

## 10. الدليل

| الطبقة | النتيجة |
|---|---|
| Backend PG ×3 على قواعد جديدة (HEAD الكود `cbad45b`، شجرة نضيفة) | **51/51 suites، 347/347** في كل تشغيلة |
| `recovery-integrity.pg.spec.ts` | 32/32 (S2: 9، S1: 23: سباقات، timeout، replay، rotation متزامن، أمان، تحقق، audit، coexistence، mixed load) |
| Migration spec | 19/19 (جديد: تحقق الإضافة + fail-closed down) |
| Backend negative controls | 6 من 6 أحمر (fence، generation في التعويض، فحص الـ ledger، مقارنة generation في الـ sync، floor، علم coexistence) |
| Mobile | `tsc` 0؛ Jest **16/16 suites، 252/252**؛ 4 negative controls أحمر (تجاهل تغيّر generation، إسقاط المفتاح عند timeout، مفتاح تاني لنفس القرار، عرض التعويض والأصل موجود). تجربة خامسة (شيل guard مكرر) ما غيّرتش النتيجة لأن الـ guard التاني بيغطّي نفس الحالة؛ اتسجّلت كده واتبدّلت بالتجربة الرابعة. |
| Device (Huawei JSN-L22، debug، بيانات synthetic) | تدفق كامل — انظر التقرير §6 |
| Build | نضيف بعد حذف `tsbuildinfo`: `dist/main.js` + 10 migrations + `migration-guards.js` |
