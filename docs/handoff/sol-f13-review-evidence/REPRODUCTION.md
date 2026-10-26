# F13-REVIEW-01 — reproducible evidence

التاريخ: 2026-10-26 (Africa/Cairo). بيانات synthetic فقط، Windows / Node 26.7.0 / PostgreSQL 15.19 / mobile Jest 29.7 / backend Jest 30.4.1. الكود: `ea0d63814913d30bdffe1fd226add071c2365f8c`؛ الـbase: `e36ae9792e9dc0d1893eb8849889b5f638ac5465`.

## النتيجة وحدودها

**CONFIRMED → FIXED**: نسخة الـbase عرضت sync quantity=55 بعد direct 404 ناتج عن سحب warehouse access حقيقي. السيرفر رفض صح؛ المشكلة في أولوية presentation model. الاختبار جمع Nest HTTP + PostgreSQL + production mobile reducer + TanStack Query + resolver. الشاشة نفسها/native hooks ما اتعملهاش render، والـHuawei ما اتلمسش.

التسلسل في `tests/integration/f13-balance-authorization.pg.spec.ts`:

1. Owner يسجّل شركة synthetic، يدعو Staff على مخزنها، ينشئ منتج ويسجّل inbound=55.
2. Staff يقرأ `/stock/changes/:w` و`/stock/balance/:p/:w` بنجاح؛ production `applyChanges` يبني sync snapshot، وproduction QueryClient يحتفظ بالرصيد.
3. Owner يعمل `PUT /team/members/:staff/warehouses` بـ`warehouseIds: []`، HTTP 200.
4. نفس Staff session يقرأ products=200، وbalance=404. TanStack Query يبقى `status:error` مع data القديمة=55، بينما warehouse sync لسه `synced / lastError:null`.
5. قبل الإصلاح resolver رجع `confirmed:55`؛ بعده `unknown:no-access` وknownQuantity=null.
6. بعد الإصلاح بنثبت كمان إن stock poll=404 وإن Owner لسه بيقرأ quantity=55؛ مفيش تغيير ledger.

`mobile/src/domain/balance-authorization-flow.test.ts` يشغّل production sync store/poll/cache functions مع mocked HTTP/platform/storage/current scope؛ بيغطي 403 و404 قبل الـpoll، purge الذاكرة وdisk عند poll denial، offline hydration بالوقت، tenant reset، explicit sign-out cache deletion، وتأخير poll عبر account switch. ده مش physical encrypted-MMKV test.

## التشغيل

من `D:\Projects\StockMind-wt\sol-f13-balance-authorization\mobile`، بعد توفير dependencies المطابقة للـlockfile:

```powershell
rtk proxy node node_modules/typescript/bin/tsc --noEmit
rtk proxy node node_modules/jest/bin/jest.js --runInBand --colors=false
rtk proxy node node_modules/jest/bin/jest.js src/domain/balance-truth.test.ts src/domain/balance-authorization-flow.test.ts src/domain/access-revocation.test.ts src/domain/sync-runner.test.ts --runInBand --colors=false
```

الـlocal tooling الموجود خارج Git: `D:\Projects\StockMind-wt\_local-tools\scripts\backend-gate.ps1`. الـcluster الخاصة بالمهمة: `D:\Projects\StockMind-wt\_local-tools\pgdata-sol-f13`، loopback فقط `127.0.0.1:55433`؛ بعد الجلسة تم إيقافها، لا يتم تشغيل cluster تانية أو إيقاف process مش تابع للمهمة. كل gate هنا استخدم DB جديدة باسم لم يكن موجوداً. الـhelper بيعمل drop/recreate للاسم، فلا تعيد استخدام اسم له بيانات عايز تحتفظ بيها.

```powershell
# شغّل cluster المهمة فقط بعد التأكد إن البورت متاح، بدون أي خدمة نظام.
rtk proxy D:\Projects\StockMind-wt\_local-tools\pg15\pgsql\bin\pg_ctl.exe -D D:\Projects\StockMind-wt\_local-tools\pgdata-sol-f13 -l D:\Projects\StockMind-wt\_local-tools\logs\sol-f13-postgres.log -o "-p 55433 -h 127.0.0.1" -w start
# اختار suffix جديد؛ guard الخاص بالاختبار بيقبل local stockmind_gate_sol_f13_* فقط.
rtk proxy powershell -NoProfile -File D:\Projects\StockMind-wt\_local-tools\scripts\backend-gate.ps1 D:\Projects\StockMind-wt\sol-f13-balance-authorization stockmind_gate_sol_f13_opus_01 --runTestsByPath tests/integration/f13-balance-authorization.pg.spec.ts tests/integration/access-lifecycle.pg.spec.ts
# لما تخلص: وقف cluster المهمة فقط.
rtk proxy D:\Projects\StockMind-wt\_local-tools\pg15\pgsql\bin\pg_ctl.exe -D D:\Projects\StockMind-wt\_local-tools\pgdata-sol-f13 -m fast -w stop
```

الـPG test بيتوقع shadow؛ ما تغيّرش deployment أو تفعّل enforce. الـgate بيجهّز test process env ببيانات مؤقتة، بدون قراءة `.env`. `--runInBand` غير متوافق مع `--maxWorkers=2` اللي الـhelper بيضيفه. الـhelper يطبع `JEST EXIT`، وده مرجع نتيجة الطفل؛ exit الخاص بالـPowerShell helper لوحده مش كفاية.

من جذر worktree المهمة، **من غير tests تانية شغالة بالتوازي**:

```powershell
rtk proxy node docs/handoff/sol-f13-review-evidence/run-negative-controls.cjs
rtk git -C D:\Projects\StockMind-wt\sol-f13-balance-authorization diff --check
```

الـnegative harness بيرفض أي branch غير فرع Sol المحدد، يحفظ exact bytes، يشيل حماية واحدة، يتطلب assertion failures فعلية + Jest exit=1، ويرجع الـbytes في finally. أول محاولة رفضت multiline anchor بسبب CRLF، **0 tests**؛ اتصلحت أداة الاختبار بتطبيع input للنص، مع استرجاع original bytes، وبعدها **6/6 DETECTED**. الـhash قبل وبعد محفوظ في `negative-controls.txt`. لا تستخدم history restore أو checkout لتصفير mutations.

## الأدلة المحفوظة

| الملف | نتيجة منفذة |
|---|---|
| `before-unit.txt` | 1 suite failed؛ 2 failed / 19 passed |
| `before-flow.txt` | 1 suite failed؛ 2 failed / 4 passed |
| `before-pg.txt` | 1 suite failed؛ 1 failed / 1 passed (real revocation) |
| `after-focused.txt` | 4 suites / 47 passed |
| `after-pg.txt` | 2 suites / 17 passed بعد الإصلاح |
| `mobile-full.txt` | 25 suites / 401 passed بعد الإصلاح |
| `typecheck.txt` | exit 0، diagnostics none |
| `negative-controls.txt` | 6/6 controls RED؛ exact-byte restoration |
| `final-mobile.txt` / `final-pg.txt` | إعادة التحقق على code commit بعد mutation restoration؛ النتيجة في bridge |

Full raw PG logs خارج Git في `_local-tools\logs\stockmind_gate_sol_f13_{before2,after,final}.log`. النسخ هنا مقتطفات صغيرة من نتيجة Jest، بدون HTTP bodies أو credentials. أول محاولة gate قبل `before2` لم تنفذ tests (PG متوقفة + CLI flag conflict)؛ مش دليل RED ضد المنتج.

## قيد cache لازم يفضل واضح

الإصلاح pure presentation rule؛ direct 403/404 بيحجب الرقم للـproduct/warehouse الحاليين، ومش بيحذف cache كله. purge المخزن يفضل عند warehouse poll denial، زي الـbaseline. لو التطبيق اتقفل قبل poll denial، query error مش persisted، وممكن cache snapshot تتهدرج كـlast-known بعد restart بدون شبكة. الكود الحالي يسمح بده؛ مش ضمان محو دائم بعد أي direct refusal. معالجة lifetime/persistence محتاجة قرار منفصل لأن product 404 مش بالضرورة warehouse revocation. ده follow-up موثّق، مش معمول هنا ولا مأذون نبدأه تلقائياً.
