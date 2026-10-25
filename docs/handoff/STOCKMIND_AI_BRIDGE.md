# STOCKMIND — AI BRIDGE (ChatGPT ↔ Claude)

> الملف ده قناة التواصل الدائمة بين ChatGPT (مراجع/مخطط، من غير وصول للـ filesystem) وClaude (المنفّذ على الجهاز). الـ Director هو اللي بيحمل الملف بينهم.
> اللغة: عربي مصري، والمصطلحات التقنية والمسارات والأوامر وأرقام الـ commits بالإنجليزي زي ما هي.
> **القاعدة الأساسية:** حالة الـ Git والكود الفعلي أقوى من أي حاجة مكتوبة هنا. الملف ده خريطة وتقرير، مش إثبات.
> التصنيفات: `VERIFIED / PARTIAL / UNVERIFIED / BLOCKED / FAILED / DEFERRED`.

> ## ⚠ المكان الرسمي لهذا الملف (ACTIVE CANONICAL)
> **الفرع:** `design/series08-enterprise-blueprint` — **المسار:** `D:\Projects\StockMind-wt\series08-enterprise-blueprint\docs\handoff\STOCKMIND_AI_BRIDGE.md`
> **الفرع ده superset من كود Series 07 (نفس كود `b3d824f`) + حزمة التوثيق؛ الفرق عن `feature/series07-recovery-integrity` توثيق فقط.**
> **النسخ الأقدم غير سارية (stale):** على `feature/series07-recovery-integrity` (v1.3 @ `dc4ff4d`، worktree `series07-recovery-integrity`)، وعلى `hardening/series06-release-safety` (v1.2)، وعلى `preflight/series05-rc-admission` (v1.1)، وعلى `integration/series04` (v1.0). ماتقراش منهم. نسخة الـ Desktop مطابقة لهذه النسخة بالـ SHA-256.

---

## 00 — BRIDGE METADATA

| البند | القيمة |
|---|---|
| المشروع | StockMind (inventory / WMS SaaS) |
| إصدار الملف | **v1.4** (بعد Series 08 — تصميم فقط) |
| آخر تحديث | **2026-10-25 (التوقيت في الـ changelog قسم 11)** (Egypt Standard Time) |
| الـ session | Claude Code Desktop، `claude-sonnet-5-5`. Series 07 وSeries 08 اتنفّذوا بتفويضين كاملين من الـ Director في رسائل مستقلة. مفيش identifiers حساسة. |
| المرحلة الحالية | **Series 08 — Enterprise Product Architecture, Governance & UX Blueprint: مكتملة (توثيق وأدلة فقط، PASS لنطاقها).** قبلها: Series 07 (S1+S2) مكتملة (PASS للنطاق، الجهاز PARTIAL). في انتظار قرارات الـ Director. |
| الحالة | ACTIVE |
| Canonical | `D:\Projects\StockMind-wt\series08-enterprise-blueprint\docs\handoff\STOCKMIND_AI_BRIDGE.md` على `design/series08-enterprise-blueprint` |
| Desktop mirror | `C:\Users\Name\Desktop\StockMind_Handoff\STOCKMIND_AI_BRIDGE.md` (مطابق بالـ SHA-256) |
| **Verified baseline (مؤشر Git)** | **الكود:** آخر commit كود/اختبارات = **`b3d824f`** (Series 07: `cbad45b` backend ← `9a79b1c` mobile ← `b3d824f` إصلاح i18n) وعليه اشتغلت الـ gates في Series 07. **Series 08 ما غيّرتش أي كود** (الفرع من `dc4ff4d` = Series 07 docs HEAD). أي commit بعد `b3d824f` **docs فقط** — للتأكد: `git -C D:\Projects\StockMind-wt\series08-enterprise-blueprint diff --name-only b3d824f HEAD` (لازم كلها تحت `docs/`). commits التوثيق الخاصة بـ Series 08: `git log --oneline dc4ff4d..HEAD`. الملف مبيقدرش يكتب hash الـ commit بتاعه. |

---

## 01 — EXECUTIVE PROJECT STATUS

### Series 08 (تصميم وأدلة فقط) — الجديد
- **المخرج:** حزمة `docs/product/` (7 وثائق + فهرس `README.md`): `STOCKMIND_PRODUCT_BIBLE_V2.md`، `STOCKMIND_CODE_TO_CAPABILITY_GAP_MATRIX.md`، `STOCKMIND_ORGANIZATION_RBAC_SPEC.md`، `STOCKMIND_MOVEMENT_GOVERNANCE_SPEC.md`، `STOCKMIND_ENTERPRISE_UX_BLUEPRINT.md`، `STOCKMIND_ARCHITECTURE_DECISIONS.md` (ADR A–J + Q-01..Q-18)، `STOCKMIND_IMPLEMENTATION_ROADMAP.md`. **لا كود ولا migration ولا اعتماديات ولا اختبارات اتغيّرت أو اتشغّلت.**
- **اللي اتكشف بالجرد (قراءة ثابتة، غير مؤكد تشغيلياً):** **D1** `costPrice` بيتسلّم (مفكوك التشفير) لأي دور فيه `VIEW_PRODUCT` عبر `GET /products` (لا DTO حاجب ولا صلاحية تكلفة)؛ **D2** مفيش إيقاف/إزالة عضو ولا تغيير دور بعد قبول الدعوة؛ **D3** الدور بيتقرأ من الـ JWT claim (نافذة ≤ 15 دقيقة)؛ **D4** الكتالوج على مستوى الشركة لكل الأدوار؛ **D5** `ApiStoreRepository.create` بيستدعي endpoint مش موجود؛ **D6** `register-device` بيستثني Manager؛ **D7** refresh token واحد لكل مستخدم؛ **D8** الـ audit best-effort وخارج transaction الحركة؛ **D9** `VIEW_AUDIT_LOG` بلا endpoint. **Manager = كل المخازن بالتصميم** (يتعارض مع "مدير مخزن بنطاق" المطلوب). لا RLS، لا hash chain على السيرفر (الموجود محلي على الجهاز فقط)، لا CHECK على الأرصدة (عدم السالبية بالتطبيق).
- **أهم التوصيات:** هوية/صلاحيات قبل الموافقات؛ تطوير الـ ledger الحالي (مش event-sourcing)؛ `domain_events` في نفس الـ transaction؛ موافقات online فقط بحجز `reserved_quantity` وفصل المبادر/المعتمد؛ عهدة تحويل بـ `transfers` وinvariant الحفظ؛ feed مؤكد فقط بـ merge؛ تطبيق واحد متكيّف بالقدرات؛ ICP واحد (FMCG موزّع) كفرضية؛ **الـ plans الحالية تفضل**.
- **الـ milestone التنفيذي التالي المقترح (مش مُصرَّح):** **Series 09 — Access Foundation Part 1 = S0 (إغلاق تسريب التكلفة) + S1 (دورة حياة الأعضاء + إبطال فوري)**، بالتوازي مع **Milestone R** (جاهزية تشغيلية غير إنتاجية بتفويضات).

### Series 07 (كما هي، مرجع)

- **آخر milestone:** Series 07. التقرير: `docs/handoff/SERIES_07_RECOVERY_INTEGRITY_REPORT.md`؛ العقد: `docs/handoff/SERIES_07_RECOVERY_CONTRACT.md`؛ الـ runbook: v0.3 (§14 إجراء المشغّل، §15 العمليات المتعايشة).
- **S1 = VERIFIED:** إعادة إدخال العملية الضايعة بقت **تعويض (replacement)** بيقرره **السيرفر جوه transaction واحدة**: claim مفتاح التعويض، إعادة فحص الصلاحية (FOR SHARE)، تطابق الـ generation، **fence (tombstone) على مفتاح الأصل** كـ test-and-set ذرّي، فحص الـ ledger بمعرّف حركة الإيصال، الكتابة العادية، provenance دائم. تعويض واحد لكل أصل، ولا تعويض والأصل موجود، وتكرار الطلب = حركة واحدة. الـ re-entry القديم (غير المحمي) اتشال من التطبيق.
- **S2 = VERIFIED مع حد صريح:** `history_generation` per-company بيتبعت مع `/stock/changes` (no-store، جزء من الـ body فالـ ETag/304 ما بيخبّيهوش) ومع الـ lookup وإيصالات الكتابة؛ تغيّره = snapshot + reset حتى لو الـ revisions اتكررت؛ العملاء القدام بياخدوا reset واحد من أرضية الـ rotation. التغيير الوحيد بيتم بـ **rotation** مصادَق (Admin، `MANAGE_RECOVERY`، flag `RECOVERY_OPERATIONS_ENABLED`، سبب + تأكيد حرفي، سجل append-only). **الـ marker جوه نفس القاعدة فبيتراجع مع restore: مفيش كشف تلقائي لـ restore؛ الكشف بيعتمد على إن المشغّل ينفّذ الـ rotation.**
- **الاختبارات:** Backend على PostgreSQL حقيقية **×3 على قواعد جديدة: 51/51 suites، 347/347** (313 + 32 recovery + 2 migration). `tsc` 0 وبناء نضيف (10 migrations). Mobile `tsc` 0 وJest **16/16، 252/252**. Negative controls: backend 6/6 أحمر، mobile 4 أحمر. **جهاز Huawei:** تدفق كامل (اكتشاف تغيّر السجل ← مراجعة ← تأكيد ← رد ضايع ← force-stop ← حسم تلقائي = حركة واحدة).
- **جهاز:** PARTIAL — زرار Retry، سيرفر بطيء، الواجهة العربية، تبديل الحساب، سحب الصلاحية، ضغطتين، حالات الرفض، جهازين = **لم تُجرَّب**.
- **جاهزية:** **Production: NO-GO** (R12، فحص Neon المسبق، سياسة تشغيل الـ rotation، release line، ترقية الأجهزة، مراجعة مستقلة…). RC: مفيش تغيير في حالته (promotion مؤجّل).

---

## 02 — DIRECTOR & AI COLLABORATION CONTRACT

**الأدوار:** **Director** = صاحب المنتج والسلطة النهائية على الموافقات. **ChatGPT** = مراجع ومخطط مستقل بلا وصول للـ filesystem، وتوصياته استشارية. **Claude** = Lead Engineer على الجهاز: يفحص الـ repo، ينفّذ المعتمد، يختبر، يحافظ على الـ state، ويكتب تقارير قابلة للتحقق. اقتراح مكتوب في الملف ده **مش إذن** ببدء مرحلة. **رسالة "attached" من غير مرفق = وقف وسؤال، مش تخمين.**

**شروط الموافقة (لازم Director صراحةً ومن جديد):** أي Android AAB أو Google Play/Internal Testing؛ أي Production deploy/promotion/migration/config أو اتصال بقاعدة Production/Neon؛ أي merge أو force-push على `main` أو `rc4/release-candidate` أو branches الإصدار، وإنشاء/تحريك branch release؛ مشاركة كود المشروع مع موديل خارجي (`APPROVE-DELEGATION` / `APPROVE-COUNCIL` / `APPROVE-EXTERNAL-REVIEW` بكتابته هو؛ RA-4 غير ممنوح؛ الـ Council degraded)؛ خدمات مدفوعة؛ تثبيت بصلاحيات admin. مسموح بدون سؤال داخل المرحلة المعتمدة: Debug APK + ADB + جهاز حقيقي (**البصمة دايماً للـ Director**)، worktrees معزولة، commit/push (بدون force) على الفرع المفوَّض.

**Mandatory start/end protocol** (التفاصيل: `docs/handoff/STOCKMIND_AI_CONTINUITY.md`):
- **البداية:** `AGENTS.md` ← الـ master ← **الـ bridge ده (النسخة الرسمية فقط، قسم 00)** ← التقرير/العقد/الـ checkpoint المطلوب فقط. فحص Git ضيق (الأوامر في الـ master). لو تعارض، الـ Git يكسب والملفات تتصحح.
- **النهاية (كل milestone):** حدّث الأقسام 00–10 وأضف سطراً لـ 11، أضف commits ونتايج فعلية وفشلاً إن حصل، حدّد الخطوة التالية، حدّث الـ master، انسخ للـ Desktop، **وتحقق من SHA-256 كامل لكل زوج**، وبلّغ بأمانة عن أي فشل حفظ.
- **نقل المكان الرسمي:** لما الشغل يتحرك لفرع/worktree جديد، انقل الـ bridge والـ master للفرع الجديد واكتب صراحةً في الأعلى إن النسخ القديمة stale.
- **مؤشر Git:** اكتبه كـ "verified baseline" بتاريخه وبـ commits docs اللاحقة؛ ماتكتبش HEAD كأنه حالي.
- **التحقق من البناء:** `exit 0` لوحده مش كفاية: امسح `*.tsbuildinfo` وافحص `dist/main.js` وعدد الـ migrations المترجمة.
- **اختبار الجهاز بيكشف حاجات Jest مش بيكشفها** (Series 07: تعارض مفاتيح i18n).

**سياسة توفير الـ tokens:** قراءة ضيقة، أقل عدد أدوات، لا subagents أو Council بدون سبب وموافقة، والـ bridge بيشاور على المستندات الكبيرة.

---

## 03 — CURRENT TASK

- **المهمة المعتمدة (اكتملت): Series 08 — تصميم وأدلة فقط.** التفويض كان رسالة Director كاملة (موجودة في المحادثة): جرد الكود مقابل الرؤية المجمّعة من 5 نماذج + Product Bible v1.0، وكتابة حزمة معمارية/صلاحيات/حركات/UX/ADR/roadmap، بدون أي تنفيذ. الفرع `design/series08-enterprise-blueprint` من `dc4ff4d`. **ممنوع كان:** كود، migrations، اعتماديات، Production/Neon، Council/موديل خارجي، merge، AAB/Play. **الحالة:** مكتملة؛ الحكم المقترح PASS لنطاقها. بوابات القبول §12 في التفويض: مفيش كود اتغيّر (يتحقق بـ `git diff`)، كل مقترح Bible ليه disposition، الـ 12 workflow مغطّاة، الصلاحيات والخصوصية محدّدة، دلالات الـ feed صادقة، عوائق Production محفوظة، شرائح بمعايير قبول قابلة للاختبار.
- **المهمة السابقة (اكتملت):** Series 07 — **S1 + S2 فقط**، على worktree/فرع معزول، Production NO-GO. التفويض كان رسالة Director كاملة (موجودة في المحادثة).
- **الهدف:** (1) منع تكرار re-entry بالخطأ أو بالتزامن لعمليات اتأكدت وغابت بعد restore؛ (2) هوية history generation صريحة تخلّي العملاء يعيدوا بناء حالتهم ويفحصوا إيصالاتهم، من غير ادّعاء كشف restore تلقائي.
- **المخرجات (اتسلّمت):** migration `1792590000000`؛ backend (`stock-replacement.service`, `history-generation.service`, lookup/sync/controllers)؛ mobile (`replacement.ts`، شاشة `outbox-review`، cursor بـ generation)؛ `recovery-integrity.pg.spec.ts` (32) + اختبارات mobile (49)؛ التقرير + العقد + runbook v0.3؛ أدلة الجهاز؛ bridge v1.3 + master + Desktop.
- **مستبعد (ما اتعملش):** dashboard المدير، هرمية المخازن، UI الفريق، صلاحيات المنتجات، approval workflows (الـ Director بيجهّز مقترح منفصل)، CP-4/CP-5، billing، Viewer، multi-org، تعديل الاعتماديات، TLS/Google، Neon/Production، AAB/Play، Council/موديل خارجي، أي merge، لمس `main` المتّسخ.

---

## 04 — CHANGES MADE

**Series 08:** ملفات توثيق جديدة فقط تحت `docs/product/` (8 ملفات) + تحديث `docs/handoff/STOCKMIND_AI_BRIDGE.md` و`STOCKMIND_AI_CONTINUITY.md`. صفر تغيير في `src/` و`mobile/` و`tests/` و`package*.json` و`tsconfig*` (مُتحقَّق بـ `git diff --name-only dc4ff4d HEAD` ← كل المسارات تحت `docs/`). **جدول Series 07 أدناه** كما هو.

| Commit | نوعه | التغيير |
|---|---|---|
| `cbad45b` | feat(recovery) | migration `1792590000000-RecoveryIntegrity` (+down fail-closed)، `StockReplacementService`، `HistoryGenerationService`، `RecoveryController`، `ReplaceOperationCommand/Handler`، `ReplaceOperationDto`/`RotateGenerationDto`، `getChanges` (generation/floor/no-store)، lookup (generation، superseded، coexisting)، `StockService.applyMovementInTransaction` (نفس الكتابة)، `MANAGE_RECOVERY`، exception filter بـ `code`، `warehouse-access.hasFullAccess`؛ `recovery-integrity.pg.spec.ts`؛ تعديل `release-safety.migration.pg.spec.ts` (+2، `undoGuard`)؛ fixture في `stock-cache.consistency.spec` |
| `9a79b1c` | feat(mobile) | `stock-sync` (generation)، `outbox.ts` (REPLACED، lookup الجديد)، `replacement.ts`، `outbox-reconcile.ts`، `outbox-replacement.ts`، `outbox-review.tsx`، قائمة outbox/banner، i18n ar/en، إزالة `reentryDraft`/`reentryOf`، `PremiumButton testID` |
| `b3d824f` | fix(mobile) | تغيير اسم namespace الـ i18n إلى `reviewFlow` + اختبار منع المفاتيح المكررة (**اتكشف على الجهاز**) |
| (commits docs) | docs | التقرير، العقد، runbook v0.3، bridge v1.3، master، `series07-evidence/` |

- **Migrations/API:** migration جديدة واحدة (10 إجمالاً)؛ API بإضافات فقط + endpoints جديدة (replacements, recovery). **اعتماديات: صفر تغيير.**
- **اتساب كما هو:** Series 06 migrations، `integration/series04`، RC، `main` المتّسخ، فرع Series 06 و05، الـ Production.
- أدوات خارج الـ repo (`_local-tools\scripts`): `start-backend-s07.ps1`, `start-metro-s07.ps1`, `lossy-proxy-s07.mjs`, `s07-slice.mjs`, `s07-negative-controls.ps1` — محلية ومؤقتة.

---

## 05 — TESTS & VERIFICATION

> **Series 08: ولا اختبار اتشغّل** (توثيق فقط، والتفويض بيقول إن الـ 3 تشغيلات PG مش مطلوبة). **كل الأرقام أدناه تخص Series 07 وكود `b3d824f` بالظبط** (backend PG ×3: 51/51 suites، 347/347؛ mobile 16/16، 252/252؛ جهاز واحد PARTIAL). ما تُنسبش لأي كود بعده ولا لـ Series 08. ما فيهوش "اختبار أخضر قديم" بيتقدّم كأنه جديد.

| الفحص | النتيجة | المستوى |
|---|---|---|
| Backend `tsc --noEmit` | exit 0 | build |
| Build نضيف (بعد مسح `*.tsbuildinfo` و`dist`) | exit 0، `dist/main.js` ✓، **10/10 migrations**، `migration-guards.js` ✓ | build |
| `recovery-integrity.pg.spec.ts` | **32/32** | real PG 15.19 |
| `release-safety.migration.pg.spec.ts` | **19/19** (17 + تحقق الإضافة + fail-closed down) | real PG |
| **Backend PG كامل ×3 على قواعد جديدة (HEAD `b3d824f`)** | **51/51 suites، 347/347 tests** في كل تشغيلة، exit 0 ×3 | real PG |
| Mobile `tsc` + Jest | exit 0 · **16/16 suites، 252/252** | unit |
| Negative controls backend | N1–N6 كلها أحمر (4، 2، 1، 3، 1، 1 فشل) | mutation |
| Negative controls mobile | 4 أحمر + تجربة واحدة ما غيّرتش النتيجة (guard مكرر) اتسجلت | mutation |
| Device (Huawei JSN-L22، debug، Metro، backend محلي مؤقت) | تدفق S1+S2 كامل: اكتشاف ← مراجعة ← تأكيد ← رد ضايع (الـ proxy) ← force-stop ← حسم؛ المخزون 51→47 (حركة واحدة)؛ provenance في `stock_replacements` | **device** (جهاز واحد + سكربتات API؛ **مش اختبار جهازين**) |

- **فشل أثناء التطوير (مفصّل في التقرير §5):** تسريب `details` في exception filter (اتكشف بـ `health.contract.spec` واتصلح)، fixtures/اختبارات (شكل `RETURNING`، hash غير ثابت، `running_balance=0`)، **تعارض مفاتيح i18n اتكشف على الجهاز فقط**، تلف ترميز ملف من PowerShell (اتصلح وفُحص الـ diff)، junction مع Metro، token الجهاز انتهى. **ولا full-suite فشلت بعد الإصلاحات، ولا flaky.**
- **ما لم يُختبر:** Neon/Production؛ جهازين؛ iOS؛ Redis حقيقي؛ Google Sign-In؛ على الجهاز: Retry، سيرفر بطيء، العربي، تبديل الحساب، سحب الصلاحية، حالات الرفض؛ الإجراء §14 على restore حقيقي؛ أداء الـ rotation على شركة كبيرة؛ مراجعة خارجية.
- **الـ Evidence:** `docs/handoff/series07-evidence/` (`device-run-ledger.txt`، 4 لقطات، `backend-gate-summary.txt`، `negative-controls-backend.txt`)؛ لقطات الجهاز الكاملة محليّاً في `_local-tools\evidence-s07\`؛ لوجات `stockmind_gate_s07_*.log`.

---

## 06 — GIT & ENVIRONMENT STATE

- **Series 08:** الفرع `design/series08-enterprise-blueprint` (worktree `D:\Projects\StockMind-wt\series08-enterprise-blueprint`) من `dc4ff4d`؛ docs فقط؛ حالة الرفع في الرد النهائي (`git ls-remote --heads origin design/series08-enterprise-blueprint`). **الـ worktree مفيهوش `node_modules` عمداً** (مفيش بناء/اختبار هنا). `feature/series07-recovery-integrity` @ `dc4ff4d` ما اتلمسش.
- PostgreSQL المؤقت (55433) لسه شغّال من Series 07 (مش مستخدم في Series 08). التطبيق على الـ Huawei لسه online بجلسة Staff محلية (راجع قسم 08).

- **الفرع الرسمي:** `feature/series07-recovery-integrity` (worktree `D:\Projects\StockMind-wt\series07-recovery-integrity`) — baseline كود `b3d824f` + docs. حالة الرفع على `origin`: في الرد النهائي (`git ls-remote --heads origin feature/series07-recovery-integrity`).
- **باقي الـ worktrees (لم تتغيّر):** `hardening/series06-release-safety` @ `6d4613b` (stale handoff) · `preflight/series05-rc-admission` @ `e517d82` · `integration/series04` @ `84faa31` · `rc4/release-candidate` @ `1447ade` · `main` @ `45d9e18` (origin `5b32df3`) · production reported `release/prod-hotfix-f4` @ `bb071ed`.
- **ملفاتك المتّسخة في `main`:** لم تُلمس (راجع Series 06 للتفاصيل: 3 ملفات بتتعارض + 3 commits محلية).
- **خدمات:** PostgreSQL المؤقت (127.0.0.1:55433) **لسه شغّال** (لإعادة تشغيل الاختبارات) بقواعد scratch `stockmind_gate_s07_*` و`stockmind_s04_s07dev`؛ backend/proxy/Metro اتوقفوا؛ `adb reverse` اتشال. التطبيق على الجهاز لسه في وضع **online** بجلسة Staff B المحلية — ارجع Offline من Settings لو عايز بياناتك الأوفلاين (الـ profile "Device Tester" ما اتمسحش).
- **بيئة:** Node `v26.7.0`، TypeORM `0.3.31`، PostgreSQL `15.19`. `node_modules`: الـ backend junction على `shared-warehouse`، والـ mobile **نسخة حقيقية** (Metro مش بيحلّ junction عبر worktree).
- **قيود الأدوات:** `freellmapi` ECONNREFUSED (ما استُخدم). Council degraded (RA-4 غير ممنوح). تغيير في أدوات/تبعيات/config: مفيش.
- **ملاحظة:** overlay تطبيق تاني (Messenger chat head) ظهر على الجهاز وغطّى جزء من الـ nav؛ ما اتلمسش.

---

## 07 — RISKS, BUGS & DEFERRED WORK  (التفاصيل: التقرير §7، العقد §5)

**جديد من Series 08** (قراءة ثابتة، **غير مؤكد تشغيلياً**؛ التفاصيل: `docs/product/STOCKMIND_CODE_TO_CAPABILITY_GAP_MATRIX.md` §2 وسجل Production في `STOCKMIND_IMPLEMENTATION_ROADMAP.md` §4):

| # | الخطورة | الوصف | يُقفل بـ |
|---|---|---|---|
| **R-13 / D1** | **عالية (خصوصية مالية)** | `costPrice` مشفّر في التخزين لكن `GET /products` بيرجّع كيانات `Product` كاملة بعد فك التشفير لأي دور فيه `VIEW_PRODUCT` (Staff كمان) | S0 (أول حاجة: إثبات بطلب فعلي) |
| **R-14 / D2 / D3** | **عالية (حوكمة)** | مفيش إيقاف/إزالة عضو ولا تغيير دور؛ الدور من الـ JWT claim | S1 |
| D4 | متوسطة | الكتالوج company-wide لكل الأدوار | قرار Q-04 |
| D7 / R-17 | متوسطة (UNVERIFIED) | refresh token واحد لكل مستخدم | S1 + جهازين |
| D8 / R-15 | متوسطة | audit best-effort وخارج transaction الحركة؛ مفيش append-only/hash chain على السيرفر | S3 / ADR-G |
| D5, D6, D9 | منخفضة | endpoint مش موجود للـ stores؛ `register-device` بيستثني Manager؛ `VIEW_AUDIT_LOG` بلا endpoint | مع الشرائح ذات الصلة |
| — | معماري | **Manager = كل المخازن بالتصميم** (يتعارض مع مدير مخزن بنطاق) | Q-02 + S2 |

**المخاطر السابقة (Series 07 وقبلها) أدناه كما هي.**

| # | الخطورة | الحالة | الوصف | الإجراء |
|---|---|---|---|---|
| ~~R1/R2~~ | — | **اتقلّل (S1+S2)** | re-entry غير محمي + عنصر history-changed ما بيتعادش فحصه | تعويض بقرار السيرفر الذرّي + إعادة فحص + REPLACED/duplicate-risk (VERIFIED). **ما اتقفلش بالكامل: L1** |
| **L1** | عالية قبل Production | مفتوح — **قيد معماري** | restore بيرجّع الـ generation والـ provenance والـ tombstone كمان؛ مفيش منع لتكرار عبر تواريخ فيزيائية؛ فقط كشف (coexisting) + إجراءات مشغّل | سياسة تشغيل معتمدة + بروفة |
| **R-ops** | عالية | مفتوح | الـ rotation خطوة يدوية ممكن تتنسي؛ مفيش اكتشاف؛ مفيش 2FA step-up؛ مفيش مسار SQL مختبَر لو الـ API واقع؛ ما اتدرّبش على قاعدة حقيقية | بروفة على قاعدة غير إنتاجية بتفويضك |
| L4 | متوسطة | مفتوح | عميل قديم ممكن يعمل re-entry عادي ما يتربطش بالأصل؛ عميل بلا anchor/generation واقف بالظبط على الـ floor مش بيتكشف | ترقية الأجهزة قبل تفعيل المخازن المشتركة |
| L3 | منخفضة | مقبول | تفاصيل الأصل ادّعاء عميل (مفيش تصعيد صلاحية) | — |
| R12 | عالية قبل Production | مفتوح — قرار | `rejectUnauthorized:false` لما `DB_SSL=true` | تفويض تقييم على branch Neon غير إنتاجي |
| R7/R8 | متوسطة | مفتوح | منح المخازن الجديدة، plans العملاء | CP-4/CP-5 (قرار منتج) |
| N2/N3 | متوسطة | UNVERIFIED | `1792580000000` بترفض boot لو تكرار revisions؛ قايمة الفحص المسبق (§13) ما اتنفّذتش على Neon | تفويض مشغّل |
| R5/R6 | متوسطة | مفتوح — قرار | release line (11 ملف/21 hunk)؛ 3 ملفات `main` متّسخة + 3 commits محلية | الخيار A (Series 06 §7) |
| — | منخفضة | UNVERIFIED | جمع إنجليزي "1 actions" في الـ banner (قبل Series 07)؛ حالات الجهاز غير المُجرّبة؛ مراجعة خارجية | — |

**مؤجّل (DEFERRED):** execution الـ release line، RC promotion، production deploy، AAB/Play، billing، iOS، Redis حقيقي، تبنّي اللوجو، S5/S6 (retention/تقرير المدير)، CP-4/5/6، Viewer، multi-org، واجهة فريق، dashboard المدير (مقترحك المنفصل).

---

## 08 — DIRECTOR APPROVALS REQUIRED

**أولاً — قرارات Series 08 (التفاصيل والافتراضي الموصى به لكل واحد: `STOCKMIND_ARCHITECTURE_DECISIONS.md` آخر جدول، Q-01..Q-18):**
- **الأهم الآن:** Q-02 (يفضل `Manager` = شركة كلها + `warehouse_manager` بنطاق كـ profile؟)، Q-03 (Owner/نقل ملكية)، Q-04 (رؤية الكتالوج)، Q-10 (step-up للـ rotation/override)، Q-11/Q-12 (ICP وتعبئة الـ tiers)، Q-18 (release line).
- **تفويض Series 09** (S0 + S1) إن وافقت على التوصية (قسم 09)، **وتفويض Milestone R** (بيئة غير إنتاجية) بشكل منفصل.
- لا شيء من Series 08 بيفتح تنفيذ أي ميزة تلقائياً.

**ثانياً — بنود سابقة (ما زالت سارية):**

1. **المرحلة التالية** (قسم 09) أو بديلها.
2. **سياسة تشغيل الـ rotation** (مين ينفّذها، امتى، التوثيق) — الـ runbook v0.3 §14 مسودة فقط؛ وهل تريد step-up (2FA) أو مسار CLI؟
3. **تفويض بروفة** على قاعدة **غير إنتاجية** (فرع Neon مؤقت إن وافقت): restore + rotation + قياس + قايمة §13 + تقييم R12.
4. **استراتيجية الـ release line** (Series 06 §8، الخيار A الموصى به) + ملفاتك المتّسخة + الـ 3 commits المحلية.
5. هل تريد **مراجعة خارجية** لـ S1/S2 (`APPROVE-EXTERNAL-REVIEW` بكتابتك + موافقة native على كل خطوة)؟ لحد الآن ما حصلتش.
6. **الجهاز:** هل تريد الإبقاء على التطبيق في وضع online (حساب Staff محلي) أم الرجوع Offline؟
7. أي حاجة تخص Production / AAB / Google Play / Internal Testing: ممنوعة لحد أمر منفصل.

---

## 09 — NEXT RECOMMENDED ENGINEERING TASK  (توصية فقط — مش مُصرَّح بها)

### التوصية الحالية (بعد Series 08): **Series 09 — Access Foundation Part 1 (S0 + S1)**
- **S0:** إثبات تشغيلي لتسريب `costPrice` (اختبار PG بـ Staff) ثم allowlist DTO للمنتج + قدرة `item.view_cost` (مبدئياً Admin) + اختبار سلبي NT-12 على كل المسارات (قائمة/تفاصيل/إنشاء/تعديل/صورة، والكاش/audit/إشعارات).
- **S1:** `members.status` (تعليق/إزالة/إعادة تفعيل)، تغيير الدور، `is_owner` + حماية آخر Owner، `token_version` (إبطال فوري)، audit لكل تغيير، Team screen بسيط على الموبايل.
- **ليه:** يقفل عيب خصوصية محتمل ويدّي المالك أول مرة قدرة offboarding؛ كل الحوكمة بعدهم تعتمد عليهم؛ نطاق محدود وبأنماط الكود الحالية؛ مفيش تفويض خارجي.
- **الاعتماد الدقيق:** أمر Director صريح بالنطاق + قراري Q-02/Q-03؛ فرع جديد من `design/series08-enterprise-blueprint`؛ PG المؤقت؛ جهاز Huawei + بصمتك (وجهاز ثاني اختياري للتحقق من D7)؛ **صفر Production/Neon**.
- **القبول:** إثبات قبل/بعد؛ NT-12/32/33/35/36/37؛ إبطال بعد التعليق خلال طلب واحد؛ آخر Owner محمي؛ outbox المستخدم المعلّق لا يُنفَّذ؛ توافق العملاء الحاليين؛ PG ×3 على قواعد جديدة؛ mobile tsc/Jest؛ جهاز (تعليق أثناء جلسة، سحب صلاحية، عربي)؛ تقرير + bridge.
- **بالتوازي (غير كودي):** **Milestone R** (بروفة restore/rotation على قاعدة غير إنتاجية، R12، step-up، جهازين، قرار release line…) بتفويضاتك. الخريطة الكاملة للشرائح S0–S9 وعوائق Production: `STOCKMIND_IMPLEMENTATION_ROADMAP.md`.

### توصية Series 07 السابقة (Series 08 للجاهزية التشغيلية) — اتدمجت في Milestone R أعلاه

**(كان اسمه "Series 08" في v1.3؛ الـ Director استخدم الاسم لمرحلة التصميم، فالمحتوى ده بقى "Milestone R") — Operational readiness of recovery (بدون Production):**
(أ) بروفة كاملة لإجراء §14 على قاعدة غير إنتاجية (restore فعلي + rotation + قياس زمن + فحوصات §3 + قايمة §13)؛ (ب) تقييم R12 (`rejectUnauthorized:true`) في نفس البيئة؛ (ج) جهازين حقيقيين على سيناريو التعويض (متزامن + سحب صلاحية + عربي + Retry + سيرفر بطيء)؛ (د) قرار الـ release line وتنفيذه كتخطيط.
- **الشروط:** تفويضك للبيئة غير الإنتاجية؛ worktree جديد من `feature/series07-recovery-integrity`؛ PG المؤقت.
- **القبول:** وثيقة بروفة بأرقام فعلية، وفجوات الجهاز في §07 تتقفل أو تتصنّف، وقرار مكتوب على الـ release line.
- **بدائل:** CP-4/CP-5؛ مقترح dashboard المدير بتاعك (بعد ما تبعته)؛ مراجعة خارجية.

---

## 10 — MESSAGE FOR CHATGPT

### رسالة Series 08 (الحالية)

**اللي حصل:** Series 08 تصميم فقط. جردنا الكود مقابل الرؤية (5 نماذج + Product Bible v1.0) وطلعنا حزمة `docs/product/` (7 وثائق + فهرس). **ولا سطر كود اتغيّر ولا اختبار اتشغّل.** المرجع الأول: مصفوفة الفجوات (كل صف بدليل: ملف/رمز/migration/اختبار، أو "قراءة ثابتة، مفيش اختبار runtime").

**أهم النتائج للمراجعة (اختبرها ضد الكود لو تقدر):**
1. **D1:** `costPrice` غالباً بيوصل لأي حامل `VIEW_PRODUCT` (قراءة ثابتة: `product.entity.ts` + `ProductService.findAll` + `GetProductListHandler` بلا serializer). **لازم يتأكد بطلب فعلي** قبل الإصلاح؛ ده أول خطوة في S0.
2. **Manager = كل المخازن بالتصميم** (`FULL_ACCESS_ROLES`، و`setWarehouseAccess` بيرفض غير Staff) — يتعارض مع "مدير مخزن بنطاق". اقترحنا profile على grant بنطاق مع إبقاء `Manager` الحالي (Q-02). هل ده أنسب من تغيير معنى Manager؟
3. **مفيش offboarding/تغيير دور** والدور من الـ claim (D2/D3) — بنوصي S1 قبل أي موافقات.
4. **اخترنا تطوير الـ ledger الحالي + `domain_events` في نفس الـ transaction، مش event-sourcing** (الثوابت الحالية مختبَرة؛ مخطط UWOS المحلي نفسه بيقول إنه غير مبني على السيرفر). تحقق من الحجة (ADR-C).
5. **الموافقة online فقط**، والسيرفر بيحوّل straight-through لـ pending لو السياسة اتغيّرت، وفحص الصرف لازم يتغيّر لـ `base − reserved` لما الحجز يتفعّل (حالياً بيتجاهل `reserved`). ده نقطة تصميم حساسة (§3.3 في الـ governance spec).
6. **عهدة التحويل بجدول `transfers` + invariant الحفظ** بدل مخزن in-transit وهمي، ومفيش LWW ولا وقت جهاز.
7. **ADR-G:** حدود صريحة: tamper-evidence مش tamper-proof، restore بيكسر السلسلة (نقسمها per generation)، لا ادّعاء قانوني. هل مقبول لعملاء مؤسسيين؟
8. **ICP:** FMCG موزّع 2–5 مخازن كفرضية؛ التجارب الأولى بدون نسخة إنتاج (إعادة تشغيل سجلات + معايرة عتبات + اختبار استخدام) لأن الإنتاج NO-GO.
9. **نقاط ضعف الحزمة نفسها:** (أ) تقديرات الأحجام (S/M/L) فرضيات؛ (ب) UX صُمّم من الكود بدون مستخدمين؛ (ج) مفيش اختبار تشغيلي للـ D1؛ (د) ما قارنّاش بمنتجات منافسة (ممنوع ندّعي).

**أسئلة تحسمها قبل توصيتك:** هل S0+S1 هو الـ milestone الصح الأول؟ هل تعطي Milestone R أولوية موازية؟ هل Q-04 (كتالوج مشترك) مقبول للخصوصية؟ هل نحتاج Owner/نقل ملكية في S1 ولا يتأجل؟ هل ترى إن عدم تقديم موافقات قبل شريك تصميم مبرر؟

**في الـ prompt التنفيذي القادم ضمّن:** اسم الشريحة، الفرع الأساسي (`design/series08-enterprise-blueprint`)، قرارات Q المطلوبة، الموافقات (خصوصاً أي بيئة غير إنتاجية)، الممنوعات (Production/AAB/merge)، وبوابات القبول بالأرقام.

### رسالة Series 07 السابقة (للمرجع)

**اللي حصل:** Series 07 خلصت للنطاق المفوَّض. **S1:** التعويض بقى قرار سيرفر ذرّي (fence على مفتاح الأصل + قفل generation + فحص ledger) بدل re-entry العميل اللي كان بيعمل حركة جديدة بدون أي حاجز. **S2:** `history_generation` per-company مع rotation مصادَق وموثّق، والعميل بيبعت generation مع الـ cursor. 347/347 backend ×3، 252/252 mobile، 6+4 negative controls، وتدفق كامل على Huawei.

**نقاط ضعف محتملة (راجعها):**
1. **الـ generation مش بيكتشف restore.** هو بيتراجع مع القاعدة؛ الكشف = إجراء مشغّل يدوي (قد يُنسى). هل المشغّل البشري كافي كـ control، ولا محتاجين marker خارجي (خدمة منفصلة/متغيّر بيئة/Neon branch id) كجزء من التصميم؟
2. **L1:** restore بيرجّع provenance وtombstone، فالتعويض ممكن يتكرر عبر التواريخ. اللي عندنا كشف (coexisting) مش منع. هل ده مقبول لـ Production ولا محتاجين سجل recovery خارجي دائم؟
3. التعويض بيثق في تفاصيل الأصل اللي بيبعتها العميل (مفيش تصعيد صلاحيات، لكن مفيش تحقق). كمية التعويض = كمية الإيصال دايماً.
4. الـ fence بيحط tombstone في `stock_idempotency_keys` (نفس جدول الـ idempotency) — عشان `down()` fail-closed و`lookup` يفهموه. هل الأفضل جدول منفصل؟ (ربحنا ذرّية بنفس الـ PK على حساب خلط معاني.)
5. عميل قديم على سيرفر جديد: يعمل re-entry عادي ولا حاجة تربطه بالأصل؛ بنقلّل لكن ما بنمنعش.
6. اختبار الجهاز كشف bug i18n فاتت على Jest؛ ده معناه إن تغطية الواجهة بـ Jest محدودة (مفيش component tests). مفيش اختبار جهازين ولا عربي على الجهاز.
7. ما حصلتش مراجعة خارجية.

**أسئلة تحسمها قبل توصيتك:**
- هل Series 08 (بروفة تشغيلية + R12 + جهازين) هي الأولوية الصح، ولا CP-4 (منح المخازن) أو مقترح dashboard المدير؟
- هل الـ rotation يحتاج step-up (2FA/تأكيد تاني) أو CLI لوحده؟ وهل flag `RECOVERY_OPERATIONS_ENABLED` كافي كـ guard؟
- هل مدة صلاحية الفحص (دقيقتين) وإيصال 7 أيام مناسبين؟
- هل نمنع التعويض لعمليات outbound الكبيرة أو فوق حد معيّن بدون موافقة المدير (مقترح مش مُنفَّذ)؟

**في الـ prompt التنفيذي القادم ضمّن:** اسم المرحلة، الفرع الأساسي (`feature/series07-recovery-integrity`)، acceptance بالأرقام، الموافقات المسموحة (خصوصاً أي بيئة غير إنتاجية)، والممنوعات (AAB/Play/Production/merge). وأشِر إن Claude يقرأ الـ bridge من المكان الرسمي (قسم 00). **ولو فيه مرفق، تأكد إنه فعلاً اتبعت.**

---

## 11 — CHANGELOG (append-only)

- **2026-10-24 20:40 +03:00 — v1.0:** إنشاء الـ bridge أثناء الـ onboarding على `integration/series04` (HEAD وقتها `eb19ab0`).
- **2026-10-24 22:03 +03:00 — v1.1:** نهاية Series 05. نقل المكان الرسمي إلى `preflight/series05-rc-admission`. RC CONDITIONAL GO / Production NO-GO.
- **2026-10-24 22:52 +03:00 — v1.2:** نهاية Series 06. نقل المكان الرسمي إلى `hardening/series06-release-safety`. CP-1 PASS 6/6، CP-2 PASS (synthetic)، PG ×3 = 50/313.
- **2026-10-25 06:45 +03:00 — v1.3:** نهاية Series 07. نقل المكان الرسمي إلى `feature/series07-recovery-integrity` (baseline كود `b3d824f`). S1 تعويض ذرّي من السيرفر، S2 history generation مع rotation مصادَق (بدون ادّعاء كشف restore تلقائي)، PG ×3 = 51/347، mobile 252، جهاز: تدفق كامل (PARTIAL). النسخ على فروع Series 06/05/04 stale. مفيش merge ولا release branch ولا deploy ولا لمس لـ Production/Neon.
- **2026-10-25 (بعد v1.3) — v1.4:** نهاية Series 08 (تصميم وأدلة فقط). نقل المكان الرسمي إلى `design/series08-enterprise-blueprint` (superset من كود Series 07 + `docs/product/`). صفر تغيير كود/اختبارات/اعتماديات. اتكشف بالقراءة الثابتة: D1 (تسريب `costPrice`)، D2/D3 (مفيش offboarding، الدور من claim)، Manager = كل المخازن بالتصميم. الـ milestone التنفيذي التالي المقترح: Series 09 = S0 + S1 (مش مُصرَّح)، وبالتوازي Milestone R. النسخ على فروع Series 07/06/05/04 stale. مفيش merge ولا deploy ولا Production/Neon ولا موديل خارجي.

---

## 12 — SOURCE-OF-TRUTH REFERENCES

**Series 08 (حزمة المنتج والمعمارية — فهرس: `docs/product/README.md`):** `docs/product/STOCKMIND_PRODUCT_BIBLE_V2.md` · `STOCKMIND_CODE_TO_CAPABILITY_GAP_MATRIX.md` · `STOCKMIND_ORGANIZATION_RBAC_SPEC.md` · `STOCKMIND_MOVEMENT_GOVERNANCE_SPEC.md` · `STOCKMIND_ENTERPRISE_UX_BLUEPRINT.md` · `STOCKMIND_ARCHITECTURE_DECISIONS.md` · `STOCKMIND_IMPLEMENTATION_ROADMAP.md` (كلها تحت `D:\Projects\StockMind-wt\series08-enterprise-blueprint\`). **المسارات في الجدول أدناه (Series 07) كانت بجذر worktree الـ Series 07؛ الملفات نفسها موجودة بنفس المسار النسبي داخل worktree الـ Series 08.**

| الموضوع | المسار |
|---|---|
| Master continuity (الرسمي) | `D:\Projects\StockMind-wt\series08-enterprise-blueprint\docs\handoff\STOCKMIND_AI_CONTINUITY.md` · نسخة: `C:\Users\Name\Desktop\StockMind_Handoff\STOCKMIND_AI_CONTINUITY_MASTER.md` |
| تعليمات الـ agents | `D:\Projects\StockMind-wt\series08-enterprise-blueprint\AGENTS.md` |
| تقرير Series 07 | `...\series07-recovery-integrity\docs\handoff\SERIES_07_RECOVERY_INTEGRITY_REPORT.md` |
| عقد Series 07 (API، transaction، ضمانات، trust model) | `...\docs\handoff\SERIES_07_RECOVERY_CONTRACT.md` |
| أدلة Series 07 (جهاز، gates، negative controls) | `...\docs\handoff\series07-evidence\` · لوجات: `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_s07_*.log` · لقطات كاملة: `_local-tools\evidence-s07\` |
| Recovery runbook (v0.3، مسودة) | `...\docs\handoff\STOCKMIND_DATABASE_RECOVERY_RUNBOOK.md` |
| Series 06 (تقرير، مصفوفة الإصلاحات الـ production، release line) | `...\docs\handoff\SERIES_06_RELEASE_SAFETY_REPORT.md` · `SERIES_06_PRODUCTION_EQUIVALENCE_MATRIX.md` |
| Series 05 / 04 | `SERIES_05_RC_PREFLIGHT_REPORT.md` · `SERIES_04_CHECKPOINT.md` + `series04-evidence\` |
| Series 03 checkpoint (backup) | `D:\StockMind_Backups\Checkpoints\SERIES_03_CHECKPOINT_2026-10-20.md` (SHA-256 `B555D4D2…26A6`) |
| Series 02 وما قبله (قراءة فقط) | `D:\Projects\StockMind\.ai-handoff\` |
| دليل المستخدم / resume / تنضيف C: | `C:\Users\Name\Desktop\StockMind_Handoff\` |
| قواعد التفويض العامة | `C:\Users\Name\.claude\ORCHESTRATION.md` |
| اللوجو (محجوز، لا يُعدَّل) | `D:\Projects\StockMind\Glossy Neon Inventory Analytics Icon.png` |
| تعليمات الإصدار | لا يوجد؛ Production NO-GO وAAB/Play ممنوعين بدون أمر منفصل (master قسم E) |
