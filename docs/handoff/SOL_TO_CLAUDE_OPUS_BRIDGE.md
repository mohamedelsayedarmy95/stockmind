# SOL → CLAUDE OPUS — F13-CACHE-LIFETIME (CURRENT FOLLOW-UP)

2026-10-26 (Africa/Cairo)، المنفّذ Sol / Codex Desktop؛ Claude Opus 5.5 هو Lead Engineer؛ ChatGPT هو Reviewer؛ Director هو صاحب التفويض.

- **الحالة: ENGINEERING PASS / CONFIRMED → FIXED**. الـbaseline المتحقق منه `376be666de12b3b12269850eaa08a8f7f5f790a7`، وفيه إصلاح F13-REVIEW-01 `ea0d638`. Final implementation / last fully tested code commit: **`468f26a675b093a03d4c6281165db0d9dc82d52d`**، بعد primary lifecycle commit `dedd3f94fda7d112d52d0f53a3acb644b30e98d7`.
- الفرع الجديد: `review/sol-f13-cache-lifetime`؛ worktree: `D:\Projects\StockMind-wt\sol-f13-cache-lifetime`، بدأت clean. لم تُعدّل أي worktree سابقة أو canonical Bridge/Continuity.
- النطاق الحالي: persistent resource denial، تصنيف cache بعد restart، scope/session races، recovery. ده follow-up منفصل عن إصلاح ترتيب resolver السابق، مش إعادة تصنيفه.
- اتقرت النسخة السابقة تحت، وAGENTS وcanonical Bridge v1.9 وبروتوكول continuity وحدود التفويض. اتفحصت warehouse-sync، secure-storage، client/repositories، account-scope، screen/list/outbox-review consumers. الإنتاجي الحالي بيخزن sync.status كما هي وما بيحفظش direct denial.
- **السياسة المتحققة في طبقة JS:** direct 403/404 تخص product/warehouse pair فقط؛ warehouse poll denial دليل نطاق مخزن؛ network failure لا يثبت revocation؛ disk snapshot عمرها ما تكون confirmed في runtime جديد قبل تحقق ناجح؛ known denial لا يزول بمجرد timeout/restart/memory reset. explicit sign-out يحذف stock + denial معاً، ويحتفظ بالـOutbox، فلا تبقى snapshot تعيد الظهور بدون marker.
- **قبل الإصلاح:** `cache-lifetime.test.ts` شغّل production secure-storage init/repositories/sync/React Query مع native/HTTP mocks، وcold JS runtime بيحتفظ بdisk/keystore mock. النتيجة **4 failed / 1 passed**: direct403 و404 رجعوا 55 last-known؛ أول poll معلّق عرض disk55 كـconfirmed؛ warehouse deny اتنسى وممكن directdata القديمة تظهر. ده deterministic lifecycle proof، مش native-MMKV/device proof.
- اتنفّذ cache v2: tombstones scoped للـpair أو المخزن، مع عنوان API كامل وaccount scope. v1 snapshots مش بتتهاجر لأنها تفتقد provenance وdenial history؛ upgrade يتطلب online sync مرة للـonline stock cache فقط. مفيش مساس SQLCipher device ledger أو Outbox. الـpairs المرفوضة لا تختفي بالـpoll الناجح؛ matching valid direct200 جديد بس يرفع pair denial، وwarehouse snapshot صالح جديد يرفع warehouse denial.
- اتضاف hydration كـcatching-up (الرصيد last-known)، scope/generation/version fences، وفحص direct-response identity/quantity قبل رفع denial. اتوصلت views بالـoverlay في movement/product/list/recent/outbox-review، وbalance query key بقى فيه scope وfull API URL.
- أول gate بعد التعديل كشف TS2454 في promise-finally guard؛ اتصلح باستخدام generation guard اللي بيحمي poll القديم من حذف running task الجديدة. بعدها focused **32/32**؛ lifecycle expanded **21/21**. لم تُضعف assertions؛ old purge tests اتحدثت للتأكد من empty-stock + persistent deny بدل حذف marker.
- Native lifecycle المختبر: production initSecureStorage واستخدام نفس keystore key بعد module reset؛ MMKV/SecureStore native engines mocked، ومش ادعاء تحقق فعلي من encryption أو physical restart.
- **Final verification على `468f26a`:** full Mobile Jest **27 suites / 430 passed / 0 failed / 0 skipped**؛ mobile TypeScript **exit0**؛ actual local PG/HTTP **2 suites / 19 passed / 0 failed / 0 skipped**؛ lifecycle **24/24** + availability **5/5**؛ **13/13 negative controls DETECTED** بفشل assertions فعلي وexact-byte restoration. `git diff --check` clean. checkpoint `dedd3f9` كان26/425 و12 controls؛ قبله422؛ test/compiler failures وتصحيحهم موثّقين، مش مخفيين.
- **PG findings:** product-specific404 مع warehouse200 مثبت فعلياً؛ warehouse revoke يرجع direct/poll404، وre-grant يرجع الاتنين200 بنفس Staff token. PG وmobile-mocked lifecycle اختبارات منفصلة، مش physical end-to-end. الـcluster الخاصة بالمهمة اتوقفت بعد الاختبارات؛ لا DB/worktree deletion.
- **التقرير الحالي والـpolicy/manifest/decisions/commands/limits/instructions:** [sol-f13-cache-lifetime-evidence/REPORT.md](sol-f13-cache-lifetime-evidence/REPORT.md). الأدلة الصغيرة والـmutation harness في نفس المجلد؛ raw PG logs خارج Git. الـreport والـheader الحاليين هم follow-up؛ الأقسام القديمة تحت ARCHIVE تاريخية، مش حالة المهمة الجديدة.
- **Compatibility/security limits:** v1 online snapshots مش بتتهاجر، فمطلوب warm-up sync مرة بعد upgrade؛ device ledger/Outbox/signing/QA network boundary كما هم. denied product rows قد تفضل encrypted على disk مع deny overlay؛ ده persistent denial-state، مش secure erasure. لو storage write والحذف الاتنين فشلوا، مفيش ادعاء durable guarantee. Native MMKV/Keystore/process-death وmounted UI/APK/device acceptance **NOT EXECUTED**.
- **Git handoff:** code `dedd3f9` و`468f26a` committed؛ documentation-only commit(s) تحتوي رأس bridge الحالي والتقرير والأدلة. final handoff SHA استخرجه بـ`git log -1 --format=%H -- docs/handoff/SOL_TO_CLAUDE_OPUS_BRIDGE.md` وقارنه بالـfinal report وremote. publication verification هيتسجل هنا بعد ordinary push؛ لا merge أو canonical promotion.
- **Opus next:** راجع diff من `376be66`، وسياسة v1 invalidation وscope/recovery، وأعد full mobile/tsc/PG/mutations بالأوامر في التقرير. بعد قبول code/policy فقط، نسّق native QA acceptance مع Director: warm-up → observed denial → cold kill/reopen قبل poll offline → legitimate restore، مع Arabic وOutbox preservation. ده recommendation للخطوة التالية، لم يبدأ هنا.
- **Final-review addendum (قبل أي push):** راجعت كمان `availability` في Reservations card. React Query بتحتفظ بـonHand/available القديمة بعد failure، والمسار ده ماكانش لسه عليه overlay. regression حقيقي على production hook مع real QueryClient/QueryObserver وmocked React hooks: **3 failed / 2 passed** قبل التصحيح؛ بعده availability5 + lifecycle24 = **29/29** وtsc0. أول إعداد للاختبار فشل TS2352 قبل تشغيل tests، فاتستخدم actual QueryObserver result بدلاً من cast غير صحيح. `useAvailability` الآن scoped بالـaccount/full endpoint وبيحجب retained data لما نفس visibility rule ترفضها؛ offline device availability محفوظة. final430/19/13-control ledger اتنفذوا على `468f26a`، والـcluster اتوقفت تاني بنجاح بعدها.
- حدود العمل: لا merge، no production/Neon/Huawei/APK/AAB/enforce، no external delegation، لا تغيير أو حذف pending outbox. مهارات sde/security/qa وgit-sync مُطبّقة داخل التفويض الخاص بالمهمة؛ لا rebase/cleanup.

---

# ARCHIVE — F13-REVIEW-01 handoff at baseline (historical; current follow-up above)

## 00 — Executive Handoff
- المهمة: `F13-REVIEW-01`؛ المنفّذ: Codex / Sol 6.1، GPT Desktop على Windows / PowerShell.
- المهندس المستلم: Claude Opus 5.5 (Lead Engineer).
- الحالة الحالية: **ENGINEERING PASS للنطاق المحدد / CONFIRMED → FIXED**، بتاريخ 2026-10-26 (Africa/Cairo). جاهز لمراجعة Opus، مش اعتماد تكامل أو device acceptance.
- النطاق: أولوية رفض صلاحية رصيد المخزن، مسارات cache/query/revocation، اختبارات حتمية وتصحيح محدود لو اتثبت.
- آخر checkpoint مختبَر بالكامل: `ea0d63814913d30bdffe1fd226add071c2365f8c`؛ Mobile 25/401، PG/HTTP 2/17، tsc=0، 6/6 mutation controls RED.

النتيجة الهندسية: اتثبت actual warehouse revocation ببيانات synthetic على PostgreSQL وHTTP. السيرفر رفض Staff صح بـ404 بعد سحب الصلاحية، لكن `resolveBalance()` رجع الرصيد السابق 55 لأن sync cache branch سبق direct denial. الإصلاح قدّم فحص direct `error + 403/404` على قراءة cache، من غير تغيير caching أو outbox أو API. last-known ووقته وzero الصحيح وdevice ledger فضلوا شغالين في الاختبارات. التأكيد هنا على مستوى HTTP/PG وproduction mobile logic/cache، مش physical UI أو محو دائم لكل cache؛ قيد restart موثّق في قسم 07.

## 01 — Project Baseline
- الأصل: `D:\Projects\StockMind`، فرع `main` عند `45d9e18`، dirty من قبل المهمة؛ لم يتم تعديله.
- canonical: `hardening/series13-authority-observability` عند `e36ae9792e9dc0d1893eb8849889b5f638ac5465`؛ worktree الأصلية clean عند البداية.
- فرع المهمة: `review/sol-f13-balance-authorization`.
- worktree: `D:\Projects\StockMind-wt\sol-f13-balance-authorization`؛ اتعملت من الـbase المذكور وحالتها الأولية clean.
- AI Bridge الرسمي: `v1.9`، supplemental bridge فقط هنا؛ لا تعديل أو mirror للملفات الرسمية حسب التفويض الخاص بالمهمة، وهو أولى من بروتوكول AGENTS العام.
- القيود: server-authoritative ledger؛ tenant/account isolation؛ encrypted cache/outbox؛ offline last-known موصوف بصدق؛ default shadow؛ Production NO-GO.

## 02 — Work Performed
1. قريت RTK وتعليمات المهمة وAGENTS والـcanonical continuity/bridge وأجزاء Series 13 المرتبطة بالمهمة؛ أولوية تعليمات Director على workflows العامة.
2. راجعت worktrees/status وHEAD؛ الفرع والمسار المطلوبين ماكانوش موجودين؛ أنشأت worktree بالاسم والـbase المحددين.
3. فحصت `mobile/src/domain/balance-truth.ts` و`mobile/package.json`؛ لقيت cache branch قبل direct-denial check. دي ملاحظة كود، مش لوحدها إثبات reachability.
4. اكتشفت مكان الاختبارات الحقيقي: `mobile/src/domain/balance-truth.test.ts`؛ مفيش `.10x/`، ومش هننشئ workflow عام خارج نطاق التفويض.
- ملاحظة أدوات: أول قراءة للـhandoffs كانت أطول من حد الإخراج؛ اتقرت المقاطع المهمة بعدها بشكل محدد. أول مسار اختبار اتجرب (`__tests__`) ماكانش موجود؛ لم يتغير أي ملف بسببه.
- claude-mem observer غير قادر على حفظ memories بسبب انتهاء weekly allowance؛ work_state tools نفسها شغالة. لم تتم إعادة تشغيل worker.
5. تتبعت `useStock.ts` و`queryClient.ts` و`api/client.ts` و`capabilities.store.ts` و`useCapabilities.ts` و`warehouse-sync.ts` و`useAuth.ts` و`outbox-drain.ts` و`account-scope.ts` و`session-scope.ts` وscreen callers. direct denial بيعمل capability refresh؛ تغيير `accessVersion` بيعمل query invalidation فقط؛ sync purge مستقل عند poll denial. Movement/Product بيقرأوا store فقط، ومابيبدأوش stock poll بنفسهم.
6. ضفت regression للـ403/404 مع cache/zero/retained query data، وcompatibility tests؛ قبل الإصلاح: **2 failed / 19 passed** في resolver suite. فشل assertion بالكمية 55 بدل no-access.
7. عملت dependency junctions داخل worktree الجديدة فقط؛ مفيش install أو تغيير dependencies. lockfile SHA-256 في الأصل والفرع متساوي: `ecc09270998173a12f3f25f112ddc624999e2ad98e34a6a8c68617d858c19e80`. مناسب Jest/tsc فقط؛ Metro محتاج real node_modules زي Series 12.
8. الـPG القديمة كانت متوقفة: أنشأت cluster synthetic جديدة `D:\Projects\StockMind-wt\_local-tools\pgdata-sol-f13` على `127.0.0.1:55433` باسم user محلي `stockmind`، بدون خدمة نظام أو install. المحاولة الأولى للـgate لم تنفذ tests (DB connection refused + تعارض `--runInBand` مع `--maxWorkers=2`)؛ اتصحح التشغيل بحذف `--runInBand`، مش بتغيير assertions.
9. أضفت real PG/HTTP revocation regression وmobile sync-store/QueryClient flow tests؛ تحت التشغيل، لا نتيجة مُدّعاة لسه.
10. قبل الإصلاح: flow suite **2 failed / 4 passed**؛ PG/HTTP suite **1 failed / 1 passed**. Staff authorized snapshot=55 → Owner PUT warehouseIds=[] ناجح → نفس session لسه يقدر يشوف products لكن balance=404 → TanStack query.status=error وdata=55 retained → sync.lastError=null → resolver.confirmed=55. الـcross-tenant HTTP test نجح. التصنيف **CONFIRMED** على مستوى PG/HTTP + production mobile domain/cache؛ مش physical UI proof ولا server authorization bypass.
11. نقلت check direct `error + (403|404)` لأول resolver بعد no-warehouse، قبل كل cache returns؛ شلت check القديم من آخر الدالة. لا تغيير API/store/outbox/build.
12. بعد الإصلاح: focused 47/47، full mobile 401/401، tsc=0، local PG/HTTP 17/17. شغلت 6 negative controls، كلها اتكشفت بفشل assertions؛ original/restored SHA-256 متساوي `2e2903032b923ded12f24116946ac0e3f1cfee1be6c8ba721db0c5405ac97d2b`. أول محاولة harness رفضت CRLF anchor قبل تشغيل أي test؛ اتصلح harness، مش tests أو assertions.
13. راجعت diff والاختبارات بمهارة code-quality: تغيير production واحد، source signature ثابت، لا weakening للـexisting tests. عملت code commit `ea0d638`، وأعدت full mobile/tsc/PG على نفس الـcommit بعد restoration: كلها PASS.
14. وقفت cluster المهمة بـ`pg_ctl -D ...\pgdata-sol-f13 -m fast -w stop`؛ exit 0. احتفظت بالـscratch DBs والـlogs، لا cleanup أو تعديل للـcluster القديمة.
15. جمعت compact evidence من logs بدون request bodies أو credentials؛ جهزت documentation-only commit للـbridge والأدلة. تحقق final commit/remote موصوف في قسم 08؛ آخر كود اختُبر هو `ea0d638`.
16. الـbridge والأدلة اتعملهم commit `cf7bc61f11a804c790889bb6c32cdc8a168b87e7` واترفعوا بordinary push لفرع Sol فقط. `git ls-remote` طابق SHA المحلي، وworktree كانت clean؛ الملف موجود فعلياً في committed tree. المراجعة الأخيرة دي تحديث documentation-only لتسجيل نجاح التسليم، بلا تغيير code/tests. canonical Series 13 لسه `e36ae97` وclean، وdirty main بنفس قائمة الحالة الأولية. `pg_ctl status` أكد no server running.

## 03 — Engineering Decisions
- التحقيق لازم يثبت state transition من المسارات الفعلية قبل تصنيف CONFIRMED.
- لا rebase أو cleanup أو external AI delegation؛ التفويض الخاص بالمهمة يعلو على defaults المهارات.
- المشكلة: sync cache early return بيحجب fresh direct denial. البديل الأول: إلغاء caching (مرفوض: يكسر offline). البديل الثاني: مسح المخزن كله عند كل direct 404 (مرفوض هنا: 404 ممكن تخص المنتج، والـresolver pure؛ محتاج سياسة invalidation مختلفة). المختار: تقديم denial على cache في نفس resolver المشترك بين الشاشتين؛ أخطاء network/5xx مش denial.
- اشتراط `query.status === 'error'` بيمنع errorStatus قديم مع query ناجحة/قيد التحميل من عمل denial وهمي؛ نفس سلوك check القديم اللي كان بعد success/pending returns.
- التوافق: نفس union والترجمات والـscreen callers؛ cache valid وoffline device ledger وzero محفوظين. الرجوع: revert commit الخاص بالإصلاح يعيد العيب، فلا يتم اعتماده بدون اختبارات.
- الـpure resolver مش بيحذف disk cache؛ purge المخزن يحصل عند poll=denied زي ما كان. ده حد مهم، ومش ادعاء إن مجرد direct denial بيمسح كل البيانات المحلية للأبد.
- لا إعادة تصميم للـinvalidation أو account scope: ده يحافظ على offline behavior ويتجنب اعتبار product 404 سحب صلاحية المخزن كله. أثر القرار وقيد restart موثّقين علناً، وتحتاج السياسة دي مراجعة مستقلة قبل توسيع ادعاء الحماية.

## 04 — File Change Manifest
| الملف | الغرض | الأثر الأمني / الاختبارات | commit |
|---|---|---|---|
| `mobile/src/domain/balance-truth.ts` | تقديم direct denial على cache في `resolveBalance` | يمنع عرض known quantity للطلب المرفوض؛ focused/PG regression | `ea0d638` |
| `mobile/src/domain/balance-truth.test.ts` | +6 regression/compatibility tests | 403/404+cache/zero، retained data، network/5xx، valid cache | `ea0d638` |
| `mobile/src/domain/balance-authorization-flow.test.ts` | +6 production-store/cache/QueryClient tests | poll purge، offline timestamp، tenant reset، sign-out، delayed poll | `ea0d638` |
| `tests/integration/f13-balance-authorization.pg.spec.ts` | +2 local PG/HTTP tests | real owner revocation→404→mobile model؛ foreign tenant denied | `ea0d638` |
| `docs/handoff/SOL_TO_CLAUDE_OPUS_BRIDGE.md` | تسليم تدريجي تكميلي | توثيق الأدلة والحدود؛ لا canonical promotion | docs commit الحاوي للنسخة دي |
| `docs/handoff/sol-f13-review-evidence/REPRODUCTION.md` | إعادة الإنتاج والأوامر ومستويات الإثبات | يفصل native mocks عن actual PG/HTTP ويشرح guard التشغيل | نفس docs commit |
| `docs/handoff/sol-f13-review-evidence/run-negative-controls.cjs` | harness بست mutations منفصلة | restore exact bytes في finally، رفض branch غلط، assertion failure لازم | نفس docs commit |
| `docs/handoff/sol-f13-review-evidence/before-unit.txt` | regression قبل الإصلاح | 2 failed / 19 passed | نفس docs commit |
| `docs/handoff/sol-f13-review-evidence/before-flow.txt` | sync/query flow قبل الإصلاح | 2 failed / 4 passed | نفس docs commit |
| `docs/handoff/sol-f13-review-evidence/before-pg.txt` | real revocation قبل الإصلاح | 1 failed / 1 passed | نفس docs commit |
| `docs/handoff/sol-f13-review-evidence/after-focused.txt` | focused بعد الإصلاح | 47 passed | نفس docs commit |
| `docs/handoff/sol-f13-review-evidence/after-pg.txt` | local PG بعد الإصلاح | 17 passed | نفس docs commit |
| `docs/handoff/sol-f13-review-evidence/mobile-full.txt` | full mobile بعد الإصلاح | 401 passed | نفس docs commit |
| `docs/handoff/sol-f13-review-evidence/typecheck.txt` | mobile tsc | exit 0 | نفس docs commit |
| `docs/handoff/sol-f13-review-evidence/negative-controls.txt` | mutations وrestoration hashes | 6/6 DETECTED | نفس docs commit |
| `docs/handoff/sol-f13-review-evidence/final-mobile.txt` | full mobile على code commit | 401 passed بعد restoration | نفس docs commit |
| `docs/handoff/sol-f13-review-evidence/final-pg.txt` | local PG على code commit | 17 passed | نفس docs commit |

ملفات canonical والـDesktop mirrors والـQA config/signing والـlockfiles لم تتغير. `node_modules` junctions وignored raw logs artifacts محلية، مش جزء من Git.

## 05 — Test & Evidence Ledger
- قبل الإصلاح: resolver **19 passed / 2 failed / 21**؛ flow **4 passed / 2 failed / 6**؛ actual PG/HTTP **1 passed / 1 failed / 2**. الفشل المتوقع بالكمية 55 بدل unknown/no-access؛ لا skipped في التشغيلات دي.
- بيئة التنفيذ: Windows، Node `26.7.0`، mobile Jest `29.7`، backend Jest `30.4.1`، PG `15.19` محلية. لا cloud/Neon أو real data.

| البوابة / الأمر (كل shell commands استخدمت `rtk`) | النتيجة الفعلية | الدليل داخل `sol-f13-review-evidence/` |
|---|---|---|
| `rtk proxy node node_modules/jest/bin/jest.js src/domain/balance-truth.test.ts --runInBand --colors=false` قبل الإصلاح، من mobile | 19 passed / 2 failed؛ 1 suite failed؛ 0 skipped | `before-unit.txt` |
| نفس الأمر لـ`balance-authorization-flow.test.ts` قبل الإصلاح | 4 passed / 2 failed؛ 1 suite failed؛ 0 skipped | `before-flow.txt` |
| `backend-gate.ps1 <worktree> stockmind_gate_sol_f13_before2 --runTestsByPath tests/integration/f13-balance-authorization.pg.spec.ts` | 1 passed / 1 failed؛ 0 skipped؛ Jest exit 1 | `before-pg.txt` |
| Mobile focused: `balance-truth`, `balance-authorization-flow`, `access-revocation`, `sync-runner`؛ `--runInBand --colors=false` | 4 suites / 47 passed؛ 0 failed/skipped؛ exit 0 | `after-focused.txt` |
| Mobile `rtk proxy node node_modules/typescript/bin/tsc --noEmit`، قبل وبعد code commit | exit 0؛ diagnostics none | `typecheck.txt` |
| Full mobile `rtk proxy node node_modules/jest/bin/jest.js --runInBand --colors=false`، قبل وبعد code commit | 25 suites / 401 passed؛ 0 failed/skipped؛ exit 0؛ baseline 24/389 | `mobile-full.txt`, `final-mobile.txt` |
| PG gate `stockmind_gate_sol_f13_after` ثم `..._final`؛ specs: `f13-balance-authorization.pg.spec.ts`, `access-lifecycle.pg.spec.ts` | كل تشغيل 2 suites / 17 passed؛ 0 failed/skipped؛ Jest exit 0؛ shadow فقط | `after-pg.txt`, `final-pg.txt` |
| `rtk proxy node docs/handoff/sol-f13-review-evidence/run-negative-controls.cjs` | 6/6 DETECTED؛ كل mutation رجّع Jest exit 1 بفشل assertions؛ harness exit 0؛ bytes restored | `negative-controls.txt` |
| `rtk git -C <worktree> diff --check` ومراجعة staged diff | لا whitespace errors؛ الملفات ضمن النطاق | manifest + Git |

الـnegative controls: N1 remove direct denial (**5 failed/22 passed**)؛ N2 ignore 403 (**2/19**)؛ N3 ignore 404 (**2/19**)؛ N4 ignore sync denial (**2/25**)؛ N5 use mismatched response (**1/20**)؛ N6 count pending receipts (**1/20**). الأرقام failure/pass لكل تشغيل، مش totals عايزين نجمعهم. أول محاولة gate غير صالحة والـCRLF harness failure موثّقين في chronology؛ لم يُحسبوا product failures أو نجاحات.

الأوامر الكاملة، guard أسماء scratch DB، وتشغيل/إيقاف cluster في `sol-f13-review-evidence/REPRODUCTION.md`. Full raw PG logs خارج Git: `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_sol_f13_{before2,after,final}.log`. الـhelper قد يرجع shell exit 0 مع Jest فاشل؛ اعتمدت `JEST EXIT` وJest counts، مش outer exit وحده.

غير منفّذ: full backend suite (لا production backend change)، component/native render، APK build/inspection جديد، emulator أو Huawei acceptance. موجود في full mobile suite: QA build identity/network boundary وoutbox/idempotency/stock-sync/access revocation tests؛ ده source compatibility verification، مش APK/device proof.

## 06 — Security & Data Integrity
- **Tenant isolation:** PG foreign tenant gets 404 للـbalance/snapshot؛ production cache functions مختبرة بمفتاح `server|company|user` مع mocked current account، وreset/generation بيمنع delayed old-account poll. Query keys نفسها مافيهاش tenant؛ بتعتمد على session clear زي الـbaseline؛ ده اتراجع في source، مش full UI lifecycle test.
- **Warehouse authorization:** same valid Staff token بيرفضه السيرفر فور revoke؛ client model الآن يقدم direct denial على cached row وcached zero. poll denial بيحجب حتى successful direct data قديمة.
- **Cache invalidation:** poll denial يمسح المخزن من memory/MMKV wrapper؛ scoped cache hydration/sign-out/reset مختبرين بmock storage. direct query denial لا يعمل disk purge؛ قسم 07.
- **Offline visibility:** فقد الشبكة بدون denial يحتفظ بـlast-known وconfirmation time؛ device ledger مستقل عن online cache. سحب صلاحية على السيرفر بدون اتصال مش ممكن client يكتشفه فوراً، ولا فيه ادعاء بالعكس.
- **Inventory integrity:** no stock command/server reducer changes؛ PG owner balance فضل 55 بعد revoke/refusal؛ knownQuantity=null وissuableOnline=0 بعد denial. queued receipts مش بتزود حد الصرف، وN6 كشف كسر الضمان.
- **Idempotency / outbox:** لا تغيير keys أو persistence أو retry/drain؛ full mobile suites وPG access lifecycle (بما فيها رفض replay لعضو موقوف) عدّوا؛ لا مسح queued intents.
- **Financial privacy:** لا تغيير DTOs/API repositories/cost paths؛ لا بيانات مالية في الأدلة. ده static no-change assessment مع existing mobile suite، مش إعادة تشغيل full backend financial privacy gates.
- **Regression risk:** network/5xx مش denial، zero حقيقي محفوظ، product/warehouse mismatch مرفوض، offline device ledger محفوظ. الـsignature والترجمات وQA variant untouched؛ build-variant وqa-build-config اختباراتهم ضمن 401.

## 07 — Open Findings & Risks
| ID | Severity / status | الدليل والأثر | التالي / هل يمنع التكامل؟ |
|---|---|---|---|
| `F13-REVIEW-01` | Medium، **CONFIRMED → FIXED** | before unit/flow/real PG failures؛ بعده 401/17 PASS؛ عرض cached quantity بعد رفض معروف | جاهز لمراجعة الإصلاح المحدود؛ مش server leak/bypass |
| `F13-CACHE-LIFETIME` | Medium، **OPEN / source-verified limitation** | query errors مش persisted؛ direct denial مش disk purge، والـsync cache يفضل لحد poll denial. لو restart سبق الـpoll، cache ممكن ترجع last-known بدون شبكة. لم يُنفّذ dedicated restart-after-direct-denial test أو سياسة محو جديدة | Opus يراجع policy والـscope؛ **لا يمنع تصحيح ترتيب resolver، لكنه يمنع ادعاء "أي denial يمحو الرصيد نهائياً" أو قبول شامل لدورة cache** |
| `F13-DEVICE` | Acceptance gap، **DEFERRED** | لا component/native/device run ولا APK جديد | build QA جديد من accepted commit، وبعده Director-coordinated Huawei؛ شرط device acceptance، مش مبرر لاعتبار source gates فاشلة |
| `F13-DEPENDENCIES` | Low، **KNOWN** | node_modules junctions من canonical copy؛ نفس lockfile | مناسب tests/tsc؛ لازم real dependency copy/setup قبل Metro/QA build؛ لا install اتعمل هنا |

## 08 — Git & Artifact State
- Initial HEAD: `e36ae9792e9dc0d1893eb8849889b5f638ac5465`.
- Final implementation / last fully tested code commit: **`ea0d63814913d30bdffe1fd226add071c2365f8c`**. final-mobile/final-pg/tsc شغالة عليه فعلياً؛ كل commit بعده في المهمة documentation/evidence فقط.
- الـhandoff والأدلة في documentation-only commit الحاوي للنسخة دي؛ self hash مش ممكن يتحط جوه نفس commit. استخرج الـfinal handoff commit بالضبط بـ`rtk git -C D:\Projects\StockMind-wt\sol-f13-balance-authorization log -1 --format=%H -- docs/handoff/SOL_TO_CLAUDE_OPUS_BRIDGE.md`، وطابقه مع final report.
- الفرع: `review/sol-f13-balance-authorization`؛ worktree: `D:\Projects\StockMind-wt\sol-f13-balance-authorization`. المتغيرات المحلية: dependency junctions وignored raw test logs فقط؛ لا env/key/APK artifacts.
- **Verified pushed handoff checkpoint:** `cf7bc61f11a804c790889bb6c32cdc8a168b87e7` (bridge + evidence)، local HEAD = `git ls-remote origin refs/heads/review/sol-f13-balance-authorization`، worktree clean، والـbridge موجود في `git ls-tree HEAD`. الكود قبله `ea0d638`، وكل اللي بعده تحت `docs/` فقط.
- النسخة الحالية تضيف سجل التحقق ده في docs-only follow-up؛ الـfinal handoff commit الحاوي لها يُستخرج بالأمر المذكور فوق. للتحقق من حالة push الحالية مستقلاً: قارن `rtk git -C <worktree> rev-parse HEAD` مع `rtk git -C <worktree> ls-remote --heads origin refs/heads/review/sol-f13-balance-authorization`، وافحص `status --short`. final report يحتوي الـSHA النهائي بعد رفع تحديث التوثيق ده.
- Cluster المهمة **STOPPED**؛ scratch data/logs متروكة؛ لا worktree حذف أو DB cleanup.
- **لم يتم أي merge** أو تعديل protected branches.

## 09 — Instructions for Claude Opus
1. افتح worktree المذكورة وطابق branch/HEAD مع final report و`origin/review/sol-f13-balance-authorization`؛ ما تكتبش عليها بالتزامن مع جلسة تانية.
2. راجع `git diff e36ae97..HEAD -- mobile/src/domain/balance-truth.ts`؛ تغيير production الوحيد هو تقديم error denial على sync cache. راجع tests قبل اعتماد fix.
3. اقرأ `sol-f13-review-evidence/REPRODUCTION.md` وbefore/after PG؛ الـactual revoke والـ404 وretained TanStack data مستقلين عن UI mocks. الـ403 مختبرة في mobile flow/unit، مش real server revoke response (اللي بيرجع404).
4. أعد mobile tsc/full Jest والـ2 PG specs على local scratch جديدة بالأوامر الموثقة، وnegative controls لو هتراجع قوة tests. لا تشغّل mutations بالتوازي مع tests تانية. لا تعتمد outer gate exit وحده.
5. اتحدى افتراضات cache lifetime/reset: no query tenant key (الضمان session clear)، explicit direct denial مش permanent tombstone، وغياب network مش دليل authorization سارية. لا تقبل ادعاء إغلاق كل revocation/offline scenarios من نتيجة resolver وحدها.
6. الفرع **جاهز لمراجعة واعتماد bounded correction**؛ ارفض تبنّيه لو عايز ضمان محو دائم أو device acceptance من غير معالجة/اختبار gaps. لا merge صامت؛ اعتماد التكامل عند Lead/Director بعد independent review.
7. بعد القبول فقط: build QA APK جديد بنفس Series 12 identity/signing/network contract، افحصه، وبعدها Huawei acceptance بتنسيق Director؛ ما تستخدمش APK `f7847ed` لإثبات إصلاح أحدث منه. لا تثبيت تلقائي.
8. بعد القبول فقط، Opus يضيف الحقائق المتحققة للـofficial Bridge v1.9 وMaster Continuity؛ أنا لم أعدّلهم أو أرقّي supplemental bridge لمرجع رسمي.

## 10 — Multi-Agent Collaboration Protocol
**Sol 6.1 is the collaborating implementation/review engineer. Claude Opus 5.5 remains the Lead Engineer. ChatGPT provides independent architectural review and task coordination.**

- Separate Git worktrees؛ لا concurrent writes لنفس branch/worktree؛ task ownership واضح.
- No silent merges؛ no undocumented changes؛ test evidence إلزامي؛ UNVERIFIED مش حقيقة مقبولة تلقائياً.
- Director وChatGPT ممكن يقسموا المهام الجاية بين Sol وOpus؛ التواصل asynchronous عن طريق handoff، مش assumed sync.
- المستلم لازم يتحقق من الفرع والأدلة قبل تبنّي التنفيذ؛ لا external delegation في المهمة دي.

## 11 — Next Recommended Engineering Task
**توصية واحدة، مش تفويض:** تحقيق محدود في persistence بعد direct denial: cache authorized → revoke warehouse → direct404 → restart قبل stock poll → offline. حدّد policy تفرق product-not-found عن warehouse revocation، وأضف deterministic lifecycle test قبل أي تغيير؛ قيّم per-resource invalidation/tombstone من غير global cache disable أو مسح outbox. لا تنفيذ للمهمة دي هنا.

## 12 — Message to Claude Opus
يا Claude Opus، خلصت `F13-REVIEW-01` على branch `review/sol-f13-balance-authorization` في `D:\Projects\StockMind-wt\sol-f13-balance-authorization`، من baseline `e36ae9792e9dc0d1893eb8849889b5f638ac5465`. العيب **CONFIRMED** بـreal local PG/HTTP revoke: Staff balance404 بينما cached55 اتعرضت كـconfirmed. code commit `ea0d63814913d30bdffe1fd226add071c2365f8c` بيقدم direct error403/404 على sync cache في resolver فقط. آخر تحقق عليه: tsc0، full mobile25/401، PG2/17، و6/6 negative controls RED مع exact-byte restoration. اقرأ `docs/handoff/sol-f13-review-evidence/REPRODUCTION.md` والـledger قبل التبنّي. راجع قيد `F13-CACHE-LIFETIME`: الإصلاح مش permanent disk-cache purge بعد direct refusal؛ policy/lifecycle follow-up لسه مفتوح. مفيش merge أو canonical handoff modification أو Production/device/APK action. راجع الفرع والأدلة، وبعد قبول bounded fix نسّق QA build جديد وHuawei مع Director. أنت لسه Lead Engineer، واعتماد النسخة الرسمية عندك بعد المراجعة.
