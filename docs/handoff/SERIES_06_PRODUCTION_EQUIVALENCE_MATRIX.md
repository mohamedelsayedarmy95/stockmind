# STOCKMIND — SERIES 06: PRODUCTION EQUIVALENCE MATRIX (CP-1)

> **التاريخ:** 2026-10-24 · **الفرع:** `hardening/series06-release-safety` · **Production المبلّغ عنه:** `bb071ed` (فرع `release/prod-hotfix-f4`، parent `ec4c5db`) · **الـ candidate:** `integration/series04` + فروع Series 05/06 (آخر commit كود/اختبارات مذكور في التقرير).
> **الهدف:** إثبات إن كل واحد من الإصلاحات الستة المبلّغة في Production موجود **سلوكياً** في الـ candidate، بدليل تنفيذي لكل واحد على حدة.
> **تحذير:** ده إثبات تكافؤ **على الكود** بأدوات اختبار. مش إثبات لحالة Production الفعلية (Render/Neon ما اتلمسوش).
> التصنيفات: `PASS` (الاختبار التنفيذي نجح) · `UNVERIFIED` · `BLOCKED`.

---

## 0. النتيجة

| | |
|---|---|
| **CP-1** | **PASS — 6 من 6**، كل إصلاح له spec تنفيذي ونتيجته الفعلية، وكل spec اتأكد إنه **بيتحول أحمر** لو الحماية اتشالت (negative control). |
| الاختبارات | `tests/equivalence/production-bb071ed/` — **8 suites، 40 tests، 40 نجحوا** (سطور الأوامر في القسم 6). |
| تعديلات الـ specs الأصلية | **setup فقط** (DI / stub / عمق ملف)، **صفر سطر assertion اتشال أو اتعدّل** — دليل مولَّد: `docs/handoff/series06-evidence/equivalence-adaptation-diff.txt`. |
| الاختلافات اللي اتفحصت | 4 اختلافات سلوكية/تنفيذية اتشرحت (القسم 5)؛ **مفيش اختلاف غير مفسّر**. |
| التوصية | استراتيجية الـ release line: **الخيار A** (قسم 7)، للـ Director يوافق عليها. **ما اتنفّذش أي merge ولا إنشاء branch release.** |

---

## 1. مصفوفة التتبّع (الإصلاحات الستة)

مصدر "العيب الأصلي" = رسالة الـ commit الأصلية في `bb071ed`-chain (`git show -s`). مصدر "commit الـ candidate" = رسائل الـ commits نفسها بتقول إنها port.

### 1) F4 — تسريب بيانات المستخدم في سجل الحركات · prod `e4cac4c`
| | |
|---|---|
| **العيب الأصلي** | `GET /stock/movements/:productId` كان بيرجّع entities بالعلاقات `user` و`warehouse` كاملة من غير serializer، فأي حامل لصلاحية `VIEW_MOVEMENTS` (حتى Staff) كان بياخد `passwordHash` و`refreshTokenHash` والإيميل والدور وعنوان المخزن. |
| **الـ invariant** | الرد = allowlist DTO فقط، `user` و`warehouse` مختزلين لـ `{id, name}`؛ لا أعمدة credentials تتحمّل ولا تظهر في الـ SQL؛ شركة تانية = 404؛ بدون الصلاحية = 403. |
| **كود production** | `movement-response.dto.ts`، `stock.service.ts` |
| **commits الـ candidate** | `2a14630` ("Forward-port of the production hotfix (e4cac4c) to main"، وفيه كمان نقل الـ cache لمفتاح `v2`)، وزيادة لاحقة: `be2bcd2` (نطاق المخزن) |
| **مسارات الـ candidate** | `src/application/dtos/stock/movement-response.dto.ts` (مطابق للـ production بدون أي فرق)، `src/infrastructure/repositories/stock.service.ts` (`toMovementResponse`، سطر `getMovements`) |
| **الاختبار التنفيذي** | `tests/equivalence/production-bb071ed/movement-history.security.spec.ts` |
| **النتيجة** | **PASS 8/8** |
| **التعديل على الـ spec** | providers فقط (`RedisService` كـ always-miss، `WarehouseAccessService` بنطاق كامل، `OperationLookupService`) + مسار الـ glob (عمق الملف). الـ assertions كما هي. |
| **Negative control** | M5: تعطيل الـ allowlist ← **3 فشلوا من 8** |

### 2) إخفاء credentials من الـ request logs والـ audit · prod `64f73b9`
| | |
|---|---|
| **العيب الأصلي** | `pino-http` كان بيسجّل كل الـ headers (Bearer token والـ cookies)؛ وAuditLogInterceptor كان بيحفظ `idToken` (Google) و`temp_token` (2FA) و`otpauthUrl`/`qrCodeDataUrl` (TOTP) في `audit_logs.new_values` لأنها ما كانتش في قايمة الأسماء. |
| **الـ invariant** | `authorization`, `proxy-authorization`, `cookie`, `set-cookie` مخفية من الـ logs؛ أي مفتاح حساس يتخفى بصرف النظر عن الحالة/الأسلوب؛ والـ interceptor مسجّل عالمياً والـ logger مبني من `httpLoggerOptions()`. |
| **كود production** | `src/shared/logging/http-logger.options.ts` (جديد)، `audit-log.interceptor.ts`، `src/app.module.ts` |
| **commits الـ candidate** | `b1177c8` (الـ logger والإخفاء)، `13f1325` (الـ audit + `proxy-authorization`، "Same fixes as the live hotfix (64f73b9, 586c0a9)") |
| **مسارات الـ candidate** | `http-logger.options.ts` (**مطابق للـ production**)، `audit-log.interceptor.ts` (تطوّر: + `@SkipAudit`)، `app.module.ts` (نفس السطر: `LoggerModule.forRoot({ pinoHttp: httpLoggerOptions() })` + `APP_INTERCEPTOR`) |
| **الاختبارات التنفيذية** | `audit-log.redaction.spec.ts` · `http-logger.redaction.spec.ts` · `wiring.spec.ts` (اختباران) |
| **النتيجة** | **PASS** — audit 6/6، logger 1/1 (الاتنين **بدون أي تعديل**: صفر فرق بعد توحيد عمق المسار)، wiring 2/2 |
| **Negative control** | M3: لا شيء حساس ← **5 فشلوا من 6**؛ M4: بلا redact ← **1 من 1** |
| **ملاحظة** | wiring هو فحص **static** للنص (مش سلوكي)؛ السلوك مغطى بالاختبارين الآخرين. |

### 3) Google login: إيميل verified فقط، والـ token الغلط = 401 · prod `586c0a9`
| | |
|---|---|
| **العيب الأصلي** | Google login بيربط الحساب بالإيميل، لكن `email_verified` ما كانتش بتتفحص، فـ token لعنوان غير موثّق كان يقدر يدخل كصاحب العنوان؛ وأي فشل تحقق كان 500. |
| **الـ invariant** | لازم `email_verified === true` وإلا 401؛ أي فشل تحقق = 401؛ ولا بحث عن حساب لـ token غير موثّق. |
| **كود production** | `firebase.service.ts` (`verifyGoogleIdToken`)، `auth.service.ts` (`googleLogin`) |
| **commit الـ candidate** | `13f1325` ("Google login (google-auth-library path) requires email_verified; any verification failure is 401") |
| **مسارات الـ candidate** | `src/infrastructure/firebase/firebase.service.ts:95` (`!payload?.email \|\| payload.email_verified !== true` ← `UnauthorizedException`)، `auth.service.ts` (`googleLogin`) |
| **الاختبار التنفيذي** | `google-login.security.spec.ts` |
| **النتيجة** | **PASS 5/5** (`rejects … email_verified=false/undefined`، `accepts verified`، `maps an invalid token to 401`، `never looks up an account for an unverified e-mail`) |
| **التعديل على الـ spec** | **هدف الـ stub بس**: الـ candidate بيتحقق من الـ token بـ `google-auth-library` (`OAuth2Client.verifyIdToken`) بدل Firebase Admin، فالـ spy اتحوّل من `admin.auth().verifyIdToken` إلى `googleClient.verifyIdToken`. المدخلات والـ assertions زي ما هي. |
| **Negative control** | M1: قبول غير الموثّق ← **2 فشلوا من 5** |

### 4) تصحيح اعتماديتين مصابتين · prod `104b3e3`
| | |
|---|---|
| **العيب الأصلي** | `compression < 1.8.2` (تسريب ذاكرة عند إغلاق الرد بدري، GHSA-vc2v-76pw-4v95)؛ `proxy-addr < 2.0.8` (تزوير trust-subnet، GHSA-jqcg-44mw-7w3h). |
| **الـ invariant** | مفيش نسخة محلولة في `package-lock.json` أقدم من 1.8.2 / 2.0.8. |
| **كود production** | `package-lock.json` فقط |
| **commit الـ candidate** | `eaceca2` — **patch-id مطابق** لـ `104b3e3` (`git patch-id --stable`) |
| **الإثبات** | lock الـ parent `ec4c5db`: `compression@1.8.1`، `proxy-addr@2.0.7` (مصابين) · `bb071ed` والـ candidate: `1.8.2` و`2.0.8` |
| **الاختبار التنفيذي** | `deps-lockfile.spec.ts` (كُتب في Series 06؛ production ما كانش عنده spec لهذا الـ commit) |
| **النتيجة** | **PASS 3/3** (النسخ في الـ lock + self-test للمقارنة اللي بترفض 1.8.1 و2.0.7) |
| **Negative control** | غير مطبّق (lockfile)؛ الـ self-test بيثبت إن المقارنة بترفض النسخ المصابة. |

### 5) A1 — refresh tokens مرة واحدة وقابلة للإلغاء · prod `3849f93`
| | |
|---|---|
| **العيب الأصلي** | refresh tokens كانت متخزنة bcrypt، وbcrypt بيقرأ أول 72 byte بس (واحدة لكل tokens المستخدم)، فأي token قديم لسه صالح كان بيطابق: rotation وlogout وterminate-all وتغيير الباسورد ما كانوش بيحموا. وtokens في نفس الثانية كانت متطابقة. |
| **الـ invariant** | تخزين SHA-256 digest بمقارنة constant-time، `jti` في كل token، وقيم bcrypt القديمة مرفوضة. |
| **commit الـ candidate** | `f460d15` — **patch-id مطابق** لـ `3849f93` |
| **مسارات الـ candidate** | `auth.service.ts`: `hashRefreshToken` (السطر ~501) و`refreshTokenMatches` (~504، `timingSafeEqual`) |
| **الاختبار التنفيذي** | `refresh-token.rotation.spec.ts` |
| **النتيجة** | **PASS 6/6** |
| **التعديل على الـ spec** | **سطر واحد**: parameter إضافي في constructor الـ `AuthService` (`EntitlementsService`). |
| **Negative control** | M2: أي token يطابق ← **2 فشلوا من 6** |

### 6) A3 — 2FA على كل مسارات الدخول + حد تخمين الـ OTP · prod `bb071ed`
| | |
|---|---|
| **العيب الأصلي** | Google وSAML كانوا بيعدّوا على `issueTokensForSsoUser` اللي بيصدر session كاملة من غير فحص 2FA؛ وخطوة الـ OTP ما كانتش محدودة بالـ brute-force. |
| **الـ invariant** | بوابة واحدة (`secondFactorGate`) لكلمة السر وGoogle وSAML: مستخدم 2FA ياخد temp token لدقيقتين بس؛ و`/auth/2fa/login` بتطبق lockout وبتسجّل كل محاولة. |
| **commit الـ candidate** | `83f1126` (bb071ed نفسها بتقول: "Same fix as the release candidate (83f1126)") + `8a027c6` (زيادة: replay protection) |
| **مسارات الـ candidate** | `auth.service.ts` (`secondFactorGate` ~461، مستخدمة في ~200 و~284)، `auth.controller.ts:72-73` (`twoFactorLogin(dto, req)` ← `this.ctx(req)`) |
| **الاختبارات التنفيذية** | `auth.second-factor.spec.ts` + `wiring.spec.ts` (اختبار) |
| **النتيجة** | **PASS** — second-factor 8/8، wiring 1/1 |
| **التعديل على الـ spec** | **سطر واحد**: نفس parameter الـ constructor. |
| **Negative control** | M6: الـ 2FA بتتعامل كمقفولة لكل المستخدمين ← **6 فشلوا من 8** |

---

## 2. تغطية الملفات: كل اللي Production غيّره (15 ملف، 6 commits، +838/−62)

`git diff --stat ec4c5db bb071ed` = **كل** اختلاف production عن نقطة التفرّع. كل ملف مربوط:

| ملف production | الإصلاح | حالته في الـ candidate | دليل تنفيذي |
|---|---|---|---|
| `package-lock.json` | 4 | patched (1.8.2 / 2.0.8) | deps-lockfile.spec |
| `src/app.module.ts` | 2 | نفس الاستدعاء | wiring.spec |
| `src/application/dtos/stock/movement-response.dto.ts` | 1 | **مطابق** | movement-history.spec |
| `src/infrastructure/firebase/firebase.service.ts` | 3 | تطوّر (google-auth-library) | google-login.spec |
| `src/infrastructure/repositories/auth.service.ts` | 3, 5, 6 | تطوّر (+96/−3، المحذوف: تحصين `rollbackTransaction` فقط) | google / refresh / second-factor |
| `src/infrastructure/repositories/stock.service.ts` | 1 | تطوّر (+scope/+cache) | movement-history.spec |
| `src/presentation/controllers/auth.controller.ts` | 6 | نفس التغيير | wiring.spec + second-factor |
| `src/presentation/interceptors/audit-log.interceptor.ts` | 2 | تطوّر (+`@SkipAudit`) | audit-log.redaction.spec |
| `src/shared/logging/http-logger.options.ts` | 2 | **مطابق** | http-logger.redaction.spec |
| 6 ملفات اختبار | 1–3, 5, 6 | موجودة (متطوّرة) + نسخ الـ production الأصلية في `tests/equivalence/` | — |

---

## 3. مراجعة تعديلات الـ specs (إثبات "setup فقط")

مولَّد بـ `git diff --no-index -U0` بين الأصل في `bb071ed` والنسخة المعدّلة بعد توحيد تغيير عمق المسار الميكانيكي (`../../../src` ← `../../src`). التفاصيل الكاملة: `docs/handoff/series06-evidence/equivalence-adaptation-diff.txt`.

| Spec | سطور اتشالت | سطور اتضافت | سطور assertion/عنوان اختبار اتشالت أو اتعدّلت |
|---|---|---|---|
| movement-history.security | 1 (ميكانيكي: glob) | 15 (providers + imports) | **0** |
| audit-log.redaction | 0 | 0 | **0** |
| http-logger.redaction | 0 | 0 | **0** |
| google-login.security | 24 (setup بتاع firebase-admin) | 7 (setup الـ google-auth-library) | **0** |
| refresh-token.rotation | 0 | 1 (arg الـ constructor) | **0** |
| auth.second-factor | 0 | 1 (arg الـ constructor) | **0** |

---

## 4. Negative control (الاختبارات بتفشل لما الحماية تتشال)

كل تجربة: تعديل سطر واحد في كود الـ candidate، تشغيل الـ spec، استعادة الملف (تم التأكد بالـ hash/`git status` إن الشجرة رجعت زي ما كانت).

| # | التعديل | النتيجة |
|---|---|---|
| M1 | قبول إيميل غير موثّق (`email_verified`) | 2 فشلوا / 5 |
| M2 | أي refresh token يطابق | 2 فشلوا / 6 |
| M3 | الـ audit مفيهوش مفاتيح حساسة | 5 فشلوا / 6 |
| M4 | تعطيل `redact` في الـ logger | 1 فشل / 1 |
| M5 | تجاوز allowlist الحركات (F4) | 3 فشلوا / 8 |
| M6 | الـ 2FA تعتبر مقفولة للجميع | 6 فشلوا / 8 |

(محاولة M6 الأولى فشلت في الـ compile بسبب تعديل مني بيكسر النوع؛ اتعادت بتعديل سليم نوعياً. مش نتيجة منتج.)

---

## 5. اختلافات اتفحصت (مفيش واحد غير مفسّر)

1. **مصدر التحقق من Google اتغيّر** (Firebase Admin ← `google-auth-library`): الـ candidate بيثبّت الـ audience على `GOOGLE_WEB_CLIENT_ID`، وما بيعملش فحص إبطال (revocation) اللي كان بيعمله `verifyIdToken(idToken, true)` في Firebase Admin. ده **مش اختلاف في الإصلاح نفسه** (`email_verified`/401)، لكنه اختلاف سلوكي يتوثّق. تعليق الكود في الـ candidate بيقول إن مسار Firebase Admin كان بيرفض دايماً الـ token اللي بيطلّعه Android Google Sign-In SDK (لأنه Google ID token مش Firebase ID token)، يعني التغيير ممكن يكون إصلاح وظيفي كمان — **ده كلام الكود، ما اتجرّبش**. تسجيل الدخول بـ Google على الجهاز = UNVERIFIED.
2. **`stock.service.ts` أوسع**: scope لكل مخزن + cache بـ generation؛ superset للـ F4 (spec الـ candidate فيه 13 اختبار مقابل 8).
3. **`auth.service.ts`**: parameter الـ entitlements، `acceptInvitation`، وتحصين `rollbackTransaction().catch(...)`، وتسجيل الخطأ في `register` (يتضمن رسالة الخطأ والـ stack: ممكن يحتوي إيميل من رسالة قيد قاعدة البيانات = ملاحظة خصوصية منخفضة).
4. **2FA أوسع في الـ candidate**: `8a027c6` زاد replay protection للـ TOTP والـ backup codes (superset).

---

## 6. أوامر التشغيل (قابلة للتكرار)

```powershell
# بيئة: PostgreSQL مؤقتة غير لازمة لهذه الـ specs (unit)، ومعاها أسرار اختبار وهمية:
$env:JWT_ACCESS_SECRET='eq-access-0123456789abcdef'; $env:JWT_REFRESH_SECRET='eq-refresh-0123456789abcdef'
$env:JWT_2FA_SECRET='eq-2fa-0123456789abcdef'; $env:DB_ENCRYPTION_KEY='eq-encryption-key-0123456789'
cd D:\Projects\StockMind-wt\series06-release-safety
npx jest --testPathPatterns tests/equivalence        # 8 suites, 40 tests
```
وتدخل أيضاً في الـ suite الكاملة (`backend-gate.ps1`) على PostgreSQL.

---

## 7. استراتيجية الـ release line (توصية للـ Director، **غير منفّذة**)

**الأدلة (كلها قراءة/محاكاة بدون لمس أي ref):**
- **دمج يدوي لـ `bb071ed`:** `git merge-tree --write-tree` = **11 ملف، 21 conflict hunk** (6 ملفات `src` + 5 ملفات اختبار add/add).
- **دمج يحفظ النسب (محاكاة بـ `git commit-tree`، object معلّق بدون ref):** الـ tree = tree الـ candidate **حرفياً**؛ `bb071ed` ancestor؛ **0 commits** في production مش داخل الدمج (يعني fast-forward ممكن)؛ production كان هيكسب 84 commit وقت المحاكاة.
- **كل اختلاف production** = 6 commits / 15 ملف (القسم 2)، كلها مغطاة بالأدلة أعلاه.

| الخيار | الوصف | التقييم |
|---|---|---|
| **A (موصى به)** | branch release جديد من الـ candidate، ثم `git merge -s ours --no-ff bb071ed` (يسجّل إن production اتدمج مع إن الـ tree هو الـ candidate)، وبعدين الـ production branch يتحرك بـ **fast-forward** | بدون force، بدون حل conflicts يدوي (21 hunk بتتجنب)، النسب محفوظ، وكل حاجة production كانت فيها اتثبت لها مقابل تنفيذي. **عيبه:** `-s ours` بيتجاهل أي محتوى production مش مغطى بالدليل — ولذلك المصفوفة دي هي شرطه — وأي commit hotfix **جديد** على production قبل التنفيذ لازم يتراجع بنفس الطريقة (تجميد hotfix). |
| B | دمج يدوي لـ `bb071ed` مع حل 11 ملف | بيشتغل لكن تكلفته عالية (21 hunk) ومعرّض لخطأ في الحل؛ الناتج المفروض يساوي الـ candidate في تلك الملفات أصلاً. |
| C | استبدال فرع production بـ reset/force-push | **مرفوض**: بيعيد كتابة history لفرع محمي. |
| D | فرع production جديد من الـ candidate وتغيير مصدر النشر في Render | بيحافظ على القديم للرجوع، لكنه تغيير في config الـ hosting (محتاج موافقة Director منفصلة). |

**أوامر مقترحة للخيار A (للمرجع، لم تُنفّذ):**
```powershell
git switch -c release/<name> <candidate-tip>        # فرع جديد وغير محمي
git merge -s ours --no-ff bb071ed -m "Record production hotfix bb071ed as merged: its six fixes are present (SERIES_06 equivalence matrix)"
git diff --quiet HEAD^1 HEAD                         # لازم ينجح: الـ tree = tip الـ candidate
# تحريك فرع production بـ fast-forward = عملية إصدار: بموافقة Director فقط، ومش جزء من هذه المرحلة
```

**شروط قبل التنفيذ:** (1) موافقة الـ Director على الخيار؛ (2) القرارات المتعلقة بملفاتك المتّسخة والـ 3 commits المحلية (التقرير §6)؛ (3) تشغيل الـ suite الكاملة ×3 على tip الفرع الجديد؛ (4) تجميد أي hotfix جديد على production لحد التنفيذ؛ (5) تأكيد قراءة فقط من Production إن فرعه لسه `bb071ed` وإن Render ما بيعمل auto-deploy (UNVERIFIED دلوقتي).
