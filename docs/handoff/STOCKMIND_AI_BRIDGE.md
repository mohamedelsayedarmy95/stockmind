# STOCKMIND — AI BRIDGE (ChatGPT ↔ Claude)

> الملف ده قناة التواصل الدائمة بين ChatGPT (مراجع/مخطط، من غير وصول للـ filesystem) وClaude (المنفّذ على الجهاز). الـ Director هو اللي بيحمل الملف بينهم.
> اللغة: عربي مصري، والمصطلحات التقنية والمسارات والأوامر وأرقام الـ commits بالإنجليزي زي ما هي.
> **القاعدة الأساسية:** حالة الـ Git والكود الفعلي أقوى من أي حاجة مكتوبة هنا. الملف ده خريطة وتقرير، مش إثبات.
> التصنيفات: `VERIFIED / PARTIAL / UNVERIFIED / BLOCKED / FAILED / DEFERRED`.

> ## ⚠ المكان الرسمي لهذا الملف (ACTIVE CANONICAL)
> **الفرع:** `hardening/series06-release-safety` — **المسار:** `D:\Projects\StockMind-wt\series06-release-safety\docs\handoff\STOCKMIND_AI_BRIDGE.md`
> **النسخ الأقدم غير سارية (stale):** على `preflight/series05-rc-admission` (v1.1 @ `e517d82`، worktree `series05-rc-preflight`) وعلى `integration/series04` (v1.0 @ `84faa31`، worktree `series04-integration`). ماتقراش منهم. نسخة الـ Desktop مطابقة لهذه النسخة بالـ SHA-256.

---

## 00 — BRIDGE METADATA

| البند | القيمة |
|---|---|
| المشروع | StockMind (inventory / WMS SaaS) |
| إصدار الملف | **v1.2** (بعد Series 06) |
| آخر تحديث | **2026-10-24 22:52 +03:00** (Egypt Standard Time) |
| الـ session | `bdd72b49-7508-48ee-87ac-66e7899a24da` (Claude Code Desktop، `claude-sonnet-5-5`؛ Series 02–04 بـ `claude-opus-5-5`). مفيش identifiers حساسة. |
| المرحلة الحالية | **Series 06 — Release-Line Reconciliation & Migration Safety Hardening: مكتملة.** في انتظار قرارات الـ Director. |
| الحالة | ACTIVE |
| Canonical | `D:\Projects\StockMind-wt\series06-release-safety\docs\handoff\STOCKMIND_AI_BRIDGE.md` على `hardening/series06-release-safety` |
| Desktop mirror | `C:\Users\Name\Desktop\StockMind_Handoff\STOCKMIND_AI_BRIDGE.md` (مطابق) |
| **Verified baseline (مؤشر Git)** | الفرع `hardening/series06-release-safety`: **آخر commit كود/اختبارات/migrations = `9b1f9dd`** (قاعدة `e517d82`؛ commits الكود: `d12b810` ← `ba16cec` ← `9b1f9dd`). الـ gates النهائية اشتغلت على HEAD = `cac4f4e` والشجرة نضيفة (الفرق بينهم docs فقط، اتأكد: `git diff --name-only 9b1f9dd cac4f4e` ما فيهوش ملفات خارج `docs/`). بعد كده commit handoff واحد (التقرير + الـ master + الـ bridge). للتأكد في أي وقت: `git -C D:\Projects\StockMind-wt\series06-release-safety diff --name-only 9b1f9dd HEAD`. الملف مبيقدرش يكتب hash الـ commit بتاعه. |

---

## 01 — EXECUTIVE PROJECT STATUS

- **آخر milestone مكتمل:** Series 06 (CP-1 + CP-2). التقرير: `docs/handoff/SERIES_06_RELEASE_SAFETY_REPORT.md`؛ المصفوفة: `docs/handoff/SERIES_06_PRODUCTION_EQUIVALENCE_MATRIX.md`.
- **CP-1 = PASS (6 من 6):** كل إصلاح من إصلاحات الـ production الستة (`e4cac4c` F4، `64f73b9` إخفاء credentials، `586c0a9` Google verified e-mail، `104b3e3` اعتماديات، `3849f93` A1، `bb071ed` A3) له spec تنفيذي على الـ candidate + negative control (تشيل الحماية فيفشل). 8 suites / 40 tests.
- **CP-2 = PASS (على بيانات synthetic):** (A) الـ FCM migration ما بقاش يحتاج `uuid-ossp`؛ (B) `down()` للـ migrations `1792560000000` و`1792570000000` بقى fail-closed (يرفض قبل أي تعديل لو هيمسح دعوات/إيصالات/plans/صلاحيات معدّلة)؛ (C+D) migration جديدة `1792580000000`: trigger يرقّم أي حركة بلا revision، إصلاح NULL الموجودة، unique partial index بفحص تكرار مسبق؛ (E) مقارنة schema بين تثبيت جديد، وترقية من baseline الـ production المُعاد بناؤه، وبيئة اتشغّل فيها نص FCM القديم.
- **الاختبارات:** Backend على PostgreSQL حقيقية، **3 تشغيلات متتالية على قواعد جديدة: 50/50 suites، 313/313 tests** (exit 0 ×3). `tsc` وbuild النضيف exit 0 (9 من 9 migrations). Mobile `tsc` exit 0 وJest 14/14 suites، 203/203. الاعتماديات/lockfiles/إعدادات التطبيق مطابقة للمرحلة السابقة.
- **جاهزية:** **RC:** جاهز لتخطيط تنفيذ الـ release line، بشرط قرارات قسم 08 (ما اتدمجش حاجة). **Production: NO-GO.**
- **اللي لسه مفتوح (مهم):** R12 (TLS `rejectUnauthorized:false`)، S1+S2 (الاسترداد)، منح صلاحيات المخازن الجديدة، plans العملاء، فحص مسبق على Neon ما اتنفّذش، وجهازين/iOS/Redis/Google Sign-In.

---

## 02 — DIRECTOR & AI COLLABORATION CONTRACT

**الأدوار:** **Director** = صاحب المنتج والسلطة النهائية على الموافقات. **ChatGPT** = مراجع ومخطط مستقل بلا وصول للـ filesystem، وتوصياته استشارية. **Claude** = Lead Engineer على الجهاز: يفحص الـ repo، ينفّذ المعتمد، يختبر، يحافظ على الـ state، ويكتب تقارير قابلة للتحقق. اقتراح مكتوب في الملف ده **مش إذن** ببدء مرحلة.

**شروط الموافقة (لازم Director صراحةً ومن جديد):** أي Android AAB أو Google Play/Internal Testing؛ أي Production deploy/promotion/migration/config أو اتصال بقاعدة Production/Neon؛ أي merge أو force-push على `main` أو `rc4/release-candidate` أو branches الإصدار، وإنشاء/تحريك branch release؛ مشاركة كود المشروع مع موديل خارجي (`APPROVE-DELEGATION` / `APPROVE-COUNCIL` / `APPROVE-EXTERNAL-REVIEW` بكتابته هو؛ RA-4 غير ممنوح؛ الـ Council degraded)؛ خدمات مدفوعة؛ تثبيت بصلاحيات admin. مسموح بدون سؤال داخل المرحلة المعتمدة: Debug APK + ADB + جهاز حقيقي، worktrees معزولة، commit/push (بدون force) على فروع feature/integration/preflight/hardening.

**Mandatory start/end protocol** (التفاصيل: `docs/handoff/STOCKMIND_AI_CONTINUITY.md`):
- **البداية:** `AGENTS.md` ← الـ master ← **الـ bridge ده (النسخة الرسمية فقط، قسم 00)** ← التقرير/الـ checkpoint المطلوب فقط. فحص Git ضيق (الأوامر في الـ master). لو تعارض، الـ Git يكسب والملفات تتصحح.
- **النهاية (كل milestone):** حدّث الأقسام 00–10 وأضف سطراً لـ 11، أضف commits ونتايج فعلية وفشلاً إن حصل، حدّد الخطوة التالية، حدّث الـ master، انسخ للـ Desktop، **وتحقق من SHA-256 كامل لكل زوج**، وبلّغ بأمانة عن أي فشل حفظ.
- **نقل المكان الرسمي:** لما الشغل يتحرك لفرع/worktree جديد، انقل الـ bridge والـ master للفرع الجديد واكتب صراحةً في الأعلى إن النسخ القديمة stale.
- **مؤشر Git:** اكتبه كـ "verified baseline" بتاريخه وبـ commits docs اللاحقة؛ ماتكتبش HEAD كأنه حالي.
- **التحقق من البناء:** `exit 0` لوحده مش كفاية: امسح `*.tsbuildinfo` وافحص `dist/main.js` وعدد الـ migrations المترجمة (حصل في Series 06 build ناقص بـ exit 0).

**سياسة توفير الـ tokens:** قراءة ضيقة، أقل عدد أدوات، لا subagents أو Council بدون سبب وموافقة، والـ bridge بيشاور على المستندات الكبيرة.

---

## 03 — CURRENT TASK

- **المهمة المعتمدة (اكتملت):** Series 06 — CP-1 + CP-2 فقط، على فرع تطوير معزول، Production NO-GO.
- **الهدف:** (1) استراتيجية release line مثبتة بالدليل؛ (2) إثبات تكافؤ سلوكيات إصلاحات الـ production الستة؛ (3) تقوية الـ migrations بدون فقد بيانات أو توسيع صلاحيات؛ (4) اختبارات حقيقية؛ (5) تحديث الـ handoff.
- **المخرجات (اتسلّمت):** `SERIES_06_RELEASE_SAFETY_REPORT.md` · `SERIES_06_PRODUCTION_EQUIVALENCE_MATRIX.md` · runbook v0.2 · 3 migrations معدّلة + migration جديدة + helper · `release-safety.migration.pg.spec.ts` (17) · `tests/equivalence/production-bb071ed/` (40) · bridge v1.2 + master + نسخة Desktop.
- **الحالة:** **مكتملة.** القبول: كل إصلاح من الستة له دليل تنفيذي ونتيجة فعلية؛ وgates الـ DB/backend/mobile خضرا؛ ولا merge/branch إصدار/deploy/اتصال بـ Production.
- **مستبعد (ما اتعملش):** S1/S2، CP-4/CP-5، billing، Viewer role، multi-org، أي تغيير في كود التطبيق أو الاعتماديات، Council/موديل خارجي، AAB/Play، لمس `main` المتّسخ أو RC أو branches الإصدار.

---

## 04 — CHANGES MADE

| Commit | نوعه | التغيير |
|---|---|---|
| `d12b810` | fix(migrations) | `1722345600000`: `gen_random_uuid()` بدل `uuid_generate_v4()`؛ `down()` fail-closed في `1792560000000` و`1792570000000`؛ **جديد** `1792580000000-StockRevisionGuard`؛ **جديد** `src/shared/db/migration-guards.ts`؛ **جديد** `release-safety.migration.pg.spec.ts` (يحل محل `rc-admission.migration.pg.spec.ts`) |
| `ba16cec` | test | `tests/equivalence/production-bb071ed/` (specs الـ production الأصلية بتعديلات setup فقط + فحص lockfile + فحص wiring) + دليل التعديلات |
| `9b1f9dd` | docs(migrations) | تعليق دقيق في migration الـ FCM (بدون تغيير سلوك) |
| `cac4f4e` | docs | التقرير، المصفوفة، runbook v0.2 |
| (آخر commit) | docs | bridge v1.2 + master + تعديل التقرير (حادثة الـ build) |

- **Migrations/API:** migration جديدة واحدة (`1792580000000`)، ولا تغيير في API أو كود التطبيق أو الاعتماديات. الـ migrations بقت 9.
- **اتساب كما هو عمداً:** كل كود التطبيق والموبايل، `integration/series04`، `rc4`، `main` المتّسخ، فرع Series 05، الـ Production.
- التفاصيل والأسباب: التقرير §2 و§4.

---

## 05 — TESTS & VERIFICATION

| الفحص | النتيجة | المستوى |
|---|---|---|
| Backend `tsc --noEmit` | exit 0 | build |
| Backend build نضيف (بعد مسح `*.tsbuildinfo` و`dist`) | exit 0، `dist/main.js`، **9/9 migrations** + `migration-guards.js` | build |
| Mobile `tsc --noEmit` + Jest | exit 0 · **14/14 suites، 203/203** | unit |
| اختبارات التكافؤ | **8 suites، 40/40** | unit |
| `release-safety.migration.pg.spec.ts` لوحده | **17/17** | real PG 15.19 |
| **Backend PG كامل ×3 على قواعد جديدة (HEAD `cac4f4e`، شجرة نضيفة)** | **50/50 suites، 313/313 tests** في كل تشغيلة، exit 0 ×3 (~33 ث) | real PG |
| حزم/lockfiles/إعدادات | مطابقة لـ `e517d82` (`git diff --stat` فاضي) | — |
| Negative control (CP-1) | M1–M6: كل حماية تتشال ← الـ spec أحمر (2/5، 2/6، 5/6، 1/1، 3/8، 6/8 فشلوا) | mutation |
| Negative control (CP-2) | N1–N5: تشيل uuid-fix/guards/trigger/unique/pre-check ← أحمر (16، 4، 3، 8، 6 فشلوا) | mutation |

- **الحساب:** Series 05 كان 42 suites / 264 tests؛ −1/−8 (spec قديم اتشال) +1/+17 +8/+40 = **50 / 313** ✓.
- **فشل أثناء التطوير (أخطاء كتابتي للاختبارات/الأدوات، مش المنتج؛ مفصّلة في التقرير §5):** نوع helper، template literal فاضي بسبب PowerShell، mutation M6 أول مرة ما اتترجمتش، مسار `__dirname` بعد نقل ملف، ترميز سكربت. **و build ناقص بـ exit 0 بسبب `tsbuildinfo` قديم** (اتكشف بفحص `dist`). وتصحيح استنتاج: TypeORM `0.3.31` بينفّذ migration بـ timestamp أقدم (كنت فاكر العكس). **ولا تشغيلة كاملة فشلت ولا flaky.**
- **ما لم يُختبر:** الجهاز، جهازين، iOS، Redis حقيقي، Google Sign-In بعد تغيير مسار التحقق، Neon/Production (حالة الـ migrations الفعلية، وجود جدول FCM، الصلاحيات، إصدار PG)، `rejectUnauthorized:true` ضد Neon، أداء الـ backfill على جداول كبيرة، deadlock مع transfers قديمة متعاكسة.
- **الـ Evidence:** `docs/handoff/series06-evidence/equivalence-adaptation-diff.txt`؛ لوجات `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_s06_*.log` و`s06-final3.summary.txt`.

---

## 06 — GIT & ENVIRONMENT STATE

- **الفرع الرسمي:** `hardening/series06-release-safety` (worktree `D:\Projects\StockMind-wt\series06-release-safety`) — baseline `9b1f9dd` + docs. حالة الرفع على `origin`: في الرد النهائي للـ session (`git ls-remote --heads origin hardening/series06-release-safety`).
- **باقي الـ worktrees (VERIFIED نهاية المرحلة، لم تتغيّر):** `preflight/series05-rc-admission` @ `e517d82` · `integration/series04` @ `84faa31` · `rc4/release-candidate` @ `1447ade` · `main` @ `45d9e18` (origin `5b32df3`) · production reported `release/prod-hotfix-f4` @ `bb071ed` (ref على origin بنفس الـ SHA) · `feature/series03-sync` @ `55348a6` · `feature/shared-warehouse` @ `02c53f5` · `mobile/offline-outbox` @ `ac9ba6b`.
- **ملفاتك المتّسخة في `main` (VERIFIED بالـ SHA-256 إنها ما اتغيّرتش):** معدّل: `DEPLOYMENT_CHECKLIST.md`، `tests/integration/notification.flow.spec.ts`. غير متتبّع: `.ai-handoff/`، `PHASE_7_CHECKLIST.md`، `scripts/`، `tests/integration/stock-cache.invalidation.spec.ts`، `Glossy Neon Inventory Analytics Icon.png`. **ثلاثة منها بتتعارض مع ملفات tracked في الـ candidate**؛ ماتدمجش في ذلك الـ tree. 3 commits محلية غير مرفوعة في `main` (`6967d46`, `bcf5832`, `45d9e18`) موجودة جوه الـ RC والـ candidate.
- **خدمات:** PostgreSQL المؤقت اتوقف والقواعد المؤقتة اتحذفت (13)؛ 3000/3001/8081/55433 فاضية؛ `adb reverse` ما اتلمسش.
- **بيئة:** Node `v26.7.0`، npm `11.19.0`، TypeORM `0.3.31`، PostgreSQL `15.19`، git `2.56.0`. `node_modules` junctions على worktrees تانية (قراءة فقط).
- **قيود الأدوات:** `freellmapi` كان `ECONNREFUSED` في بداية الـ session (ما اتأعاد فحصه، ولا اتستخدم). الـ Council degraded (RA-4 غير ممنوح). ما استُخدم أي تفويض خارجي.
- **تغيير في أدوات/تبعيات/config:** مفيش.

---

## 07 — RISKS, BUGS & DEFERRED WORK  (التفاصيل: التقرير §6)

| # | الخطورة | الحالة | الوصف | الإجراء |
|---|---|---|---|---|
| ~~R-down~~ | — | **اتقفل** | `down()` مدمّر وبيوسّع صلاحيات Staff | fail-closed (VERIFIED) |
| ~~R-uuid~~ | — | **اتقفل** | الاعتماد على `uuid-ossp` | شالناه (VERIFIED) |
| ~~R-nullrev~~ | — | **اتقفل** | حركات بلا revision بعد rollback التطبيق | trigger + إصلاح + unique index (VERIFIED) |
| R1/R2 | عالية | **مفتوح** | restore يتعكس بعد re-entry ← duplicate؛ عنصر `history-changed` ما بيتعادش فحصه | S1 + S2 (runbook §11) قبل تفعيل المخازن المشتركة |
| R12 | عالية قبل Production | **مفتوح — قرار** | `rejectUnauthorized:false` لما `DB_SSL=true` في `app.module.ts` و`data-source.ts` (مطابق في production)؛ لم يُختبر ضد Neon | تفويض تقييم على branch غير إنتاجي |
| R7 | متوسطة | مفتوح | مخزن جديد بعد الـ rollout مش ظاهر للـ Staff + مفيش UI للمنح (وبيمنع `down()` كمان) | CP-4 قرار منتج |
| R8 | متوسطة | مفتوح | كل الشركات `free`؛ enforcement بدون تثبيت plans يمنع الإضافات | ماتفعّلش `ENTITLEMENTS_ENFORCED` قبل CP-5 |
| N2 | متوسطة | CONFIRMED (مقصود) | `1792580000000` بترفض الـ boot لو في تكرار revisions | الفحص المسبق (runbook §13) |
| N3 | متوسطة | UNVERIFIED | القايمة المسبقة على Neon ما اتنفّذتش | تفويض مشغّل مصرّح |
| R5 | متوسطة | مفتوح (قرار) | الـ production branch مش ancestor؛ دمج يدوي = 11 ملف / 21 hunk | الخيار A (المصفوفة §7) |
| R6 | متوسطة | مفتوح (قرار) | 3 ملفات متّسخة بتتعارض + 3 commits محلية هتتنشر مع الـ RC | قرارك |
| N1/N4/N5 | منخفضة | HYPOTHESIS/CONFIRMED | deadlock مع transfers قديمة؛ boot متزامن بأكتر من instance؛ `register()` بيسجّل رسالة خطأ ممكن تحمل إيميل | مراقبة |
| — | — | UNVERIFIED | الجهاز، جهازين، iOS، Redis، Google Sign-In (تغيّر مسار التحقق وبقى بلا فحص إبطال)، حالة Production | بدون |

**مؤجل (DEFERRED):** execution الـ release line، RC promotion، production deploy، AAB/Play، billing، iOS، Redis حقيقي، تبنّي اللوجو، S1/S2، CP-4/5/6، Viewer role، multi-org، واجهة فريق على الموبايل.

---

## 08 — DIRECTOR APPROVALS REQUIRED

1. **(الرئيسي) استراتيجية الـ release line:** الخيار **A** (موصى به): فرع release **جديد** من الـ candidate + `git merge -s ours --no-ff bb071ed` ثم fast-forward لفرع production (عملية إصدار بموافقتك). ومعاه **تجميد أي hotfix جديد** على فرع production. بدائل: B دمج يدوي (21 hunk)، D فرع production جديد مع تغيير مصدر النشر. (C force-push مرفوض.) الأدلة: المصفوفة §7.
2. **ملفاتك المتّسخة** (3 ملفات متعارضة) و**الـ 3 commits المحلية** (FCM/Redis/checklist) اللي هتتنشر مع الـ RC: commit/backup وقرار أي نسخة تبقى.
3. **تفويض فحص قراءة فقط** على قاعدة Production/Neon بقايمة runbook §13 (إيه اتطبّق، جدول FCM، إصدار PG، الصلاحيات، تكرار revisions) بواسطة مشغّل مصرّح، مع backup/restore point قبل أول boot.
4. **R12:** تفويض تقييم `rejectUnauthorized:true` ضد branch Neon **غير إنتاجي**.
5. **المرحلة التالية** (قسم 09) أو بديلها.
6. أي حاجة تخص Production / AAB / Google Play / Internal Testing: ممنوعة لحد أمر منفصل.

---

## 09 — NEXT RECOMMENDED ENGINEERING TASK  (توصية فقط — مش مُصرَّح بها)

**Series 07 — Recovery safeguards S1 + S2** (runbook §11) + قرار CP-4 (منح المخازن) في نفس الحزمة.
- **ليه:** أكبر فجوة تقنية قدام تفعيل المخازن المشتركة (R1/R2)، ومستقلة عن ميكانيكا الـ release line اللي محتاجة موافقاتك.
- **الشروط المسبقة:** قرارك على قسم 08 بند 5؛ worktree جديد من `hardening/series06-release-safety`؛ PG المؤقت.
- **الحدود:** مفيش merge أو deploy أو Production/Neon أو AAB/Play؛ gates كاملة (3 تشغيلات PG متتالية + mobile)؛ ما تلمسش `main` المتّسخ.
- **القبول:** (S1) قبل ما شاشة الـ re-entry تبعت، التطبيق يعمل `lookup` للـ key الأصلي ويمنع لو `present`؛ (S2) السيرفر يعرض `historyEpoch` بيتغيّر بإجراء مشغّل ويخلّي الأجهزة تعيد فحص الإيصالات فوراً؛ اختبارات domain وPG وجهاز؛ تحديث التقرير والـ bridge.

---

## 10 — MESSAGE FOR CHATGPT

**اللي حصل:** Series 06 خلصت. **CP-1 PASS 6/6**: كل إصلاح أمني من الـ production ليه spec تنفيذي على الـ candidate، ومعمول له negative control، وتعديلات الـ specs الأصلية setup فقط (دليل مولَّد: صفر assertion اتشال أو اتعدّل). **CP-2 PASS** على بيانات synthetic: شلنا اعتماد `uuid-ossp`، وخلّينا `down()` fail-closed، وأضفنا migration `1792580000000` (trigger + إصلاح + unique index). 3 تشغيلات PG كاملة خضرا (50/50 suites، 313/313).

**نقاط ضعف محتملة (راجعها):**
1. كل أدلة الـ DB على PostgreSQL مؤقتة وبيانات **مُعاد بناؤها** لـ baseline الـ production المبلّغ عنه؛ مفيش لمس لـ Neon، فحالته الفعلية UNVERIFIED (القايمة المسبقة لم تُنفَّذ).
2. تكافؤ إصلاح Google: السلوك المحمي (email_verified/401) اتأكد، لكن مسار التحقق اتغيّر (Firebase Admin ← google-auth-library) وبقى بلا فحص إبطال؛ ما اتجرّبش على جهاز.
3. `exit 0` للبناء كان مضلّلاً مرة (cache قديم) واتصلح بفحص `dist`: ناقش لو عايز خطوة build تمسح الـ buildinfo.
4. الـ trigger بيغطي الكتابة بدون revision لكن **rollback التطبيق لسه غير مدعوم كاستراتيجية رجوع** (الإصدار القديم مايعرفش الـ idempotency ولا صلاحيات المخازن).
5. ما حصلتش مراجعة خارجية مستقلة ولا اختبار جهاز في المرحلة دي.

**أسئلة تحسمها قبل توصيتك:**
- هل الخيار A (`-s ours` + fast-forward) كافٍ أم تفضّل B/D؟ وهل المصفوفة كافية كشرط له؟
- هل مقبول إن `1792580000000` توقف الـ boot لو في تكرار (بدل أن تكمل)؟ وهل تحب فحصه خطوة manual قبل الـ deploy؟
- أولوية R12 (TLS) مقابل Series 07 (S1/S2)؟ وهل تقييم TLS على branch Neon غير إنتاجي مقبول ضمن مرحلة مستقلة؟
- هل نكتفي بالـ unique partial index أم نضيف `NOT NULL` على `revision` بعد فترة؟
- معايير قبول Series 07 كافية؟

**في الـ prompt التنفيذي القادم ضمّن:** اسم المرحلة، الفرع الأساسي (`hardening/series06-release-safety`)، acceptance بالأرقام، الموافقات المسموحة، والممنوعات (AAB/Play/Production/merge على main أو RC أو branch إصدار). وأشِر إن Claude يقرأ الـ bridge من المكان الرسمي (قسم 00).

---

## 11 — CHANGELOG (append-only)

- **2026-10-24 20:40 +03:00 — v1.0:** إنشاء الـ bridge أثناء الـ onboarding على `integration/series04` (HEAD وقتها `eb19ab0`).
- **2026-10-24 22:03 +03:00 — v1.1:** نهاية Series 05. نقل المكان الرسمي إلى `preflight/series05-rc-admission`. الحكم: RC CONDITIONAL GO / Production NO-GO.
- **2026-10-24 22:52 +03:00 — v1.2:** نهاية Series 06. نقل المكان الرسمي إلى `hardening/series06-release-safety` (baseline كود `9b1f9dd`). CP-1 PASS 6/6، CP-2 PASS (synthetic)، PG ×3 = 50/313. النسخ على فرع Series 05 و`integration/series04` stale. مفيش merge ولا release branch ولا deploy.

---

## 12 — SOURCE-OF-TRUTH REFERENCES

| الموضوع | المسار |
|---|---|
| Master continuity (الرسمي) | `D:\Projects\StockMind-wt\series06-release-safety\docs\handoff\STOCKMIND_AI_CONTINUITY.md` · نسخة: `C:\Users\Name\Desktop\StockMind_Handoff\STOCKMIND_AI_CONTINUITY_MASTER.md` |
| تعليمات الـ agents | `D:\Projects\StockMind-wt\series06-release-safety\AGENTS.md` |
| تقرير Series 06 | `...\series06-release-safety\docs\handoff\SERIES_06_RELEASE_SAFETY_REPORT.md` |
| مصفوفة تكافؤ الـ production + استراتيجية الـ release line | `...\docs\handoff\SERIES_06_PRODUCTION_EQUIVALENCE_MATRIX.md` · الدليل: `...\docs\handoff\series06-evidence\` |
| Recovery runbook (v0.2، مسودة) | `...\docs\handoff\STOCKMIND_DATABASE_RECOVERY_RUNBOOK.md` |
| Series 05 (preflight) | `...\docs\handoff\SERIES_05_RC_PREFLIGHT_REPORT.md` |
| Series 04 checkpoint + evidence الجهاز | `...\docs\handoff\SERIES_04_CHECKPOINT.md` و`...\series04-evidence\` |
| Series 03 checkpoint (backup) | `D:\StockMind_Backups\Checkpoints\SERIES_03_CHECKPOINT_2026-10-20.md` (SHA-256 `B555D4D2…26A6`) |
| Series 02 وما قبله (قراءة فقط) | `D:\Projects\StockMind\.ai-handoff\` |
| لوجات الاختبار | `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_s06_*.log` |
| دليل المستخدم / resume / تنضيف C: | `C:\Users\Name\Desktop\StockMind_Handoff\` |
| قواعد التفويض العامة | `C:\Users\Name\.claude\ORCHESTRATION.md` |
| اللوجو (محجوز، لا يُعدَّل) | `D:\Projects\StockMind\Glossy Neon Inventory Analytics Icon.png` |
| تعليمات الإصدار | لا يوجد؛ Production NO-GO وAAB/Play ممنوعين بدون أمر منفصل (master قسم E) |
