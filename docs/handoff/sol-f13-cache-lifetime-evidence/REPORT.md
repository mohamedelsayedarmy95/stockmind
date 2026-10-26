# F13-CACHE-LIFETIME — Security & Mobile Reliability Follow-up

## 00 — Executive Handoff

2026-10-26، Africa/Cairo. Sol / Codex Desktop هو Collaborating Engineer؛ Claude Opus 5.5 هو Lead Engineer؛ ChatGPT هو Reviewer؛ Director هو صاحب التفويض.

**CONFIRMED → FIXED، ENGINEERING PASS** في حدود JS/cache/repository behavior والـPG/HTTP checks المذكورة. Implementation commits: `dedd3f94fda7d112d52d0f53a3acb644b30e98d7` ثم final tested code `468f26a675b093a03d4c6281165db0d9dc82d52d` (mobile27/430، tsc0، PG2/19، mutations13/13). ده follow-up مستقل عن `F13-REVIEW-01` (`ea0d638`). بروتوكول Director الأحدث سمح بملحق `SOL — PENDING OPUS REVIEW` داخل نسخة AI Bridge في الفرع المعزول؛ الملحق اتضاف بدون تغيير الحقائق السابقة أو Master Continuity أو worktree Opus، ومش canonical promotion. Native encryption/process-death/device acceptance لسه **NOT EXECUTED**.

قبل الإصلاح، direct403/404 كان بيحجب الرصيد في runtime الحالي بس؛ بعد cold JS runtime مع نفس disk data وبدون شبكة، 55 بترجع last-known. كمان disk snapshot كانت بتترجع `synced`، فيتبان 55 confirmed أثناء أول poll لسه pending. الحل denial metadata مستمرة لكل resource، مع hydration last-known، scope/request fences، وتجميع stock+denial في نفس encrypted document. مفيش إلغاء caching ولا مسح Outbox.

## 01 — Baseline & Scope

- Base: `376be666de12b3b12269850eaa08a8f7f5f790a7` على `review/sol-f13-balance-authorization`، verified/clean عند البداية.
- Working branch: `review/sol-f13-cache-lifetime`؛ worktree: `D:\Projects\StockMind-wt\sol-f13-cache-lifetime`، اتعملت clean من الـbase المحدد.
- Canonical Series 13: `hardening/series13-authority-observability` عند `e36ae9792e9dc0d1893eb8849889b5f638ac5465`، AI Bridge v1.9؛ اتقرت instructions/boundaries، بلا تعديل أو Desktop mirror.
- قريت prior Sol bridge، AGENTS، relevant continuity sections، warehouse-sync/cache callers، secure-storage، repositories/HTTP propagation، query keys، account/session reset وUI consumers. Source/Git هو الدليل، مش handoff قديم لوحده.
- استخدمت node_modules junctions داخل worktree الجديدة من canonical dependencies؛ مفيش install أو dependency/lockfile/signing/config change. Junctions دي للاختبارات/tsc؛ Metro محتاج setup مناسب مستقل.

## 02 — Investigation & Chronology

1. اتأكدت من base SHA/status وعدم وجود branch/worktree المطلوبين؛ أنشأت العزل وحدّثت رأس supplemental bridge من أول المهمة، مع الاحتفاظ بالنسخة السابقة ARCHIVE.
2. تتبعت `ApiStockRepository.balance` اللي كان بيرجع HTTP response/error مباشرة؛ مفيش durable direct-denial update. `entryOf` كانت بترجّع disk `sync.status` زي ما هي. warehouse poll denial كانت بتمسح stock، لكن مفيش persistent denial marker.
3. ضفت deterministic `cache-lifetime.test.ts` قبل الإصلاح: **4 failed / 1 passed**. حالات direct403/direct404 والـpending-first-poll أثبتت العيب. الـwarehouse-denial test أثبت إن سبب no-access بيتنسي، ويقدر fabricated retained-success input يتغلب عليه؛ ده دفاع إضافي، **مش** ادعاء إن stock cache اللي اتمسحت فعلاً بترجع لوحدها بعد poll denial.
4. اتنفّذ v2 encrypted document + product/warehouse denial overlay، fresh request recovery، no stale-response revival، وviews مشتركة بتطبق `isCachedStockVisible`؛ حتى recent movements وoutbox-review cached server figure ما يرجعوش رقم مرفوض.
5. أول focused gate بعد التعديل فشل TS2454 (`task` في finally قبل definite assignment). اتصلح generation guard بدون weakening tests. الـ32 focused tests عدّوا بعده. بعد توسيع الحالات: lifecycle21، وبعد concurrency/consumer checks: **24**.
6. شغلت full mobile أول مرة **26 suites / 422** قبل آخر 3 tests؛ final بعد restoration **26/425**؛ tsc0. PG/HTTP specs **2/19**. نفّذت **12/12 negative controls DETECTED**، وكل الملفات رجعت exact original bytes (hashes في ledger).
7. راجعت diff والـsource consumers بمهارة code-quality، وعملت code commit `dedd3f9`. Mobile full425 وtsc0 وPG2/19 اتعادوا فعلياً عليه. بعدها توقفت cluster المهمة بنجاح؛ scratch data/logs محفوظة، بلا cleanup.
8. لا external AI delegation، no merge/rebase/history rewrite/cleanup، no production/Neon/enforce/APK/device actions. الـPG المستخدمة cluster synthetic الخاصة بالمهمة السابقة، بنفس executable، وDB names جديدة فقط؛ لا بيانات عميل أو `.env`.
9. final consumer audit لقى مسار Reservations availability خارج scalar balance overlay. ضفت actual-hook regression بreal QueryClient/QueryObserver وmocked React hooks: **3 failed / 2 passed** قبل التصحيح (product deny، warehouse deny، account query identity). أول test setup فشل TS2352 مع0 tests، فاتصلح harness باستخدام actual observer result. بعد fix: availability5 + lifecycle24 = **29/29** وtsc0. الإضافة في `468f26a`، قبل أي push. `useAvailability` بيحجب retained onHand/available/reserved لما stock visibility ترفض، وquery identity فيها account/full URL. الـnegative suite اتعادت: **13/13 DETECTED** بما فيها availability bypass؛ final full27/430 وtsc0 وPG2/19 عدّوا على الـHEAD الجديد. الـcluster اتوقفت تاني بنجاح؛ scratch data محفوظة.
10. documentation checkpoint `31756f82e3e6db436ad56de547a124b16f6671fe` اتعمله ordinary push، وlocal/remote SHA متساويين، والـbridge/REPORT في committed tree. آخر raw Git range check كشف trailing whitespace من terminal transcripts الجديدة؛ اتطبّع line-end whitespace وANSI في `.txt` evidence بس، بدون تغيير counts/assertions أو أي source/test. التحديث ده documentation-only؛ raw logs الأصلية محفوظة خارج Git.
11. بعد رسالة Director ببروتوكول Shared AI Bridge، اتضاف pending-review appendix فقط لـ`docs/handoff/STOCKMIND_AI_BRIDGE.md` في الفرع المعزول، واتضاف سجل توقيتات بمصدرها في قسم 13. تفاصيل current mission فوق والـarchive القديم محفوظ؛ Master/نسخ Opus/Desktop لم تتغير. final publication verification تُسجل محلياً بعد الرفع في ignored `docs/handoff/cache-lifetime-publication-verification.log`، ومعها exact final SHA في رد التسليم؛ الملف خارج committed tree لتجنب self-hash circularity، والأوامر في قسم 08 تسمح بإعادة التحقق من remote.
12. Final documentation checks: raw `git diff --check 376be66` exit0، ولا mobile/tests/Continuity diff بعد `468f26a`. AI Bridge original content محفوظ بالكامل والملحق appended فقط. أول archive-preservation assertion حاول يطابق الملف القديم بما فيه عنوانه الأول، ففشل لأن العنوان اتسمّى ARCHIVE عمداً؛ التصحيح قارن body من section00 حتى EOF وأثبت إنه مطابق حرفياً بعد newline normalization. ده تصحيح نطاق check توثيقي، مش product test failure أو تغيير للحقائق التاريخية. previous Sol/Series13 worktrees clean، و`pg_ctl status` رجّع no server running (exit1 المتوقع للحالة دي).

## 03 — Policy & Engineering Decisions

| الحالة | السياسة اللي الكود بيطبقها | التعافي / الحد |
|---|---|---|
| direct balance403/404 | deny للـ`server + company + user + warehouse + product` فقط، مكتوب قبل انتهاء repository promise | 404 مبهمة؛ مفيش parsing لرسالة backend ولا افتراض إن المخزن كله اتسحب |
| product-specific404 | المنتج ده يختفي من stock/recent/cached server figure؛ المنتجات التانية تفضل متاحة | matching valid direct200 بدأ بعد آخر denial يرفع marker المنتج فقط؛ poll200 لوحده مش كفاية |
| warehouse `/stock/changes/:w`403/404 | stock/recent للمخزن يتشالوا، ومعاهم persistent warehouse-deny marker | fresh matching poll يكوّن valid warehouse state (`revision !== null`) هو اللي يرفع warehouse marker؛ لا timeout/5xx/foreign snapshot |
| restart مع known deny | denial يتهدرج من نفس encrypted document؛ query cache الفاضية أو القديمة مش طريق لإعادة الرقم | no expiry تلقائي أو TTL يسمح بظهور رقم مرفوض |
| restart بدون observed deny | snapshot تتقرأ last-known بوقتها، حتى والـfirst poll pending | تبقى confirmed بعد live valid sync؛ confirmed zero وdevice ledger زي ما هم |
| device أوفلاين لم يستقبل revocation | last-known المسموح سابقاً ممكن يتشاف بوضوح كقديم | **مش ادعاء إن جهاز مفصول يقدر يكتشف revocation ما وصلتهوش** |
| same account، token refresh / memory reset / relaunch | denial المستمرة محفوظة؛ tokens مش authorization cache identity | auth payload/company/user + full configured API URL، مش token string |
| user/company/server change | stock memory وdisk namespaces ما بيتخلطوش؛ full URL يشمل scheme/host/port/path حتى لو host نفسه | account `scopeKey` الأصلي وOutbox scope ما اتغيروش؛ stock/query لهما endpoint binding إضافي |
| explicit sign-out | current account/server stock cache والـdenials تتمسح مع بعض؛ v1 current-scope stock key كمان | مفيش stock قديم يتهدرج بعد محو marker؛ queued Outbox operations محفوظة |
| access رجعت شرعياً | fresh matching direct200 يرفع pair marker، fresh warehouse poll يرفع warehouse marker؛ لو الاتنين معروفين، الاتنين لازم يتأكدوا | successful direct recovery يخلي snapshot القديمة catching-up/last-known لحد poll جديد؛ لا إعادة تصنيف snapshot قديمة كـconfirmed |
| obsolete request | account/session generation + denial version يمنعوا late success من رفع deny أحدث أو poll قديم من كتابة snapshot بعده | warehouse-level version محافظ: رفض منتج قد يرفض direct response متزامنة لمنتج تاني؛ retry جديد يعيد التحقق |
| failed storage write | live deny يتطبق الأول؛ لو الكتابة فشلت يُحذف stock document القديم، من غير لمس queue | الاختبار أثبت write failure مع نجاح deletion. لو الكتابة والحذف الاتنين فشلوا، مفيش ضمان durable بلا storage؛ مش مُدّعى خلاف ده |

**بدائل اتراجعت:**

- إلغاء offline caching: مرفوض، بيكسر requirement.
- اعتبار كل product404 warehouse revocation: مرفوض؛ PG أثبت product404 + warehouse200 في نفس session.
- حذف row المنتج من sync balances بس: مرفوض؛ absence بعد snapshot معناها confirmed zero في الـdomain، فده يبقى رقم مضلل.
- تغيير global `account-scope` أو Outbox schema: مرفوض؛ ممكن يسيب queued operations من غير scope معروف. الربط بعنوان API الكامل خاص بـstock cache وbalance query فقط.
- separate deny key وstock key: كان محتاج multi-key ordering. المختار document واحد لـstock+markers عبر setter متزامن؛ لا window بين حفظ stock وحفظ marker في JS.
- migration صامتة من v1: مرفوضة؛ v1 لا تسجل direct denials ولا full endpoint provenance. **v1 online snapshots يتم تجاهلها مرة بعد upgrade، ويلزم online sync لإعادة بناء cache**. لم يتم global deletion أو تعطيل caching؛ SQLCipher local inventory وOutbox لم يتغيروا. ده compatibility cost لازم Lead/Director يعرفوه قبل QA upgrade.

## 04 — File Change Manifest

Source/test changes في `dedd3f94fda7d112d52d0f53a3acb644b30e98d7`؛ `mobile/src/query/useStock.ts` اتضافله availability correction، و`mobile/src/domain/availability-visibility.test.ts` اتضاف في `468f26a675b093a03d4c6281165db0d9dc82d52d`:

| Exact path | الغرض والأثر |
|---|---|
| `mobile/src/sync/warehouse-cache.ts` | v2 full-endpoint/account namespace، single-document read/write، required denial metadata validation، targeted cleanup |
| `mobile/src/sync/warehouse-sync.ts` | persistent pair/warehouse denial، hydrated last-known، direct fetch lifecycle، scope/generation/version fences، safe single-flight reset، cache-only reactive entry |
| `mobile/src/data/api/api-repositories.ts` | ربط balance/availability الفعليين بـ`fetchWarehouseBalance`؛ نفس error propagation وserver response |
| `mobile/src/domain/balance-truth.ts` | denial overlay + shared visibility predicate + unavailable list state؛ منع inference zero لمنتج مرفوض |
| `mobile/src/query/useStock.ts` | balance/availability query keys تشمل account/full endpoint؛ availability data تُحجب بنفس overlay؛ prefix invalidation الحالي لسه شغال |
| `mobile/app/movement/[productId].tsx` | scoped hydrated view وdenial metadata للـresolver؛ لا تغيير write payloads |
| `mobile/app/product/[productId].tsx` | نفس الحماية في transfer/product balance؛ لا UI redesign |
| `mobile/app/outbox-review.tsx` | إخفاء cached server stock المرفوض؛ own receipt/queued intent/persistence بدون تغيير |
| `mobile/src/components/OnlineWarehouseStock.tsx` | filtering للـdenied stock/recent؛ المنتجات المسموحة تفضل موجودة |
| `mobile/src/components/SyncStatusPill.tsx` | hydrated catching-up figures تتوصف last-known بوقتها، مش synced |
| `mobile/src/i18n/locales/en.json` | `online.sync.cachedAt` |
| `mobile/src/i18n/locales/ar.json` | نفس key بالعربي |
| `mobile/src/domain/cache-lifetime.test.ts` | 24 lifecycle/storage-wiring/repository/query/scope/concurrency/recovery cases؛ 291 lines كلها لنفس السلوك |
| `mobile/src/domain/availability-visibility.test.ts` | 5 actual-hook tests بreal QueryObserver retained data؛ React hooks mocked، no mounted UI |
| `mobile/src/domain/balance-authorization-flow.test.ts` | assertions اتحدثت من حذف cache record إلى empty stock + durable marker؛ مش weakening |
| `tests/integration/f13-balance-authorization.pg.spec.ts` | +2 actual HTTP/PG distinction/re-grant checks؛ +2 السابقة محفوظين |

Documentation-only follow-up commit(s): `docs/handoff/SOL_TO_CLAUDE_OPUS_BRIDGE.md` (current header + unchanged prior archive)، وكل الملفات داخل `docs/handoff/sol-f13-cache-lifetime-evidence/`: التقرير ده، reproduction/run commands، small before/after test logs، mutation harness/ledger؛ و`docs/handoff/STOCKMIND_AI_BRIDGE.md` (append-only pending-review section داخل isolated branch، بتفويض Director الأحدث). لا Master Continuity أو lockfiles أو build/signing changes؛ لا writes على canonical worktree.

## 05 — Test & Evidence Ledger

البيئة: Windows / PowerShell، Node26.7.0، mobile Jest29.7، backend Jest30.4.1، PostgreSQL15.19 محلية `127.0.0.1:55433`. Native MMKV/Expo/RN engines وHTTP في mobile lifecycle suite mocked؛ إنتاجي فعلي: secure-storage initialization/wrapper، repositories، sync store/poll/reducer، TanStack Query، resolver. الـPG tests تستخدم backend حقيقي وHTTP حقيقي، وبتشتغل separately عن mocked mobile lifecycle؛ مش single device end-to-end run.

| الأمر / checkpoint | النتيجة الفعلية | Evidence |
|---|---|---|
| `rtk proxy node node_modules/jest/bin/jest.js src/domain/cache-lifetime.test.ts --runInBand --colors=false` قبل الإصلاح | 4 failed / 1 passed، 1 failed suite، 0 skipped | `before-lifecycle.txt` |
| first focused بعد التعديل | compile failed TS2454؛ lifecycle cases لم تنفذ فعلياً رغم Jest listing failure؛ 21 existing balance-truth tests عدّوا | `initial-compile-failure.txt` |
| fixed initial focused: cache-lifetime + balance-authorization-flow + balance-truth | 3 suites / 32 passed، 0 failed/skipped | `focused-32.txt` |
| expanded lifecycle21 ثم24 | كل تشغيل PASS؛ النهائي 24/24 | `lifecycle-24.txt` |
| full mobile قبل آخر3 tests | 26 suites / 422 passed، 0 failed/skipped | `mobile-422.txt` |
| full mobile بعد restoration وعلى code commit | 26 suites / 425 passed، 0 failed/skipped؛ exit0 | `mobile-final.txt`, `mobile-committed.txt` |
| availability hook قبل fix | 3 failed / 2 passed، 0 skipped | `availability-before.txt` |
| availability test setup الأول | TS2352 compile failure، 0 tests؛ مش product RED | `availability-test-compile-failure.txt` |
| availability + lifecycle بعد fix | 2 suites / 29 passed، 0 failed/skipped | `availability-focused-29.txt` |
| full Mobile على final code `468f26a` | **27 suites / 430 passed، 0 failed/skipped، exit0** | `mobile-head-430.txt` |
| mobile TypeScript على `468f26a` | exit0، diagnostics none | `typecheck-head.txt` |
| PG/HTTP على `468f26a`، fresh local DB | 2 suites / 19 passed، 0 failed/skipped، Jest exit0 | `pg-head-19.txt` |
| `rtk proxy node node_modules/typescript/bin/tsc --noEmit` | exit0، مفيش diagnostics؛ اتعاد على code commit | `typecheck.txt` |
| local PG gate: f13-balance-authorization + access-lifecycle، قبل وبعد code commit | كل تشغيل2 suites / 19 passed، 0 failed/skipped؛ child Jest exit0 | `pg-19.txt`, `pg-final.txt` |
| `rtk proxy node docs/handoff/sol-f13-cache-lifetime-evidence/run-negative-controls.cjs` بعد availability fix | **13/13 DETECTED**؛ كل mutant actual assertion failure + Jest exit1؛ harness exit0 | `negative-controls.txt` |
| `rtk git -C <worktree> diff --check`، staged diff/source review | clean؛ scope-bound changes | Git + manifest |

Negative controls: عدم حفظ product deny (9 failed)، عدم حفظ warehouse deny (1)، hydrate confirmed (1)، network يمسح warehouse deny (2)، poll يمسح product denies (10)، stale direct response يرفع deny (1)، old poll يكتب بعد deny (1)، تجاهل session identity (4)، دمج endpoints في cache (1)، product404 يقفل المخزن كله (5)، visibility تتجاهل product deny (13)، repository تتجاوز durable wrapper (16)، availability تتجاوز deny overlay (2). أول12 كل تشغيل فيه24 test؛ الأخير5 tests؛ الباقي passed. لا compile/zero-test failure اتقبل كـdetected. SHA-256 original/restored لكل ملف موجود في ledger. أول12 controls اتنفّذوا قبل الإضافة كمان، والـ13 اتعادوا كلهم على النسخة النهائية.

**غير منفّذ:** physical process death، native MMKV disk/Keystore encryption أو power-loss durability، component render، emulator/Huawei، QA APK build/inspection، full backend suite (لا production backend change). QA boundary وOffline/device-ledger rules وOutbox/Idempotency/Reconciliation suites القديمة كلها ضمن full mobile430. الادعاء هنا source/domain/runtime wiring verification، مش device certification.

## 06 — Security & Integrity Assessment

- Company/user/server isolation: namespace وlive scope checks وdirect query key؛ late foreign-session success/denial لا يكتب في account الجديد. لا تعديل global Outbox scope.
- Warehouse authorization: server لسه هو صاحب القرار. local markers تمنع عرض cached stock المعروف رفضه؛ مش grants ولا bypass للـbackend.
- Product-specific denial: لا مسح أو منع المنتجات التانية بلا دليل. نجاح warehouse sync لا يرفع رفض منتج مباشر لوحده.
- Offline truth: no denial → last-known/time؛ observed deny → unavailable بلا رقم؛ device ledger مستقل؛ مفيش ادعاء اكتشاف revocation غير مستلمة.
- Inventory/idempotency: لم يتغير reducer أو movement body أو server commands/keys. no queued receipts added to committed stock؛ existing outbox pending effects زي ما هي.
- Privacy: denied raw product rows قد تفضل داخل encrypted document، لكن guard بتمنع app stock/recent/outbox-stock readers من عرضها؛ ده denial-state mechanism، **مش secure erasure**. Warehouse denial يمسح snapshot/recent ويحتفظ بmarker.
- Financial privacy: لا cost/DTO/API permission changes؛ no sensitive records في الأدلة. ده static no-change assessment، مش تشغيل full financial/backend gates.

## 07 — Limits & Open Risks

| ID | الحالة / الأثر | Next action / integration |
|---|---|---|
| F13-CACHE-LIFETIME | CONFIRMED → FIXED في طبقة JS/persistent-wrapper behavior | جاهز لمراجعة Opus، مش merge تلقائي |
| NATIVE-DURABILITY | UNVERIFIED: MMKV engine/Keystore/process death الحقيقيين مش متجربين هنا | QA build + coordinated cold-kill/offline acceptance قبل device sign-off |
| V1-CACHE-UPGRADE | KNOWN: legacy online snapshots مش هتظهر offline لأول مرة بعد upgrade لحد sync ناجح | لازم user/QA يعرفوا ويعملوا online warm-up؛ local inventory وOutbox محفوظين |
| STORAGE-UNAVAILABLE | partial write failure + successful delete مختبر؛ فشل الكتابة والحذف معاً لا يمكن ضمان persistence بسببه | fail-closed live state موجودة؛ investigate native storage failure handling لو حصل، بلا ادعاء ضمان غير قابل للتنفيذ |
| BACKEND-CONTRACT | direct404 لا تصنف warehouse revocation؛ fresh valid poll هو الدليل الأوسع؛ no received denial means no offline revocation knowledge | Opus يتحدى السياسة ضد أي API permission changes مستقبلية |
| UI-NATIVE | pure visibility rule tested + consumers inspected/typechecked؛ لا mounted native UI proof | تأكد من list/recent/outbox-review masking والعربي عند device acceptance |

## 08 — Git & Artifacts

- Initial: `376be666de12b3b12269850eaa08a8f7f5f790a7`.
- Primary tested checkpoint: `dedd3f94fda7d112d52d0f53a3acb644b30e98d7` (mobile26/425 + tsc0 + PG2/19). Final implementation / last fully tested code: **`468f26a675b093a03d4c6281165db0d9dc82d52d`**؛ mobile27/430 + tsc0 + PG2/19 متنفذين عليه فعلياً؛ mutations13/13 مع exact-byte restoration قبل الـcommit.
- Supplemental bridge/evidence في docs-only commit بعد الكود؛ final handoff SHA يُستخرج بـ`rtk git -C D:\Projects\StockMind-wt\sol-f13-cache-lifetime log -1 --format=%H -- docs/handoff/SOL_TO_CLAUDE_OPUS_BRIDGE.md` (self-hash لا يمكن إدراجه داخل نفسه).
- Branch/worktree فوق؛ قبل الرفع يُفحص clean status وexact source diff وordinary push؛ local/remote SHA equality تتسجل في supplemental header بعد التحقق. لا merge أو force-push.
- Verified published documentation checkpoint: `31756f82e3e6db436ad56de547a124b16f6671fe`، remote=local وclean worktree. current docs-only verification/formatting follow-up يُعرف commit بتاعه من أمر `git log` فوق؛ final report يدي الـSHA بعد رفعه. previous Sol/Series13 SHAs وحالتهم clean اتراجعوا، ومفيش writes على main.
- Raw logs خارج Git: `_local-tools\logs\stockmind_gate_sol_f13_lifetime_{01,final,availability_final}.log`؛ هنا compact summaries فقط، بدون request bodies/credentials. dependency junctions وignored `.log` artifacts محلية.
- الـcluster **STOPPED** بعد checkpoint الأول، واتشغلت لإعادة PG gates على availability addendum ثم اتوقفت تاني بنجاح. scratch DBs متروكة بلا حذف. كل commits بعد `468f26a` documentation/evidence فقط.

## 09 — Reproduction & Instructions for Opus

1. طابق branch/base/code/final handoff SHA مع Git وremote؛ اقرأ current supplemental header والتقرير، والـarchive القديم كمرجع تاريخي بس.
2. راجع cache v2 policy والتكلفة المقصودة للـv1 invalidation؛ ما تنقلش v1 snapshots تلقائياً ولا تغيّر Outbox scope.
3. من `D:\Projects\StockMind-wt\sol-f13-cache-lifetime\mobile`:

```powershell
rtk proxy node node_modules/typescript/bin/tsc --noEmit
rtk proxy node node_modules/jest/bin/jest.js --runInBand --colors=false
rtk proxy node node_modules/jest/bin/jest.js src/domain/cache-lifetime.test.ts --runInBand --colors=false
```

4. PG cluster الخاصة بالمهمة فقط `D:\Projects\StockMind-wt\_local-tools\pgdata-sol-f13`؛ ابدأها لو متوقفة والبورت فاضي. الـhelper بيعمل drop/recreate للاسم؛ **اختار DB name جديدة بلا بيانات**. Test guard بيقبل local `127.0.0.1:55433` و`stockmind_gate_sol_f13_*` فقط. لا `.env`، no production/enforce.

```powershell
rtk proxy D:\Projects\StockMind-wt\_local-tools\pg15\pgsql\bin\pg_ctl.exe -D D:\Projects\StockMind-wt\_local-tools\pgdata-sol-f13 -l D:\Projects\StockMind-wt\_local-tools\logs\sol-f13-lifetime-postgres.log -o "-p 55433 -h 127.0.0.1" -w start
rtk proxy powershell -NoProfile -File D:\Projects\StockMind-wt\_local-tools\scripts\backend-gate.ps1 D:\Projects\StockMind-wt\sol-f13-cache-lifetime stockmind_gate_sol_f13_lifetime_opus_01 --runTestsByPath tests/integration/f13-balance-authorization.pg.spec.ts tests/integration/access-lifecycle.pg.spec.ts
rtk proxy D:\Projects\StockMind-wt\_local-tools\pg15\pgsql\bin\pg_ctl.exe -D D:\Projects\StockMind-wt\_local-tools\pgdata-sol-f13 -m fast -w stop
```

الـhelper بيضيف `--maxWorkers=2`، فلا تضيف `--runInBand`. اعتمد `JEST EXIT` + counts، مش outer PowerShell exit لوحده.

5. من جذر worktree، بدون tests شغالة بالتوازي:

```powershell
rtk proxy node docs/handoff/sol-f13-cache-lifetime-evidence/run-negative-controls.cjs
rtk git -C D:\Projects\StockMind-wt\sol-f13-cache-lifetime diff --check
```

6. المتحقق مستقلاً في الطبقة المعنية: direct denial cold-runtime regression، first-poll truth، identity/races/recovery، actual HTTP product404 vs warehouse denial/re-grant. اتحدى native durability وUI integration؛ ما تعتمدش fake MMKV كإثبات تشفير حقيقي.
7. بعد قبول code/policy بس: نسّق QA build بنفس Series12 identity/key/network contract، warm stock cache online، وبعدها cold kill/reopen offline قبل poll، product-only/warehouse-wide masking، recovery، Arabic، وOutbox preservation مع Director. لا تثبيت Huawei تلقائي.
8. راجع pending appendix في نسخة AI Bridge على الفرع المعزول؛ Opus وحده بعد قبول الأدلة يحدّث canonical Bridge/Master؛ التقرير والملحق مش promotion للمرجع الرسمي. لو ظهر documentation conflict، احتفظ بالنسختين واطلب reconciliation، من غير حذف صامت.

## 10 — Collaboration Protocol

Sol هو implementation/review collaborator، Opus هو Lead Engineer، ChatGPT مستقل للمراجعة/التنسيق، وDirector صاحب القرارات. Worktrees منفصلة، لا concurrent writes، no silent merges، no external delegation، changes/decisions/tests موثقة، وunverified claims مش حقائق مقبولة تلقائياً. Receiving engineer يتحقق قبل التبنّي.

## 11 — Next Recommended Task

**توصية فقط، مش تفويض:** native QA acceptance محدودة لـcache-lifetime من accepted branch: online warm-up → observed denial → kill/reopen قبل poll offline → recovery بعد re-grant، مع الحفاظ على Outbox والتحقق من العربي. لم يبدأ build/device work في المهمة دي.

## 12 — Message to Claude Opus

يا Opus، follow-up `F13-CACHE-LIFETIME` على `review/sol-f13-cache-lifetime` من `376be66` اتثبت واتصلح. code `dedd3f9` + availability fix `468f26a675b093a03d4c6281165db0d9dc82d52d` بيحفظ pair/warehouse denials في cache v2 مربوطة بالـfull API endpoint/account، ويهدرج disk stock كـlast-known، ويحجب retained availability كمان. product404 مش دليل revoke للمخزن؛ poll denial دليل نطاق مخزن؛ recovery لازم fresh matching server response؛ late responses fenced. Lifecycle24 + availability5، و13/13 mutations detected؛ final full/tsc/PG results في current header والـledger. أهم compatibility cost: v1 online cache محتاجة warm-up sync بعد upgrade؛ device ledger/Outbox لم يتغيروا. Native engines/process death/UI لم تتجرب فعلياً، فلا تعتبر ده device acceptance. راجع التقرير ورأس `SOL_TO_CLAUDE_OPUS_BRIDGE.md` والأدلة والـpending appendix في AI Bridge على نفس الفرع، ثم قرر قبول code/policy ونسّق QA acceptance مع Director. لا merge أو canonical promotion اتعمل هنا؛ Master untouched.

## 13 — Timestamped Changelog & Publication Provenance

التوقيتات التالية يوم 2026-10-26. صفوف Git بتسجل commit timestamp كما هو؛ صفوف log بتسجل mtime للملف بتوقيت Africa/Cairo (وقت كتابة الدليل، مش ادعاء بداية الاختبار). ساعة execution host مختلفة عن clock tool بحوالي ساعتين؛ مفيش محاولة لتعديل التاريخ أو اختراع أوقات للمراحل اللي ما اتسجلتش بدقة.

| التوقيت المسجل / المصدر | checkpoint / commit | الدليل والنتيجة |
|---|---|---|
| 07:30:00 Africa/Cairo، log mtime | base `376be66`؛ `cache-lifetime-before.log` | deterministic lifecycle قبل الإصلاح: 4 failed / 1 passed؛ baseline/full scope في قسم 01 |
| 07:42:18+03:00، Git | `dedd3f94fda7d112d52d0f53a3acb644b30e98d7` | primary lifecycle implementation؛ full425/tsc0/PG19 أُعيدوا على commit ده؛ التفاصيل في ledger |
| 07:48:25 Africa/Cairo، log mtime | قبل `468f26a`؛ `cache-lifetime-before-availability2.log` | actual-hook regression: 3 failed / 2 passed؛ TS2352 setup failure أقدم موثق منفصلاً |
| 07:50:43+03:00، Git | `468f26a675b093a03d4c6281165db0d9dc82d52d` | final code، availability masking/scoped identity؛ controls13/13 detected مع exact-byte restoration |
| 07:51:04 Africa/Cairo، log mtime | `468f26a`؛ `cache-lifetime-head-mobile.log` | full Mobile 27 suites / 430 passed / 0 skipped، exit0؛ TypeScript exit0 موثق منفصلاً |
| 07:51:16 Africa/Cairo، log mtime | `468f26a`؛ `stockmind_gate_sol_f13_lifetime_availability_final.log` | actual synthetic PG/HTTP 2 suites / 19 passed، JEST EXIT0؛ cluster اتوقفت بعدها |
| 07:53:31+03:00، Git | `31756f82e3e6db436ad56de547a124b16f6671fe` | documentation checkpoint منشور وتم التحقق من remote=local وclean status؛ الكود مطابق `468f26a` |
| 09:57:13 Africa/Cairo = 06:57:13 UTC، clock tool | docs-only shared-protocol follow-up (commit يُستخرج من Git) | pending-review appendix؛ timestamp ledger؛ terminal whitespace normalization؛ لا source/test تغيّر بعد `468f26a` |

الـfinal HEAD هو commit اللي بيحتوي تحديث التسليم ده، ويمكن استخراجه بـ`rtk proxy git log -1 --format=%H -- docs/handoff/SOL_TO_CLAUDE_OPUS_BRIDGE.md`. قبل إعلان publication لازم يطابق `rtk proxy git ls-remote --heads origin refs/heads/review/sol-f13-cache-lifetime`، مع clean status و`rtk proxy git diff --check 376be66 HEAD` exit0. الـexact SHA ووقت تحقق الرفع بيتسجلوا بعد العملية في publication log المحلي ورد Director النهائي؛ ما ينفعش تضمين self-hash داخل نفس commit. Last tested code يظل `468f26a675b093a03d4c6281165db0d9dc82d52d`؛ كل ما بعده docs/evidence فقط.
