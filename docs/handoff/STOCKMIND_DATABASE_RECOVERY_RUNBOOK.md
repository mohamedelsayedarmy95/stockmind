# STOCKMIND — DATABASE RECOVERY RUNBOOK

> **الحالة:** مسودة تشغيلية v0.1 — 2026-10-24 — اتكتبت أثناء Series 05 (RC admission preflight).
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

-- (ج) حركات بلا revision (كتبها إصدار قديم بعد rollback للتطبيق) — القسم 8
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
| `lookup` للتأكد من وجود الحركة قبل أي قرار | `migration:revert` على Production (القسم 8) |
| Acknowledge لحركة اتأكد إنها ضايعة عن قصد | حذف/تعديل `stock_idempotency_keys` أو إعادة استخدام Idempotency-Key لطلب مختلف (السيرفر بيرد 422) |
| Re-entry بشري بعد استيفاء قايمة الفحص تحت | `UPDATE/DELETE` يدوي على `stock_movements` أو `product_warehouse` لـ"تظبيط الأرقام" بدون تسوية مسجّلة |
| إيقاف الـ API أثناء الاستعادة والمقارنة | restore فوق Production من غير تجميد الكتابة |
| | تشغيل repair SQL (القسم 8) على Production من غير بروفة على نسخة + موافقة الـ Director |
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

> الـ migrations الجديدة (`1792560000000`, `1792570000000`) بتقول في تعليقاتها إن "rollback التطبيق مش محتاج تغيير schema". الاختبار (`rc-admission.migration.pg.spec.ts`) أثبت إن ده **ناقص**:

- **rollback التطبيق لإصدار قديم** بيكتب حركات **بلا `revision`** ومش بيزوّد `warehouses.stock_revision`. بعد الرجوع للإصدار الجديد، `GET /stock/changes` بيستخدم `revision > since` فالحركات دي **ماتظهرش في أي delta** (`VERIFIED`).
- **`migration:revert`** (الـ `down()`) **بيمسح** `warehouse_access` و`team_invitations` و`stock_idempotency_keys` وأعمدة `plan/subscription_status`، وإعادة `up()` بتمنح **كل Staff كل مخازن شركته** من جديد (توسيع صلاحيات!) (`VERIFIED`). **ممنوع على Production.**

لو حصل rollback تطبيق وفي حركات بلا revision — الـ repair ده (`VERIFIED` على PostgreSQL مؤقتة؛ **ممنوع على Production** إلا بعد بروفة على نسخة وموافقة الـ Director):

```sql
BEGIN;
SELECT id FROM warehouses WHERE id IN (SELECT DISTINCT warehouse_id FROM stock_movements WHERE revision IS NULL)
ORDER BY id FOR UPDATE;
WITH todo AS (
  SELECT id, warehouse_id, row_number() OVER (PARTITION BY warehouse_id ORDER BY created_at, id) AS rn
  FROM stock_movements WHERE revision IS NULL)
UPDATE stock_movements m SET revision = w.stock_revision + t.rn
FROM todo t JOIN warehouses w ON w.id = t.warehouse_id WHERE m.id = t.id;
UPDATE warehouses w SET stock_revision =
  COALESCE((SELECT max(m.revision) FROM stock_movements m WHERE m.warehouse_id = w.id), 0);
COMMIT;
```

بعده: أي جهاز عنده cursor قديم هياخد الحركات دي في الـ delta الجاي (اتأكد في الاختبار). شغّل فحوصات القسم 3 قبل وبعد.

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

> مفيش واحدة منها بتمنع **قبول الـ RC** (الـ online mode dev preview فقط، وبيتأكد في الكود من `__DEV__` + متغيرين). لكنها **شروط قبل تفعيل الـ shared warehouses / الـ online mode على Production**. دي مقترحات؛ مفيش أي منها اتنفّذ في Series 05.

| # | الحالة | ليه الـ runbook مش كفاية | acceptance criteria مقترحة |
|---|---|---|---|
| S1 | عنصر `history-changed` ما بيتعاد فحصه، فلو الـ restore اتعكس والمستخدم عمل re-entry يحصل duplicate | المستخدم مش هيعرف | قبل ما شاشة الـ re-entry تبعت، التطبيق يعمل `lookup` للـ key الأصلي؛ لو `present` يمنع ويشرح. اختبار domain + اختبار PG + تجربة جهاز |
| S2 | مفيش "restore marker" من السيرفر (history epoch)؛ الكشف بيعتمد على poll الجهاز أو بدء التطبيق، وجهاز cursor بتاعه أقدم من نقطة الـ restore مش بيتعلّم | نافذة زمنية يعرض فيها الجهاز إيصال confirmed قديم | السيرفر يعرض `historyEpoch` بيتغيّر بإجراء مشغّل، ويتبعت مع `/stock/changes`؛ تغيّره يخلّي الجهاز يعيد فحص كل الإيصالات فوراً. اختبار PG بيحاكي restore بدون رجوع cursor |
| S3 | تفرّد `(warehouse_id, revision)` بيعتمد على بروتوكول القفل مش على constraint (الفهرس `idx_stock_movements_warehouse_revision` مش unique) | أي bug أو كتابة خارج المسار يكسر الترتيب بصمت | unique partial index (`WHERE revision IS NOT NULL`) عبر migration إضافية مراجَعة؛ فحص التكرار قبل التطبيق؛ اختبارات التزامن ×3 |
| S4 | `down()` مدمّر + rollback التطبيق بيسيب NULL revisions | الإجراء اليدوي بيتنسى | `down()` يرفض لو في بيانات (إلا بمتغير صريح)؛ وفحص readiness/boot يفشل أو يصلّح تلقائياً لو في NULL revisions. اختبارات |
| S5 | `stock_idempotency_keys` بلا retention/cleanup | بتكبر، وأي cleanup لازم يتوافق مع فترة الإيصالات (7 أيام) ونافذة الـ restore | سياسة retention موثقة ≥ فترة الجهاز + نافذة الـ restore؛ job بيسيب الـ lookup يشتغل بالـ movement id (متحقق منه في الـ spec) |
| S6 | مفيش تقرير للمدير بالعمليات `history-changed` | المشغّل شغال بـ SQL فقط | endpoint/تقرير للـ Admin يلخّص الضايع per company من أدلة السيرفر |

---

## 12. المراجع

- الكود: `src/infrastructure/repositories/operation-lookup.service.ts`، `stock.service.ts` (`getChanges`)، `mobile/src/domain/outbox.ts` (`applyLookup`, `recheckCandidates`, `reentryDraft`, `prune`).
- الاختبارات: `tests/integration/operation-lookup.pg.spec.ts`، `sync-cursor-reset.pg.spec.ts`، `rc-admission.migration.pg.spec.ts`.
- التقارير: `docs/handoff/SERIES_04_CHECKPOINT.md` §2، `docs/handoff/SERIES_05_RC_PREFLIGHT_REPORT.md`.
- سياسة الموافقات: `docs/handoff/STOCKMIND_AI_CONTINUITY.md` قسم E.
