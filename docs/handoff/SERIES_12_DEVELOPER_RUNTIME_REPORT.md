# STOCKMIND — SERIES 12 REPORT: Developer runtime stability & standalone QA foundation

> الفرع: `feature/series12-standalone-qa` (worktree `D:\Projects\StockMind-wt\series12-standalone-qa`) من `hardening/series11-authorization-admission` @ `5902072`.
> العقد: `SERIES_12_STANDALONE_QA_CONTRACT.md`. **بدون merge، بدون Production/Neon، بدون AAB/Play، بدون cloud build.**
> الأدلة: `docs/handoff/series12-evidence/` + لوجات `D:\Projects\StockMind-wt\_local-tools\logs\s12-*`.

## 0. الحكم

| البند | الحكم |
|---|---|
| **SERIES 12** | **PASS** للنطاق، بحدود مكتوبة في القسم 10 (الـ log بيأكد 7 من الـ 10 فتحات اللي الـ Director أبلغ عنها؛ الكمبيوتر اتفصل بالـ USB لكن ما اتقفلش؛ Gate B ملاحظات الـ Director؛ Gate C على الجهاز Staff بس) |
| StockMind QA بيشتغل من غير Metro؟ | **أيوه** — على الـ Huawei: الـ USB مفصول (`mIsUsbPlugged=false`)، الـ Director فتحه 10/10 بدون أخطاء، والـ log بيأكد 7 فتحات (6 cold processes) بصفر أخطاء Metro/crash/ANR. وعلى emulator Android 10: 10/10 cold + 5/5 warm |
| التطبيق القديم `io.stockmind.app` | **ما اتلمسش**: نفس وقت التثبيت/التحديث (2026-10-20 08:39:06) ونفس التوقيع قبل وبعد؛ مفيش أي أمر غير قراءة. والـ APK بتاعه = نفس ملف الـ debug build بتاع يوليو بالـ SHA-256 (السبب الجذري مُثبت على الجهاز) |
| أونلاين محلي | **PASS على الـ emulator** (Owner/Manager/Staff، خصوصية التكلفة، shadow، انقطاع/رجوع، outbox مرة واحدة) و**على الـ Huawei** (Staff: دخول، W1 بس، استلام +2 اتسجّل مرة واحدة 53→55) |
| الافتراضي | `CAPABILITY_MODE=shadow` بدون تغيير؛ صفر تغيير في `src/` و`tests/` (backend) |

## 1. السبب الجذري للشاشتين (مُثبت)

| الدليل | النتيجة |
|---|---|
| الـ APK الوحيد المبني على الكمبيوتر ده للتطبيق: `D:\Projects\StockMind\mobile\android\app\build\outputs\apk\debug\app-debug.apk` (2026-07-24، 261 MB، 4 ABIs) | `aapt2 dump badging`: `package: io.stockmind.app versionCode=1 versionName=1.0.0`، **`application-debuggable`**، `launchable-activity io.stockmind.app.MainActivity` |
| محتوى الـ APK | **مفيش `assets/index.android.bundle`** ولا أي Hermes bytecode = **الجافاسكربت مش جوه التطبيق** |
| التوقيع (`apksigner`) | `CN=Android Debug` — SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` = **مفتاح قالب React Native العام** |
| `mobile/package.json` | `"start": "expo start --dev-client"` لكن **`expo-dev-client` مش متثبّت** (مش في dependencies ولا في الـ APK) → ده **debug build عادي لـ React Native**، مش Expo Development Client بواجهة launcher |
| `android/gradle.properties` (المتولّد في main) | `hermesEnabled=true`، `newArchEnabled=false` |

**الآلية:** في الـ debug build `BuildConfig.DEBUG=true`، فـ React Native بيشغّل DevSupport: عند الفتح بيطلب الـ bundle من packager على `localhost:8081` **من على الموبايل نفسه**. على موبايل حقيقي `localhost` هو الموبايل، فده بيشتغل بس لما:
1. Metro شغال على الكمبيوتر، **و**
2. `adb reverse tcp:8081 tcp:8081` عامل نفق USB من بورت الموبايل لبورت الكمبيوتر (أو عنوان Metro متظبط يدوياً على LAN).

لو أي واحد ناقص: React Native بيعرض **"Unable to load script. Make sure you're either running Metro … or that your bundle 'index.android.bundle' is packaged correctly for release"** (مفيش bundle مضمّن يرجع له) و**"Cannot connect to Metro"** (DevSupport مش لاقي packager). **ده تصميم الـ debug build، مش عطل.** وده بالظبط ليه التطبيق "بيشتغل بعد ما Claude يشغّل ADB وMetro": سكربتات Series 04/07 (`start-metro*.ps1` + `adb reverse`) كانت بتوفّر الشرطين.

**على الجهاز نفسه:** لم أقرأ حالة الـ Huawei (قاعدة الجهاز). الـ handoff بيقول الجهاز عليه "debug APK `io.stockmind.app` loads JS from Metro" (master §F). تأكيد الـ `versionCode`/`debuggable`/تاريخ التثبيت على الجهاز = قراءة `dumpsys package io.stockmind.app` بس، بعد إذن الـ Director (القسم 9).

**`eas.json` profile `preview` مش هيحل المشكلة لوحده:** صحيح إنه APK release (الـ bundle مضمّن)، لكن: (أ) ده build على EAS cloud (خارج النطاق المسموح)؛ (ب) نفس الـ id `io.stockmind.app` بتوقيع مختلف (EAS keystore) → Android يرفضه كتحديث، والحل الوحيد إلغاء تثبيت التطبيق القديم = **ضياع بياناتك**؛ (ج) `extra.apiBaseUrl` فيه **URL الإنتاج**؛ (د) `__DEV__=false` → الأونلاين مقفول؛ (هـ) `PINNING.enforce = !__DEV__` مع hashes placeholder وموديول `react-native-ssl-pinning` **مستبعد من الـ autolinking** → أي طلب أونلاين في release كان هيفشل.

## 2. الـ toolchain (متحقَّق على الجهاز ده)

| البند | الحالة |
|---|---|
| Node | v26.7.0 (Expo SDK 51 رسمياً على Node 18/20؛ prebuild وexport:embed اشتغلوا — انظر §6) |
| JDK | Temurin 17.0.18 (على الـ PATH؛ `JAVA_HOME` فاضي) |
| Gradle / AGP | wrapper 8.8 / AGP 8.2.1 (من قالب Expo SDK 51)؛ كاش Gradle كان فاضي (أول بناء نزّل ~3 GB) |
| Android SDK | build-tools 34–37، platforms 34–37، cmdline-tools، platform-tools؛ رخصة `android-sdk-license` متوافق عليها من قبل |
| NDK | كان موجود **28.2 بس**. RN 0.74 بيثبّت **26.1.10909125** → اتثبّت بـ sdkmanager. وGradle نزّل لوحده **25.1.8937393** (الـ NDK الافتراضي لـ AGP 8.2.1 للموديولات الـ native اللي مش محددة NDK). مفيش رخصة جديدة اتقبلت |
| Emulator | WHPX شغال؛ نزّلت `system-images;android-29;default;x86_64` (Android 10 زي الـ Huawei) وعملت AVD `stockmind_qa_api29` (معزول، بدون Google Play) |
| الترقيات | **صفر**: Expo/RN/Gradle/JDK/الاعتماديات زي ما هي؛ `package*.json` بدون تغيير |

## 3. معمارية البيلد (انظر العقد §1–§3)

- **مصدر واحد:** `app.json` بدون تغيير؛ `app.config.js` بيشتق QA بس بـ `STOCKMIND_VARIANT=qa`.
- **native من Git:** `plugins/with-stockmind-qa.js` (توقيع QA إلزامي، network security config، علامة variant). `android/` git-ignored ومتعاد توليده بـ `expo prebuild --clean` كل بناء — **مفيش تعديل يدوي**.
- **release variant:** `assembleRelease` → Hermes bytecode مضمّن، `debuggable=false`، مفيش DevSupport → **مفيش Metro**.
- **حدود run-time:** `src/domain/build-variant.ts` (علامتين، hosts خاصة بس، مفيش رجوع لـ URL الإنتاج، مفيش pinned transport في QA).
- **واجهة:** كارت "StockMind QA — test build" في Settings (محلي بس / خادم اختبار + رقم الإصدار)، وشارة "QA PREVIEW" بدل "DEV PREVIEW". عربي/إنجليزي.

## 4. عزل البيانات والهوية

- `io.stockmind.app.qa` = UID وsandbox منفصلين: MMKV، SQLCipher، SecureStore/Keystore، البصمة — مفيش أي نقل أو قراءة من `io.stockmind.app`. الاسم "StockMind QA"، والـ scheme `stockmind-qa` (عشان روابط `stockmind://` ما تتقسمش بين التطبيقين).
- تحديثات QA بـ `adb install -r` بنفس مفتاح QA → بيانات QA بتفضل (versionCode تصاعدي بالدقيقة).
- على الـ emulator: الوضع الأوفلاين ("QA Tester") والأونلاين (حسابات synthetic) فضلوا منفصلين في الاتجاهين (القسم 9).

## 5. التوقيع

- مفتاح QA: PKCS12 RSA-2048، صلاحية 10000 يوم، `CN=StockMind QA (local testing only - not for release)`، في `D:\Projects\StockMind-wt\_local-tools\qa-signing\` (خارج كل repo). كلمة السر عشوائية (CSPRNG) ومشفّرة بـ DPAPI للمستخدم الحالي. بصمة الشهادة: `65b206f51440dd8dc6d3c401f65899baab65bb9493b88e67d8c5da7bcbe74b72`.
- الـ build بيفشل لو المفتاح مش متمرّر (plugin + Gradle guard)، و`--no-daemon` عشان كلمة السر ما تفضلش في daemon. فحص الـ APK بيرفض توقيع مفتاح RN العام (`fac61745…`) وبيطلب شهادة واحدة مقروءة = مفتاح QA.
- **مخاطرة مقبولة لازم تعرفها:** لو ضاع الـ keystore أو اتعمل reinstall للويندوز (DPAPI)، أي QA جديد هيترفض كتحديث، والحل إلغاء تثبيت QA (= ضياع بيانات QA التجريبية بس). يُنصح بنسخة احتياطية من المجلد وتسجيل كلمة السر بطريقتك.

## 6. البيلدات اللي اتعملت فعلاً (كلها محلية، release، بدون AAB، بدون cloud)

| # | commit | النوع | النتيجة |
|---|---|---|---|
| 1 | `5902072-dirty` | offline-only | وقف قبل Gradle: قراءة كلمة سر DPAPI فشلت (سطر جديد زيادة) → اتصلح |
| 2 | `5902072-dirty` (code 428426) | offline-only | Gradle نجح (أول بناء ~32 دقيقة: ~3 GB تنزيل + NDK 25.1)؛ **اترفض في الفحص** لأن قراءة بصمة الموقّع فشلت (صيغة apksigner 37). اتبنى وأنا لسه بعدّل وأثناء negative controls ← **مش artifact صالح للاختبار** |
| 3 | `045b204` (428461) | online `127.0.0.1` | Gradle نجح؛ **اترفض في الفحص**: ملف الـ network config اسمه متقصّر في الـ release (`res/Q2.xml`) → المفتش اتصلح |
| 4 | **`f2747d6` (428472)** | online `127.0.0.1` | **الفحوص الـ21 كلها نجحت** — ده الـ APK المختبَر: SHA-256 `10b3fd473bf7d1fc4e4b612dcbb1b10397d8e63492ff438bde2a7aafaebc7213`، 141.6 MB |

- **قابلية إعادة الإنتاج:** الـ Hermes bundle في (3) و(4) متطابق بالبايت (`b0fa0fe5edd905c2c0815acb47ff2b1b7178e24de7faed49fb7ec0b96294e3b9`، 2,968,356 bytes) رغم إنهم بيلدين مستقلين.
- كود التطبيق في (4) = كود `8ca81fc` (الـ commits اللي بعده سكربتات بس). `f8304bc` (فحص الـ ABI في الـ installer) جه بعد البيلد ومالوش أثر على الـ APK.
- الـ APK والسجل: `D:\Projects\StockMind-wt\_local-tools\artifacts\stockmind-qa\` (`latest.json`)؛ نسخة منقّحة من السجل في `series12-evidence/apk-inspection-f2747d6.json`.

## 7. أمان الأونلاين المحلي

- QA أونلاين بس لو: علامتين build (bundle + config مضمّن) + flag + URL على loopback/RFC 1918. اتجرّب: production host، hosts عامة، أسماء، IPs غلط = أوفلاين (51 اختبار + 10 negative controls).
- network security: cleartext ممنوع إلا للـ host المحدد (المفتش بيتأكد إنه host واحد بالظبط ومطابق للـ URL المضمّن في الـ bundle).
- مفيش رجوع لـ URL الإنتاج: الـ app config المضمّن مفيهوش `apiBaseUrl` (مفحوص في الـ APK)، وQA من غير backend بيروح لـ `127.0.0.1:9`.
- السيرفر هو المرجع: مفيش bypass لـ auth/2FA/guards؛ الـ backend المحلي `shadow`؛ `warehouse_manager` ظاهر "not active on this server".
- **Google Sign-In وFCM في QA: غير متاحين** (زرار Google موجود في شاشة الدخول لكن مفيش OAuth client لـ `io.stockmind.app.qa`) — ما اتعملش أي التفاف.

## 8. الاختبارات والبوابات (آخر تشغيل على `f8304bc`؛ كود التطبيق = `8ca81fc`)

| الفحص | النتيجة |
|---|---|
| Mobile `tsc --noEmit` | 0 أخطاء |
| Mobile Jest كامل | **22 suites / 359 tests** (كان 20/308؛ +51 جديد: `build-variant.test.ts`، `qa-build-config.test.ts`) |
| Negative controls (10 طفرات في الحدود) | **10/10 أحمر** (`series12-evidence/negative-controls.txt`) |
| فحص الـ APK (21 فحص) | APK (4) كله أخضر؛ والـ debug APK القديم بيفشل 12 فحص (تحكّم سلبي)؛ ونفس APK (4) بيفشل لو اتفحص كأوفلاين أو بـ host تاني |
| Backend | **صفر تغيير** في `src/`/`tests/`/`package*.json`؛ `nest build` نضيف، 12/12 migrations، `dist/main.js`؛ إقلاع على قاعدة جديدة `stockmind_qa_local` بـ shadow؛ تكامل حقيقي عبر Gate C (auth، team، capabilities، cost redaction، outbox/idempotency). ما اتعادتش suites الـ PG لأن الكود ما اتغيّرش |

## 9. البوابات على الـ emulator

التفاصيل الكاملة: `series12-evidence/emulator-gate-ledger.md` + 10 لقطات. الخلاصة:
- **Gate A (emulator):** 10/10 cold (675–790 ms)، 5/5 warm (83–99 ms)، swipe-away + reopen، صفر أخطاء Metro/bundle/fatal، crash buffer فاضي، Metro مش شغال، مفيش reverse.
- **Gate B (emulator):** مخزن + منتج + استلام 10 + صرف 4 + **رفض صرف 7** + process death (الرصيد 6 والسجل بالظبط) + airplane mode (استلام/صرف وبقاء الرصيد 10 بعد kill) + عربي RTL كامل.
- **Gate C (emulator):** Owner/Manager/Staff بالصلاحيات الصح، التكلفة مش بتوصل لـ Manager/Staff من السيرفر، shadow ظاهر بصدق، انقطاع = طابور من غير تزييف، رجوع = تسليم مرة واحدة (50→53، rev 3)، الرجوع للأوفلاين سليم.
- **حدود الـ emulator:** مش الـ Huawei (EMUI، بصمة، ذاكرة، شبكة حقيقية)؛ مفيش بصمة متسجّلة فالـ biometric gate ما اتجرّبش؛ "الكمبيوتر مقفول" مستحيل على emulator.

## 10. الجهاز (Huawei)

التفويض: الـ Director أكّد في المحادثة إنه جنب الموبايل ووافق على الخطة بالحرف ("Yes, run the full plan"). كل أمر اتوجّه بالـ serial `XSQ4C19419000318`. التفاصيل الكاملة: `series12-evidence/huawei-device-run.md`.

| المرحلة | النتيجة |
|---|---|
| 0 — قراءة | HUAWEI JSN-L22، Android 10، ABI أول `arm64-v8a`. التطبيق القديم: versionCode 1، **DEBUGGABLE**، اتثبّت 2026-10-20 08:39:06؛ الـ APK بتاعه (الملف بس، من غير أي بيانات) = نفس `app-debug.apk` بتاع يوليو بالـ SHA-256، من غير bundle، وبمفتاح RN العام |
| 1 — التثبيت | `qa-install.ps1` → فحص كامل + ABI كامل (56/56) + `install -r` → Success؛ الموبايل عليه الاتنين؛ القديم بنفس سجله وتوقيعه |
| 2 — Gate A (USB مفصول) | الـ Director: 10/10 من غير شاشة خطأ. الـ log: 7 مرات في الـ foreground (6 processes منفصلة + رجوع)، `mIsUsbPlugged=false`، صفر Metro/bundle/FATAL/ANR/crash |
| 3 — Gate B (USB مفصول) | الـ Director: كل الخطوات نجحت (مخزن، منتج، استلام 10، صرف 4، رفض 7، airplane + إعادة فتح = 10، عربي RTL)؛ مفيش طلب بصمة |
| 4 — Gate C (USB + reverse) | أول محاولة: "مش قادرين نوصل للخادم" **صح** لأن قاعدة الـ reverse اتشالت مع إعادة توصيل الـ USB (21:57:50)؛ اتشخّصت واترجعت من غير تغيير كود؛ بعدها دخول Staff (200)، W1 بس، استلام +2 (201 مرة واحدة، 53→55) |

**حدود صريحة:** الـ log بيأكد 7 من الـ 10 فتحات (والسبعة نضيفة)؛ "الكمبيوتر مش متاح" اتجرّب بفصل الـ USB مش بقفل الكمبيوتر؛ Gate B ملاحظات الـ Director (QA مش debuggable فقاعدته المشفّرة مش بتتقري، وده المطلوب)؛ البصمة ما ظهرتش فالـ biometric gate ما اتجرّبش على الجهاز؛ Owner/Manager وتسلسل الانقطاع/الطابور على الجهاز ما اتعملوش (اتعملوا على الـ emulator). الـ Director فتح التطبيق القديم 27 ثانية (21:20:03–21:20:30) بنفسه؛ مفيش أي تغيير فيه.

## 11. الأعطال وإصلاحها (بصدق)

1. نسخ `node_modules` بـ robocopy رجّع exit 1 = "اتنسخ بنجاح" (مش فشل).
2. سكربت PowerShell: `"$h:"` خطأ parse؛ والسكربت كمّل بعد فشل الـ dot-source وطبع "Created" وهمي (مفيش ملفات اتعملت) → كل سكربت بقى يتأكد إن الـ helper اتحمّل.
3. `keytool` تحت `ErrorActionPreference=Stop` في PowerShell 5.1: سطر stderr = خطأ قاتل → `Invoke-Native`.
4. كلمة سر DPAPI: سطر جديد زيادة → `.Trim()`.
5. البيلد (2) اتبنى وأنا بعدّل وأثناء negative controls → اتعامل كـ toolchain proof بس واتشال من الاختبار.
6. **فحص ضعيف اتمسك:** "مش مفتاح debug العام" كان بيعدّي لو البصمة فاضية (apksigner 37 بيكتب `V2 Signer:`) → شهادة واحدة مقروءة إلزامية.
7. **فحص ضعيف تاني:** "مفيش cleartext host" كان بيعدّي لأن الملف ما اتلقاش أصلاً (اسم متقصّر) → المسار من resource table + فحص "resource found" إلزامي.
8. الـ installer رفض البيلد الأونلاين (فحصه كأوفلاين) → بيقرا الـ host من سجل البيلد. (رفض آمن.)
9. **مخاطرة packaging حقيقية:** `armeabi-v7a`/`x86` فيهم 50 مكتبة من 56 (المبنية من المصدر للـ ABIs المطلوبة بس) → الـ installer بيقرا ABIs الجهاز (getprop) ويرفض لو الجهاز هيحمّل ABI ناقص.
10. Maestro driver مات بعد airplane toggle، و`uiautomator dump` مش بيشتغل (الواجهة مش بتهدى) → adb input + screenshots؛ إطفاء animations على الـ emulator بس.
11. إدخال الدخول: الكيبورد غيّر الأماكن فالنصين دخلوا خانة الإيميل → اتمسحت واتعادت (حساب synthetic محلي).
12. سكربت فحص استورد seed module بالغلط فاشتغل مساره "already seeded" وخرج (مفيش تغيير) → اتشال الـ import.
13. رسالة commit `045b204` بتقول إن فيها إصلاح الـ inspector؛ الحقيقة الإصلاح ده دخل في `8ca81fc`، و`045b204` غيّرت علامة dirty بس.
14. **Gate C على الجهاز:** "مش قادرين نوصل للخادم" — مش عيب كود: قاعدة `adb reverse` بتتشال مع كل إعادة توصيل USB. اتشخّص (backend 200، الجهاز `device`، القائمة فاضية، الـ USB اتوصّل تاني 21:57:50)، واترجعت القاعدة، واتأكد طرف الموبايل (`LISTEN` على `127.0.0.1:3000`). الـ preflight بقى فيه `-RestoreReverse` وفحص طرف الموبايل (`d63cfbe`).

## 12. المتبقي والحدود

- **الجهاز:** القسم 10 (حدوده).
- QA أونلاين على `127.0.0.1` محتاج USB + `adb reverse tcp:3000`، **وكل إعادة توصيل USB بتشيل القاعدة** (`qa-backend-preflight.ps1 -Serial <serial> -RestoreReverse`)؛ البديل LAN (`-ApiBaseUrl http://<IP خاص>:3000/api/v1`) محتاج بيلد جديد لما الـ IP يتغيّر، ونفس الشبكة، وFirewall يسمح (فيه قواعد inbound لـ node على Public موجودة من قبل؛ ما اتغيّرتش).
- ABIs جزئية (القسم 11.9)؛ الـ Huawei JSN-L22 (Kirin 710) متوقّع arm64 — هيتأكد بالقراءة قبل أي تثبيت.
- Google Sign-In/FCM غير متاحين في QA.
- `mobile/android/` واحد للـ variants (العقد §10).
- `PINNING` placeholders + موديول ssl-pinning مستبعد (قائم؛ يمنع أي public release أونلاين).
- الـ manifest فيه `SYSTEM_ALERT_WINDOW` وصلاحيات تخزين قديمة من القالب/الموديولات (قائم، مش من Series 12).
- Node 26 مع Expo SDK 51 (رسمياً 18/20) اشتغل في البناء، لكنه مش مدعوم رسمياً.
- ملاحظات الواجهة (الـ ledger): "Current balance: 0" أونلاين مع backend واقع، "1 actions"، ErrorBoundary إنجليزي بس، "he" في نص الـ profile.
- **Series 11 N-1** (قفل `companies FOR UPDATE` في trigger آخر owner) و**N-2** (`snapshot()` غير مرئي): **مفتوحين** — blockers قبل أي بروفة enforce.

## 13. القيود والخطوة التالية

ممنوع وما اتعملش: Production/Neon، deploy، AAB/Play، cloud build، merge، force-push، تعديل `io.stockmind.app`، تفعيل enforce، ميزات جديدة. التوصية: (1) milestone تصليب مخصص لـ Series 11 N-1/N-2 + إصلاح "Current balance: 0" وبقية ملاحظات الواجهة، يتجرّب على StockMind QA على الـ Huawei؛ (2) بعدها بروفة shadow/enforce غير إنتاجية؛ (3) لاحقاً: جهازين، والبصمة على الجهاز، وOwner/Manager على الجهاز.
