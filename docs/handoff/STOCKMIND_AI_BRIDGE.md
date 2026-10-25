# STOCKMIND — AI BRIDGE (ChatGPT ↔ Claude)

> الملف ده قناة التواصل الدائمة بين ChatGPT (مراجع/مخطط، من غير وصول للـ filesystem) وClaude (المنفّذ على الجهاز). الـ Director هو اللي بيحمل الملف بينهم.
> اللغة: عربي مصري، والمصطلحات التقنية والمسارات والأوامر وأرقام الـ commits بالإنجليزي زي ما هي.
> **القاعدة الأساسية:** حالة الـ Git والكود الفعلي أقوى من أي حاجة مكتوبة هنا. الملف ده خريطة وتقرير، مش إثبات.
> التصنيفات: `VERIFIED / PARTIAL / UNVERIFIED / BLOCKED / FAILED / DEFERRED`.

> ## ⚠ المكان الرسمي لهذا الملف (ACTIVE CANONICAL)
> **الفرع:** `feature/series12-standalone-qa` — **المسار:** `D:\Projects\StockMind-wt\series12-standalone-qa\docs\handoff\STOCKMIND_AI_BRIDGE.md`
> **الفرع ده superset من `hardening/series11-authorization-admission` (= Series 09 + 10 + 11) + Series 12 (StockMind QA المستقل، حدود الأونلاين المحلي، سكربتات Dev/QA). صفر تغيير backend.**
> **النسخ الأقدم غير سارية (stale):** على `hardening/series11-authorization-admission` (v1.7)، `feature/series10-scoped-access` (v1.6)، `feature/series09-access-foundation` (v1.5)، `design/series08-enterprise-blueprint` (v1.4)، `feature/series07-recovery-integrity` (v1.3)، `hardening/series06-release-safety` (v1.2)، `preflight/series05-rc-admission` (v1.1)، `integration/series04` (v1.0). ماتقراش منهم. نسخة الـ Desktop مطابقة لهذه النسخة بالـ SHA-256.
---

## 00 — BRIDGE METADATA

| البند | القيمة |
|---|---|
| المشروع | StockMind (inventory / WMS SaaS) |
| إصدار الملف | **v1.8** (بعد Series 12 — StockMind QA مستقل عن Metro + workflow Dev/QA) |
| آخر تحديث | **2026-10-25 (التوقيت في الـ changelog قسم 11)** (Egypt Standard Time) |
| الـ session | Claude Code Desktop، `claude-opus-5-5` (Mission 00 + Series 12). Series 07–12 اتنفّذوا بتفويضات Director كاملة في رسائل مستقلة. مفيش identifiers حساسة. |
| المرحلة الحالية | **Series 12 — Developer Runtime Stability & Standalone QA: مكتملة — PASS للنطاق بحدود مكتوبة** (StockMind QA `io.stockmind.app.qa` مثبّت جنب التطبيق القديم على الـ Huawei، بيفتح من غير Metro/USB، أوفلاين شغال، أونلاين محلي اتجرّب). التطبيق القديم `io.stockmind.app` ما اتلمسش. الافتراضي `CAPABILITY_MODE=shadow`؛ `enforce` غير مفعّل. **Series 11 N-1/N-2 (Mission 00) مفتوحين.** Production NO-GO. في انتظار قرارات الـ Director. |
| الحالة | ACTIVE |
| Canonical | `D:\Projects\StockMind-wt\series12-standalone-qa\docs\handoff\STOCKMIND_AI_BRIDGE.md` على `feature/series12-standalone-qa` |
| Desktop mirror | `C:\Users\Name\Desktop\StockMind_Handoff\STOCKMIND_AI_BRIDGE.md` (مطابق بالـ SHA-256) |
| **Verified baseline (مؤشر Git)** | **آخر commit كود تطبيق: `8ca81fc`** (variant QA + حدود الأونلاين + سكربتات + 51 اختبار)؛ سكربتات بعده: `045b204`, `f2747d6`, `f8304bc`, `d63cfbe` (مالهاش أثر على الـ APK). **الـ APK المختبَر اتبنى من `f2747d6`** (كود التطبيق = `8ca81fc`)، SHA-256 `10b3fd473bf7d1fc4e4b612dcbb1b10397d8e63492ff438bde2a7aafaebc7213`. Mobile `tsc`/Jest على كود `8ca81fc`. أي commit بعد `d63cfbe` = docs/evidence فقط: `git -C D:\Projects\StockMind-wt\series12-standalone-qa diff --name-only d63cfbe HEAD` (لازم كلها تحت `docs/`). الفرع من `5902072` (HEAD Series 11). Backend: صفر تغيير من `4547af9`. |
---

## 01 — EXECUTIVE PROJECT STATUS

### Series 12 (StockMind QA مستقل + workflow Dev/QA، موبايل + سكربتات) — الجديد
- **التقرير:** `docs/handoff/SERIES_12_DEVELOPER_RUNTIME_REPORT.md`؛ **العقد:** `docs/handoff/SERIES_12_STANDALONE_QA_CONTRACT.md`؛ الأدلة: `docs/handoff/series12-evidence/` (فحص الـ APK، ledger الـ emulator، تشغيل الـ Huawei، negative controls، 10 لقطات)؛ الدليل للمستخدم: `docs/handoff/STOCKMIND_USER_MANUAL.md` (مُرآة على الـ Desktop).
- **السبب الجذري (مُثبت على الجهاز نفسه):** StockMind المتثبّت على الـ Huawei = `app-debug.apk` بتاع يوليو بالـ SHA-256 (`ce960750…`)، DEBUGGABLE، من غير `index.android.bundle`، بمفتاح RN العام. بيحمّل الكود من Metro عبر `adb reverse`؛ من غيرهم "Cannot connect to Metro" / "Unable to load script". ده تصميم الـ debug build. `expo-dev-client` مش متثبّت أصلاً. `eas.json preview` لوحده مش حل (cloud، نفس الـ id بتوقيع تاني = لازم uninstall = ضياع بياناتك، URL الإنتاج، pinning مكسور).
- **الحل:** variant **StockMind QA** = `io.stockmind.app.qa` release جنب التطبيق القديم: Hermes bundle مضمّن، مش debuggable، توقيع مفتاح QA محلي (DPAPI، خارج Git، البناء يفشل من غيره، أبداً مش مفتاح RN العام)، `app.config.js` + `plugins/with-stockmind-qa.js` (مفيش تعديل يدوي في `android/`). `app.json` والـ build الافتراضي **بدون تغيير**.
- **حدود الأونلاين:** QA = علامتين build مستقلتين (bundle + app config مضمّن بالـ id)، وأونلاين بس لـ loopback/RFC 1918، أبداً host الإنتاج، مفيش رجوع لـ URL الإنتاج، cleartext لـ host واحد بس. Dev builds كمان ممنوع عليها host الإنتاج. Google Sign-In/FCM غير متاحين في QA.
- **السكربتات (`mobile/scripts/`):** `qa-build` (prebuild clean → assembleRelease → فحص 21 بند إلزامي → artifacts + SHA-256)، `qa-inspect-apk`، `qa-install` (جهاز مسمّى، `install -r` بس، فحص ABI، مفيش uninstall/clear/downgrade)، `dev-metro`، `qa-backend-preflight` (`-RestoreReverse`)، `qa-local-backend` (shadow، بدون `.env`)، `qa-seed-synthetic`، `qa-signing-init`.
- **الاختبارات:** Mobile `tsc` 0؛ Jest **22 suites / 359** (+51)؛ negative controls 10/10 أحمر؛ الـ APK المختبَر 21/21 فحص؛ Hermes bundle متطابق بالبايت بين بيلدين. Backend صفر تغيير (build نضيف 12/12 + تكامل حقيقي في Gate C).
- **emulator Android 10 (معزول):** Gate A 10/10 cold + 5/5 warm؛ Gate B كامل (رفض صرف زيادة، process death، airplane، عربي RTL)؛ Gate C (Owner/Manager/Staff، التكلفة مش بتوصل لـ Manager/Staff، shadow ظاهر بصدق، انقطاع → طابور → تسليم مرة واحدة).
- **الـ Huawei (بحضور وتفويض الـ Director):** QA اتثبّت جنب القديم (القديم بنفس سجله وتوقيعه)؛ Gate A: الـ Director 10/10 مع الـ USB مفصول، الـ log بيأكد 7 (صفر أخطاء)؛ Gate B: الـ Director كل الخطوات؛ Gate C: Staff دخول + W1 بس + استلام +2 مرة واحدة (53→55)، بعد تشخيص "مش قادرين نوصل للخادم" = قاعدة `adb reverse` اتشالت مع إعادة توصيل الـ USB (مش عيب كود).
- **مفتوح:** Series 11 **N-1** (trigger آخر owner بياخد `companies FOR UPDATE` بعد أقفال الأعضاء) و**N-2** (`snapshot()` غير مرئي) — blockers قبل أي بروفة enforce. ملاحظات واجهة (أهمها "Current balance: 0" أونلاين لما الـ backend واقع).

### Series 11 (تصليب تفويض السلطة، كود + اختبارات) — مرجع
- **التقرير:** `docs/handoff/SERIES_11_AUTHORIZATION_HARDENING_REPORT.md`؛ **العقد:** `docs/handoff/SERIES_11_ENFORCEMENT_ADMISSION_CONTRACT.md`؛ الأدلة: `docs/handoff/series11-evidence/` (إعادة إنتاج قبل الإصلاح، negative controls، أداء).
- **F11-01 (مؤكَّد بإعادة إنتاج على كود Series 10):** منحة صلاحيات كانت بتعمل commit بعد ما سلطة الـ admin المانح اتسحبت بـ commit سابق (demote/suspend/remove + مسار legacy اللي مكانش بيعيد تفويض الـ actor أصلاً). **مصلّح:** بروتوكول أقفال عالمي (الـ actor shared + الهدف exclusive كمجموعة مرتبة بالـ id، company KEY SHARE، `lock_timeout` + `AUTHORITY_BUSY` 503)، الـ legacy وCP-4 بيعيدوا التفويض جوه الـ tx.
- **اكتشافات إضافية مؤكدة:** F11-05 مفتاح القفل غير canonical (UUID كبير = قفل تاني)، F11-06 admin من شركة تانية بيتحبس خلف قفل عضو غريب، **F11-07 deadlock حقيقي بين كتابة مخزون وإجراء عضوية (500)**، F11-08 الـ legacy PUT كان بيسيب منح بنطاق بصمت (دلوقتي 409)، **F11-09 تجويع: suspend استنّى 9:45 د تحت كتابة متواصلة** (مصلّح: قفل عضوية عادل بدل `FOR UPDATE` على صف الشركة).
- **F11-02:** `CAPABILITY_MODE` غلط **بيرفض الإقلاع** (مش بيتحول لـ off). الافتراضي لسه `shadow`. **F11-04:** فرق shadow "expected" فقط لو grant نشط على نفس المخزن بنفس الـ capability؛ غياب الأدلة = `incomplete`.
- **F11-03:** suite كاملة تحت enforce (63 suite/552) ما عدا الـ fixture الإنتاجي المجمّد؛ بديله يحمل نفس العناوين الـ8 (مُلزَم باختبار) وهو نفسه بيفشل مغلقاً تحت enforce (6 رفض/2 عدّى).
- **الرجوع:** enforce→off/shadow **بيضيّق فقط**؛ الـ grants بتفضل dormant (`effective:false`) وبترجع مع enforce — قرار مشغّل بأثر أمني، مفيش fallback تلقائي.
- **الاختبارات:** Backend PG **×3 على قواعد جديدة: 64 suites + 4 skipped، 560 passed + 4 skipped في كل تشغيلة** (Series 10: 57/459) + enforce 63/552؛ build نضيف 12/12 migrations (**لا migration جديدة**)؛ Mobile `tsc` 0 وJest 20/308 (بدون تغيير). Negative controls 23 تعريف على 4 جولات (3 ما اتمسكوش في الجولة الأولى واتصلحوا؛ مكافئان بالتصميم موثّقان).
- **الأداء (محلي):** shadow +2.19 ms (كان +3.09)، enforce +1.72 ms، منحة وسيط 10.96 ms وحدها و40 ms تحت 4 كتّاب متواصلين؛ **0 deadlock، 0 AUTHORITY_BUSY**.
- **الجهاز:** **ما اتلمسش** (Huawei/adb). **Production: NO-GO.** سياسات R-18/R-19/R-20 سياسة غير منفَّذة (بدون تغيير).

### Series 10 (S2، كود) — مرجع
- **التقرير:** `docs/handoff/SERIES_10_SCOPED_ACCESS_REPORT.md`؛ **العقد:** `docs/handoff/SERIES_10_CAPABILITY_AUTHORIZATION_CONTRACT.md`؛ الأدلة: `docs/handoff/series10-evidence/`.
- **النتيجة: ENGINEERING PASS — PHYSICAL DEVICE DEFERRED.** محرك قدرات (capability engine) default-deny بنظرتين (`legacy` = القرار قبل Series 10 حرفياً، `scoped` = الجديد)؛ `CAPABILITY_MODE=off|shadow|enforce` (الافتراضي **shadow**: القديم يقرر والجديد يُحسب ويُقارن)؛ profiles بإصدارات (`operator v1` = Staff الحالي بالظبط، `warehouse_manager v1` = operator + تسوية + تحويل + تعديل بيانات المخزن)؛ `access_grants` بنطاق مخزن مع أحداث append-only؛ `warehouse_access` القديم = grants `operator` ضمنية (dual-read بدون نسخ). **الـ Manager العالمي بدون تغيير (كل المخازن)؛ مدير المخزن المحدود = Staff + grant.**
- **مفعول فقط تحت `enforce`:** نطاق المخزن الفعلي (خارج النطاق = 404 مطابق لمخزن غير موجود)، `GET /me/capabilities`، `PUT /team/members/:id/access` (بإصدار تفاؤلي، anti-escalation، لا تعديل ذاتي)، **CP-4** (مخزن جديد = لا أحد؛ `initialAccess` ذرّي اختياري)، تفويض داخل الـ transaction (مع قفل عضو عادل) — سحب منحة أو تغيير دور أثناء كتابة جارية بيرفض الكتابة بدون أثر في الـ ledger.
- **الموبايل:** تنقل وأزرار متكيّفة من `/me/capabilities` (snapshot في الذاكرة فقط)، شاشة `team-access`، نموذج CP-4 — **منطق + Jest فقط، لا جهاز ولا component tests**.
- **الاختبارات:** Backend PG **×3 على قواعد جديدة: 57 suites + 3 skipped، 459 passed + 3 skipped في كل تشغيلة** (Series 09: 54/395) + تشغيلة enforce إضافية 55 suites/438؛ build نضيف 12/12 migrations؛ Mobile `tsc` 0 وJest **20 suites، 308 tests** (كان 18/273). Negative controls: backend N1–N14، mobile MM1–MM8 — كلها أحمر في النهاية (اتنين ما اتمسكوش من أول مرة: N6 وN14، موثّقين بصدق).
- **اكتشافات هندسية:** (1) تجويع `FOR UPDATE` خلف `FOR SHARE` متداخل، (2) deadlock عبر مفتاح الـ idempotency FK، (3) **عكس ترتيب أقفال كامن من Series 09** بين التعويض وتغيير العضوية (D11) — اتصلحوا بقفل advisory عادل لكل عضو وترتيب موحّد (company ← عضو ← مخازن)؛ 0 deadlocks في الضغط.
- **الأداء (محلي):** طلب محروس وسيط off 3.58 / shadow 6.67 (+3.09) / enforce 5.17 (+1.59) ms؛ `/me/capabilities` ≈3.2 ms؛ كتابة مخزون وحدها 9.5 ms ومع سحب/منح متكرر p95 26.8 ms.
- **سياسات Director بعد Series 09 (POLICY لا IMPLEMENTED — انظر قسم 07):** R-18 تنظيف `audit_logs` (معتمد مبدئياً، محجوب على Production)، R-19 ملكية legacy بدليل ومشغّل، R-20 رفض مالي افتراضي للـ Manager (الرفض الافتراضي **منفَّذ**؛ `item.set_cost` وصلاحية مالية بنطاق مخزن **غير منفَّذين**).
- **الجهاز:** **ما اتلمسش** (Huawei/adb)؛ كل سيناريو جهاز = **DEFERRED — DIRECTOR PHYSICAL ACCESS REQUIRED**. **Production: NO-GO** (بدون تغيير).

### Series 09 (S0 + S1، كود) — مرجع
- **التقرير:** `docs/handoff/SERIES_09_ACCESS_FOUNDATION_REPORT.md`؛ **العقد:** `docs/handoff/SERIES_09_AUTHORIZATION_AND_PRIVACY_CONTRACT.md`؛ الأدلة: `docs/handoff/series09-evidence/`.
- **S0 = PASS:** D1 **اتأكد تشغيلياً** (Staff استلم `costPrice` في list وdetail) ثم اتقفل: allowlist DTO + صلاحية `item.view_cost` (Admin فقط افتراضياً؛ Manager لا تلقائياً) + `Vary: Authorization` + redaction في الـ audit. **اكتشاف جديد D10:** الـ `audit_logs` كانت بتخزّن التكلفة بالنص الصريح (4 صفوف في الاختبار) — اتقفلت للكتابة الجديدة؛ **الصفوف القديمة لسه ممكن تحتويها (تنظيف مشغّل غير منفّذ).**
- **S1 = PASS (backend VERIFIED؛ mobile unit فقط):** migration `1792600000000` (`status`, `token_version`, `is_owner`, trigger آخر owner، `membership_events`)؛ كل طلب بيقرأ صف العضو (status/tv/الشركة/**الدور من الـ DB**) فالتعليق/الإزالة/تغيير الدور/إنهاء الجلسات بتسري **من أول طلب بعدها**؛ فحص `FOR SHARE` جوه transaction الحركات والتعويض وتدوير الـ generation؛ سياسة نقية (owner فقط على Admins، لا ذاتي، آخر owner محمي، ترقية Manager/Admin بتأكيد صريح)؛ شاشة Team؛ الـ outbox بيحجز العمليات عند `ACCESS_REVOKED` ومبيبعتهاش تلقائياً بعد إعادة التفعيل.
- **الاختبارات:** Backend PG **×3 على قواعد جديدة: 54 suites + 2 skipped، 395 passed في كل تشغيلة** (كان 51/347)؛ build نضيف 11/11 migrations؛ Mobile `tsc` 0 وJest **18/18، 273/273** (كان 252). Negative controls: backend 9/9 أحمر، mobile 4/4. أداء البحث لكل طلب: **+0.33 ms وسيط** محلياً.
- **الجهاز:** **ما اتلمسش** (قاعدة سلامة: المدير عن بُعد، Huawei على USB، بدون أي تفاعل يحفّز البصمة/القفل). كل سيناريو جهاز = **DEFERRED — DIRECTOR PHYSICAL UNLOCK REQUIRED**.
- **Production: NO-GO** (بدون تغيير).

### Series 08 (تصميم وأدلة فقط) — مرجع
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

- **المهمة المعتمدة (اكتملت): Series 12 — Developer Runtime Stability & Standalone QA Foundation** (تفويض Director كامل في المحادثة): تطبيق QA مستقل عن Metro/USB/الكمبيوتر، منفصل عن `io.stockmind.app`، workflow Dev منفصل، أونلاين محلي آمن، بوابات A–D، توثيق. **ممنوع كان:** Production/Neon، deploy، AAB/Play، cloud/EAS، تعديل أو مسح التطبيق القديم، enforce، ميزات جديدة، Council/موديل خارجي. الجهاز: بعد تأكيد الـ Director الصريح بخطة محددة فقط (حصل). **الحالة:** مكتملة؛ STOP بعدها. وقبلها **Mission 00** (تهيئة جلسة، قراءة فقط): كشفت N-1/N-2 (القسم 07).
- **المهمة السابقة (اكتملت): Series 11 — تصليب تفويض السلطة** (تفويض Director كامل في المحادثة): F11-01 إلغاء سلطة المانح، F11-02 تحقق `CAPABILITY_MODE`، F11-03 تغطية enforce، F11-04 دقة تصنيف shadow، والرجوع بين الأوضاع. **ممنوع كان:** Production/Neon، merge، AAB/Play، موديل خارجي/Council، أي تفاعل مع Huawei/adb، تفعيل enforce عالمياً، ميزات جديدة. **الحالة:** مكتملة؛ STOP بعدها (لا بروفة enforce ولا مرحلة تالية).
- **المهمة السابقة (اكتملت): Series 10 — S2.**
- (تفصيل) Series 10: **S2 فقط** (تفويض Director كامل في المحادثة): capability profiles + scoped grants + `/me/capabilities` + تنقل متكيّف + CP-4 فوق Series 09، مع الحفاظ على معنى Manager العالمي و`warehouse_manager` كـ profile بنطاق، وحماية Owner/Admin، ورفض مالي افتراضي، وسلامة المخزون والـ offline والتعويض. **لم يُنفَّذ (بقرار):** موافقات، dashboard حي، عهدة متقدمة، محاسبة مالية. **قيود:** ممنوع أي تفاعل مع جهاز Huawei/adb، Production/Neon، merge، AAB/Play، خدمات مدفوعة، موديل خارجي/Council. **الحالة:** مكتملة؛ STOP بعدها.
- **المهمة السابقة (اكتملت): Series 09 — S0 + S1 فقط.**
- (تفصيل) Series 09: التفويض كان رسالة Director كاملة في المحادثة: إثبات الاستغلال أولاً، `item.view_cost` وDTOs، دورة حياة الأعضاء والإبطال الفوري، Team screen، سلوك الـ outbox عند الإبطال، اختبارات سلبية، gates، تقارير. **قيود الأمان:** ممنوع أي تفاعل مع جهاز Huawei (قفل/إعادة تشغيل/مسح بيانات/إلخ)، ممنوع Production/Neon/merge/AAB/خدمات مدفوعة/موديل خارجي. قرارات Q-01..Q-18 اتعتمدت كاتجاه (انظر `STOCKMIND_ARCHITECTURE_DECISIONS.md` آخر جدول). **الحالة:** مكتملة.
- **المهمة السابقة (اكتملت): Series 08 — تصميم وأدلة فقط.** التفويض كان رسالة Director كاملة (موجودة في المحادثة): جرد الكود مقابل الرؤية المجمّعة من 5 نماذج + Product Bible v1.0، وكتابة حزمة معمارية/صلاحيات/حركات/UX/ADR/roadmap، بدون أي تنفيذ. الفرع `design/series08-enterprise-blueprint` من `dc4ff4d`. **ممنوع كان:** كود، migrations، اعتماديات، Production/Neon، Council/موديل خارجي، merge، AAB/Play. **الحالة:** مكتملة؛ الحكم المقترح PASS لنطاقها. بوابات القبول §12 في التفويض: مفيش كود اتغيّر (يتحقق بـ `git diff`)، كل مقترح Bible ليه disposition، الـ 12 workflow مغطّاة، الصلاحيات والخصوصية محدّدة، دلالات الـ feed صادقة، عوائق Production محفوظة، شرائح بمعايير قبول قابلة للاختبار.
- **المهمة السابقة (اكتملت):** Series 07 — **S1 + S2 فقط**، على worktree/فرع معزول، Production NO-GO. التفويض كان رسالة Director كاملة (موجودة في المحادثة).
- **الهدف:** (1) منع تكرار re-entry بالخطأ أو بالتزامن لعمليات اتأكدت وغابت بعد restore؛ (2) هوية history generation صريحة تخلّي العملاء يعيدوا بناء حالتهم ويفحصوا إيصالاتهم، من غير ادّعاء كشف restore تلقائي.
- **المخرجات (اتسلّمت):** migration `1792590000000`؛ backend (`stock-replacement.service`, `history-generation.service`, lookup/sync/controllers)؛ mobile (`replacement.ts`، شاشة `outbox-review`، cursor بـ generation)؛ `recovery-integrity.pg.spec.ts` (32) + اختبارات mobile (49)؛ التقرير + العقد + runbook v0.3؛ أدلة الجهاز؛ bridge v1.3 + master + Desktop.
- **مستبعد (ما اتعملش):** dashboard المدير، هرمية المخازن، UI الفريق، صلاحيات المنتجات، approval workflows (الـ Director بيجهّز مقترح منفصل)، CP-4/CP-5، billing، Viewer، multi-org، تعديل الاعتماديات، TLS/Google، Neon/Production، AAB/Play، Council/موديل خارجي، أي merge، لمس `main` المتّسخ.

---

## 04 — CHANGES MADE

**Series 12:** `c3eeb94` docs: نسخة الدليل القديم كما هي (قبل التصحيح). `8ca81fc` feat(mobile): `app.config.js`، `plugins/with-stockmind-qa.js`، `src/domain/build-variant.ts` (+test)، `qa-build-config.test.ts`، `lib/dev-flags.ts`، `api/client.ts`، كارت QA في Settings + شارة QA PREVIEW (login/mode)، i18n ar/en، `mobile/README.md`، `mobile/scripts/*` (8 سكربتات). `045b204` علامة dirty لـ `mobile/` بس. `f2747d6` المفتش يلاقي الـ network config باسمه المتقصّر. `f8304bc` الـ installer: فحص ABI + host من سجل البيلد. `d63cfbe` الـ preflight: `-RestoreReverse` + طرف الموبايل. ثم docs: التقرير، العقد، الأدلة، الدليل المصحّح، bridge v1.8، master. **migrations: صفر، backend: صفر، اعتماديات (`package*.json`): صفر.** تغييرات سلوك: Dev online ممنوع على host الإنتاج (كان مسموح لو اتكتب صراحة)؛ مفيش تغيير تاني للبيلد الافتراضي.

**Series 11:** `8f5bfe3` fix(authz): `member-lock.ts` (lockMembers مرتبة، canonical، lockForAuthorityChange، authorityTransaction + AUTHORITY_BUSY)، `access-grant.service` / `team.service` (legacy) / `warehouse.service` (CP-4) / `membership.service`، `stock.service` (company key-share قبل قفل العضو)، `capabilities.constant` (CapabilityModeError + parse/validate)، `app.module` (+import-time check + ConfigModule validate)، `main.ts`، `shadow-classifier.ts` (جديد)، `capability.service` (CapabilityShadowService: observePermission/observeScope/incomplete)، `permissions.guard`، `warehouse-access.service`. `399b91b`,`e17b6b8`,`b5251c4` اختبارات (authority-linearization 27، classifier 17، mode 23، shadow.service 13، enforce-coverage 10، member-lock 8، lock-order 2، + rollback في capability-shadow.pg). `f0d9df1` fix F11-09 (قفل عضوية عادل) + `authority-lock-perf`. `4547af9` أدلة. ثم التقرير والعقد والـ handoff. **migrations: صفر (12 إجمالاً)، اعتماديات: صفر، mobile: صفر.** تغييرات سلوك ظاهرة: invalid `CAPABILITY_MODE` = رفض إقلاع؛ 503 `AUTHORITY_BUSY` بدل 500 عند تعارض أقفال؛ legacy PUT بيرفض بـ 409 `SCOPED_GRANTS_PRESENT`؛ `GET /team/members/:id/access` بيرجّع `effective` لكل تعيين.

**Series 10:** `5a24c17` feat(access) backend core (migration `1792610000000-ScopedAccess`، `capabilities.constant`، `capability-evaluator`، `CapabilityService`/`CapabilityShadowService`، `member-lock`، `actor-guard.assertActorAuthorized`، `AccessGrantService`، `MeController`، تعديل guards/warehouse-access/team/membership/warehouse/DTOs). `807676a` tests + قفل العضو العادل (stock/replacement/history-generation). `a8a6ab3` feat(mobile) (`capabilities.ts`، `capability-signal.ts`، store، hooks، `team-access.tsx`، CP-4 في `warehouse/new.tsx`، تنقل/أزرار، i18n ar/en). `d33b2f6` العقد + docs المنتج + negative controls. `2bb0053` إصلاح اقتباس في اختبار. `33c3039` ملخص gates + أداء. ثم التقرير والـ bridge والـ master. **migration جديدة واحدة (12 إجمالاً)، اعتماديات: صفر.** تغييرات سلوك (الافتراضي shadow = لا تغيير في القرارات): لا شيء ظاهر للمستخدم تحت shadow غير `GET /me/capabilities` وواجهة الصلاحيات؛ تحت `enforce` نطاق المخازن للـ grants. `item.set_cost`: موثّق فقط.

**Series 09:** (1) `dc83f6b` feat(privacy): `product-response.dto.ts`، `item.view_cost`، `PermissionService.userHas`، controller، redaction في interceptor وsink، NT-12 + spec الإثبات. (2) `7f55d09` feat(access): migration `1792600000000-AccessLifecycle`، `User` entity، `JwtStrategy` (DB-backed)، `AuthService`، `MembershipService`، `membership-policy.ts`، `actor-guard.ts`، Team controller/DTOs، stock/replacement/rotation recheck، entitlements seats، تعديل 4 fixtures، اختبارات. (3) `1399b33`,`e49e3bb`,`3b9bb69` اختبارات (status لوحده، قياس الأداء، NT-32/NT-37). (4) `00b494e` feat(mobile): Team screen، `team-actions`، `access-notice.store`، outbox/auth-flow/client/login، i18n ar/en، اختبارات. (5) docs: التقرير، العقد، أدلة، تحديث `docs/product/*`، bridge v1.5، master. **migration جديدة واحدة (11 إجمالاً)، اعتماديات: صفر.** تغييرات سلوك: الـ Manager لا يرى `costPrice`؛ تغيير كلمة السر وإنهاء الجلسات الذاتي بيبطلوا الـ access token فوراً؛ seats لا تحسب المحذوفين.

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

**Series 12 (كود تطبيق `8ca81fc`؛ APK من `f2747d6`؛ synthetic فقط):**

| الفحص | النتيجة |
|---|---|
| Mobile `tsc` / Jest | 0 / **22 suites، 359 tests** (+51) |
| Negative controls (حدود QA) | 10/10 أحمر |
| بيلد APK محلي (release، بدون AAB/cloud) | 4 محاولات؛ المختبَر `stockmind-qa-428472-f2747d6.apk` = 21/21 فحص (id، label، مش debuggable، Hermes bundle، config مضمّن من غير URL إنتاج، activity، cleartext host واحد، توقيع QA ≠ مفتاح RN العام)؛ bundle متطابق بالبايت بين بيلدين |
| emulator Android 10 | Gate A 10/10 cold (675–790 ms) + 5/5 warm + swipe-away، صفر أخطاء؛ Gate B كامل؛ Gate C كامل (3 أدوار، تكلفة، shadow، انقطاع/طابور/تسليم مرة واحدة) |
| **Huawei JSN-L22 (Android 10)** | تثبيت جنب القديم (القديم بنفس سجله)؛ Gate A: Director 10/10 USB مفصول، log 7 فتحات نضيفة؛ Gate B: Director كل الخطوات؛ Gate C: Staff دخول/W1/استلام +2 مرة واحدة |
| Backend | صفر تغيير؛ build نضيف 12/12؛ إقلاع shadow على `stockmind_qa_local`؛ ما اتعادتش suites الـ PG |

**ما لم يُختبر في Series 12:** بصمة على الجهاز (ما ظهرتش)، Owner/Manager وتسلسل الانقطاع على الجهاز، قفل الكمبيوتر فعلياً، جهازين، iOS، Google Sign-In/FCM في QA.

**Series 11 (كود: آخر commit مختبَر `4547af9`، PostgreSQL 15.19 مؤقتة على 127.0.0.1:55433، بيانات synthetic):**

| الفحص | النتيجة |
|---|---|
| Backend `tsc` / build نضيف | exit 0 / exit 0، `dist/main.js` ✓، **12/12 migrations** |
| **Backend PG كامل ×3 (shadow الافتراضي، DB جديدة)** | **64 suites + 4 skipped · 560 passed + 4 skipped · exit 0 ×3** |
| تشغيلة enforce كاملة | 63 suites + 4 skipped · 552 passed · exit 0 (الـ fixture المجمّد `movement-history.security` الإنتاجي مُستثنى ومبرَّر) |
| الـ fixture المجمّد تحت enforce | 6 رفض / 2 عدّى = fail closed |
| Mobile `tsc` + Jest | exit 0 · 20 suites، 308 tests (بدون تغيير) |
| Negative controls | 23 تعريف: الكل أحمر ما عدا N4a/N4b (طبقتين متكافئتين؛ N4c أحمر) وN6c (defence-in-depth) — وثلاثة ما اتمسكوا من أول مرة (N1,N4,N6) واتصلحوا |
| Skipped الأربعة (شرطية) | `capability-perf` و`authority-lock-perf` اتشغّلوا صراحةً (نجحوا)؛ `s0-cost-exposure.repro` و`auth-lookup.perf` **ما اتشغّلوش** |
| الجهاز | **لم يُجرَّب** (DEFERRED — DIRECTOR PHYSICAL ACCESS REQUIRED) |

**ما لم يُختبر في Series 11:** بيانات حقيقية (حتى غير إنتاجية)، قاعدة بعيدة، جهاز/RTL، Neon/Production، جهازين، مراجعة خارجية.

**(الجداول التالية تخص كود Series 10 والأقدم فقط.)**

**Series 10 (كود: آخر commit مختبَر `2bb0053`، PostgreSQL 15.19 مؤقتة على 127.0.0.1:55433، بيانات synthetic):**

| الفحص | النتيجة |
|---|---|
| Backend `tsc` / build نضيف | exit 0 / exit 0، `dist/main.js` ✓، **12/12 migrations** |
| **Backend PG كامل ×3 (قواعد جديدة، shadow الافتراضي)** | **57 suites + 3 skipped · 459 passed + 3 skipped · exit 0 ×3** |
| تشغيلة enforce (`CAPABILITY_MODE=enforce`) | 55 suites · 438 passed، exit 0 (استُثني `movement-history.security` ×2: بتركّب controllers بدون نموذج القدرات فـ enforce بيرفض بتصميمه) |
| `capability-evaluator` / `scoped-access.pg` / `capability-shadow.pg` / `release-safety.migration` | 28 / 25 / 6 / 29 |
| Mobile `tsc` + Jest | exit 0 · 20 suites، 308 tests |
| Negative controls | backend N1–N14 أحمر (N6 وN14 اتمسكوا بعد تقوية)؛ mobile MM1–MM8 أحمر |
| الأداء | انظر قسم 01 / `series10-evidence/s2-perf.json` |
| الجهاز | **لم يُجرَّب** (DEFERRED — DIRECTOR PHYSICAL ACCESS REQUIRED) |

**ما لم يُختبر في Series 10:** أي جهاز/emulator/RTL؛ component tests؛ جهازين؛ Neon/Production؛ shadow على بيانات حقيقية؛ قاعدة بعيدة؛ مراجعة خارجية.

**(جداول Series 09 وSeries 07 أدناه تخص كودهم فقط وما تُنسبش لكود Series 10.)**

**Series 09 (كود: آخر commit مختبَر `3b9bb69`، PostgreSQL 15.19 مؤقتة على 127.0.0.1:55433، بيانات synthetic):**

| الفحص | النتيجة |
|---|---|
| Backend `tsc` / build نضيف | exit 0 / exit 0، `dist/main.js` ✓، 11/11 migrations |
| **Backend PG كامل ×3 (قواعد جديدة)** | **54 suites + 2 skipped · 395 passed + 2 skipped · exit 0 ×3** |
| `financial-privacy` (NT-12) / `access-lifecycle` / `membership-policy` / `release-safety.migration` | 14 / 15 / 14 / 24 |
| Mobile `tsc` + Jest | exit 0 · 18/18 suites، 273/273 |
| Negative controls | backend M0–M8 أحمر (M1 كانت خضراء أول مرة فأُضيف اختبار)؛ mobile 4/4 |
| أداء البحث لكل طلب | +0.33 ms وسيط (+0.18 p95) محلياً |
| الجهاز | **لم يُجرَّب** (DEFERRED — DIRECTOR PHYSICAL UNLOCK REQUIRED) |

**ما لم يُختبر:** أي جهاز حقيقي أو emulator؛ جهازين؛ Neon/Production؛ شركات legacy حقيقية (backfill مُختبَر على بيانات synthetic فقط)؛ Redis؛ Google/SAML بتدفق كامل مع عضو موقوف (محمي بنفس `assertMayAuthenticate` لكن مفيش اختبار HTTP مخصّص).

**أرقام Series 07 أدناه كما هي (كود `b3d824f`).**

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

- **Series 12:** الفرع `feature/series12-standalone-qa` (worktree `D:\Projects\StockMind-wt\series12-standalone-qa`) من `5902072`؛ الرفع (بدون force) في الرد النهائي. `mobile/node_modules` **نسخة حقيقية** (robocopy من `series04-integration`، نفس الـ lockfile)؛ backend `node_modules` junction على `shared-warehouse`. `mobile/android/` متولّد لـ QA (git-ignored، علامة `.stockmind-variant`). أدوات محلية جديدة: `_local-tools\qa-signing\` (مفتاح QA + كلمة سر DPAPI — **خذ نسخة احتياطية**)، `_local-tools\artifacts\stockmind-qa\` (APKs + سجلات + `latest.json`)، لوجات `_local-tools\logs\s12-*`. Android SDK: اتثبّت NDK 26.1.10909125 (sdkmanager) وGradle نزّل NDK 25.1.8937393 (رخصة موجودة من قبل)، و`system-images;android-29;default;x86_64` + AVD `stockmind_qa_api29`. خدمات شغالة وقت كتابة الـ bridge: PostgreSQL 55433، backend مؤقت `:3000` (`stockmind_qa_local`، shadow)، `adb reverse tcp:3000` على الـ Huawei. **Huawei:** عليه `io.stockmind.app` (ما اتلمسش) + `io.stockmind.app.qa`.
- **Series 11:** الفرع `hardening/series11-authorization-admission` (worktree `D:\Projects\StockMind-wt\series11-authorization-admission`) من `7e695d8`؛ الرفع (بدون force) في الرد النهائي (`git ls-remote --heads origin hardening/series11-authorization-admission`). `node_modules` junctions (backend على `shared-warehouse`، mobile على `series04-integration`). PostgreSQL المؤقت (55433) لسه شغّال بقواعد scratch `stockmind_gate_s11_*`. Huawei/adb: **ما اتلمسوا**. `freellmapi` ECONNREFUSED (ما استُخدم). ما اتعدّلش أي worktree تاني (نسخة اختبار مؤقتة اتحطت في worktree Series 10 واتمسحت؛ نضيف).
- **Series 10:** الفرع `feature/series10-scoped-access` (worktree `D:\Projects\StockMind-wt\series10-scoped-access`) من `d24719d`؛ الرفع (بدون force) في الرد النهائي (`git ls-remote --heads origin feature/series10-scoped-access`). PostgreSQL المؤقت (55433) لسه شغّال بقواعد scratch `stockmind_gate_s10_*`. Huawei/adb: **ما اتلمسوا**. `freellmapi` ECONNREFUSED (ما استُخدم).
- **Series 09:** الفرع `feature/series09-access-foundation` (worktree `D:\Projects\StockMind-wt\series09-access-foundation`) من `af7f61f`؛ الرفع (بدون force) في الرد النهائي (`git ls-remote --heads origin feature/series09-access-foundation`). `node_modules` junctions على `shared-warehouse` (mobile: نفس الفكرة؛ كفاية لـ tsc/Jest، مش لـ Metro). PostgreSQL المؤقت (55433) **لسه شغّال** بقواعد scratch `stockmind_gate_s09_*`. Huawei: **ما اتلمسش**.

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

## 07 — RISKS, BUGS & DEFERRED WORK  (Series 11: التقرير §13–14؛ Series 10: تقريره §10)

**مفتوح من Mission 00 (Series 11، لم يُصلَح — blockers قبل أي بروفة enforce):**

| # | الخطورة | التصنيف | الوصف |
|---|---|---|---|
| **N-1** | متوسطة-منخفضة | PLAUSIBLE (قراءة كود، بدون repro) | الـ trigger `users_guard_last_owner` (`1792600000000`) بياخد `companies FOR UPDATE` عند suspend/remove لـ owner نشط **بعد** أقفال الأعضاء — عكس العقد §2: deadlock محتمل مع كتابة نفس الـ owner، وتجويع محدود (10s → `AUTHORITY_BUSY`) |
| **N-2** | متوسطة (للبروفة) | CONFIRMED | `CapabilityShadowService.snapshot()` مالوش أي caller؛ `incomplete` مش بيتسجّل → بوابة §15 "0 incomplete" مش قابلة للقياس برّه الـ process |
| N-3 | منخفضة | CONFIRMED | الموبايل مش بيعرف `AUTHORITY_BUSY`/`SCOPED_GRANTS_PRESENT` (رسالة عامة) |
| N-4 | منخفضة | PLAUSIBLE | `enforce-coverage.spec` بيقارن عناوين بس |

**مخاطر Series 12:**

| # | الخطورة | الوصف | الإجراء |
|---|---|---|---|
| R-34 | منخفضة | QA أونلاين على `127.0.0.1` محتاج USB، وكل إعادة توصيل USB بتشيل `adb reverse` (حصل فعلاً) | `qa-backend-preflight -RestoreReverse`؛ أو بيلد LAN |
| R-35 | منخفضة | ABIs جزئية (`armeabi-v7a`/`x86` = 50/56) | الـ installer بيرفض جهاز هيحمّل ABI ناقص؛ الـ Huawei arm64 |
| R-36 | متوسطة | ضياع مفتاح QA أو DPAPI (reinstall ويندوز) = QA جديد مايتثبّتش كتحديث → لازم uninstall QA (بيانات QA بس) | نسخة احتياطية من `_local-tools\qa-signing\` (قرار Director) |
| R-37 | منخفضة-متوسطة | "Current balance: 0" في شاشة الاستلام الأونلاين لما الـ backend واقع (القيمة الحقيقية مجهولة) — مخالفة لمبدأ الحالة الصادقة (قائم قبل Series 12) | milestone تصليب |
| R-38 | منخفضة | Google Sign-In/FCM غير متاحين في QA؛ Node 26 مش مدعوم رسمياً مع SDK 51؛ `SYSTEM_ALERT_WINDOW` في الـ manifest (قائم) | موثّق |

**مخاطر Series 11 المتبقية:**

| # | الخطورة | الوصف | الإجراء |
|---|---|---|---|
| R-28 | عالية قبل أي إنتاج | `enforce` لسه ما اتجرّبش على بيانات حقيقية (حتى غير إنتاجية)؛ الأدلة synthetic | بروفة شروطها في تقرير Series 11 §15 (بتفويض منك) |
| R-29 | متوسطة | تليمتري shadow في الذاكرة فقط (per-process، بتتصفّر، بلا aggregation/alerting) | كفاية لبروفة محكومة؛ مش لقرار إنتاج |
| R-30 | متوسطة | `FOR UPDATE` على صف الشركة لسه في تدوير الـ generation وقبول الدعوة وإعادة تفعيل محذوف (مش سحب سلطة، لكن ممكن تتجوّع تحت كتابة متواصلة؛ بعضها بلا مهلة) | موثّق؛ قرار لاحق |
| R-31 | متوسطة (UNVERIFIED) | قياس الأداء محلي فقط؛ على قاعدة بعيدة أعلى | قياس ضمن البروفة |
| R-32 | منخفضة-متوسطة (UNVERIFIED) | سباق migrations لو نسختين أقلعوا معاً على نفس القاعدة (`migrationsRun:true`) — لوحظ في الـ harness | خارج النطاق؛ يتفحص قبل نشر متعدد النسخ |
| R-33 | منخفضة | `AUTHORITY_LOCK_TIMEOUT_MS` الافتراضي 10s قرار منتج لم يُراجَع؛ الواجهة ما بتعالج 503 `AUTHORITY_BUSY` بشكل خاص | قرار + اختبار جهاز |
| F11-closed | اتقفلت | F11-01/01b/05/06/07/08/09/02/04 | انظر القسم 01 |

**سياسات Director بعد Series 09 (POLICY ≠ IMPLEMENTED) — بدون تغيير:**

**حالة بعد Series 10 — سياسات Director بعد Series 09 (POLICY ≠ IMPLEMENTED):**

| # | السياسة المعتمدة | منفَّذ؟ | عائق Production |
|---|---|---|---|
| **R-18** | تنظيف `audit_logs` القديمة اللي فيها `costPrice` نصي: جرد بدون تصدير قيم، redaction ضيق idempotent (مختبَر على بيانات synthetic) لـ `old_values`/`new_values` بما فيها المتداخل، يُحتفظ بـ id/actor/action/timestamp/correlation، لا حذف سجلات، backup مُتحقَّق + خطة restore + dry-run + تحقق بعدي + سجل تنفيذ، حماية نسخ الـ backup، لا ادّعاء tamper-proof | **لا** (سياسة فقط، مش في S2) | **نعم — محجوب (Production/Neon)** |
| **R-19** | ملكية legacy: backfill "Admin واحد بالظبط" يفضل لكن تتحقق فرضيته قبل أي rollout؛ 0 أو ≥2 Admin = دليل موثّق + قرار مشغّل بتحقق مستقل (مرجع الدليل، المراجع، الوقت، النتيجة)؛ ممنوع الأقدم/الأنشط/أول صف؛ لا تعيين ذاتي؛ آخر Owner نشط محمي؛ نقل الملكية workflow مستقبلي بـ MFA حديث | **لا** (الـ backfill من Series 09 فقط) | **نعم** — يعتمد على دليل |
| **R-20** | `item.view_cost` رفض افتراضي للـ Manager والـ Staff؛ تفويض صريح بأقل صلاحية فقط؛ ممنوع ترقية Manager لـ Admin لكشف التكلفة؛ ممنوع وصف صلاحية مالية على مستوى الشركة بأنها محدودة بمخزن؛ السيرفر يحذف `costPrice` أيًا كانت الواجهة؛ `item.set_cost` قدرة كتابة مالية منفصلة للتقييم | **الرفض الافتراضي + اختبارات الانحدار: منفَّذ (Series 09/10).** `item.set_cost`: موثّق في العقد §10 وغير منفَّذ؛ إنشاء Manager لمنتج بتكلفة كما هو | قرار منتج |

**مخاطر جديدة من Series 10:**

| # | الخطورة | الوصف | الإجراء |
|---|---|---|---|
| R-23 | عالية قبل أي نشر | `enforce` غير مفعّل عالمياً، ولا اتجرّب shadow على بيانات حقيقية؛ صفر فروق غير مقصودة لسه ما اتثبتش خارج الاختبارات | بروفة shadow على نسخة غير إنتاجية بتفويضك |
| R-24 | متوسطة | تفويض مالي صريح (دور مخصّص legacy) على مستوى الشركة | لا يُوصف كمحدود بمخزن؛ قرار منتج |
| R-25 | متوسطة | تكلفة shadow ≈ +3 ms/طلب محروس محلياً؛ غير مقاسة على قاعدة بعيدة | قياس قبل النشر |
| R-26 | متوسطة (UNVERIFIED) | واجهة Series 10 ما اتجرّبتش على جهاز/RTL؛ مفيش component tests | اختبار جهاز بحضور المدير |
| R-27 | منخفضة | القراءات (مش الكتابات) مش بتتفوّض داخل transaction؛ نافذة ملّي ثانية بين الـ guard والتنفيذ | مقبول؛ موثّق (عقد §9) |
| D11 | اتقفل | عكس ترتيب أقفال كامن من Series 09 | اتصلح (قفل العضو العادل + ترتيب موحّد) |

**استمرار:** R12 (TLS)، L1 (restore)، release line (الخيار A غير منفَّذ)، فحص Neon المسبق، مراجعة خارجية، ترقية الأجهزة، D7 (refresh واحد لكل مستخدم) — بدون تغيير. **Production: NO-GO.**

**حالة بعد Series 09:** **R-13/D1 اتقفل** (مُثبت قبل/بعد). **R-14/D2/D3 اتقفلوا** (S1). **جديد:**

| # | الخطورة | الوصف | الإجراء |
|---|---|---|---|
| **R-18 / D10** | عالية (قديم فقط) | `audit_logs` القديمة ممكن تحتوي `costPrice` بالنص الصريح في أي بيئة اشتغل فيها الإصدار القديم | تنظيف مشغّل بعد backup وبتفويض (غير منفّذ) |
| R-19 | متوسطة | شركات بدون owner بعد الـ migration (0 أو ≥2 Admin): لا إدارة Admins | فحص + تحديد owner بدليل (عقد §9) قبل أي نشر |
| R-20 | متوسطة | Manager فقد رؤية التكلفة (تغيير سلوك) | إبلاغ العملاء؛ منح بدور مخصّص |
| R-21 | منخفضة | تغيير الدور مش مُغلق داخل transaction الكتابة (التعليق مغلق) | مقبول؛ موثّق |
| R-22 | متوسطة (UNVERIFIED) | شاشات Series 09 ما اتجرّبتش على جهاز/RTL؛ D7 (جلسة refresh واحدة) بقى أثره أوضح | اختبار جهاز بحضور المدير |

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

**أولاً — بعد Series 12:** (1) مراجعة نتيجة Series 12؛ (2) نسخة احتياطية لمفتاح QA (`_local-tools\qa-signing\`) — وين؟؛ (3) تفويض milestone تصليب لـ N-1/N-2 + "Current balance: 0" (التوصية)؛ (4) هل StockMind QA يفضل بيلد أونلاين `127.0.0.1` (USB) ولا بيلد LAN؟؛ (5) مصير التطبيق القديم `io.stockmind.app` (يفضل زي ما هو؛ أي تحديث له بيلد debug بنفس المفتاح = قرار منفصل)؛ (6) قيمة `AUTHORITY_LOCK_TIMEOUT_MS` وبنود Series 11 أدناه لسه قائمة.

**أولاً — بعد Series 11:** (1) مراجعة نتيجة Series 11 وحكم القبول؛ (2) هل تفوّض **بروفة shadow ثم enforce على نسخة بيانات غير إنتاجية** وفق §15 من التقرير (لا Neon/Production)؟ (3) قيمة `AUTHORITY_LOCK_TIMEOUT_MS`؛ (4) **اختبار جهاز** لـ Series 09–11 بحضورك؛ (5) تنفيذ R-18/R-19 (محجوبين على Production)؛ (6) قرار `item.set_cost`. **مفيش حاجة من دي بتفعّل enforce.**

**أولاً — بعد Series 10:** (1) مراجعة نتيجة Series 10 وتحديد التالي (قسم 09)؛ (2) **تفويض اختبار جهاز** لـ Series 09 + 10 (بحضورك فيزيائياً)؛ (3) **تفويض بروفة shadow** على نسخة بيانات **غير إنتاجية** قبل أي قرار `enforce`؛ (4) قرار تفعيل `enforce` (لم يُطلب)؛ (5) تنفيذ R-18/R-19 (محجوبين على Production)؛ (6) تقييم `item.set_cost` وصلاحية مالية بنطاق مخزن (قرار منتج).

**أولاً — بعد Series 09:** (1) مراجعة نتيجة Series 09 وتحديد التالي (قسم 09)؛ (2) **تفويض اختبار جهاز** لـ Team screen وسحب الصلاحية أثناء جلسة (محتاج حضورك فيزيائياً للبصمة)؛ (3) **قرار تنظيف `audit_logs` القديمة** (R-18) وتفويضه؛ (4) **قرار شركات بدون owner** (R-19): مين يحدد الـ owner ومن أي دليل؛ (5) إبلاغ العملاء بتغيير رؤية التكلفة للـ Manager؛ (6) هل `item.view_cost` يتمنح للـ Manager افتراضياً (حالياً لا)؟ (7) سياسة إعادة دعوة إيميل عضو محذوف.

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

### التوصية الحالية (بعد Series 12): **milestone تصليب: Series 11 N-1 (repro حتمي ثم إصلاح trigger آخر owner) + N-2 (طريقة مقروءة للـ shadow snapshot) + N-3 + "Current balance: 0"**
- كل حاجة تتجرّب على StockMind QA على الـ Huawei (workflow Series 12) + PG المؤقت. بعدها بروفة shadow/enforce غير إنتاجية (synthetic أولاً).
- **مش مُصرَّح؛ محتاج أمرك.** لا Production/Neon/AAB/merge.

### توصية سابقة (بعد Series 11): **بروفة shadow ثم enforce على نسخة بيانات غير إنتاجية (بتفويضك) + اختبار جهاز لـ Series 09–11 بحضورك** — الجهاز اتعمل جزئياً في Series 12؛ البروفة مستنية N-1/N-2
- الشروط والبوابات: تقرير Series 11 §15 (0 unexpected / 0 errors / 0 incomplete في shadow، قياس زمن على قاعدة بعيدة، تمرين رجوع، سحب تحت حمل).
- **مش مُصرَّح؛ محتاج أمرك.** لا Production/Neon/AAB/merge.
- بديل ميزة: S3 (بيانات المساءلة + `domain_events`) — لكن بعد البروفة أنسب.

### توصية سابقة (بعد Series 10) — **اتنفّذت كتصليب Series 11**
- (الأصل) **بروفة shadow على بيانات غير إنتاجية + اختبار جهاز لـ Series 09/10 بحضورك — قبل أي تفعيل `enforce`**
- ليه: كل ضمانات S2 مثبتة على بيانات synthetic؛ اللي ناقص دليل على بيانات حقيقية وعلى الجهاز.
- **بديل لو عاوز شريحة ميزة:** S3 (بيانات المساءلة + `domain_events` + feed) — بتعتمد على الهوية والصلاحيات الموجودة.
- **مش مُصرَّح؛ محتاج أمرك.** ولا حاجة من Production/Neon/AAB/merge.

### توصية سابقة (بعد Series 09): Series 10 — S2 — **اتنفّذت**
- (الأصل) **Series 10 — Access Foundation Part 2 (S2) مسبوقة باختبار جهاز لـ Series 09**
- **S2:** قدرات ومنح بنطاق + `GET /me/capabilities` + قاعدة CP-4 (مين ياخد الصلاحية عند مخزن جديد) + Manager بنطاق (`warehouse_manager`) — حسب `docs/product/STOCKMIND_IMPLEMENTATION_ROADMAP.md` §S2 وقرار Q-02.
- **قبلها (لما تكون متاح فيزيائياً):** تشغيل سيناريوهات الجهاز المؤجلة (Team screen، سحب صلاحية أثناء جلسة، outbox بعد إبطال، العربي).
- **مش مُصرَّح؛ محتاج أمرك.** بالتوازي غير الكودي: Milestone R.

### توصية سابقة (بعد Series 08): Series 09 — Access Foundation Part 1 (S0 + S1) — **اتنفّذت**
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

### رسالة Series 12 (الحالية)

**اللي حصل:** الـ Director عمره ما قدر يفتح StockMind لوحده لأن المتثبّت debug build من غير bundle (مُثبت على الجهاز بالـ SHA-256). عملنا **StockMind QA** (`io.stockmind.app.qa`) release مستقل جنب القديم، بتوقيع QA محلي وحدود أونلاين محلية بعلامتين، وسكربتات build/inspect/install/metro/preflight/backend/seed. اتجرّب على emulator Android 10 (A/B/C كاملين) وعلى الـ Huawei بحضور الـ Director (تثبيت جنب القديم، فتح من غير USB، أوفلاين، Staff أونلاين). Backend صفر تغيير. Jest 359.

**نقاط ضعف للمراجعة (اختبرها ضد الكود):**
1. **حد QA على build-time markers** (env في الـ bundle + app config مضمّن). حد ده كافي ولا محتاج signature check وقت التشغيل؟
2. **QA بيتخطى الـ pinned transport** بشرط host خاص فقط؛ والـ release العادي pinning بتاعه مكسور أصلاً (placeholders + موديول مستبعد).
3. **ABIs جزئية** والحل حاجز في الـ installer مش بيلد كامل.
4. **مفتاح QA بـ DPAPI**: ضياع = uninstall QA.
5. **Gate A على الجهاز:** الـ log أكّد 7 من 10؛ الكمبيوتر اتفصل مش اتقفل؛ Gate B ملاحظات Director.
6. **Mission 00 N-1/N-2 لسه مفتوحين.**

**أسئلة تحسمها:** هل نصلّح N-1/N-2 قبل أي حاجة؟ هل QA build-time boundary مقبول؟ هل نبني كل الـ ABIs؟ هل "Current balance: 0" يتصلّح في نفس الـ milestone؟

**في الـ prompt التنفيذي القادم ضمّن:** الفرع الأساسي `feature/series12-standalone-qa`، وقاعدة الجهاز (حضور + خطة محددة)، واستخدام StockMind QA للاختبار اليدوي.

### رسالة Series 11 (للمرجع)

**اللي حصل:** مراجعتك لـ Series 10 كانت صح: **F11-01 اتأكد** بإعادة إنتاج حتمية على الكود القديم (منحة بتعمل commit بعد سحب سلطة المانح، وفي الـ legacy حتى من غير فحص actor). اتصلح ببروتوكول أقفال مرتب (actor shared + target exclusive، ترتيب id، company key-share، مهلة + `AUTHORITY_BUSY`). كمان القياس كشف **تجويع** (suspend استنّى ~10 دقايق تحت كتابة متواصلة) و**deadlock** كتابة/عضوية — الاتنين اتصلحوا. `CAPABILITY_MODE` غلط = رفض إقلاع. shadow بيصنّف expected بدقة (grant نشط على نفس المخزن والـ capability). تغطية enforce كاملة ما عدا fixture إنتاجي مجمّد بديله مُلزَم بعناوينه. Backend ×3: 64/560؛ enforce: 63/552؛ mobile 308.

**نقاط ضعف للمراجعة (اختبرها ضد الكود):**
1. **الاختبارات الحتمية بتتحكم في الترتيب بأقفال/صفوف بيمسكها الاختبار** مش بنقاط توقف في الكود؛ مفيش ادّعاء بتغطية كل تداخل.
2. **3 negative controls ما اتمسكوا من أول مرة** (حماية مكرّرة + اختبار أعمى)؛ اتصلحوا، ومكافئان بالتصميم باقيان (N4a/b، N6c).
3. **`FOR UPDATE` على صف الشركة باقي** في rotation وقبول الدعوة وإعادة تفعيل المحذوف (مش سحب سلطة).
4. **التليمتري في الذاكرة فقط.** كافية لبروفة، مش لإنتاج.
5. **الأداء محلي.** منحة أبطأ ~6.5 ms من Series 10 (أقفال إضافية).
6. **`AUTHORITY_LOCK_TIMEOUT_MS` = 10s** قرار منتج.
7. سباق migrations متعدد النسخ لوحظ في الـ harness ومش مصلّح.
8. لا جهاز، لا بيانات حقيقية، لا مراجعة خارجية.

**أسئلة تحسمها:** هل شروط §15 كافية لبروفة؟ هل نبدأ بـ shadow فقط على نسخة بيانات؟ هل نقلّل/نزوّد المهلة؟ هل نصلّح `FOR UPDATE` الباقي قبل البروفة؟

**في الـ prompt التنفيذي القادم ضمّن:** الفرع الأساسي `hardening/series11-authorization-admission`، الموافقات (بيئة غير إنتاجية بالاسم)، وقاعدة الجهاز.

### رسالة Series 10 (للمرجع)

**اللي حصل:** نفّذنا S2: محرك قدرات default-deny، profiles بإصدارات، `access_grants` بنطاق مخزن، `/me/capabilities`، CP-4، تنقل متكيّف، وتفويض داخل الـ transaction مع قفل عضو عادل. **الافتراضي shadow** (القديم يقرر)؛ `enforce` مختبَر فقط. Backend PG ×3: 57 suites/459؛ enforce: 438؛ mobile 308؛ 14+8 negative controls.

**نقاط ضعف للمراجعة (اختبرها ضد الكود):**
1. **`enforce` ما اتجرّبش على بيانات حقيقية**؛ اختبارات parity على synthetic + بيانات legacy معاد بناؤها.
2. **كلفة shadow** ≈ +3 ms وسيط محلياً؛ على قاعدة بعيدة ممكن تتضاعف. هل shadow يتشال بعد فترة؟
3. **الصلاحية المالية الصريحة (دور مخصّص legacy) على مستوى الشركة**، مش بنطاق مخزن؛ `item.set_cost` غير منفَّذ.
4. **التفويض داخل الـ transaction للكتابات فقط**؛ القراءات بتتفوّض عند أول طلب جديد.
5. **اكتشفنا أخطاء أقفال حقيقية** (تجويع، deadlock، عكس ترتيب كامن من Series 09) — هل الترتيب company ← member ← warehouses كافي لباقي المسارات المستقبلية (موافقات/عهدة)؟
6. **اتنين negative controls ما اتمسكوش من أول مرة** (N6, N14) واتقوّوا.
7. **Mobile: لا component tests ولا جهاز.**
8. R-18/R-19/R-20 سياسة معتمدة وغير منفَّذة؛ لا مراجعة خارجية.

**أسئلة تحسمها:** هل نجرّب shadow على نسخة غير إنتاجية قبل أي قرار؟ هل نختبر الجهاز قبل S3؟ هل نحتاج `item.set_cost` قبل أي عميل حقيقي؟

**في الـ prompt التنفيذي القادم ضمّن:** الفرع الأساسي `feature/series10-scoped-access`، الموافقات (خصوصاً أي بيئة غير إنتاجية)، وقاعدة الجهاز (حضورك فيزيائياً أو DEFERRED).

### رسالة Series 09 (للمرجع)

**اللي حصل:** نفّذنا S0 + S1 على فرع معزول بدون جهاز. **S0:** أثبتنا أولاً إن Staff كان بيستلم `costPrice` وإن الـ `audit_logs` كانت بتخزّنه بالنص الصريح (D10 جديد)، وبعدين allowlist DTO + `item.view_cost` (Admin فقط) + redaction. **S1:** `status`/`token_version`/`is_owner`، كل طلب بيقرأ صف العضو (الدور من الـ DB)، تعليق/إزالة/تغيير دور/إنهاء جلسات بتسري من أول طلب، فحص `FOR SHARE` جوه transaction الكتابة والتعويض والتدوير، trigger في الـ DB لآخر owner، سياسة owner-only على Admins، `membership_events`، شاشة Team، وحجز الـ outbox عند `ACCESS_REVOKED`. Backend PG ×3: 54 suites/395؛ mobile 273؛ 13 negative control أحمر.

**نقاط ضعف للمراجعة (اختبرها ضد الكود):**
1. **`JwtStrategy` بيعمل query لكل طلب** (+0.33 ms محلياً؛ على Neon بعيد أكتر). بدون cache عمداً. هل مقبول؟ بدائل: cache قصير جداً مع invalidation (بيرجّع تأخير).
2. **ملكية legacy:** backfill لـ "Admin واحد بالظبط" فقط؛ الباقي بدون owner ولا إدارة Admins. هل الإجراء اليدوي مقبول أم محتاجين مسار أداة؟
3. **Manager فقد التكلفة** (حسب RBAC spec). هل ده الافتراضي الصح تجارياً؟
4. **تغيير الدور مش مغلق جوه transaction الكتابة** (التعليق مغلق).
5. **الإيميل المحذوف لا يُدعى تاني** (reactivate بدلها).
6. **`membership_events` append-only بـ trigger على UPDATE فقط** والحذف ممكن لمستخدم DB؛ لا ادّعاء tamper-proof.
7. **Mobile: لا component tests ولا اختبار جهاز** — المنطق النقي فقط. اختبار الجهاز مؤجل بقرار أمان.
8. `audit_logs` القديمة لسه فيها تكلفة محتملة؛ التنظيف مش منفّذ.
9. لا مراجعة خارجية.

**أسئلة تحسمها:** هل Series 10 = S2 صح؟ هل نختبر الجهاز أولاً؟ هل نعمل تنظيف الـ audit قبل أي نشر؟ هل نمنح `item.view_cost` للـ Manager؟

**في الـ prompt التنفيذي القادم ضمّن:** الفرع الأساسي `feature/series09-access-foundation`، قرارات Q المتبقية، الموافقات، وقاعدة الجهاز (حضورك فيزيائياً أو DEFERRED).

### رسالة Series 08 (للمرجع)

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

- **2026-10-25 (بعد v1.4) — v1.5:** نهاية Series 09 (S0 + S1، كود). نقل المكان الرسمي إلى `feature/series09-access-foundation` (آخر commit كود `00b494e`، آخر مختبَر `3b9bb69`). S0: D1 مُثبت ومقفول + D10 جديد؛ S1: إبطال فوري، owner، Team screen، outbox. Backend PG ×3 = 54/395؛ mobile 273؛ جهاز DEFERRED. Production NO-GO.

- **2026-10-25 (بعد v1.5) — v1.6:** نهاية Series 10 (S2، كود). نقل المكان الرسمي إلى `feature/series10-scoped-access` (كود backend `807676a`/core `5a24c17`، mobile `a8a6ab3`، آخر مختبَر `2bb0053`). محرك قدرات (shadow افتراضي، enforce مختبَر)، profiles، grants بنطاق مخزن، CP-4، `/me/capabilities`، تنقل متكيّف؛ Backend PG ×3 = 57/459، mobile 308؛ جهاز DEFERRED. تسجيل سياسات R-18/R-19/R-20 كـ POLICY (غير منفَّذة). النسخ على فروع Series 09 وأقدم stale. Production NO-GO.

- **2026-10-25 (بعد v1.6) — v1.7:** نهاية Series 11 (تصليب تفويض السلطة). نقل المكان الرسمي إلى `hardening/series11-authorization-admission` (كود `f0d9df1`، آخر مختبَر `4547af9`). F11-01 (+ legacy) مؤكَّد ومصلّح، F11-05..09 اكتشافات إضافية مصلّحة (منها deadlock وتجويع حقيقيين)، `CAPABILITY_MODE` غلط = رفض إقلاع، تصنيف shadow دقيق، تغطية enforce (63/552 + fixture مجمّد مُبرَّر)، الرجوع بين الأوضاع موثّق ومُختبَر. Backend PG ×3 = 64/560؛ mobile 308؛ negative controls 23؛ لا migration. الحكم: READY FOR NON-PRODUCTION ENFORCE REHEARSAL (مش إذن). النسخ على فروع Series 10 وأقدم stale. Production NO-GO. جهاز DEFERRED.

---

- **2026-10-25 (بعد v1.7) — v1.8:** Mission 00 (تهيئة، قراءة فقط: N-1..N-4) ثم نهاية Series 12 (StockMind QA المستقل). نقل المكان الرسمي إلى `feature/series12-standalone-qa` (كود تطبيق `8ca81fc`، سكربتات حتى `d63cfbe`، APK مختبَر من `f2747d6` SHA-256 `10b3fd47…aebc7213`). السبب الجذري مُثبت على الجهاز؛ QA `io.stockmind.app.qa` جنب القديم (القديم ما اتلمسش)؛ emulator A/B/C كامل؛ Huawei: تثبيت + فتح بدون USB + أوفلاين + Staff أونلاين؛ Jest 359؛ backend صفر تغيير. الحكم: PASS للنطاق بحدود مكتوبة. النسخ على Series 11 وأقدم stale. Production NO-GO. enforce غير مفعّل.

---

## 12 — SOURCE-OF-TRUTH REFERENCES

**Series 08 (حزمة المنتج والمعمارية — فهرس: `docs/product/README.md`):** `docs/product/STOCKMIND_PRODUCT_BIBLE_V2.md` · `STOCKMIND_CODE_TO_CAPABILITY_GAP_MATRIX.md` · `STOCKMIND_ORGANIZATION_RBAC_SPEC.md` · `STOCKMIND_MOVEMENT_GOVERNANCE_SPEC.md` · `STOCKMIND_ENTERPRISE_UX_BLUEPRINT.md` · `STOCKMIND_ARCHITECTURE_DECISIONS.md` · `STOCKMIND_IMPLEMENTATION_ROADMAP.md` (كلها تحت `D:\Projects\StockMind-wt\series08-enterprise-blueprint\`). **المسارات في الجدول أدناه (Series 07) كانت بجذر worktree الـ Series 07؛ الملفات نفسها موجودة بنفس المسار النسبي داخل worktree الـ Series 08.**

| الموضوع | المسار |
|---|---|
| **Series 12 — تقرير / عقد / أدلة / دليل** | `D:\Projects\StockMind-wt\series12-standalone-qa\docs\handoff\SERIES_12_DEVELOPER_RUNTIME_REPORT.md` · `SERIES_12_STANDALONE_QA_CONTRACT.md` · `series12-evidence\` (apk-inspection، emulator-gate-ledger، huawei-device-run، negative-controls، screenshots) · `STOCKMIND_USER_MANUAL.md` · سكربتات: `mobile\scripts\` · APKs: `D:\Projects\StockMind-wt\_local-tools\artifacts\stockmind-qa\` · لوجات `_local-tools\logs\s12-*` |
| Series 11 — تقرير / عقد / أدلة (مرجع) | `D:\Projects\StockMind-wt\series11-authorization-admission\docs\handoff\SERIES_11_AUTHORIZATION_HARDENING_REPORT.md` · `SERIES_11_ENFORCEMENT_ADMISSION_CONTRACT.md` · `series11-evidence\` (before-fix-reproduction، negative-controls، authority-lock-perf.json، s2-perf-rerun.json) · لوجات: `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_s11_*.log` |
| Series 10 — تقرير / عقد / أدلة (مرجع) | `D:\Projects\StockMind-wt\series10-scoped-access\docs\handoff\SERIES_10_SCOPED_ACCESS_REPORT.md` · `SERIES_10_CAPABILITY_AUTHORIZATION_CONTRACT.md` · `series10-evidence\` (negative controls، perf، gate summary) · لوجات: `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_s10_*.log` |
| Series 09 — تقرير / عقد / أدلة (مرجع) | `D:\Projects\StockMind-wt\series09-access-foundation\docs\handoff\SERIES_09_ACCESS_FOUNDATION_REPORT.md` · `SERIES_09_AUTHORIZATION_AND_PRIVACY_CONTRACT.md` · `series09-evidence\` (before/after، negative controls، gate summary، perf) · لوجات: `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_s09_*.log` |
| Master continuity (الرسمي) | `D:\Projects\StockMind-wt\series12-standalone-qa\docs\handoff\STOCKMIND_AI_CONTINUITY.md` · نسخة: `C:\Users\Name\Desktop\StockMind_Handoff\STOCKMIND_AI_CONTINUITY_MASTER.md` |
| تعليمات الـ agents | `D:\Projects\StockMind-wt\series12-standalone-qa\AGENTS.md` |
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
