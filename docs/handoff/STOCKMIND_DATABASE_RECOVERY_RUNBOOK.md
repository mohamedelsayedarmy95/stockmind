# STOCKMIND — DATABASE RECOVERY RUNBOOK

> **الحالة:** مسودة تشغيلية v0.2 — 2026-10-24 — اتكتبت في Series 05 (RC admission preflight) واتحدّثت في Series 06 (أقسام 3 و5 و8 و11 و13)؛ التحديثات مبنية على migrations جديدة وأدلة اختبار PostgreSQL.
> **مش** سياسة Production معتمدة. الـ re-entry البشري هو **سلوك التطوير الحالي** المقبول للـ preflight، والـ Director هو اللي يعتمد السياسة النهائية.
> مبني على الكود الفعلي (`integration/series04`، آخر commit كود `d69f6e8`)، وأي SQL هنا **معلّم** بحالته: `VERIFIED` (اتجرّب على PostgreSQL مؤقتة) أو `NOT RUN` (اتراجع على الكود بس).
> أي restore أو repair على Production يحتاج **موافقة صريحة من الـ Director**. الملف ده مش تصريح بتنفيذ حاجة.

---

## 0. كارت سريع (أول 10 دقايق بعد أي restore)

1. **وقّف الـ API** (مفيش write-freeze مدمج في الكود؛ التجميد = إيقاف الـ service من الـ hosting dashboard). ماتسيبش مستخدمين يكتبوا فوق restore ما اتراجعش.
2. **احتفظ بنسخة ما قبل الـ restore** كما هي (ماتمسحهاش ولا تكتب عليها) وسجّل: مين، إمتى، ليه، نقطة الـ restore.
3. **اطلع الفرق:** الحركات اللي كانت في النسخة القديمة ومش موجودة دلوقتي (القسم 4).
4. **افحص الـ invariants** (القسم 3): counters، تكرار الـ revision، NULL revisions.
5. **قرّر لكل حركة ضايعة** (القسم 5) — والقرار لإنسان، مش للتطبيق.
6. **شغّل الـ API** وبلّغ المستخدمين إن شاشة "Needs review · history changed" متوقعة (القسم 6).

> قبل **أول** deploy للـ candidate على أي قاعدة بيانات حقيقية: نفّذ قايمة الفحص المسبق (القسم 13). الـ migrations بتتشغّل أوتوماتيك وقت الـ boot (`migrationsRun: true`).

---

## 1. القاعدة الذهبية

> **العملية اللي السيرفر كان أكدها (confirmed) ماتتبعتش تاني أوتوماتيك لمجرد إن السيرفر الحالي ما بقاش فيها.**
> إعادة الإرسال هتطبّقها **حركة جديدة** من غير ما أي حد يعرف إن الضياع كان مقصود (مثلاً rollback متعمّد). عشان كده التطبيق بيحوّلها لـ `NEEDS_REVIEW · history-changed` وبيسيب القرار لإنسان.

---

## 2. الفرق بين "stock truth" و"receipt"

| | stock truth (حقيقة المخزون) | receipt (إيصال) |
|---|---|---|
| مصدرها | السيرفر فقط: `product_warehouse` + `stock_movements` (snapshot/delta) | الجهاز: النتيجة اللي السيرفر رجّعها وقت التأكيد (`CONFIRMED`) |
| بتقول إيه | الكميات **دلوقتي** | إن السيرفر **كان** سجّل العملية في وقت ما |
| بعد restore | بتتغيّر وتتصحّح مع الـ snapshot (`reset: true`) | بتبقى **دليل على الماضي** لحد ما السيرفر يأكدها تاني |
| قاعدة العرض | بتتعرض كما هي | بتتعرض "re-checking" لحد ما تتأكد، ومش "Confirmed" بلا قيد |

ردود `POST /stock/operations/lookup` (الكود: `operation-lookup.service.ts`):

| الرد | المعنى | ما يعمله الجهاز |
|---|---|---|
| `present` + مطابق | الحركة في الـ ledger الحالي | `verified` (ياخد الـ revision الحالي) |
| `present` بس مختلف | نفس الـ key بس تفاصيل مختلفة | `NEEDS_REVIEW · history-mismatch` |
| `absent` | مفيش أي أثر لا في الـ ledger ولا في الـ idempotency records. **يعني "مش في التاريخ الحالي"، مش "ما حصلتش"** | `NEEDS_REVIEW · history-changed` — **ماتتبعتش تاني** |
| `indeterminate` | في أثر مش كفاية (key بلا حركة / claim ما خلصش / نوع مش مدعوم) | "could not be re-checked" — **مش Confirmed** |
| `unavailable` | الحركة موجودة بس في مخزن المستخدم ما بقاش مسموحله بيه | "could not be re-checked (no-access)" |

---

## 3. بعد الـ restore مباشرةً — فحوصات القراءة (كلها `SELECT`، اشتغل على النسخة المستعادة)

> مصنّفة `VERIFIED` من ناحية أسماء الجداول والأعمدة (من الـ migrations)، و`NOT RUN` من ناحية التنفيذ على بيانات حقيقية.

```sql
-- (أ) العداد لازم يساوي أعلى revision في كل مخزن — لازم تطلع صفر صفوف
SELECT w.id, w.stock_revision, COALESCE(max(sm.revision), 0) AS max_revision
FROM warehouses w LEFT JOIN stock_movements sm ON sm.warehouse_id = w.id
GROUP BY w.id HAVING w.stock_revision <> COALESCE(max(sm.revision), 0);

-- (ب) تكرار revision داخل نفس المخزن — لازم صفر صفوف
SELECT warehouse_id, revision, count(*) FROM stock_movements
WHERE revision IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;

-- (ج) حركات بلا revision. بعد تطبيق migration 1792580000000 مفروض ما تحصلش أبداً (trigger)؛
--     أي نتيجة = البيئة لسه ما طبّقتهاش، أو في مشكلة تستحق تصعيد — القسم 8
SELECT warehouse_id, count(*) FROM stock_movements WHERE revision IS NULL GROUP BY 1;

-- (د) الأرصدة مقابل الـ ledger — قارنها بنتيجة نفس الاستعلام قبل الـ restore.
--     "صفر صفوف" مطلق متوقع بس لو كل تغيير مخزون بيعدّي كحركة (UNVERIFIED على بيانات حقيقية).
SELECT pw.product_id, pw.warehouse_id, pw.base_quantity, COALESCE(sum(sm.quantity_change), 0) AS ledger_sum
FROM product_warehouse pw
LEFT JOIN stock_movements sm ON sm.product_id = pw.product_id AND sm.warehouse_id = pw.warehouse_id
GROUP BY pw.product_id, pw.warehouse_id, pw.base_quantity
HAVING pw.base_quantity <> COALESCE(sum(sm.quantity_change), 0);
```

أي نتيجة غير فاضية في (أ) أو (ب) = **أوقف** وصعّد (القسم 9).

---

## 4. قبل الـ restore: جمع الأدلة. بعده: استخراج الضايع

**قبل** الـ restore (على النسخة اللي هتتستبدل، قراءة فقط) — بـ `psql`. ملاحظة: `psql` **مش بيعوّض المتغيرات** (`:'x'`) جوه أمر `\copy`، فاكتب القيم الفعلية مكان `<COMPANY_UUID>` و`<SINCE_TIMESTAMP>`:

```sql
\copy (SELECT sm.id, sm.warehouse_id, sm.product_id, sm.user_id, sm.movement_type::text, sm.quantity_change, sm.revision, sm.notes, sm.created_at FROM stock_movements sm JOIN warehouses w ON w.id = sm.warehouse_id WHERE w.company_id = '<COMPANY_UUID>' ORDER BY sm.warehouse_id, sm.revision, sm.created_at) TO 'ledger_pre_restore.csv' CSV HEADER
\copy (SELECT user_id, idempotency_key, request_hash, response, created_at FROM stock_idempotency_keys WHERE company_id = '<COMPANY_UUID>') TO 'keys_pre_restore.csv' CSV HEADER
\copy (SELECT id, stock_revision FROM warehouses WHERE company_id = '<COMPANY_UUID>') TO 'counters_pre_restore.csv' CSV HEADER
\copy (SELECT actor_user_id, action, entity_type, entity_id, correlation_id, http_path, status_code, created_at FROM audit_logs WHERE company_id = '<COMPANY_UUID>' AND created_at >= '<SINCE_TIMESTAMP>') TO 'audit_pre_restore.csv' CSV HEADER
```

(الاستعلامات العادية في القسم 7 بتستخدم `:'company'` وغيرها: عرّفها الأول بـ `\set company '<COMPANY_UUID>'`.)

خزّن الملفات **برا** قاعدة البيانات المستعادة، واحسب SHA-256 لكل ملف وسجّله في سجل التصعيد (القسم 7). ماتحطش بيانات عملاء حقيقية في أي مكان مش مصرّح بيه.

**بعد** الـ restore (على النسخة المستعادة): حمّل الـ ledger القديم في جدول مؤقت وقارن:

```sql
CREATE TEMP TABLE pre_ledger (id uuid PRIMARY KEY, warehouse_id uuid, product_id uuid, user_id uuid,
  movement_type text, quantity_change numeric, revision bigint, notes text, created_at timestamptz);
\copy pre_ledger FROM 'ledger_pre_restore.csv' CSV HEADER

-- الحركات الضايعة (كانت موجودة قبل الـ restore ومش موجودة بعده)
SELECT p.* FROM pre_ledger p LEFT JOIN stock_movements s ON s.id = p.id
WHERE s.id IS NULL ORDER BY p.warehouse_id, p.revision;

-- أرقام revision اتعاد استخدامها لحركات مختلفة (بعد ما رجعت كتابات جديدة)
SELECT p.warehouse_id, p.revision, p.id AS pre_id, s.id AS post_id
FROM pre_ledger p JOIN stock_movements s ON s.warehouse_id = p.warehouse_id AND s.revision = p.revision AND s.id <> p.id;
```

الضايع ده هو **القايمة اللي هتتعرض كـ "Needs review" على أجهزة المستخدمين اللي بعتوا العمليات دي** (بشرط إن الإيصال لسه محفوظ على الجهاز، القسم 5-ج).

---

## 5. القرار لكل حركة ضايعة

القرار **بشري** ومبني على الواقع الفعلي (هل البضاعة اتحركت فعلاً؟).

### أ) إجراءات آمنة وإجراءات ممنوعة

| آمن | ممنوع / لازم مراجعة |
|---|---|
| قراءة ومقارنة الـ ledger، تصدير الأدلة | **إعادة إرسال أوتوماتيك** لأي إيصال confirmed |
| `lookup` للتأكد من وجود الحركة قبل أي قرار | `migration:revert` على Production — حتى لو بيرفض لما في بيانات، ممنوع تعتمد عليه (القسم 8) |
| Acknowledge لحركة اتأكد إنها ضايعة عن قصد | حذف/تعديل `stock_idempotency_keys` أو إعادة استخدام Idempotency-Key لطلب مختلف (السيرفر بيرد 422) |
| Re-entry بشري بعد استيفاء قايمة الفحص تحت | `UPDATE/DELETE` يدوي على `stock_movements` أو `product_warehouse` لـ"تظبيط الأرقام" بدون تسوية مسجّلة |
| إيقاف الـ API أثناء الاستعادة والمقارنة | restore فوق Production من غير تجميد الكتابة |
| | تشغيل أي repair أو migration على Production من غير بروفة على نسخة + موافقة الـ Director (القسم 8 و13) |
| | تغيير `ENTITLEMENTS_ENFORCED` أثناء الاسترداد |

### ب) امتى **ماتعملش** re-entry

1. لو في أي احتمال إن الـ restore **يتلغى أو يتعكس** (rollforward) — العملية الأصلية ممكن ترجع، فالـ re-entry هيعملها مرتين.
2. لو الـ `lookup` على نفس الـ key بقى `present` (العملية رجعت).
3. لو الضياع كان **متعمّد** (rollback لبيانات غلط/اختبار).
4. لو اتعمل **جرد فعلي** بعد الـ restore — الجرد هو الحقيقة والرصيد صُحّح بيه.
5. لو العملية `indeterminate` أو `unavailable` — اتحقق من السيرفر والصلاحيات الأول.
6. لو مش متأكد إن البضاعة اتحركت فعلاً.
7. لو الحركة أقدم من فترة الاحتفاظ (7 أيام على الجهاز): الجهاز **مش بيتتبعها** أصلاً؛ اعتمد على أدلة السيرفر في القسم 4.

### ج) حدود التطبيق الحالية (مهمة للمشغّل)

- الإيصالات بتتحفظ **7 أيام** (`CONFIRMED_RETENTION_MS`)، بحد أقصى 500 عنصر. الأقدم مش بيتصالح.
- عنصر في حالة `history-changed` **ما بيتعاد فحصه** (`recheckCandidates` و`applyLookup` بيشتغلوا على `CONFIRMED` فقط). لو الـ restore اتعكس بعدين، الجهاز مش هيعرف.
- الكشف بيتم لما الجهاز يعمل poll لمخزنه بالـ anchor (تقريباً كل 45 ثانية على شاشات المخزون)، **ومرة لكل حساب في كل تشغيل للتطبيق** للإيصالات المحفوظة. جهاز ما عملش poll لسه وقت الـ restore ممكن يفضل يعرض إيصال "confirmed" لحد ما يتقفل ويتفتح التطبيق.
- **استنتاج من قراءة `getChanges` (ما اتجرّبش على جهاز):** المستخدم اللي cursor بتاعه أقدم من نقطة الـ restore، وحركته عند الـ cursor لسه سليمة، الـ anchor بتاعه بيطابق فمش بيتعلّم reset؛ بيكمّل delta عادي. إيصالاته الضايعة تتعرف بعدين فقط عند فحص بدء التطبيق (القسم 11 / S2).

---

## 6. اللي هيشوفه المستخدمون وإزاي تبلّغهم

- شاشة المخزون هتتصلّح لوحدها (snapshot ثم deltas).
- العمليات اللي ضاعت هتظهر في شاشة الـ outbox كـ **"Needs review · history changed"** مع آخر إيصال كدليل، وبخيارين: **Acknowledge** أو **Re-enter** (بمفتاح جديد وملاحظة في الـ ledger: `Re-entry of action <أول 8 حروف> (missing from server history after a reset)`).
- رسالة مقترحة للمستخدمين: *"حصلت استعادة لقاعدة البيانات. بعض عملياتك الأخيرة ممكن تظهر 'Needs review'. ماتعيدش إدخالها قبل ما تتأكد من المدير."*

---

## 7. التحقيق في duplicate مشتبه فيه (restore اتعكس أو re-entry تمّ مرتين)

```sql
-- كل الـ re-entries (الملاحظة بتحمل أول 8 حروف من معرّف العملية الأصلية = Idempotency-Key)
SELECT sm.id, sm.user_id, sm.warehouse_id, sm.product_id, sm.movement_type, sm.quantity_change,
       sm.revision, sm.created_at, sm.notes
FROM stock_movements sm JOIN warehouses w ON w.id = sm.warehouse_id
WHERE w.company_id = :'company' AND sm.notes LIKE 'Re-entry of action %' ORDER BY sm.created_at;

-- هل الأصل رجع؟ (بادئة الـ key = الـ 8 حروف من الملاحظة)
SELECT k.user_id, k.idempotency_key, k.created_at, k.response->>'id' AS movement_id
FROM stock_idempotency_keys k
WHERE k.company_id = :'company' AND k.idempotency_key LIKE :'prefix' || '%';

-- بدون key (اتمسحت): نفس المستخدم + المنتج + المخزن + الكمية، في نافذة زمنية حوالين العملية
SELECT sm.id, sm.revision, sm.created_at, sm.notes FROM stock_movements sm
WHERE sm.user_id = :'user' AND sm.product_id = :'product' AND sm.warehouse_id = :'warehouse'
  AND sm.quantity_change = :'qty' AND sm.created_at BETWEEN :'from' AND :'to' ORDER BY sm.created_at;
```

لو لقيت **حركتين** لنفس العملية الواقعية: **ماتمسحش**. سجّل الاتنين في سجل التصعيد، وصحّح بـ **حركة تسوية (adjustment) مسجّلة** بموافقة المدير، مش بحذف. (الـ ledger هو دليل المحاسبة.)

---

## 8. After an application rollback (بعد rollback للتطبيق) أو `migration:revert`

> **تحديث Series 06.** الاختبار الجديد `tests/integration/release-safety.migration.pg.spec.ts` (17 اختبار على PostgreSQL مؤقتة، كل حماية فيه بتتحوّل لأحمر لو اتشالت) غيّر الصورة.

### أ) `migration:revert` (الـ `down()`) — fail-closed

- `1792570000000` (entitlements) و`1792560000000` (shared warehouse) بيرفضوا **قبل أي تعديل** لو هيمسحوا: دعوات، أو idempotency records (الإيصالات اللي المصالحة بتعتمد عليها)، أو بيانات plan، أو صلاحيات مخازن مختلفة عن الافتراضي (Staff اتضيّقت صلاحيته، أو مخزن اتفتح بعد الـ rollout ومتمنحش). الرسالة بتقول **إيه** اللي هيضيع وبتنتهي بـ "Nothing was changed". (VERIFIED: snapshot كامل قبل/بعد الرفض مطابق، وسجل الـ migration لسه موجود، والصلاحيات ما اتوسّعتش.)
- **مفيش override.** الرجوع الفعلي = restore من backup قبل الـ migration، أو fix-forward.
- `1792580000000` (revision guard): `down()` بتشيل الـ trigger والـ index والـ function فقط، **بدون حذف أي صفوف**، والأرقام المُصلَّحة بتفضل.
- بعد `down()`+`up()` لـ `1792560000000` على قاعدة نضيفة، أرقام الـ revisions بتتعاد حسابها بترتيب `(created_at, id)` وممكن تختلف عن اللي اتصدرت (الترتيب الأصلي = ترتيب الـ commit). الأجهزة بتكتشف ده بالـ anchor وبتعمل reset، ولذلك ده مش سبب لمنع الـ down.
- "الـ down نجح من غير SQL error" **مش** معناها "آمن للإنتاج". استخدمه فقط على قاعدة ما فيهاش بيانات الميزات.

### ب) rollback التطبيق لإصدار أقدم من `1792560000000`

- **بعد `1792580000000`:** الإصدار القديم اللي بيدخّل حركات بلا revision بياخد revision من القاعدة (trigger) بنفس بروتوكول التطبيق: زيادة العداد تحت قفل صف المخزن. الحركات دي **بتظهر في الـ delta** (VERIFIED، بما فيها 12 كاتب بأسلوب التطبيق + 12 بأسلوب قديم في نفس الوقت: أرقام فريدة ومتتالية بلا فجوات).
- **لسه غير مدعوم كاستراتيجية رجوع:** الإصدار القديم مايعرفش الـ idempotency (إعادة المحاولة ممكن تكرر الكتابة)، ولا صلاحيات المخازن (Staff ممكن يوصل لأي مخزن)، ولا الدعوات. يعني rollback التطبيق = **وضع متدهور مؤقت** لحد fix-forward، مش طريق رجوع آمن. لو حصل: وقّف الكتابة من الأجهزة (القسم 9) وصلّح للأمام.
- **احتمال (HYPOTHESIS، ما اتجرّبش):** لو الإصدار القديم عمل transfers متعاكسة متزامنة، قفل صفوف المخازن في ترتيب الإدخال ممكن يعمل deadlock؛ PostgreSQL بيقتل واحدة والـ client يعيد. التطبيق الحالي بيقفل بترتيب الـ id فمش متأثر.

### ج) حركات بلا revision موجودة بالفعل

- تطبيق `1792580000000` بيصلّحها **أوتوماتيك** داخل الـ migration: بيقفل مخازنها، ويرقّمها **فوق كل رقم اتصدر** بترتيب `(created_at, id)`، ويرفع العداد. الأرقام اللي اتصدرت قبل كده **ما بتتغيّرش أبداً** (VERIFIED). ترتيب `created_at` ده قاعدة حتمية وموثقة مش ترتيب الـ commit الحقيقي (ده مجهول)؛ بروتوكول الـ cursor محتاج بس إنها تتحط فوق أي رقم ممكن يكون جهاز قراه.
- ماتستخدمش SQL يدوي بدل الـ migration: الـ migration فيها فحص التكرار المسبق وبتتشغّل في transaction واحدة.

### د) تكرار `(warehouse, revision)`

- `1792580000000` بترفض التطبيق **قبل أي تعديل** لو لقيت تكرار وبتسمّي الأزواج (VERIFIED). الاستعلام (ب) في القسم 3 هو الفحص المسبق. بعد التطبيق التكرار مستحيل بـ unique partial index (VERIFIED بإدخال مباشر مرفوض).
- **مفاضلة:** تكرار موجود = الـ boot بيفشل لحد ما حد يحله، بدل ما يكمّل بتكامل مكسور. ده المقصود، وعشان كده الفحص المسبق (القسم 13) مطلوب قبل أول deploy.
---

## 9. امتى توقف الكتابة أو الـ deployment

أوقف الـ API / جمّد أي deploy لحد ما المسألة تتقفل لو:
1. فحص (أ) أو (ب) في القسم 3 رجّع صفوف.
2. الـ restore غير مفهوم أو نقطته غير مسجّلة.
3. الحركات الضايعة أكتر من اللي المسؤول المالي مستعد يراجعها يدوياً، أو فيها عمليات مالية كبيرة.
4. في احتمال إن الـ restore يتعكس (rollforward) أو إن في أكتر من نسخة "حقيقة".
5. ظهرت `indeterminate` بأعداد كبيرة (دليل على restore جزئي: key بلا حركة).
6. بعد أي rollback للتطبيق، لحد تنفيذ القسم 8 والتحقق.
7. أي deploy فيه migration لازم يتأجل أثناء الاسترداد.

---

## 10. سجل الأدلة والتصعيد (انسخه لكل حادثة)

| الحقل | القيمة |
|---|---|
| معرّف الحادثة / التاريخ والتوقيت (مع timezone) | |
| سبب الـ restore ومين قرّره ومين وافق (Director) | |
| نقطة الـ restore (timestamp / branch id من مزوّد الـ DB) | |
| الشركة/الشركات المتأثرة | |
| ملفات الأدلة + SHA-256 لكل واحد (ledger / keys / counters / audit) | |
| عدد الحركات الضايعة + قايمتها (ids) | |
| قرار لكل حركة (re-enter / acknowledge / hold) + المسؤول | |
| اشتباه duplicate؟ نتيجة التحقيق (القسم 7) | |
| تسويات اتعملت (adjustment ids) | |
| وقت إيقاف الـ API ووقت إعادته | |
| إيه اللي اتبلّغ للمستخدمين ومتى | |

ماتكتبش credentials ولا بيانات عملاء حقيقية في الملف ده أو في الـ handoff؛ احتفظ بالأدلة في مكان مصرّح بيه.

---

## 11. حالات فشل محتاجة safeguards برمجية (مش بيحلها runbook وحده)

> مفيش واحدة منها بتمنع **قبول الـ RC** (الـ online mode dev preview فقط، وبيتأكد في الكود من `__DEV__` + متغيرين). لكنها **شروط قبل تفعيل الـ shared warehouses / الـ online mode على Production**. **S3 وS4 اتنفّذوا في Series 06** (migration `1792580000000` وحمايات الـ `down()`)؛ S1 وS2 وS5 وS6 لسه مقترحات.

| # | الحالة | ليه الـ runbook مش كفاية | acceptance criteria مقترحة |
|---|---|---|---|
| S1 | عنصر `history-changed` ما بيتعاد فحصه، فلو الـ restore اتعكس والمستخدم عمل re-entry يحصل duplicate | المستخدم مش هيعرف | قبل ما شاشة الـ re-entry تبعت، التطبيق يعمل `lookup` للـ key الأصلي؛ لو `present` يمنع ويشرح. اختبار domain + اختبار PG + تجربة جهاز |
| S2 | مفيش "restore marker" من السيرفر (history epoch)؛ الكشف بيعتمد على poll الجهاز أو بدء التطبيق، وجهاز cursor بتاعه أقدم من نقطة الـ restore مش بيتعلّم | نافذة زمنية يعرض فيها الجهاز إيصال confirmed قديم | السيرفر يعرض `historyEpoch` بيتغيّر بإجراء مشغّل، ويتبعت مع `/stock/changes`؛ تغيّره يخلّي الجهاز يعيد فحص كل الإيصالات فوراً. اختبار PG بيحاكي restore بدون رجوع cursor |
| S3 ✔ **تم (Series 06)** | تفرّد `(warehouse_id, revision)` كان بيعتمد على بروتوكول القفل فقط | — | unique partial index + فحص تكرار مسبق في `1792580000000`؛ اختبارات: بيئة production-reconstruction وتزامن 24 كاتب ومحاولة إدخال مكرر مرفوضة |
| S4 ✔ **تم (Series 06)** | `down()` مدمّر + rollback التطبيق بيسيب NULL revisions | — | `down()` fail-closed (بدون override)، وtrigger يرقّم الحركات بلا revision، وإصلاح أوتوماتيك داخل الـ migration. القسم 8 |
| S5 | `stock_idempotency_keys` بلا retention/cleanup | بتكبر، وأي cleanup لازم يتوافق مع فترة الإيصالات (7 أيام) ونافذة الـ restore | سياسة retention موثقة ≥ فترة الجهاز + نافذة الـ restore؛ job بيسيب الـ lookup يشتغل بالـ movement id (متحقق منه في الـ spec) |
| S6 | مفيش تقرير للمدير بالعمليات `history-changed` | المشغّل شغال بـ SQL فقط | endpoint/تقرير للـ Admin يلخّص الضايع per company من أدلة السيرفر |

---

## 12. المراجع

- الكود: `src/infrastructure/repositories/operation-lookup.service.ts`، `stock.service.ts` (`getChanges`)، `mobile/src/domain/outbox.ts` (`applyLookup`, `recheckCandidates`, `reentryDraft`, `prune`).
- الاختبارات: `tests/integration/operation-lookup.pg.spec.ts`، `sync-cursor-reset.pg.spec.ts`، `release-safety.migration.pg.spec.ts`، و`tests/equivalence/production-bb071ed/`.
- التقارير: `docs/handoff/SERIES_04_CHECKPOINT.md` §2، `SERIES_05_RC_PREFLIGHT_REPORT.md`، `SERIES_06_RELEASE_SAFETY_REPORT.md`، `SERIES_06_PRODUCTION_EQUIVALENCE_MATRIX.md`.
- سياسة الموافقات: `docs/handoff/STOCKMIND_AI_CONTINUITY.md` قسم E.

---

## 13. قايمة الفحص المسبق قبل أول deploy للـ candidate (قراءة فقط — لمشغّل مصرّح)

> **الحالة: NOT RUN على أي قاعدة حقيقية.** ما اتصلناش بـ Production ولا Neon في أي مرحلة. الاستعلامات دي بتتشغّل بموافقة الـ Director، والنتايج بتتسجّل في سجل الأدلة (القسم 10). الـ migrations بتتشغّل أوتوماتيك وقت الـ boot (`migrationsRun: true`)، فـ **الـ deploy = الـ migrate**.

```sql
-- 1) إيه اللي اتطبّق فعلاً؟ (المتوقع على production المبلّغ عنه: 4 migrations، آخرها SamlSso1722000000000)
SELECT id, "timestamp", name FROM migrations ORDER BY id;

-- 2) هل جدول FCM موجود بالفعل؟ لو موجود، CREATE TABLE في 1722345600000 هيفشل والـ batch كله يتراجع. المتوقع: NULL
SELECT to_regclass('public.user_fcm_tokens');

-- 3) إصدار PostgreSQL (المشروع محتاج 13+ أصلاً: gen_random_uuid() في Phase1Foundation وغيره) وصلاحية الإنشاء. المتوقع: 13+ و true
SHOW server_version;
SELECT has_schema_privilege(current_user, 'public', 'CREATE');

-- 4) أحجام الجداول (تقدير زمن backfill الـ revisions وبناء الـ index)
SELECT (SELECT count(*) FROM stock_movements) AS movements,
       (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM warehouses) AS warehouses;

-- 5) لو الأعمدة الجديدة موجودة (بيئة بعد 1792560000000): تكرار revisions لازم يبقى صفر صفوف
SELECT warehouse_id, revision, count(*) FROM stock_movements WHERE revision IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
```

**قبل الـ boot الأول:**
1. خد backup/branch/restore point من مزوّد الـ DB وسجّله (القسم 10). ده طريق الرجوع الحقيقي؛ `down()` مش طريق رجوع.
2. شغّل **instance واحدة** بس في أول boot (مفيش advisory lock حوالين الـ migrations، قسم الفرضيات في تقرير Series 06).
3. `uuid-ossp` **لم يعد شرطاً**: مفيش migration بيستخدمه.
4. بعد الـ boot: فحوصات القسم 3 (أ) و(ب) و(ج) لازم تطلع صفر صفوف، والـ trigger `trg_stock_movements_assign_revision` والـ index `uq_stock_movements_warehouse_revision` موجودين.