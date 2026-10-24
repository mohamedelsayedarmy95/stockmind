# STOCKMIND — AI BRIDGE (ChatGPT ↔ Claude)

> الملف ده قناة التواصل الدائمة بين ChatGPT (مراجع/مخطط، من غير وصول للـ filesystem) وClaude (المنفّذ على الجهاز). الـ Director هو اللي بيحمل الملف بينهم.
> اللغة: عربي مصري، والمصطلحات التقنية والمسارات والأوامر وأرقام الـ commits بالإنجليزي زي ما هي.
> **القاعدة الأساسية:** حالة الـ Git والكود الفعلي أقوى من أي حاجة مكتوبة هنا. الملف ده خريطة وتقرير، مش إثبات.
> التصنيفات المستخدمة: `VERIFIED / PARTIAL / UNVERIFIED / BLOCKED / FAILED / DEFERRED`.

---

## 00 — BRIDGE METADATA

| البند | القيمة |
|---|---|
| المشروع | StockMind (inventory / WMS SaaS) |
| إصدار الملف | **v1.0** (إنشاء أولي أثناء الـ onboarding) |
| آخر تحديث | **2026-10-24 20:40 +03:00** (Egypt Standard Time) |
| الـ session | `bdd72b49-7508-48ee-87ac-66e7899a24da` (Claude Code Desktop، موديل `claude-sonnet-5-5`؛ Series 02–04 اتعملت بموديل `claude-opus-5-5`). حساب Claude الحالي مختلف عن حسابات Series 04 (حسب كلام الـ Director). مفيش أي identifiers حساسة اتسجلت. |
| المرحلة الحالية | Onboarding على حساب جديد + إنشاء الـ bridge. **لا Series 05 ولا أي كود.** |
| حالة الملف | ACTIVE. **Canonical:** `D:\Projects\StockMind-wt\series04-integration\docs\handoff\STOCKMIND_AI_BRIDGE.md` |
| Desktop mirror | `C:\Users\Name\Desktop\StockMind_Handoff\STOCKMIND_AI_BRIDGE.md` (نسخة مطابقة بالـ SHA-256) |
| الـ commit الخاص بالملف نفسه | `git -C D:\Projects\StockMind-wt\series04-integration log -1 --format=%h -- docs/handoff/STOCKMIND_AI_BRIDGE.md` (الملف مش بيقدر يكتب hash الـ commit بتاعه) |

---

## 01 — EXECUTIVE PROJECT STATUS

**الحالة في جملتين:** الـ integration branch `integration/series04` جاهز للمراجعة من الـ Director. الـ gates الأخيرة (Series 04) كلها أخضر، ولسه مفيش حاجة اتعملها merge ولا deploy.

- **آخر milestone مكتمل:** Series 04 — دمج backend + mobile، وحل مشكلة الـ P0: لو الـ server database اتعملها restore واتمسحت عمليات كانت confirmed، الموبايل **مش بيعيد إرسالها أوتوماتيك**، وبيعرضها "Needs review · history changed" لحد ما إنسان يقرر.
- **الـ branch/HEAD الفعلي (VERIFIED دلوقتي):** `integration/series04` @ `eb19ab06618e8fa9509a94bbe26073f1ec835893`. متزامن مع `origin/integration/series04` (اتأكد بـ `git ls-remote`). الـ worktree نضيف.
  - آخر commit فيه **كود** هو `d69f6e8` (والـ gates اتشغلت عليه). كل اللي بعده (`bdc9fa7`, `37d4e22`, `322e8a0`, `e4880af`, `eb19ab0`) **docs فقط**. ده اتأكد دلوقتي بـ `git diff --name-only d69f6e8 HEAD` (النتيجة: `AGENTS.md` + `docs/handoff/*` + صور/ملفات الـ evidence فقط).
- **جاهزية:**
  - Development: **CONDITIONAL GO** (بشرط مراجعة الـ Director لـ semantics الـ P0).
  - Release review: لسه، بعد قرار الـ Director على استراتيجية الـ RC.
  - Production: **NO-GO / DEFERRED**. الـ online mode لسه dev preview فقط.
- **قدرات VERIFIED** (من Series 01–04، مش اتعادت في الـ onboarding ده؛ التفاصيل في قسم 05):
  - عزل الـ tenant والـ RBAC والـ warehouse scope (real PostgreSQL).
  - الـ idempotent writes، الـ concurrent dispatch، الـ atomic transfer (real PG).
  - Login + 2FA + قبول الدعوة على الموبايل (جهاز حقيقي).
  - Live sync بالـ revision cursor + anchors + reset (PG + جهاز).
  - الـ offline outbox: إرسال مرة واحدة بالظبط، سيرفر بطيء، استمرار بعد kill للتطبيق (جهاز واحد + API client).
  - مصالحة الـ restore (P0) على PG وعلى الجهاز.
- **الفجوات الحرجة المتبقية:** مفيش اختبار على جهازين فعليين، iOS عمره ما اتبنى، Redis الحقيقي ما اتجربش، مفيش واجهة إدارة الفريق على الموبايل (API بس)، مفيش billing حقيقي، ومفيش runbook لعملية الـ restore، والـ RC لسه ما اتدمجش مع الخط ده.

---

## 02 — DIRECTOR & AI COLLABORATION CONTRACT

**أهداف الـ Director وأولوياته:** منتج SaaS تجاري (freemium: Free / Pro / Business / Enterprise)، مخازن مشتركة وصلاحيات فريق، دقة محاسبية كاملة في الـ stock ledger، offline-first آمن، UX/UI راقي، ميزات شغالة فعلاً (مش واجهات شكلية)، أتمتة واختبارات حقيقية، وتكلفة بنية تحتية منخفضة (free tier أولاً). أندرويد على جهاز Huawei حقيقي، وiOS هدف مستقبلي.

**الأدوار:**
| الدور | المسؤولية |
|---|---|
| **Director** | صاحب المنتج، السلطة النهائية على الموافقات والأولويات والعمليات الحساسة. هو الوحيد اللي بيحمل الملف ده لـ ChatGPT ويرجّع prompt التنفيذ. |
| **ChatGPT** | مستشار هندسي مستقل: يراجع الأدلة، يلاقي الثغرات، يقرر هل المرحلة استوفت الـ acceptance، ويكتب prompt التنفيذ التالي. **مفيش عنده وصول للـ filesystem.** توصياته استشارية لحد ما الـ Director يوافق. |
| **Claude** | Lead Engineer / Orchestrator: يفحص الـ repo الفعلي، ينفّذ الشغل المعتمد بحكم مهندسي، يشغّل الاختبارات، يحافظ على الـ state، ويكتب تقارير قابلة للتحقق. اقتراح مكتوب من Claude في الملف ده **مش إذن** ببدء مرحلة جديدة. |

**شروط الموافقة (لازم Director صراحةً ومن جديد):**
- أي **Android AAB** (build أو upload)، أي Google Play / Internal Testing.
- أي **Production** deploy أو promotion أو migration أو تغيير config.
- أي **merge / force-push** على `main` أو `rc4/release-candidate` أو branches الـ release.
- أي مشاركة لكود المشروع أو مواد سرية مع موديل خارجي (القواعد في `~/.claude/ORCHESTRATION.md`: `APPROVE-DELEGATION` / `APPROVE-COUNCIL` / `APPROVE-EXTERNAL-REVIEW` — لازم الـ Director يكتبها بنفسه). **RA-4 غير ممنوح**، وAI Council حالته degraded.
- خدمات مدفوعة، تثبيت بصلاحيات admin، أو تغيير config لـ Claude/MCP/FreeLLMAPI.
- مسموح من غير سؤال (جوه المرحلة المعتمدة): Debug APK + ADB + اختبار على الجهاز الحقيقي، worktrees معزولة، commit/push (من غير force) على الـ feature/integration branches.

**Mandatory start/end protocol** (التفاصيل الكاملة في `docs/handoff/STOCKMIND_AI_CONTINUITY.md` قسم "MANDATORY AI SESSION START / END PROTOCOL"):
- **البداية:** اقرأ `AGENTS.md` ← الـ master continuity ← **الـ bridge ده** ← الـ checkpoint المطلوب فقط. بعدين `git worktree list` + `git status -sb` + `git log --oneline -5` على الـ integration worktree، و`git status --porcelain=v1` على `D:\Projects\StockMind` (قراءة بس). لو في تعارض بين الملفات والـ Git، الـ Git يكسب ولازم تتصحح الملفات.
- **النهاية (عند كل milestone):** حدّث الأقسام 01 و03–09، أضف الـ commits ونتايج التحقق الفعلية، سجّل المشاكل غير المحلولة، حدّد الخطوة التالية بالظبط، حدّث الـ master لو الحالة/القواعد اتغيرت، انسخ الـ bridge لـ Desktop، وتأكد إن الـ SHA-256 متطابق للنسختين، وبلّغ بأمانة عن أي فشل في الحفظ.

**سياسة توفير الـ tokens:** قراءة ضيقة فقط (مفيش audit شامل ولا re-install ولا full test run للتعارف)، أقل عدد أدوات، مفيش subagents أو Council بدون سبب ومن غير موافقة، والـ bridge بيشاور على المستندات الكبيرة بدل ما ينسخها. وماتتعدلش إلا الأقسام اللي اتغيرت.

---

## 03 — CURRENT TASK

- **المهمة المعتمدة:** "STOCKMIND — AI ACCOUNT ONBOARDING & PERMANENT COLLABORATION PROTOCOL" (قراءة فقط أولاً).
- **الهدف:** يستكمل Claude الشغل من آخر حالة موثّقة على حساب جديد، وينشئ الـ bridge الدائم.
- **النطاق المنفّذ:** (A) قراءة الـ `AGENTS.md` والـ master continuity والـ Series 04 checkpoint. (B) تحقق Git ضيق. (C) تثبيت عقد التعاون (قسم 02). (D) كتابة الملف ده. (E) النسخة المطابقة على Desktop + مقارنة SHA-256. (F) إضافة مرجع قصير للـ bridge في الـ master. (G) توقف.
- **المخرجات:** الـ bridge (canonical + mirror)، تحديث صغير في `STOCKMIND_AI_CONTINUITY.md`، commit/push للـ docs فقط على `integration/series04` (لو اتسمح).
- **الحالة:** **مكتملة** عند كتابة النسخة دي (تفاصيل الـ commit في قسم 06 وفي الرد النهائي للـ session).
- **معايير القبول:** الملفين موجودين وSHA-256 متطابق؛ مفيش تعديل في الكود أو الـ main أو الـ RC أو الـ Production؛ كل معلومة في الملف إما اتحققت دلوقتي أو معلّمة بمصدرها/UNVERIFIED.
- **مستبعد صراحةً:** Series 05، أي feature، اختبارات واسعة أو builds، تغيير اللوجو، نشر أي حاجة، Redis، تحديث dependencies، AAB/Play.

---

## 04 — CHANGES MADE

### أ) في الـ onboarding ده (docs فقط)
| الملف | التغيير | ليه |
|---|---|---|
| `docs/handoff/STOCKMIND_AI_BRIDGE.md` (جديد) | الملف ده | قناة ChatGPT↔Claude |
| `docs/handoff/STOCKMIND_AI_CONTINUITY.md` | (1) صف `integration/series04` في جدول قسم C اتصحح من `322e8a0` لـ `eb19ab0` مع شرح إن اللي بعد `322e8a0` docs فقط. (2) سطر مرجع للـ bridge في بروتوكول البداية/النهاية وقسم H. (3) سطر في الـ Change log. | تصحيح تعارض موثّق + ربط الملفين |
- **مفيش** migrations ولا تغييرات API ولا كود. اتساب كما هو عمداً: كل الكود، `AGENTS.md`، اللوجو، `main`، الـ RC، الـ Production.

### ب) آخر milestones قبل الـ onboarding (من الـ Git والـ checkpoint)
| Commit | التغيير |
|---|---|
| `5e4c5be` | دمج `mobile/offline-outbox` (`ac9ba6b`) في `feature/series03-sync` (`55348a6`) من غير conflicts |
| `e43daad` | backend: `POST /stock/operations/lookup` + `@SkipAudit` للـ POSTs القراءة فقط + اختبارات PG |
| `c84673f` | mobile domain: فصل "receipt knowledge" عن "stock truth"، قواعد المصالحة، حفظ الـ receipts 7 أيام |
| `2038e46` | mobile runtime/UI: re-check بعد reset، شاشة review لـ "history changed" مع re-entry بشري، تحمل السيرفر البطيء |
| `6b975bc` | صياغة: "not confirmed yet" |
| `d69f6e8` | إصلاح harness الاختبارات: `listen` مرة واحدة في specs الـ concurrency (سبب ECONNRESET) |
| `bdc9fa7` / `37d4e22` / `322e8a0` | checkpoint + evidence موثّق (docs) |
| `e4880af` | ملف الاستمرارية + `AGENTS.md` (docs) |
| `eb19ab0` | سطر الصيانة في ملف الاستمرارية (docs) |

- **تغييرات API (إضافية، متوافقة مع العملاء القدام):** `POST /stock/operations/lookup`؛ `GET /stock/changes/:w` بيرجّع `anchor` و`reset`. مفيش migrations في Series 03 و04 (آخر migration `1792570000000`).
- **صيانة خارج الـ Git (2026-10-21):** تنضيف القرص C: وفّر 6.85 GB (caches بس). التقرير: `C:\Users\Name\Desktop\StockMind_Handoff\C_DRIVE_CLEANUP_REPORT.md`. ما اتلمسش أي tool أو config أو بيانات مشروع.

---

## 05 — TESTS & VERIFICATION

**مهم:** في الـ onboarding ده **ما اتشغلش أي test أو build**. الأرقام تحت **منقولة من Series 04** (`docs/handoff/SERIES_04_CHECKPOINT.md` §4–5)، والكود ما اتغيرش من `d69f6e8` (اتأكد بالـ diff في قسم 01).

| الـ Gate | النتيجة (Series 04) | المستوى |
|---|---|---|
| Backend `tsc --noEmit` + clean `nest build` | 0 errors / نجح | build |
| Backend full suite على HEAD `d69f6e8`، 3 تشغيلات متتالية على DBs جديدة | **41/41 suites، 255/255 tests، 3 من 3** | real PostgreSQL 15.19 (throwaway cluster) |
| Backend قبل إصلاح الـ harness (`6b975bc`) | تشغيلين 255/255، والتالت **FAILED** (254/255، `read ECONNRESET`) | اتحلل لا اتجاهل: القديم 2/8 فشل، الـ listen-once 0/8 |
| Mobile `tsc --noEmit` + Jest | 0 errors، **14 suites، 203/203** | unit |
| Specs جديدة | `operation-lookup.pg.spec.ts` (8 tests)، `sync-cursor-reset.pg.spec.ts` (6 tests منهم concurrent reader) | PG integration |

**الجهاز (Huawei JSN-L22، Android 10، debug APK + Metro، backend محلي على DB مؤقتة، والـ "طرف تاني" هو API client — مش موبايل تاني):**
Login+2FA ✔ · dispatch أوفلاين → تأكيد مرة واحدة ✔ · سيرفر بطيء 45s: "Sending…" وطلب HTTP واحد وmovement واحد ✔ · restore بيمسح عملية confirmed ← "Needs review · history changed" ولا يُعاد إرسالها ✔ · kill للتطبيق + بصمة الـ Director ← الحالة اتحفظت ولم يُرسل أي write ✔ · re-entry بشري بمفتاح جديد وnote في الـ ledger ✔ · الشاشة بالعربي ✔.

**ما لم يتم اختباره (UNVERIFIED / NOT DONE):**
- جهازين فعليين (NOT DONE) · iOS build (UNVERIFIED، مفيش macOS) · Redis حقيقي (UNVERIFIED) · online transfer على الجهاز (UNVERIFIED) · حالة "Catching up" على الجهاز (PARTIAL، unit بس) · Google Sign-In والـ AI assistant محلياً (UNVERIFIED) · حالة الـ Production الفعلية (UNVERIFIED، "reported" فقط).

**الـ Evidence:** `docs/handoff/series04-evidence/` (12 صورة + `server-ledger-W1.txt` + `http-trace-proxy.txt`، كلها بيانات dummy). الـ checkpoint: `docs/handoff/SERIES_04_CHECKPOINT.md`.

**فحوصات القراءة فقط في الـ onboarding ده (VERIFIED دلوقتي):** الفرع والـ HEAD ومزامنة الـ remote، `git worktree list`، حالة `main` المتّسخة، وجود الملفات والـ hashes، الـ diff المحدود لـ docs، وجود `_local-tools` (pg_ctl + backend-gate)، المنافذ 3000/3001/8081/55433 مش مفتوحة.

---

## 06 — GIT & ENVIRONMENT STATE

**Worktrees (اتأكدوا من `git worktree list`):**
| Branch | HEAD | المسار |
|---|---|---|
| `integration/series04` | `eb19ab0` (قبل commit الـ bridge) | `D:\Projects\StockMind-wt\series04-integration` |
| `feature/series03-sync` | `55348a6` | `D:\Projects\StockMind-wt\series03-backend` |
| `mobile/offline-outbox` | `ac9ba6b` | `D:\Projects\StockMind\.claude\worktrees\clever-poincare-ebc43f` (الـ session دي) |
| `feature/shared-warehouse` | `02c53f5` | `D:\Projects\StockMind-wt\shared-warehouse` |
| `mobile/shared-sync` | `905f535` | `D:\Projects\StockMind-wt\mobile-device` |
| `rc4/release-candidate` | `1447ade` | `D:\Projects\StockMind-wt\combined` |
| `hotfix/rc41-credential-redaction` | `bb071ed` | `D:\Projects\StockMind-wt\wp-h0-f4` |
| `fix/f4-forward-port`, `fix/fcm-di-boot` | `45d9e18` | `StockMind-wt\f4-forward-port`, `StockMind-wt\fcm-di-fix` |
| `main` (محلي) | `45d9e18` | `D:\Projects\StockMind` |

- الـ remote: `origin` = `https://github.com/mohamedelsayedarmy95/stockmind.git`. لا تعديل على `main` ولا الـ RC ولا الـ Production، ولا merge، ولا deploy.
- **ملفات محمية (الـ main المتّسخ، شغل الـ Director — ممنوع تتلمس):** معدّل: `DEPLOYMENT_CHECKLIST.md`، `tests/integration/notification.flow.spec.ts`. غير متتبّع: `.ai-handoff/`، `PHASE_7_CHECKLIST.md`، `scripts/`، `tests/integration/stock-cache.invalidation.spec.ts`، `Glossy Neon Inventory Analytics Icon.png`. (hash prefixes اتسجلت في Series 04 checkpoint §1.) كمان `.ai-handoff/` غير متتبّع في worktree الـ session الحالية.
- **خدمات شغالة:** مفيش (المنافذ 3000/3001/8081/55433 فاضية). جهاز Android واحد ظاهر في `adb devices` بحالة `device`؛ قائمة `adb reverse` ما اتفحصتش في الـ onboarding ده.
- **الأدوات (`_local-tools`):** `D:\Projects\StockMind-wt\_local-tools\` موجودة (PG15 + scripts) — VERIFIED بـ `Test-Path`. الـ cluster `pgdata-s04` متوقف ويتشغل بالأمر في الـ master قسم F.
- **قيود البيئة (ملاحظات الـ session دي):**
  - `freellmapi` فشل الاتصال (`ECONNREFUSED`) ← أي تفويض لموديل خارجي **BLOCKED** حالياً. أداة `mem_search` الخاصة بـ claude-mem منقطعة. ملاحظة: AI Council لسه degraded (RA-4 غير ممنوح).
  - كذا connector محتاج OAuth (`/mcp`) ومش مستخدم في المشروع.
  - مساحة C: الفاضية دلوقتي **49.97 GB** (كانت 62.85 GB بعد تنضيف 2026-10-21). النقص ≈ 12.9 GB في 3 أيام **من غير تحقيق** في السبب (خارج نطاق المهمة).
- **تغيير في أدوات/تبعيات/config في الـ onboarding:** مفيش.

---

## 07 — RISKS, BUGS & DEFERRED WORK

| # | الخطورة | النوع | الوصف / الأثر | الحل المؤقت |
|---|---|---|---|---|
| R1 | **عالية** | حد معروف (CONFIRMED) | لو الـ restore اتلغى بعدين، وإنسان عمل re-entry لعملية، العملية هتتكرر. القرار "هل العملية المفقودة تتعاد؟" قرار عمل. | Re-entry بشري فقط + ledger note يسمي الأصل. محتاج runbook/اجراء تشغيلي. |
| R2 | متوسطة | افتراض معروف (CONFIRMED) | الكشف بيفترض point-in-time restores، والـ receipts بتتخزن 7 أيام بس. | موثّق؛ لا حل كودي حالياً. |
| R3 | متوسطة | فجوة (CONFIRMED) | مفيش اختبار على جهازين؛ online transfer على الجهاز؛ حالة "Catching up" unit فقط. | الاختبار لما يتوفر موبايل تاني. |
| R4 | متوسطة | فجوة (CONFIRMED) | iOS عمره ما اتبنى. الناقص: iOS profile في `eas.json`، `iosUrlScheme` للـ Google Sign-In، certificate pin حقيقي بدل الـ placeholder، permission الإشعارات. | مراجعة نظرية بس (Series 04 §6). |
| R5 | منخفضة | CONFIRMED | `stock_idempotency_keys` مفيش لها cleanup job (P2). | الـ lookup بيرجع للـ movement id كـ fallback. |
| R6 | منخفضة | CONFIRMED | مفيش واجهة إدارة فريق على الموبايل (API بس). الـ entitlements موجودة بس `ENTITLEMENTS_ENFORCED` مقفول، ومفيش billing. | لا شيء (نطاق مرحلة قادمة). |
| R7 | منخفضة | **فرضية** (HYPOTHESIS) | "suite failed to run" في `tenant-concurrency` ظهرت مرة في Series 03 ولم تتكرر في 6 تشغيلات كاملة بعد الإصلاح. اللوج ضاع، فالسبب **غير مثبت** (غالباً نفس سباق supertest). | الـ harness اتصلح. راقب. |
| R8 | معلومة | UNVERIFIED | حالة الـ Production (Render من `release/prod-hotfix-f4` @ `bb071ed`، auto-deploy مقفول) **مبلغ عنها فقط**. ما اتفحصتش. Neon كـ DB سحابية نفس الشيء. | يتحقق منها فقط بإذن في مرحلة الـ preflight/release. |
| R9 | معلومة | CONFIRMED (إنه متّسخ) / UNVERIFIED (علاقته بـ origin) | `main` المحلي (`45d9e18`) متّسخ دلوقتي (ملفين معدّلين + ملفات غير متتبّعة). الـ master بيقول إن `origin/main` = `5b32df3`، والعلاقة بينهم ما اتفحصتش. شغل الـ Director غير متتبّع جزئياً ← خطر ضياع. | ماتلمسوش؛ الـ Director يقرر commit أو backup. |
| R10 | معلومة | CONFIRMED | gotcha: `tsconfig.build.tsbuildinfo` قديم بيخلي `nest build` يطلع `dist` فاضي. | امسحه جوه الـ worktree المعني قبل الـ build. |

**مؤجل (DEFERRED) لحد موافقة:** production deploy / RC promotion / AAB وGoogle Play / billing / iOS build / Redis حقيقي / تبنّي اللوجو / history epoch على السيرفر / Viewer role / multi-org.

**تناقضات اتلاقت وتم تسويتها:** ملف الاستمرارية كان بيقول HEAD = `322e8a0`؛ الفعلي `eb19ab0` (فرق docs فقط) — اتصحح. باقي ما ورد في prompt الـ onboarding اتطابق مع الـ repo (الفرع، الـ SHAs، 41/41 و255/255 و203/203).

---

## 08 — DIRECTOR APPROVALS REQUIRED

لا يوجد إذن مطلوب لإكمال الـ onboarding. القرارات دي مطلوبة **قبل المرحلة القادمة** (مرتبة بالأهمية):

1. **مراجعة semantics الـ P0.** هل "re-entry بشري فقط، ولا إعادة إرسال أوتوماتيك" هو السلوك النهائي؟ *الأكثر أماناً:* نعم (الحالي). *البديل:* إضافة "history epoch" من السيرفر يخلّي المشغّل يعلّم الـ restore صراحةً (كود أكتر، لكن بيقلل خطر R1).
2. **استراتيجية الـ RC.** الـ preflight يتفرّع من `integration/series04` ولا من `rc4/release-candidate` (`1447ade`)؟ *الأكثر أماناً:* branch جديد معزول من `integration/series04` للـ preflight فقط (مفيش merge في الـ RC/main).
3. **مراجعة خارجية حقيقية؟** لو عايزها: لازم الـ Director يكتب `APPROVE-EXTERNAL-REVIEW` (ومنح RA-4 للـ Reviewer A) ويشغّل الـ FreeLLMAPI gateway. من غيرها: مفيش مراجعة خارجية ولا هنفترض إنها حصلت.
4. **موبايل تاني متاح؟** بدونه اختبار الجهازين يفضل NOT DONE.
5. **iOS:** محتاج macOS أو EAS build مدفوع ← موافقة صريحة (مؤجل).
6. **أي حاجة تخص Production / AAB / Google Play / Internal Testing:** ممنوعة لحد أمر منفصل وبوابات release.

---

## 09 — NEXT RECOMMENDED ENGINEERING TASK

**(توصية فقط — مش مُصرَّح بها):** **Series 05 — RC preflight لـ `integration/series04` في branch جديد معزول** (بدون merge أو deploy).

- **ليه ده الأول:** هو الخطوة اللي تقرّب من الإصدار، وبيكشف مشاكل الدمج/الـ migrations بدري، وكل الحاجات التانية (runbook، team UI) أقل إلحاحاً قبل ما الخط ده يتأكد إنه قابل للدمج.
- **الشروط المسبقة:**
  - موافقة الـ Director على قسم 08 البنود 1–2 وتسمية الـ branch الأساسي.
  - worktree نضيف؛ تشغيل الـ PG cluster المؤقت (`pg_ctl` من `_local-tools`).
  - تحقق Git ضيق (الأوامر الأربعة في الـ master).
- **حدود التنفيذ:**
  - branch جديد (مثلاً `preflight/rc-series04`) من الأساس اللي الـ Director يحدده، في worktree جديد.
  - تسجيل الـ merge bases مع `1447ade`، ومراجعة ترتيب الـ migrations، واختبار `up/down/up` على **نسخة من بيانات legacy على الـ PG المؤقت فقط** (أبداً على Neon/Production).
  - مفيش merge في `rc4/release-candidate` أو `main`، مفيش push على branches محمية، مفيش deploy، مفيش AAB، ولا لمس للـ main المتّسخ.
- **بوابات القبول والتحقق:**
  1. مفيش conflicts غير مفسّرة.
  2. الـ migrations قابلة للعكس (`up/down/up` ناجح).
  3. Backend real-PG: كل الـ suites ناجحة **3 مرات متتالية** على DBs جديدة.
  4. Mobile `tsc` = 0 وJest ناجح.
  5. تقرير بالأرقام الفعلية والفشل لو حصل، وتحديث الـ bridge والـ master وSHA-256 متطابق.
- **الاعتماديات:** قرار الـ Director على البند 2؛ `_local-tools` سليمة (اتأكدت دلوقتي).

---

## 10 — MESSAGE FOR CHATGPT

**اللي حصل:** Series 04 خلصت وبقت جاهزة للمراجعة على `integration/series04` @ `eb19ab0` (الكود متجمّد من `d69f6e8`، وما بعده docs). الـ onboarding الحالي كان **docs فقط** ومفيش test اتشغل فيه. الأدلة الرقمية كلها منقولة من Series 04 (قسم 05).

**اللي محتاج مراجعتك (نقاط ضعف محتملة في الأدلة):**
1. اختبار الجهاز = موبايل واحد + API client، **مش جهازين**. الاستنتاجات عن التزامن متعدد المستخدمين مبنية على PG integration + API client.
2. سيناريو الـ restore اتعمل بـ restore مصطنع (point-in-time على DB مؤقتة)، مش restore حقيقي على Neon.
3. فشل ECONNRESET في التشغيل التالت اتحلل وأُصلح في الـ harness (القديم 2/8، الجديد 0/8)، بس ده إصلاح harness مش الكود؛ راجع إن التحليل مقنع.
4. R1 (تكرار العملية لو الـ restore اتلغى) حد معروف مش مُعالَج بكود.
5. ما حصلتش أي مراجعة خارجية مستقلة؛ الـ Council degraded والـ FreeLLMAPI منقطع الآن. **ماتفترضش إن مراجع تاني وافق.**

**أسئلة تحسمها قبل ما توصي بالمرحلة التالية:**
- هل semantics الـ P0 (re-entry بشري) كافية للـ RC، ولا الأفضل نعمل "history epoch"/runbook **قبل** الـ preflight؟
- الـ preflight يتفرّع من `integration/series04` ولا من `rc4/release-candidate`؟
- هل لازم اختبار جهازين قبل الـ RC، ولا نقبل الـ PG integration كدليل مؤقت؟
- هل الـ Director عايز مراجعة خارجية حقيقية (تحتاج `APPROVE-EXTERNAL-REVIEW` وRA-4)؟
- صياغة معايير قبول الـ preflight (قسم 09) كافية؟ عدّلها لو مش.

**لما تكتب prompt التنفيذ التالي، ضمّن:** اسم المرحلة، الـ branch الأساسي، الـ acceptance بالأرقام، الموافقات الصريحة المسموحة، وقائمة الممنوعات (AAB/Play/Production/merge على main/RC). والتزم بإن Claude هيكمل من آخر حالة موثّقة من غير إعادة اكتشاف.

---

## 11 — CHANGELOG (append-only)

- **2026-10-24 20:40 +03:00 — v1.0:** إنشاء الـ bridge أثناء الـ onboarding على حساب Claude جديد (`claude-sonnet-5-5`). HEAD قبل الـ commit = `eb19ab0`. تصحيح صف `integration/series04` في الـ master. لا تغيير في الكود. لا اختبارات اتشغلت.

---

## 12 — SOURCE-OF-TRUTH REFERENCES

| الموضوع | المسار |
|---|---|
| Master continuity (الخريطة الأساسية) | `D:\Projects\StockMind-wt\series04-integration\docs\handoff\STOCKMIND_AI_CONTINUITY.md` · نسخة: `C:\Users\Name\Desktop\StockMind_Handoff\STOCKMIND_AI_CONTINUITY_MASTER.md` |
| تعليمات الـ agents | `D:\Projects\StockMind-wt\series04-integration\AGENTS.md` |
| Series 04 checkpoint (المقاييس، العقد، الـ gates، الجهاز، القرار) | `D:\Projects\StockMind-wt\series04-integration\docs\handoff\SERIES_04_CHECKPOINT.md` |
| Evidence الجهاز | `D:\Projects\StockMind-wt\series04-integration\docs\handoff\series04-evidence\` |
| Series 03 checkpoint (backup) | `D:\StockMind_Backups\Checkpoints\SERIES_03_CHECKPOINT_2026-10-20.md` (SHA-256 `B555D4D2…26A6`) |
| Series 02 وما قبله (للقراءة فقط، غير متتبّع في main المتّسخ) | `D:\Projects\StockMind\.ai-handoff\` (`SERIES_02_CHECKPOINT.md`, `CURRENT_STATE.md`, `DECISIONS.md`, `evidence\`) |
| دليل المستخدم (بالعربي) | `C:\Users\Name\Desktop\StockMind_Handoff\StockMind_USER_MANUAL.md` |
| Resume checkpoint مختصر | `C:\Users\Name\Desktop\StockMind_Handoff\StockMind_RESUME_CHECKPOINT.md` |
| تقرير تنضيف C: | `C:\Users\Name\Desktop\StockMind_Handoff\C_DRIVE_CLEANUP_REPORT.md` |
| أدوات الاختبار المحلية | `D:\Projects\StockMind-wt\_local-tools\` |
| قواعد التفويض/Council العامة | `C:\Users\Name\.claude\ORCHESTRATION.md` |
| الـ API والـ architecture | master قسم B + checkpoint §3 |
| تعليمات الـ release | لا يوجد ملف release جاهز؛ الـ Production NO-GO والـ AAB/Play ممنوعين بدون أمر منفصل (master قسم E) |
| اللوجو (محجوز، لا يُعدَّل) | `D:\Projects\StockMind\Glossy Neon Inventory Analytics Icon.png` |
