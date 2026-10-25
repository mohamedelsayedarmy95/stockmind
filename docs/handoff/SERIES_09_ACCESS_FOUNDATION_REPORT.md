# STOCKMIND — SERIES 09 REPORT: Access Foundation (S0 خصوصية التكلفة + S1 دورة حياة الأعضاء)

> الفرع: `feature/series09-access-foundation` (worktree `D:\Projects\StockMind-wt\series09-access-foundation`، من `af7f61f` = Series 08). **لا merge، لا Production/Neon، لا AAB، لا جهاز.**
> التفاصيل التقنية والعقد: `SERIES_09_AUTHORIZATION_AND_PRIVACY_CONTRACT.md`. الأدلة: `series09-evidence/`.

## 1. الحكم

| الشريحة | الحكم | ملاحظة |
|---|---|---|
| **S0** خصوصية التكلفة | **PASS للنطاق** (بيئة تطوير، PostgreSQL حقيقية، HTTP حقيقي) | الاستغلال اتأكد تشغيلياً قبل الإصلاح، واتقفل بعده، مع اكتشاف إضافي (الـ audit). |
| **S1** دورة الحياة والإبطال | **PASS للنطاق — backend VERIFIED، mobile VERIFIED بـ unit tests فقط** | مفيش اختبار جهاز (قرار أمان من الـ Director)، فسلوك الشاشات على Huawei = **DEFERRED — DIRECTOR PHYSICAL UNLOCK REQUIRED**. |
| Production | **NO-GO** (بدون تغيير) | مفيش اتصال بـ Neon/Production. |

## 2. S0 — إثبات الاستغلال قبل الإصلاح (الخطوة الأولى الإلزامية)
بيئة: PG 15 محلية مؤقتة، شركة/مستخدمين/منتج synthetic، قيمة `7351.25`. الملف: `series09-evidence/s0-before-fix.json`.
- `GET /products` و`GET /products/:id`: **Staff** (وManager وAdmin) استلموا `costPrice` مفكوك التشفير. شركة تانية: لا شيء.
- `POST /products`، `PATCH`، `POST /products/:id/image`: الرد كامل فيه التكلفة لمن يملك الصلاحية.
- **اكتشاف جديد D10:** `audit_logs` فيها **4 صفوف بالقيمة بالنص الصريح** (request وresponse) — بيكسر تشفير التخزين لأي قارئ للـ audit.
- `PATCH` بـ `costPrice` كان 400 أصلاً (الـ DTO مفيهوش الحقل) — ما اتغيّرش.
**بعد الإصلاح** (`s0-after-fix.json`): المفتاح غايب لـ Manager وStaff على كل المسارات، موجود لـ Admin؛ `Vary: Authorization`؛ **0** صف audit فيه القيمة؛ المفتاح محفوظ بـ `[REDACTED]`.

## 3. اللي اتبنى
**S0:** `toProductResponse` (allowlist؛ يشيل `deletedAt/deletedBy` ويمنع تسريب أعمدة جديدة)، صلاحية `item.view_cost` (Admin فقط افتراضياً؛ منح صريح بدور مخصّص مُختبَر)، `PermissionService.userHas`، redaction في الـ audit بطبقتين. Manager يحتفظ بكتابة التكلفة عند الإنشاء.
**S1 backend:** migration `1792600000000` (status، token_version، is_owner، trigger آخر owner، `membership_events`)؛ `JwtStrategy` بيقرأ صف العضو كل طلب (الدور من الـ DB)؛ `tv` في التوكنز؛ رفض الدخول/التجديد للموقوف بكود `ACCESS_REVOKED`؛ `assertActorActive` (`FOR SHARE`) جوه transaction الحركات والتعويض وتدوير الـ generation؛ `MembershipService` + سياسة نقية + 6 endpoints؛ seats لا تحسب المحذوفين.
**S1 mobile:** شاشة Team (Admin/online)، `team-actions` (مرآة نقية)، التعامل مع `ACCESS_REVOKED` في الـ outbox (يتحجز للمراجعة ولا يُرسل تلقائياً بعد إعادة التفعيل)، رسالة هادئة عند الدخول، مفاتيح i18n عربي/إنجليزي.

## 4. الاختبارات (الأرقام الفعلية)
| الفحص | النتيجة |
|---|---|
| Backend `tsc` / build نضيف (مسح `*.tsbuildinfo` و`dist`) | exit 0 / exit 0، `dist/main.js` ✓، **11/11 migrations** |
| **Backend PG كامل ×3 على قواعد جديدة** (آخر commit مختبَر `3b9bb69`) | **54 suites passed + 2 skipped، 395 passed + 2 skipped في كل تشغيلة، exit 0 ×3** (الـ baseline قبل Series 09: 51/347؛ +3 suites، +48 اختبار) |
| `financial-privacy.pg.spec.ts` (NT-12) | 14/14 |
| `access-lifecycle.pg.spec.ts` | 15/15 (NT-32، NT-35/36، NT-37، الفجوة داخل الـ transaction) |
| `membership-policy.spec.ts` | 14/14 |
| `release-safety.migration.pg.spec.ts` | 24/24 (19 + 5: backfill، trigger، تزامن، down() fail-closed) |
| Mobile `tsc` + Jest | exit 0 · **18/18 suites، 273/273** (الـ baseline 252؛ +21) |
| الـ 2 skipped | `s0-cost-exposure.repro` و`auth-lookup.perf` (بيشتغلوا بـ `S09_EVIDENCE_OUT` وأرقامهم في الأدلة) |

**Negative controls (كلها أحمر — `negative-controls.txt`/`-mobile.txt`):** backend: M0 (S0: التكلفة دايماً ظاهرة) 4 أحمر؛ M1 تجاهل status (1)؛ M2 تجاهل token_version (4)؛ M3 الدور من الـ claim (1)؛ M4 بلا فحص جوه transaction الكتابة (1)؛ M5 نفس الشيء للتدوير (1)؛ M6 التعليق بلا إبطال (2)؛ M7 إلغاء شرط الـ owner (4)؛ M8 login يتجاهل status (2). mobile: 4 أحمر (3، 1، 1، 1). **ملاحظة صدق:** M1 كانت خضراء في أول تشغيل (التعليق كان بيرفع `token_version` فبيتغطى)، فأضفنا اختبار "status لوحده" وبعدها احمرّت.

**أداء الفحص لكل طلب** (`s1-auth-lookup-perf.json`، PG على نفس الجهاز، A/B متبادل 1000 طلب لكل جانب): الوسيط 2.05 → 2.37 ms (**+0.33 ms**)، p95 +0.18 ms؛ الاستعلام لوحده 0.23 ms (index scan على الـ PK). على قاعدة بعيدة يضاف زمن الشبكة (1–20 ms تقريباً). **بدون cache عمداً.**

## 5. أخطاء وقت التطوير (مفصّلة بصدق)
- `event_type` في `membership_events` كان `role_change` في الـ CHECK و`change_role` في الكود ← 500 على تغيير الدور (اتكشف بأول تشغيل لاختبار HTTP؛ اتصلح قبل أي commit مشترك).
- 4 fixtures قديمة اتأثرت بالقرار المقصود (JwtStrategy بقى بيحتاج DataSource؛ transaction الحركات بقت بتقرأ صف المستخدم؛ fixture الـ refresh بلا `status`) واتعدّلت بحدود ضيقة؛ نسخة production-equivalence (frozen) ما اتلمسش fixture بتاعها — بدل كده فحص الـ status في `refreshTokens` بيتسامح مع كائن بلا `status` (العمود NOT NULL فمفيش أثر حقيقي).
- 429 من الـ throttler في قياس الأداء (100/دقيقة) ← استُبدل storage الـ throttler في spec القياس فقط.
- PowerShell 5.1 أفسد ترميز ملف العقد (قراءة/كتابة بدون UTF-8) واتصلح بعكس التحويل قبل أي commit.

## 6. الجهاز (Huawei)
**ما اتلمسش.** مفيش adb ولا Metro ولا تثبيت، حسب قاعدة السلامة (المدير عن بُعد بلا وصول فيزيائي). السيناريوهات دي **DEFERRED — DIRECTOR PHYSICAL UNLOCK REQUIRED**، ومش مثبتة بأي نتيجة emulator: شاشة Team على الجهاز؛ سحب صلاحية أثناء جلسة مفتوحة؛ توافق الـ outbox على الجهاز؛ العربي/RTL للشاشة الجديدة. **الـ Jest بيغطي المنطق النقي فقط (لا component tests).** اكتمال الـ Series ما اعتمدش على المدير.

## 7. المخاطر المتبقية والحدود
1. **audit قديم:** صفوف `audit_logs` الأقدم ممكن تحتوي التكلفة بالنص الصريح في أي بيئة اشتغل فيها الإصدار القديم؛ تنظيفها إجراء مشغّل لم يُنفَّذ (يحتاج تفويض). `VIEW_AUDIT_LOG` بلا endpoint قراءة.
2. **شركات بدون owner:** أي شركة فيها 0 أو ≥2 Admin بعد الـ migration لا يقدر أي Admin فيها يدير Admin تاني؛ العلاج اجراء مشغّل بدليل. **لم تُفحص أي قاعدة حقيقية.**
3. **Manager فقد رؤية التكلفة** (تضييق مقصود حسب RBAC spec) — لازم يتبلّغ العملاء؛ المنح الصريح بدور مخصّص.
4. **نافذة تغيير الدور:** الفحص جوه الـ transaction بيغطي الحالة (active) مش الدور؛ كتابة اتجازت الـ guard بدور قديم ممكن تكمل (ملّي ثانية). التعليق نفسه مغلق بالكامل.
5. **الإيميل المحذوف** مش بيتدعى من جديد (الإرجاع = reactivate)؛ ده قيد مقبول لحد قرار منتج.
6. **جلسة refresh واحدة لكل مستخدم (D7):** لسه، وبقت أثرها أوضح (إنهاء جلسات يقفل كل الأجهزة). مش مختبَر بجهازين.
7. **الموبايل:** وضع online ما زال dev-preview؛ حقل التكلفة في شاشة تعديل المنتج (لـ online/API) ما اتخفاش بحسب الصلاحية (الخادم هو المانع)، ومفيش UI لتاريخ أحداث العضو (الـ API موجود).
8. `membership_events` append-only بـ trigger على UPDATE فقط (الحذف ممكن لمستخدم DB) — لا ادعاء tamper-proof.
9. لا RLS، لا مراجعة خارجية.

## 8. التوافق
إضافات فقط؛ التوكنز القديمة بلا `tv` شغّالة لحد أول إبطال؛ `costPrice` بيغيب لغير المخوّلين (تغيير سلوك للـ Manager/Staff)؛ ثلاث حالات خطأ جديدة بكود `ACCESS_REVOKED`. لا اعتماديات اتغيّرت، لا تغيير في `package*.json`.

## 9. الخطوة التالية المقترحة (توصية، مش تفويض)
**Milestone: Series 10 = "Access Foundation Part 2": S2** (قدرات ومنح بنطاق + `/me/capabilities` + قاعدة CP-4 + Manager بنطاق) **مسبوقة بمراجعة/اختبار جهاز لـ Series 09** عند توفر المدير فيزيائياً (Team screen + سحب صلاحية أثناء جلسة)، ومعها قرار تنظيف الـ audit القديم. بالتوازي (غير كودي): Milestone R بتفويضاتك.
