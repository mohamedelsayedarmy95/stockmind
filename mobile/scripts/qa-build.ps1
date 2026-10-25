# Builds (or rebuilds) the standalone StockMind QA APK locally (Series 12). One command:
#
#   powershell -ExecutionPolicy Bypass -File mobile\scripts\qa-build.ps1                 # offline-only QA
#   powershell -ExecutionPolicy Bypass -File mobile\scripts\qa-build.ps1 -Online         # + Online Preview to 127.0.0.1:3000 (adb reverse over USB)
#   powershell -ExecutionPolicy Bypass -File mobile\scripts\qa-build.ps1 -Online -ApiBaseUrl http://192.168.1.20:3000/api/v1   # LAN backend
#
# What it does: checks the toolchain; regenerates the git-ignored android/ project with `expo prebuild --clean` for the QA
# variant (all native customisation comes from app.config.js + plugins/with-stockmind-qa.js); builds the RELEASE variant
# (JavaScript embedded as Hermes bytecode, no Metro, not debuggable) signed with the local QA key; inspects the APK with
# qa-inspect-apk.ps1 (fails the build if any check fails); copies it to <local tools>\artifacts\stockmind-qa with a JSON
# record (SHA-256, commit, versions). It never installs anything and never touches a device; no AAB; no cloud build.
param(
    [switch]$Online,
    [string]$ApiBaseUrl = 'http://127.0.0.1:3000/api/v1',
    [string]$Abis = 'arm64-v8a,x86_64',
    [string]$ArtifactsDir
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'qa-common.ps1')
if (-not (Get-Command Get-MobileRoot -ErrorAction SilentlyContinue)) { throw 'qa-common.ps1 did not load.' }

$mobile = Get-MobileRoot
$tools = Get-LocalToolsDir
if (-not $ArtifactsDir) { $ArtifactsDir = Join-Path $tools 'artifacts\stockmind-qa' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDir = Join-Path $tools 'logs'
New-Item -ItemType Directory -Force $logDir, $ArtifactsDir | Out-Null
$log = Join-Path $logDir "s12-qa-build-$stamp.log"

Write-Host '== StockMind QA build =='
# ---- Preflight -------------------------------------------------------------------------------------------------------
$sdk = Get-AndroidSdk
$env:ANDROID_HOME = $sdk
if (-not (Test-Path (Join-Path $sdk 'ndk\26.1.10909125'))) {
    Fail "NDK 26.1.10909125 (pinned by React Native 0.74) is missing. Install it: `"$sdk\cmdline-tools\latest\bin\sdkmanager.bat`" --install `"ndk;26.1.10909125`""
}
$javaVersion = (Invoke-Native { & java -version }) -join ' '
if ($javaVersion -notmatch 'version "17\.') { Fail "JDK 17 is required on PATH (found: $javaVersion)" }

$nm = Get-Item (Join-Path $mobile 'node_modules') -Force -ErrorAction SilentlyContinue
if (-not $nm) { Fail 'mobile/node_modules is missing. Run `npm ci` in mobile/ (the lockfile is the source of truth).' }
if ($nm.LinkType) { Fail 'mobile/node_modules is a junction/symlink; Metro cannot bundle through it. Use a real copy (npm ci).' }

# Expo loads .env files at bundle time; one of them could inject EXPO_PUBLIC_* values (for example a production URL).
foreach ($f in @('.env', '.env.local', '.env.production', '.env.production.local')) {
    if (Test-Path (Join-Path $mobile $f)) { Fail "mobile/$f exists. Move it away before a QA build so it cannot inject build-time values." }
}

$apiHost = $null
if ($Online) { $apiHost = Assert-LocalBackendUrl $ApiBaseUrl }

$signingDir = Get-SigningDir
$store = Join-Path $signingDir 'stockmind-qa.p12'
if (-not (Test-Path $store)) { Fail "QA signing key not found in $signingDir. Run mobile/scripts/qa-signing-init.ps1 once." }

$commit = (Invoke-Native { & git -C $mobile rev-parse --short HEAD }) | Select-Object -First 1
$dirty = (Invoke-Native { & git -C $mobile status --porcelain=v1 }) | Where-Object { $_ }
$buildId = $commit
if ($dirty) { $buildId = "$commit-dirty" }
# Monotonic per minute since 2026-01-01 UTC, so every QA build can update the previous one in place.
$versionCode = [int][math]::Floor(((Get-Date).ToUniversalTime() - [datetime]'2026-01-01T00:00:00Z').TotalMinutes)

Write-Host "  commit $buildId, versionCode $versionCode, ABIs $Abis"
if ($Online) { Write-Host "  Online Preview: $ApiBaseUrl" } else { Write-Host '  Online Preview: off (offline-only QA build)' }
Write-Host "  log: $log"

# ---- Build environment (this process and its children only) -------------------------------------------------------
$saved = @{}
$names = 'STOCKMIND_VARIANT', 'EXPO_PUBLIC_STOCKMIND_VARIANT', 'EXPO_PUBLIC_ONLINE_MODE', 'EXPO_PUBLIC_API_BASE_URL', 'NODE_ENV',
    'STOCKMIND_QA_BUILD_ID', 'STOCKMIND_QA_VERSION_CODE', 'STOCKMIND_QA_STORE_FILE', 'STOCKMIND_QA_STORE_PASSWORD',
    'STOCKMIND_QA_KEY_ALIAS', 'STOCKMIND_QA_KEY_PASSWORD'
foreach ($n in $names) { $saved[$n] = [Environment]::GetEnvironmentVariable($n, 'Process') }
try {
    $env:STOCKMIND_VARIANT = 'qa'
    $env:EXPO_PUBLIC_STOCKMIND_VARIANT = 'qa'
    $env:NODE_ENV = 'production'
    $env:STOCKMIND_QA_BUILD_ID = $buildId
    $env:STOCKMIND_QA_VERSION_CODE = "$versionCode"
    if ($Online) { $env:EXPO_PUBLIC_ONLINE_MODE = '1'; $env:EXPO_PUBLIC_API_BASE_URL = $ApiBaseUrl }
    else { Remove-Item Env:\EXPO_PUBLIC_ONLINE_MODE, Env:\EXPO_PUBLIC_API_BASE_URL -ErrorAction SilentlyContinue }

    Push-Location $mobile
    try {
        Write-Host '-- expo prebuild --clean (QA variant; regenerates the git-ignored android/ project)'
        $out = Invoke-Native { & npx expo prebuild --platform android --clean --no-install }
        $out | Add-Content -Path $log
        if ($script:LastNativeExit -ne 0) { Fail "expo prebuild failed (see $log)" }
        if (((Get-Content (Join-Path $mobile 'android\.stockmind-variant') -ErrorAction SilentlyContinue) -join '').Trim() -ne 'qa') {
            Fail 'android/ was not generated by the QA plugin (marker missing).'
        }

        # Values inlined at bundle time must not come from a stale Metro cache.
        $metroCache = Join-Path $env:TEMP 'metro-cache'
        if (Test-Path $metroCache) { Remove-Item -Recurse -Force $metroCache }

        $env:STOCKMIND_QA_STORE_FILE = $store
        $env:STOCKMIND_QA_KEY_ALIAS = 'stockmind-qa'
        $pass = Read-QaSigningPassword $signingDir
        $env:STOCKMIND_QA_STORE_PASSWORD = $pass
        $env:STOCKMIND_QA_KEY_PASSWORD = $pass
        $pass = $null

        Write-Host '-- gradle assembleRelease (this takes a while on the first run)'
        Push-Location (Join-Path $mobile 'android')
        try {
            # --no-daemon: the signing password must not linger in a background Gradle daemon after the build.
            # Output is streamed into the log as it arrives (a first build downloads ~2 GB and takes a long time).
            $savedPref = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            & .\gradlew.bat assembleRelease "-PreactNativeArchitectures=$Abis" --no-daemon --console=plain 2>&1 |
                ForEach-Object { "$_" } | Add-Content -Path $log
            $gradleExit = $LASTEXITCODE
            $ErrorActionPreference = $savedPref
        } finally { Pop-Location }
        Remove-Item Env:\STOCKMIND_QA_STORE_PASSWORD, Env:\STOCKMIND_QA_KEY_PASSWORD -ErrorAction SilentlyContinue
        if ($gradleExit -ne 0) { Fail "gradle assembleRelease failed with exit $gradleExit (see $log)" }
    } finally { Pop-Location }
} finally {
    foreach ($n in $names) { [Environment]::SetEnvironmentVariable($n, $saved[$n], 'Process') }
}

$built = Join-Path $mobile 'android\app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $built)) { Fail "Gradle reported success but $built does not exist." }

$name = "stockmind-qa-$versionCode-$buildId"
$apk = Join-Path $ArtifactsDir "$name.apk"
Copy-Item $built $apk -Force
$record = Join-Path $ArtifactsDir "$name.json"

Write-Host '-- inspecting the APK'
$inspect = Join-Path $PSScriptRoot 'qa-inspect-apk.ps1'
if ($Online) { & powershell -NoProfile -ExecutionPolicy Bypass -File $inspect -Apk $apk -ExpectApiHost $apiHost -Json $record }
else { & powershell -NoProfile -ExecutionPolicy Bypass -File $inspect -Apk $apk -Json $record }
if ($LASTEXITCODE -ne 0) {
    Rename-Item $apk "$name.REJECTED.apk" -Force
    Fail 'The APK failed inspection and was marked REJECTED. Do not install it.'
}

$info = Get-Content $record -Raw | ConvertFrom-Json
$info | Add-Member -NotePropertyName commit -NotePropertyValue $buildId
$info | Add-Member -NotePropertyName online -NotePropertyValue ([bool]$Online)
$info | Add-Member -NotePropertyName apiBaseUrl -NotePropertyValue $(if ($Online) { $ApiBaseUrl } else { $null })
$info | Add-Member -NotePropertyName builtAt -NotePropertyValue (Get-Date).ToString('o')
$info | Add-Member -NotePropertyName buildLog -NotePropertyValue $log
$info | ConvertTo-Json -Depth 4 | Set-Content -Path $record -Encoding utf8
Copy-Item $record (Join-Path $ArtifactsDir 'latest.json') -Force

Write-Host ''
Write-Host "StockMind QA APK: $apk" -ForegroundColor Green
Write-Host "SHA-256: $($info.apkSha256)"
Write-Host 'Nothing was installed. To install on a phone you are holding: mobile\scripts\qa-install.ps1 -Serial <serial>'
