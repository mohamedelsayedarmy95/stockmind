# STOCKMIND — SERIES 12 CONTRACT: Standalone QA build, Dev runtime and the QA online boundary

> العقد ده بيوصف **اللي الكود والسكربتات بيضمنوه فعلاً** بعد Series 12، وحدوده. التفاصيل والأدلة في
> `SERIES_12_DEVELOPER_RUNTIME_REPORT.md`. الفرع: `feature/series12-standalone-qa` (من `hardening/series11-authorization-admission` @ `5902072`).
> **مش إذن نشر.** لا AAB، لا Google Play، لا Production. `CAPABILITY_MODE` الافتراضي لسه `shadow`.

## 1. التلات أنواع من البيلد

| النوع | الهوية | الجافاسكربت | بيحتاج Metro؟ | الأونلاين |
|---|---|---|---|---|
| **OLD DEVELOPMENT CLIENT** (`dev`) | `io.stockmind.app`، debug، توقيع مفتاح RN العام | **مش جوه الـ APK**؛ بيتحمّل من Metro | **أيوه دايماً** (USB + `adb reverse tcp:8081` أو LAN) | زي قبل Series 12: `EXPO_PUBLIC_ONLINE_MODE=1` + URL صريح، **وممنوع host الإنتاج** (جديد) |
| **STANDALONE QA** (`qa`) | `io.stockmind.app.qa`، اسم "StockMind QA"، release، توقيع مفتاح QA محلي | **جوه الـ APK** (Hermes bytecode في `assets/index.android.bundle`) | **لا** | اختياري وقت البناء، وبس لـ backend على loopback/شبكة خاصة |
| **PUBLIC RELEASE** (`release`) | `io.stockmind.app` release | جوه الـ APK | لا | **مقفول** ("Cloud sync coming soon")، زي ما هو — **ومش مُصرَّح ببنائه أو نشره** |

## 2. حدود هوية QA (build-time + run-time)

- `mobile/app.config.js`: من غير `STOCKMIND_VARIANT` → **app.json بالحرف** (مختبَر: `toEqual(appJson)`). بـ `STOCKMIND_VARIANT=qa` → application id `io.stockmind.app.qa`، scheme `stockmind-qa`، اسم "StockMind QA"، `version` = `1.0.0-qa.<commit>`، `versionCode` تصاعدي، **`extra.apiBaseUrl` (URL الإنتاج) بيتشال**، `extra.stockmindVariant='qa'`. أي قيمة تانية = رفض.
- `mobile/src/domain/build-variant.ts` (`decideBuild`): البيلد يتحسب **QA** بس لو **علامتين مستقلتين** اتفقوا: `EXPO_PUBLIC_STOCKMIND_VARIANT=qa` (جوه الـ bundle) **و** الـ app config المضمّن في الـ APK بيقول `stockmindVariant='qa'` و`android.package='io.stockmind.app.qa'`. لو واحدة بس → **`release` ومقفول** (`qa-identity-mismatch`). يعني متغيّر بيئة متسرّب لوحده ما يحوّلش بيلد عادي لـ QA.
- الأونلاين في QA محتاج كمان `EXPO_PUBLIC_ONLINE_MODE=1` و`EXPO_PUBLIC_API_BASE_URL` على host **loopback أو RFC 1918** (`127.x`, `10.x`, `172.16–31.x`, `192.168.x`, `localhost`, `10.0.2.2`). أي اسم تاني (حتى لو بيـresolve لعنوان خاص)، أي host عام، أو host الإنتاج = **QA أوفلاين بس**.
- `resolveApiBaseUrl`: QA **عمره ما يرجع** لـ `extra.apiBaseUrl`؛ لو الأونلاين مقفول بياخد `http://127.0.0.1:9/api/v1` (discard port على الموبايل نفسه) فأي طلب شارد بيفشل كـ "server unreachable".
- `usesPinnedTransport`: QA مش بيستخدم الـ pinned adapter (الـ backend المحلي مالوش شهادة إنتاج، و`react-native-ssl-pinning` أصلاً مستبعد من الـ autolinking). باقي البيلدات زي ما هي.
- السيرفر لسه هو المرجع: نفس `/auth/*` و2FA والـ guards؛ **مفيش أي bypass** للمصادقة أو التفويض.

## 3. الـ native (مصدره في Git، مش تعديل يدوي)

`mobile/plugins/with-stockmind-qa.js` بيتطبّق **بس** في QA، وبيتعاد كل مرة `expo prebuild --clean`:
1. **توقيع release** بـ `signingConfigs.stockmindQa` من متغيرات بيئة (`STOCKMIND_QA_STORE_FILE`…)، و**البناء بيفشل** لو مش موجودة. **مفيش رجوع لمفتاح RN debug العام** (SHA-256 `fac61745…033b9c`)، اللي أي حد يقدر يوقّع بيه.
2. **Network security config**: `cleartextTrafficPermitted=false` في الأساس، واستثناء cleartext **لـ host واحد بس** = الـ backend المحلي المحدد وقت البناء (أو ولا host في بيلد أوفلاين).
3. ملف علامة `android/.stockmind-variant` (`qa`) عشان سكربتات الـ Dev تعرف إن `android/` اتولّد لـ QA.

## 4. مفتاح توقيع QA

- مكانه: `<local tools>\qa-signing\` (خارج كل repo): `stockmind-qa.p12` (PKCS12، alias `stockmind-qa`)، كلمة السر عشوائية ومشفّرة بـ **Windows DPAPI** للمستخدم الحالي (`stockmind-qa.pass.dpapi`)، وبصمة الشهادة العامة `stockmind-qa.cert-sha256`.
- بصمة شهادة QA: `65b206f51440dd8dc6d3c401f65899baab65bb9493b88e67d8c5da7bcbe74b72`.
- `qa-signing-init.ps1` **مبيكتبش فوق مفتاح موجود** (مختبَر). كلمة السر بتعدّي للـ Gradle عن طريق البيئة لعملية البناء بس، و`--no-daemon` عشان ما تفضلش في daemon.
- **لو المفتاح ضاع:** أي QA جديد هيترفض كتحديث (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`)، والحل الوحيد إلغاء تثبيت QA (= ضياع بيانات QA التجريبية) — قرار للـ Director، مش للسكربت.

## 5. عزل البيانات

- `io.stockmind.app.qa` = sandbox أندرويد منفصل: MMKV، قاعدة SQLCipher، SecureStore/Keystore aliases، وصلاحيات البصمة، كلها per-UID. **مفيش أي نقل** من/إلى `io.stockmind.app`، ولا قراءة لبياناته.
- تحديثات QA بـ `adb install -r` بنفس المفتاح بتحافظ على بيانات QA.
- الأوفلاين والأونلاين جوه QA ماشيين بنفس قواعد Series 03–11 (account scope، الـ outbox، الحجز عند `ACCESS_REVOKED`): مفيش ترقية صامتة لبيانات أوفلاين لمخزون شركة.

## 6. سكربتات الـ workflow (`mobile/scripts/`)

| السكربت | بيعمل إيه | ضمانات |
|---|---|---|
| `qa-build.ps1 [-Online] [-ApiBaseUrl]` | prebuild clean (QA) → `assembleRelease` → فحص → artifacts + JSON | يرفض `.env*` في `mobile/`، junction في `node_modules`، host غير محلي؛ فحص الـ APK إلزامي، والفاشل بيتعلّم `REJECTED`؛ مبيثبّتش حاجة |
| `qa-inspect-apk.ps1 -Apk` | 20+ فحص (id، label، debuggable، bundle Hermes، app.config، activity، توقيع QA ≠ debug، cleartext) | قراءة بس |
| `qa-install.ps1 -Serial` | فحص ثم `adb install -r` على **جهاز محدد بالاسم** | يرفض أي id غير QA؛ مفيش uninstall/clear/downgrade/force-stop؛ يقف عند تعارض التوقيع؛ يتأكد إن `io.stockmind.app` لسه موجود |
| `dev-metro.ps1 [-AdbReverse -Serial]` | يشغّل Metro لو مش شغال ويستنى `/status` | مفيش Metro تاني، مفيش kill، مفيش جهاز من غير `-Serial` |
| `qa-backend-preflight.ps1 [-Serial] [-RestoreReverse]` | `/health` + بورت PG + قاعدة `adb reverse` + طرف الموبايل (`LISTEN` على 127.0.0.1) | يرفض host الإنتاج/العام قبل أي طلب؛ التغيير الوحيد الممكن: إعادة قاعدة reverse واحدة للجهاز المسمّى |
| `qa-local-backend.ps1` | backend مؤقت (`dist/main.js`) على `stockmind_qa_*` | بدون `.env`، تكاملات خارجية متشالة، `CAPABILITY_MODE=shadow` |
| `qa-seed-synthetic.mjs` | شركة/مخازن/منتجات/Owner/Manager/Staff synthetic | loopback بس؛ idempotent |
| `qa-signing-init.ps1` | مفتاح QA مرة واحدة | مبيكتبش فوق موجود |

## 7. متى بنحتاج USB

| السيناريو | USB/ADB؟ |
|---|---|
| فتح StockMind QA واستخدامه أوفلاين | **لا** (والكمبيوتر ممكن يكون مقفول) |
| QA أونلاين على `127.0.0.1` | **أيوه** (`adb reverse tcp:3000`) + backend شغال. **كل إعادة توصيل USB بتشيل القاعدة** → التطبيق يقول "مش قادرين نوصل للخادم" (صح) → `qa-backend-preflight.ps1 -Serial <serial> -RestoreReverse` |
| QA أونلاين على IP شبكة خاصة | لا USB، بس لازم الموبايل والكمبيوتر على نفس الشبكة والـ firewall يسمح؛ ولو الـ IP اتغيّر لازم بيلد جديد |
| تثبيت/تحديث QA | أيوه (مرة لكل تحديث)، بحضور الـ Director |
| تطبيق الـ Dev القديم | **أيوه دايماً** (Metro) |

## 8. سياسة الأخطاء

- QA release: مفيش RedBox ولا overlay تطوير؛ مفيش اتصال بـ Metro أصلاً.
- `ErrorBoundary` + `installGlobalCrashHandler` بيسجّلوا في `crash_log` (SQLCipher المشفّر) — بتتشاف من **Settings → Crash reports** من غير USB، ومن `adb logcat` بالـ USB. `console.*` بيتشال من bundle الـ release (babel + minifier).
- لا passwords ولا tokens ولا تكاليف بتتسجّل عمداً؛ الـ crash log فيه رسالة الخطأ والـ stack بس.
- غياب الـ backend = حالة اتصال (رسالة "Can't reach the server")، مش مزامنة وهمية.

## 9. ما لم يتغيّر عمداً

`io.stockmind.app` (هويته، توقيعه، بياناته، الـ APK المتثبّت)؛ app.json؛ كود الـ backend والتفويض (صفر تغيير في `src/` و`tests/`)؛ `CAPABILITY_MODE=shadow`؛ الاعتماديات (`package*.json` بدون تغيير)؛ Expo SDK 51 / RN 0.74.5 / Gradle 8.8 / JDK 17.

## 10. حدود معروفة

- Google Sign-In وFCM push في QA **غير متاحين** (مفيش `google-services.json`/OAuth client لـ `io.stockmind.app.qa`) — ما اتعملش أي إضعاف للهوية علشانهم.
- `PINNING` في الإنتاج لسه placeholders والموديول مستبعد من الـ autolinking (قائم من قبل؛ بيمنع أي public release أونلاين — PUBLIC RELEASE غير مُصرَّح أصلاً).
- `mobile/android/` واحد للـ variants: بيلد QA بيعيد توليده؛ قبل بناء الـ Dev تاني: `npx expo prebuild --platform android --clean` من غير `STOCKMIND_VARIANT`.
- مخاطر Series 11 **N-1** (قفل `companies FOR UPDATE` في trigger آخر owner) و**N-2** (`snapshot()` غير مرئي) **مفتوحين** ومش من نطاق Series 12.
