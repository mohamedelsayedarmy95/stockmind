# STOCKMIND — AI BRIDGE (ChatGPT ↔ Claude)

> الملف ده قناة التواصل الدائمة بين ChatGPT (مراجع/مخطط، من غير وصول للـ filesystem) وClaude (المنفّذ على الجهاز). الـ Director هو اللي بيحمل الملف بينهم.
> اللغة: عربي مصري، والمصطلحات التقنية والمسارات والأوامر وأرقام الـ commits بالإنجليزي زي ما هي.
> **القاعدة الأساسية:** حالة الـ Git والكود الفعلي أقوى من أي حاجة مكتوبة هنا. الملف ده خريطة وتقرير، مش إثبات.
> التصنيفات: `VERIFIED / PARTIAL / UNVERIFIED / BLOCKED / FAILED / DEFERRED`.

> ## ⚠ المكان الرسمي لهذا الملف (ACTIVE CANONICAL)
> **الفرع:** `preflight/series05-rc-admission` — **المسار:** `D:\Projects\StockMind-wt\series05-rc-preflight\docs\handoff\STOCKMIND_AI_BRIDGE.md`
> **أي نسخة من الملف ده على `integration/series04` (worktree `series04-integration`) أقدم وغير سارية** (v1.0 @ `84faa31`). ماتقراش منها. نسخة الـ Desktop مطابقة لهذه النسخة بالـ SHA-256.

---

## 00 — BRIDGE METADATA

| البند | القيمة |
|---|---|
| المشروع | StockMind (inventory / WMS SaaS) |
| إصدار الملف | **v1.1** (بعد Series 05) |
| آخر تحديث | **2026-10-24 22:03 +03:00** (Egypt Standard Time) |
| الـ session | `bdd72b49-7508-48ee-87ac-66e7899a24da` (Claude Code Desktop، موديل `claude-sonnet-5-5`؛ Series 02–04 بموديل `claude-opus-5-5`). مفيش identifiers حساسة اتسجلت. |
| المرحلة الحالية | **Series 05 — RC Admission Preflight: مكتملة.** في انتظار قرار الـ Director. |
| الحالة | ACTIVE |
| Canonical | `D:\Projects\StockMind-wt\series05-rc-preflight\docs\handoff\STOCKMIND_AI_BRIDGE.md` على `preflight/series05-rc-admission` |
| Desktop mirror | `C:\Users\Name\Desktop\StockMind_Handoff\STOCKMIND_AI_BRIDGE.md` (نسخة مطابقة) |
| **Verified baseline (مؤشر Git)** | الفرع `preflight/series05-rc-admission`، **آخر commit كود/اختبارات = `e20cf93`** (اتحقق منه 2026-10-24 ~22:00 وكان الـ worktree نضيف). فوقه commits **docs فقط** اتعملت بعد التحقق: `de5cf63` (التقرير والـ runbook) + commit الـ bridge/الـ master (آخر commit يلمس هذا الملف: `git -C D:\Projects\StockMind-wt\series05-rc-preflight log -1 --format=%h -- docs/handoff/STOCKMIND_AI_BRIDGE.md`). للتأكد إنها docs فقط: `git diff --name-only e20cf93 HEAD`. الملف مبيقدرش يكتب hash الـ commit بتاعه. |

---

## 01 — EXECUTIVE PROJECT STATUS

- **آخر milestone مكتمل:** Series 05 — preflight لقبول `integration/series04` كأساس RC. **القرار: RC ADMISSION = CONDITIONAL GO. PRODUCTION = NO-GO.** (التفاصيل في `docs/handoff/SERIES_05_RC_PREFLIGHT_REPORT.md`.)
- **الفرع/الـ worktree الفعلي دلوقتي:** `preflight/series05-rc-admission` @ baseline `e20cf93` (انظر قسم 00 للتحقق). أُنشئ من `integration/series04` @ `84faa31` (اللي اتحقق إنه متزامن ومفيش كود اتغيّر فيه بعد `d69f6e8`).
- **جاهزية:** تطوير: نعم. مراجعة إصدار: بعد قرار الـ Director على قسم 08. Production: **لا**.
- **قدرات VERIFIED (مضاف في Series 05):** الترقية من schema الـ **Production** الحقيقي (أول 4 migrations) إلى الـ candidate في تشغيلة واحدة بدون فقد بيانات؛ backfill صلاحيات Staff داخل الشركة فقط؛ revisions متسلسلة بدون فجوات؛ انتهاء الدعوات؛ تكافؤ إصلاحات الـ production الأمنية الستة (قسم 05 والتقرير §2-ج).
- **أهم النتائج:**
  1. الـ candidate إضافات فقط فوق الـ RC (123 ملف، صفر حذف، الاعتماديات والإعدادات مطابقة للـ RC) والدمج مع الـ RC بدون conflicts.
  2. خط الـ production hotfix `bb071ed` **مش ancestor**: دمجه بيدّي **11 conflict** (الإصلاحات اتعاد تنفيذها)، لكن السلوك متكافئ بالأدلة.
  3. الـ migrations الجديدة ليها 3 مخاطر مؤكدة: `down()` مدمّر ويعيد توسيع صلاحيات Staff؛ migration الـ FCM بيحتاج `uuid-ossp`؛ rollback التطبيق بيسيب حركات بلا revision.
  4. ملفات الـ Director المتّسخة في `main` بتتعارض مع الـ candidate (3 ملفات) — ماتدمجش فيه.
- **فجوات حرجة متبقية:** جهازين، iOS، Redis حقيقي، واجهة فريق على الموبايل، billing، safeguards الاسترداد S1+S2، منح صلاحيات المخازن الجديدة، تثبيت plans العملاء قبل أي enforcement.

---

## 02 — DIRECTOR & AI COLLABORATION CONTRACT

**الأدوار:** **Director** = صاحب المنتج والسلطة النهائية على الموافقات. **ChatGPT** = مراجع ومخطط مستقل، مفيش عنده وصول للـ filesystem، وتوصياته استشارية. **Claude** = Lead Engineer على الجهاز: يفحص الـ repo، ينفّذ المعتمد، يختبر، يحافظ على الـ state، ويكتب تقارير قابلة للتحقق. اقتراح مكتوب في الملف ده **مش إذن** ببدء مرحلة.

**أولويات الـ Director:** SaaS تجاري freemium، مخازن مشتركة وصلاحيات، دقة محاسبية، offline-first آمن، UX راقي، ميزات شغالة فعلاً، اختبارات حقيقية، تكلفة منخفضة (free tier أولاً).

**شروط الموافقة (لازم Director صراحةً ومن جديد):** أي Android AAB (build/upload) أو Google Play/Internal Testing؛ أي Production deploy/promotion/migration/config؛ أي merge أو force-push على `main` أو `rc4/release-candidate` أو branches الـ release؛ مشاركة كود المشروع مع موديل خارجي (`APPROVE-DELEGATION` / `APPROVE-COUNCIL` / `APPROVE-EXTERNAL-REVIEW` بكتابته هو؛ RA-4 غير ممنوح؛ الـ Council degraded)؛ خدمات مدفوعة؛ تثبيت بصلاحيات admin؛ تغيير config لـ Claude/MCP/FreeLLMAPI. مسموح بدون سؤال داخل المرحلة المعتمدة: Debug APK + ADB + جهاز حقيقي، worktrees معزولة، commit/push (بدون force) على الفروع الـ feature/integration/preflight.

**Mandatory start/end protocol** (التفاصيل في `docs/handoff/STOCKMIND_AI_CONTINUITY.md`):
- **البداية:** اقرأ `AGENTS.md` ← الـ master ← **الـ bridge ده (النسخة الرسمية فقط، قسم 00)** ← الـ checkpoint/التقرير المطلوب فقط. بعدين فحص Git ضيق (الأوامر في الـ master). لو تعارض مع الـ Git، الـ Git يكسب والملفات تتصحح.
- **النهاية (كل milestone):** حدّث الأقسام 00–10 وأضف سطراً لـ 11، أضف commits ونتايج فعلية وفشلاً إن حصل، حدّد الخطوة التالية، حدّث الـ master لو الحالة/القواعد اتغيرت، انسخ للـ Desktop، **وتحقق من SHA-256 كامل لكل زوج**، وبلّغ بأمانة عن أي فشل حفظ.
- **قاعدة جديدة (Series 05):** لما الشغل يتحرك لفرع/worktree جديد، **انقل المكان الرسمي للـ bridge والـ master للفرع الجديد** واكتب صراحةً في الأعلى إن النسخ القديمة على الفروع التانية stale.
- **قاعدة الـ metadata:** اكتب مؤشر Git كـ "verified baseline" بتاريخه، واشرح أي commits docs لاحقة، ولا تكتب HEAD كأنه حالي.

**سياسة توفير الـ tokens:** قراءة ضيقة، أقل عدد أدوات، لا subagents أو Council بدون سبب وموافقة، والـ bridge بيشاور على المستندات الكبيرة.

---

## 03 — CURRENT TASK

- **المهمة المعتمدة (اكتملت):** Series 05 — "Enterprise RC Admission Preflight & Recovery Safety Review" (تطوير فقط، worktree معزول).
- **الهدف:** تحديد هل الكود المتكامل في `integration/series04` صالح تقنياً يبقى RC جاي، بأدلة: تكامل، migrations، سلامة المخزون والاسترداد، أمان، واختبارات حقيقية.
- **المخرجات (اتسلّمت):** `docs/handoff/SERIES_05_RC_PREFLIGHT_REPORT.md` · `docs/handoff/STOCKMIND_DATABASE_RECOVERY_RUNBOOK.md` · spec جديد `tests/integration/rc-admission.migration.pg.spec.ts` · اختبار انتهاء الدعوة · إصلاح harness · تحديث الـ bridge والـ master · نسخة Desktop.
- **الحالة:** **مكتملة.** القبول: التقرير فيه توصية صريحة (CONDITIONAL GO للـ RC، NO-GO للـ Production)، والـ runbook موجود، و3 تشغيلات كاملة خضرا.
- **مستبعد (ما اتعملش):** merge فعلي، أي تغيير في كود التطبيق أو الـ migrations أو الاعتماديات، history-epoch، Production/Neon، AAB/Play، Council/موديل خارجي، اختبار جهاز، تفعيل entitlements.

---

## 04 — CHANGES MADE

**على الفرع `preflight/series05-rc-admission` (اختبارات ووثائق فقط — صفر تغيير في `src/` أو `mobile/` أو الـ migrations):**

| Commit | نوعه | التغيير |
|---|---|---|
| `5184831` | test | `rc-admission.migration.pg.spec.ts` (ترقية من schema الإنتاج + 3 اختبارات توصيفية للمخاطر) + اختبار انتهاء الدعوة في `shared-warehouse.pg.spec.ts` |
| `e20cf93` | test | `shared-warehouse.migration.pg.spec.ts` بقى بيثبّت `uuid-ossp` بنفسه (كان بيفشل لو اشتغل لوحده أو اتجدول بدري)؛ + إثبات SQL إصلاح الـ NULL revisions |
| `de5cf63` | docs | التقرير + الـ runbook |
| (آخر commit) | docs | الـ bridge v1.1 + تحديث الـ master |

- **مفيش** migrations جديدة ولا تغييرات API. اتساب كما هو عمداً: `integration/series04`، `rc4`، `main` المتّسخ، كود التطبيق، الاعتماديات، اللوجو.
- مراحل سابقة (Series 04) في `docs/handoff/SERIES_04_CHECKPOINT.md` §2.

---

## 05 — TESTS & VERIFICATION

| الفحص | النتيجة | المستوى |
|---|---|---|
| Backend `tsc --noEmit` | exit 0 (على `84faa31` وعلى الشجرة النهائية) | build |
| Backend `npm run build` نضيف | exit 0، `dist/main.js`، 8 migrations | build |
| Mobile `tsc --noEmit` + Jest | exit 0 · **14/14 suites، 203/203** | unit |
| Backend PG — baseline على الـ candidate بدون تعديل | **41/41 suites، 255/255** (85.6 ث) | real PG 15.19 مؤقتة |
| Backend PG — بعد إضافة الاختبارات | **FAILED**: 1 suite / 3 tests (`shared-warehouse.migration.pg.spec`: `uuid_generate_v4() does not exist`) — اعتماد خفي قديم على ترتيب الـ specs، اتحلّل ولم يُعاد لحد ما يخضر | PG |
| Backend PG — **الشجرة النهائية، 3 تشغيلات متتالية** على DBs جديدة | **42/42 suites، 264/264** ×3 | PG |
| specs الـ production الستة غير المعدّلة على كود الـ candidate | 2 نجحوا (7/7)؛ 4 ما اشتغلوش (TS2554 ×3 تغيّر constructor، وتجهيز Nest ×1) — نسخ الـ candidate منها بتعدّي | unit |

**ما لم يُختبر (UNVERIFIED / NOT DONE):** الجهاز (ما اتغيّرش كود تطبيق)، جهازين، iOS، Redis حقيقي، Neon/Production (وجود `uuid-ossp` هناك)، Google Sign-In، online transfer على الجهاز، أداء الـ backfill على جداول كبيرة.
**الـ Evidence:** `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_s05_*.log` و`s05-final3.summary.txt`؛ الجهاز: `docs/handoff/series04-evidence/`.

---

## 06 — GIT & ENVIRONMENT STATE

- **الفرع الرسمي:** `preflight/series05-rc-admission` (worktree `D:\Projects\StockMind-wt\series05-rc-preflight`) — baseline `e20cf93` + commits docs (قسم 00). حالة الرفع على `origin`: تُذكر في الرد النهائي للـ session (يتحقق منها `git ls-remote --heads origin preflight/series05-rc-admission`).
- **باقي الـ worktrees (لم تتغيّر):** `integration/series04` @ `84faa31` · `rc4/release-candidate` @ `1447ade` · `feature/series03-sync` @ `55348a6` · `feature/shared-warehouse` @ `02c53f5` · `mobile/offline-outbox` @ `ac9ba6b` (session worktree) · `mobile/shared-sync` @ `905f535` · `hotfix/rc41-credential-redaction` @ `bb071ed` · `main` @ `45d9e18` (متّسخ).
- **Production المبلّغ عنه:** `release/prod-hotfix-f4` @ `bb071ed` (الـ ref موجود على origin بنفس الـ SHA؛ تشغيله فعلاً = UNVERIFIED).
- **ملفات محمية (main المتّسخ):** معدّل: `DEPLOYMENT_CHECKLIST.md`، `tests/integration/notification.flow.spec.ts`. غير متتبّع: `.ai-handoff/`، `PHASE_7_CHECKLIST.md`، `scripts/`، `tests/integration/stock-cache.invalidation.spec.ts`، `Glossy Neon Inventory Analytics Icon.png`. **ثلاثة منها بتتعارض مع ملفات tracked في الـ candidate** (`DEPLOYMENT_CHECKLIST.md`، `notification.flow.spec.ts`، `stock-cache.invalidation.spec.ts`)؛ ماتدمجش ولا تعمل checkout في ذلك الـ tree. ثلاث commits محلية غير مرفوعة في `main` (`6967d46`, `bcf5832`, `45d9e18`: FCM/Redis/checklist) موجودة جوه الـ RC والـ candidate.
- **خدمات:** كل حاجة متوقفة: PostgreSQL المؤقت (55433) اتوقف والقواعد `stockmind_gate_s05_*` اتحذفت؛ 3000/3001/8081 فاضيين. جهاز Android واحد ظاهر في `adb` وقت البدء؛ مفيش `adb reverse` اتعمل.
- **بيئة:** Node `v26.7.0`، npm `11.19.0`، PostgreSQL `15.19`، Jest 30.4.1 (backend) / 29.7.0 (mobile). `node_modules` للـ worktree الجديد junctions على worktrees تانية (قراءة فقط).
- **قيود الأدوات (ملاحظات الـ session):** `freellmapi` كان `ECONNREFUSED` وقت بدء الـ session (ما اتأعاد فحصه)؛ الـ AI Council degraded (RA-4 غير ممنوح)؛ ما استُخدمش أي تفويض خارجي.
- **تغيير في أدوات/تبعيات/config:** مفيش.

---

## 07 — RISKS, BUGS & DEFERRED WORK  (التفاصيل والأدلة: التقرير §3 و§5 و§7)

| # | الخطورة | النوع | الوصف | الحل المؤقت |
|---|---|---|---|---|
| R1 | عالية | CONFIRMED | `down()` للـ migrations `1792560000000`/`1792570000000` بيمسح grants/دعوات/idempotency keys/plans، وإعادة `up()` بتمنح كل Staff كل مخازن شركته (توسيع صلاحيات) | ممنوع `migration:revert` على Production |
| R2 | عالية | CONFIRMED (حد معروف) | restore يتعكس بعد re-entry ← duplicate؛ عنصر `history-changed` ما بيتعادش فحصه | الـ runbook + re-entry بشري؛ safeguards S1/S2 |
| R3 | متوسطة | CONFIRMED | migration `1722345600000` محتاج `uuid-ossp` (ما بيتنشئش في أي migration؛ التطبيق بيثبّته وقت الاتصال). لو غايب: الـ upgrade كله بيتراجع ذرّياً | فحص `pg_extension` على Production بمشغّل مصرّح (UNVERIFIED) أو CP-2 |
| R4 | متوسطة | CONFIRMED | rollback التطبيق لإصدار قديم بيسيب حركات بلا `revision` لا يرجّعها أي delta | SQL إصلاح مجرّب في الـ runbook §8 |
| R5 | متوسطة | CONFIRMED | خط production `bb071ed` مش ancestor (11 conflict) رغم التكافؤ السلوكي | CP-1 |
| R6 | متوسطة | CONFIRMED | 3 ملفات متّسخة في `main` بتتعارض مع الـ candidate | دمج في worktree نضيف بقرار الـ Director |
| R7 | متوسطة | CONFIRMED | مخازن جديدة بعد الـ rollout مش ظاهرة للـ Staff الحاليين ومفيش UI للمنح | CP-4 |
| R8 | متوسطة | CONFIRMED | كل الشركات الحالية `free` (1 seat/1 warehouse): enforcement بدون تثبيت plans هيمنع الإضافات | ماتفعّلش `ENTITLEMENTS_ENFORCED` قبل CP-5 |
| R9 | منخفضة | CONFIRMED | فهرس الـ revision مش unique؛ `stock_idempotency_keys` بلا cleanup؛ runtime الموبايل بلا اختبارات آلية | CP-2 / مقترحات S3/S5 |
| R10 | منخفضة | HYPOTHESIS | قفل backfill على جداول كبيرة؛ instances متزامنة؛ الإيميل case-sensitive؛ cursor أقدم من الـ restore ما بيتعلّمش reset | مراقبة |
| R11 | معلومة | UNVERIFIED | حالة Production الفعلية؛ Neon؛ جهازين؛ iOS؛ Redis؛ Google Sign-In | بدون |
| R12 | معلومة | CONFIRMED | اتصال DB بـ `rejectUnauthorized:false` (قديم وموجود في production)، والـ AI assistant بيبعت prompts لـ Hugging Face | مراجعة لاحقة |

**مؤجل (DEFERRED):** production deploy / RC promotion / AAB وGoogle Play / billing / iOS / Redis حقيقي / تبنّي اللوجو / history epoch / Viewer role / multi-org / واجهة فريق على الموبايل.

---

## 08 — DIRECTOR APPROVALS REQUIRED

لا إذن مطلوب لإغلاق Series 05. القرارات دي قبل المرحلة القادمة:

1. **(القرار الرئيسي) اعتماد Series 06** = "مصالحة خط الإصدار + تقوية الـ migrations" (التقرير §8: CP-1 + CP-2) في فرع جديد من `preflight/series05-rc-admission`. *الأكثر أماناً:* بناء release line من الـ candidate وعدم دمج `bb071ed` آليّاً، مع مصفوفة تكافؤ موقّعة. *بديل:* دمج `bb071ed` وحل الـ 11 conflict يدوياً.
2. **ملفاتك المتّسخة في `main`:** اعمل commit/backup لنسختك، وقرر أي نسخة تبقى لكل واحد من التلاتة المتعارضين؛ وقرر مصير الـ 3 commits المحلية (FCM/Redis/checklist) اللي هتتنشر مع الـ RC.
3. **فحص قراءة فقط على Production** (`SELECT extname FROM pg_extension`) لتأكيد `uuid-ossp` — محتاج مشغّل مصرّح؛ مفيش اتصال بـ Production اتعمل.
4. **مراجعة خارجية حقيقية؟** من غير `APPROVE-EXTERNAL-REVIEW` وRA-4 وتشغيل FreeLLMAPI: مفيش، ولا هنفترض إنها حصلت.
5. **موبايل تاني / iOS (macOS أو EAS مدفوع):** مؤجلين لقرارك.
6. أي حاجة تخص Production / AAB / Google Play: ممنوعة لحد أمر منفصل وبوابات release.

---

## 09 — NEXT RECOMMENDED ENGINEERING TASK  (توصية فقط — مش مُصرَّح بها)

**Series 06 — RC release-line reconciliation + migration hardening** (التقرير §8: CP-1 + CP-2).
- **ليه ده الأول:** هو اللي بيفتح الطريق للـ RC promotion، وبيقفل مخاطر الـ migrations قبل ما أي حاجة تلمس Production.
- **الشروط المسبقة:** قرار الـ Director (قسم 08 بند 1)؛ worktree جديد نضيف من `preflight/series05-rc-admission`؛ تشغيل PG المؤقت.
- **الحدود:** مفيش merge في `rc4`/`main`/branches الإصدار، مفيش push على محمي، مفيش force، مفيش deploy أو AAB أو Production/Neon، مفيش لمس لـ `main` المتّسخ. تغيير migrations مسموح فقط داخل نطاق CP-2 وبـ gates الموسّعة.
- **بوابات القبول:** (CP-1) استراتيجية موثّقة + مصفوفة تكافؤ للإصلاحات الستة + ما فيش force-push. (CP-2) `1722345600000` بلا اعتماد على امتداد خارجي؛ `down()` يرفض مع وجود بيانات؛ حماية/إصلاح NULL revisions؛ (اختياري) فهرس unique جزئي بعد فحص التكرار؛ **3 تشغيلات كاملة متتالية على DBs جديدة**؛ `up/down/up` على نسخة بيانات synthetic؛ تحديث التقرير والـ bridge.

---

## 10 — MESSAGE FOR CHATGPT

**اللي حصل:** Series 05 خلصت. الحكم: **RC admission = CONDITIONAL GO، Production = NO-GO**. الـ candidate `integration/series04` إضافات فقط فوق الـ RC، بدون drift في الاعتماديات، ودمجه مع الـ RC نضيف. اتضاف spec جديد (ترقية من schema الإنتاج + توصيف مخاطر) واختبار انتهاء دعوة، واتصلّح اعتماد خفي في الاختبارات. 3 تشغيلات كاملة خضرا (42/42، 264/264).

**نقاط ضعف محتملة في الأدلة (راجعها):**
1. الاختبارات على PostgreSQL 15.19 مؤقتة وبيانات synthetic — مش Neon ولا بيانات حقيقية.
2. التكافؤ مع إصلاحات الـ production معتمد على: patch-id (2 مطابق)، وتطابق عناوين الـ specs وكونها بتعدّي، وتشغيل specs الـ production غير المعدّلة (2 فقط اشتغلوا). الأربعة التانيين فشلوا في الترجمة/التجهيز بسبب تغيّر الـ constructors. هل ده كافي لتوقيع مصفوفة التكافؤ؟
3. فشل تشغيلة كاملة حصل فعلاً أثناء المرحلة (spec-order) واتصلّح في الاختبارات فقط. الأخضر الأول (baseline) كان بترتيب جدولة محظوظ.
4. المخاطر المؤكدة R1–R4 اتوصّفت باختبارات "توصيفية" بتسجّل الخطر، ولو اتصلّح الخطر لازم تتحدّث عمداً.
5. ما حصلتش أي مراجعة خارجية مستقلة، ولا اختبار جهاز في الـ phase دي.

**أسئلة تحسمها قبل توصيتك:**
- استراتيجية الـ promotion: release line جديدة من الـ candidate، أم دمج `bb071ed` بحل الـ 11 conflict؟
- هل CP-2 (تعديل migration `1722345600000` اللي لم يُطبّق على Production، و guard لـ `down()`) مقبول كنطاق Series 06، ولا نقسمه؟
- أولوية S1/S2 (safeguards الاسترداد) مقابل CP-4 (منح المخازن) قبل أي تفعيل online؟
- هل الـ runbook (مسودة) مناسب كأساس سياسة Production؟ إيه اللي ناقص؟
- معايير قبول Series 06 كافية؟

**في الـ prompt التنفيذي القادم ضمّن:** اسم المرحلة، الفرع الأساسي (`preflight/series05-rc-admission`)، acceptance بالأرقام، الموافقات المسموحة، وقائمة الممنوعات (AAB/Play/Production/merge على main أو RC). وأشِر بوضوح إن Claude يقرأ الـ bridge من المكان الرسمي (قسم 00).

---

## 11 — CHANGELOG (append-only)

- **2026-10-24 20:40 +03:00 — v1.0:** إنشاء الـ bridge أثناء الـ onboarding على `integration/series04` (HEAD وقتها `eb19ab0`). تصحيح صف `integration/series04` في الـ master. لا تغيير في الكود.
- **2026-10-24 22:03 +03:00 — v1.1:** نهاية Series 05. نقل المكان الرسمي للـ bridge والـ master إلى `preflight/series05-rc-admission`. تقرير + runbook + اختبارات (baseline `e20cf93`). الحكم: RC CONDITIONAL GO / Production NO-GO. مفيش تغيير في كود التطبيق أو الـ migrations.

---

## 12 — SOURCE-OF-TRUTH REFERENCES

| الموضوع | المسار |
|---|---|
| Master continuity (الرسمي) | `D:\Projects\StockMind-wt\series05-rc-preflight\docs\handoff\STOCKMIND_AI_CONTINUITY.md` · نسخة: `C:\Users\Name\Desktop\StockMind_Handoff\STOCKMIND_AI_CONTINUITY_MASTER.md` |
| تعليمات الـ agents | `D:\Projects\StockMind-wt\series05-rc-preflight\AGENTS.md` |
| تقرير Series 05 | `D:\Projects\StockMind-wt\series05-rc-preflight\docs\handoff\SERIES_05_RC_PREFLIGHT_REPORT.md` |
| Recovery runbook (مسودة) | `D:\Projects\StockMind-wt\series05-rc-preflight\docs\handoff\STOCKMIND_DATABASE_RECOVERY_RUNBOOK.md` |
| Series 04 checkpoint + evidence | `docs\handoff\SERIES_04_CHECKPOINT.md` و`docs\handoff\series04-evidence\` (داخل نفس الـ worktree) |
| Series 03 checkpoint (backup) | `D:\StockMind_Backups\Checkpoints\SERIES_03_CHECKPOINT_2026-10-20.md` (SHA-256 `B555D4D2…26A6`) |
| Series 02 وما قبله (قراءة فقط) | `D:\Projects\StockMind\.ai-handoff\` |
| لوجات الاختبار | `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_s05_*.log` |
| دليل المستخدم / resume / تنضيف C: | `C:\Users\Name\Desktop\StockMind_Handoff\` (`StockMind_USER_MANUAL.md`، `StockMind_RESUME_CHECKPOINT.md`، `C_DRIVE_CLEANUP_REPORT.md`) |
| قواعد التفويض العامة | `C:\Users\Name\.claude\ORCHESTRATION.md` |
| اللوجو (محجوز، لا يُعدَّل) | `D:\Projects\StockMind\Glossy Neon Inventory Analytics Icon.png` |
| تعليمات الإصدار | لا يوجد ملف release جاهز؛ Production NO-GO وAAB/Play ممنوعين بدون أمر منفصل (master قسم E) |
