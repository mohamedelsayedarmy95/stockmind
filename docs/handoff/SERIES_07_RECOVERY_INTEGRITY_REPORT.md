# STOCKMIND — SERIES 07 REPORT: Recovery Integrity & Safe Re-entry (S1 + S2)

> التاريخ: 2026-10-24/25 · الفرع: `feature/series07-recovery-integrity` (من `6d4613b`) · الـ worktree: `D:\Projects\StockMind-wt\series07-recovery-integrity`
> المنفّذ: Claude (`claude-sonnet-5-5`) بتفويض Director صريح لـ **S1 + S2 فقط**. **Production = NO-GO.** لا merge، لا release branch، لا deploy، لا Neon/Production، لا AAB/Play، لا Council/موديل خارجي.
> التصنيفات: `VERIFIED / PARTIAL / UNVERIFIED / NOT DONE`. العقد التقني: `SERIES_07_RECOVERY_CONTRACT.md`. إجراء المشغّل: الـ runbook v0.3 §14–15.

## 1. الحكم

**SERIES 07 — PASS (للنطاق المفوَّض، على بيئة تطوير)، مع جهاز حقيقي PARTIAL.**

- **S1 (تعويض آمن):** VERIFIED على PostgreSQL حقيقية (32 اختبار مخصص + سباقات + negative controls) وعلى Huawei لتدفق كامل واحد.
- **S2 (history generation):** VERIFIED على PostgreSQL وعلى الجهاز (اكتشاف تغيّر generation بعد restore + rotation). **بشرط فهم حدّه:** الـ marker جوه القاعدة فبيتراجع مع restore؛ الكشف الفعلي بيعتمد على **خطوة مشغّل صريحة**، ومفيش ادّعاء بالعكس.
- **اللي ما اتأكدش:** تدفقات جهاز معيّنة (§6)، Production/Neon، جهازين، iOS، مراجعة خارجية، تدريب المشغّل على الإجراء.

## 2. اللي اتبنى

| البند | الوصف |
|---|---|
| Migration `1792590000000-RecoveryIntegrity` | عمودين + جدولين (provenance وأحداث rotation) + `down()` fail-closed. الـ migrations بقت 10. |
| Backend | `HistoryGenerationService` (rotate/current/events)، `StockReplacementService` (قرار ذرّي)، تمديد `getChanges` (generation/floor/no-store)، تمديد الـ lookup (generation، superseded، coexisting)، `RecoveryController`، `ReplaceOperationCommand/Handler`، `MANAGE_RECOVERY`، exception filter بـ `code`. إعادة هيكلة صغيرة: `StockService.applyMovementInTransaction` (نفس الكتابة، بتتشارك مع التعويض). |
| Mobile | cursor فيه generation؛ `replacement.ts` (دومين نقي)؛ `outbox-replacement.ts` (runtime)؛ شاشة `outbox-review`؛ حالة `REPLACED`؛ إعادة فحص العمليات الضايعة/المتعوّضة؛ i18n عربي/إنجليزي؛ إزالة الـ re-entry القديم غير المحمي. |
| لا تغيير | اعتماديات (`package.json`/lockfiles صفر فرق)، كود Series 06 migrations، `main`، RC، Production. |

التفاصيل والـ API والـ transaction والضمانات: **العقد**.

## 3. Invariants (I1–I10)

| # | كيف اتضمن | الدليل |
|---|---|---|
| I1 مفيش replay تلقائي | `absent` بيروح NEEDS_REVIEW مش PENDING؛ `nextToSend` ما بيلمسوش؛ التعويض بس بقرار بشري | `outbox-reconcile.test`, `replacement.test`, PG |
| I2 السيرفر هو الرصيد | الإيصال القديم معروض منفصل ومش بيتجمع؛ `pendingEffects` بيحسب التعويض كإيصال مؤكد لحد الـ sync | `replacement.test`; device (Oil 51 / 47) |
| I3 قرار بشري | `acknowledge:true` + Alert تأكيد + JWT + صلاحية الحركة + صلاحية المخزن | validation spec؛ device ✓ |
| I4 دلالات الحالات | جدول العقد §7؛ `absent` = "مش في السجل الحالي"؛ النص بيقول "مش معناه إنها محصلتش" | `replacement.test` (copy) |
| I5 ذرّية | fence على مفتاح الأصل + قفل generation/grant + كتابة وprovenance في commit واحد | سباقات PG (8 متزامنة، 12 جولة أصل/تعويض، rotation متزامن) + N1–N3 |
| I6 provenance | `stock_replacements` + ملاحظة السيرفر + audit + `original_claim` | PG |
| I7 أمان | tenant/warehouse/user key-space، revoked access، audit بدون credentials | PG security + lookup tests |
| I8 ضمانات صادقة | العقد §5–6: حدود L1–L7 مكتوبة، ومفيش ادّعاء كشف restore تلقائي | وثائق |
| I9 offline | التعويض محتاج فحص أونلاين حديث؛ الـ cursor بيحمل generation؛ مفيش انتقال صامت بين generations | `stock-sync-generation.test`; device |
| I10 توافق | إضافات فقط للـ API؛ عميل قديم: floor-reset مرة؛ superseded = indeterminate | PG (legacy test) + suite كاملة خضرا |

## 4. السيناريوهات المطلوبة (§7 في التفويض)

| السيناريو | PG | Mobile domain | جهاز |
|---|---|---|---|
| العملية الأصلية بتختفي | ✔ | ✔ | ✔ |
| العميل يكتشف تغيّر السجل | ✔ (generation/floor/anchor) | ✔ | ✔ |
| الأصل absent | ✔ | ✔ | ✔ |
| مستخدم مخوَّل يطلب التعويض | ✔ | ✔ | ✔ |
| النجاح بمفتاح جديد | ✔ | ✔ | ✔ |
| محاولات متزامنة | ✔ (8 بمفاتيح مختلفة؛ 8 بنفس المفتاح) | — | NOT DONE |
| الأصل بقى present قبل الإرسال | ✔ (+12 جولة سباق) | ✔ | NOT DONE |
| timeout بعد الـ commit | ✔ (replay) | ✔ | ✔ (الـ proxy قطع الرد بعد 201) |
| kill للتطبيق قبل التأكيد | — | ✔ (SENDING→UNKNOWN، نفس المفتاح) | ✔ (force-stop ثم إعادة التشغيل) |
| سحب صلاحية Staff أثناء المراجعة | ✔ (404، لا شيء اتسجّل) | — | NOT DONE |
| restore تاني يرجّع الأصل | ✔ (coexisting و replacement-missing) | ✔ | NOT DONE |
| إيصالات في generations مختلفة | ✔ | ✔ | ✔ (إيصال a5816268 مقابل فحص 1d194ac4) |
| عميل قديم بعد تغيّر generation | ✔ (floor) | — | NOT DONE |

## 5. نتائج الاختبار الفعلية

| الفحص | النتيجة |
|---|---|
| Backend `tsc --noEmit` | exit 0 |
| Build نضيف (بعد حذف `*.tsbuildinfo` و`dist`) | exit 0؛ `dist/main.js` ✓؛ **10/10 migrations** مترجمة؛ `migration-guards.js` ✓ |
| Backend PG كامل ×3، كل مرة على DB جديدة (HEAD `b3d824f`، شجرة كود نضيفة) | **51/51 suites، 347/347 tests** ×3، exit 0 ×3 |
| الحساب | 313 (Series 06) + 32 (recovery) + 2 (migration: 17→19) = **347**؛ suites 50 + 1 = **51** |
| `recovery-integrity.pg.spec.ts` لوحده | 32/32 |
| Negative controls (backend) | 6/6 أحمر: N1 بلا fence (4 فشلوا)، N2 بلا فحص generation (2)، N3 بلا فحص الـ ledger (1)، N4 مقارنة generation في sync (3)، N5 بلا floor (1)، N6 بلا علم coexistence (1) — `series07-evidence/negative-controls-backend.txt` |
| Mobile `tsc --noEmit` | exit 0 |
| Mobile Jest | **16/16 suites، 252/252** (203 قبل: +49: `replacement.test` 40، `stock-sync-generation.test` 9) |
| Negative controls (mobile) | 4 أحمر (تجاهل generation، إسقاط المفتاح عند timeout، مفتاح تاني لنفس القرار، عرض التعويض والأصل present)؛ تجربة خامسة ما غيّرتش النتيجة (guard مكرر) واتسجلت كده |
| اعتماديات | `package.json`/lockfiles: صفر فرق عن `6d4613b` |

اللوجات: `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_s07_*.log`، ملخص: `series07-evidence/backend-gate-summary.txt`.

### أخطاء وفشل أثناء التطوير (بصراحة)
- **اتكشف بالاختبارات:** تغييري في `GlobalExceptionFilter` كان بيمرّر `details` لكل الاستثناءات وبيسرّب driver messages من health 503 (`health.contract.spec` وقع)؛ اتحصر على الاستثناءات اللي معاها `code`. fake الـ transaction في `stock-cache.consistency.spec` احتاج يرد على الـ SQL الجديد (إضافة fixture مش إضعاف assertion). مشكلة شكل `UPDATE … RETURNING` في TypeORM (`[rows, affected]`)، وbody اختبار غير ثابت (timestamp) خلّى الـ hash يتغير، وإدخال يدوي بـ `running_balance=0` لوّث اختبارات تالية — كلها أخطاء كتابة اختبار/كود اتصلحت.
- **اتكشف بالجهاز بس (Jest ما كشفهوش):** تعارض مفاتيح i18n — الـ object الجديد `online.outbox.review` اتكتب على نفس مفتاح نص `review` المستخدم في الـ banner (مفتاح JSON مكرر، الأخير بيكسب) فشاشة المخزون اتكسرت بـ "returned an object instead of string". اتصلح بتغيير الاسم لـ `reviewFlow` وأُضيف اختبار بيفشل على أي مفتاح مكرر في ملفات اللغة. **ده سبب إن اختبار الجهاز لازم.**
- أخطاء بيئة: تلف ترميز `outbox.ts` من أمر PowerShell (اتعالج بإعادة الترميز وفُحص الـ diff بحيث ما فيهوش تغييرات غير مقصودة)؛ junction الـ `mobile/node_modules` ما اشتغلش مع Metro فاتعمل نسخة حقيقية؛ token الجهاز (4 ساعات) انتهى أثناء انقطاع الجلسة فاحتاج re-auth. ولا تشغيلة full-suite فشلت بعد الإصلاحات ولا فيه flaky ملاحظ.
- لاحظت `"1 actions need your review"` (جمع إنجليزي) — قبل Series 07 (مفاتيح `_one` موجودة)، سببه غير مفحوص: UNVERIFIED.

## 6. الجهاز الحقيقي (Huawei JSN-L22، debug build من Metro، backend محلي مؤقت، بيانات synthetic)

تدفق واحد كامل (البصمة دايماً من الـ Director): تسجيل دخول Staff (2FA) ← Dispatch Oil −4 (revision 3) ← محاكاة restore للقاعدة المؤقتة (revision 2) + **rotation** بالـ endpoint + كتابة Manager reuse لـ revision 3 ← فتح المخزن: "The server rebuilt its stock history"، Oil = 51 (رقم السيرفر)، banner مراجعة ← قائمة العمليات: "Needs review · …no longer contains this confirmed action… not re-sent automatically" ← شاشة المراجعة: الإيصال القديم (history `a5816268`) منفصل عن "Confirmed stock on the server 51" و"Server check: Not in the server's current history… history `1d194ac4`" ← "Replace as a new action" ← Alert تأكيد ← الـ proxy قطع الرد بعد `201` ← "Replacement sent · the answer was lost" مع "Retry the same request" ← force-stop وإعادة تشغيل ← التطبيق سأل السيرفر بمفتاح التعويض ← **Oil = 47** (حركة واحدة −4)، والقائمة: "Replaced · the server recorded a new movement for it. Original action `4ea564c5`… Replaced by movement `d42541cc`".
السيرفر: `stock_replacements` صف واحد، حركة واحدة ملاحظتها `Replacement of action 4ea564c5 …`، الأصل مش في الـ ledger. الدليل: `series07-evidence/device-run-ledger.txt` + 4 لقطات شاشة (اللقطات اللي ظهر فيها overlay تطبيق تاني محفوظة محلياً فقط).

**ما لم يُجرَّب على الجهاز (UNVERIFIED):** زرار "Retry the same request" (الحسم حصل بالـ lookup قبله)، سيرفر بطيء (delay)، الواجهة العربية (مغطاة بالاختبارات للنصوص فقط)، تبديل الحساب، سحب الصلاحية، ضغطتين، حالات الرفض (stale/present…)، جهازين (**لا** يُعتبر اختبار جهازين).

## 7. المخاطر والشروط غير المتحققة

1. **R-restore (L1):** استرجاع صورة قديمة بيرجّع الـ generation والـ provenance كمان؛ الحماية = إجراء المشغّل + كشف coexisting، **مش** منع. (HIGH قبل Production؛ بيحتاج سياسة تشغيل معتمدة.)
2. **R-ops:** الـ rotation إجراء يدوي ممكن يتنسي؛ مفيش اكتشاف لنسيانه؛ مفيش step-up؛ مفيش مسار SQL مختبَر؛ ما اتدرّبش على قاعدة حقيقية. (HIGH)
3. **R-claims:** تفاصيل الأصل ادّعاء عميل. (LOW—مفيش تصعيد صلاحية.)
4. **R-legacy:** عملاء قدام ممكن يعملوا re-entry غير مرتبط بالأصل. (MEDIUM؛ rollout ينسّق ترقية الأجهزة.)
5. **R12 (TLS `rejectUnauthorized:false`)**، الفحص المسبق على Neon (runbook §13)، release line، 3 ملفات `main` المتّسخة: **كما هي، مفتوحة** (لم تُلمس).
6. **R7/R8** (منح مخازن، plans): لم تُلمس (CP-4/CP-5 خارج النطاق).
7. ما حصلتش مراجعة خارجية (RA-4 غير ممنوح، Council degraded)، ولا اختبار على Production/Neon.

## 8. شروط Production — لا تزال NO-GO

R12؛ تنفيذ قايمة الفحص المسبق على قاعدة حقيقية بتفويض؛ قرار الـ release line (Series 06 §8)؛ سياسة تشغيل معتمدة للـ rotation + تدريب + backup/restore point؛ ترقية الـ mobile على الأجهزة قبل تفعيل المخازن المشتركة؛ جهازين/iOS/Redis/Google Sign-In؛ مراجعة مستقلة؛ قرار Director على CP-4/CP-5.

## 9. الخطوة التالية المقترحة (توصية، مش تفويض)

**Series 08 — "Operational readiness of recovery" (بدون Production):** (أ) بروفة كاملة للإجراء §14 على قاعدة غير إنتاجية (فرع Neon مؤقت بتفويض منك) تشمل restore فعلي، rotation، وقياس زمن؛ (ب) تقييم R12 (`rejectUnauthorized:true`) في نفس البيئة؛ (ج) جهازين حقيقيين على سيناريو التعويض (متزامن/سحب صلاحية)؛ (د) قرار الـ release line. بدائل: CP-4/CP-5، أو مراجعة خارجية للـ S1/S2 لو وافقت على `APPROVE-EXTERNAL-REVIEW`.
