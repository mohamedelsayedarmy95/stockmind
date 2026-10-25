# Installs or updates StockMind QA on ONE explicitly named device (Series 12). Run it only with the phone in your hands.
#
#   powershell -ExecutionPolicy Bypass -File mobile\scripts\qa-install.ps1 -Serial <serial>             # the latest QA build
#   powershell -ExecutionPolicy Bypass -File mobile\scripts\qa-install.ps1 -Serial <serial> -Apk <path>
#
# Guarantees: it refuses any APK whose application id is not io.stockmind.app.qa or that fails qa-inspect-apk.ps1; it only
# runs `adb install -r` (update in place, keeps the QA app's data); it never uninstalls, never clears data, never downgrades,
# never force-stops, and never touches io.stockmind.app (the existing installed app). If Android reports a signature conflict
# it stops and explains instead of "fixing" it.
param(
    [Parameter(Mandatory = $true)][string]$Serial,
    [string]$Apk
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'qa-common.ps1')
if (-not (Get-Command Get-Adb -ErrorAction SilentlyContinue)) { throw 'qa-common.ps1 did not load.' }

if (-not $Apk) {
    $latest = Join-Path (Get-LocalToolsDir) 'artifacts\stockmind-qa\latest.json'
    if (-not (Test-Path $latest)) { Fail 'No QA build found. Run mobile/scripts/qa-build.ps1 first.' }
    $Apk = (Get-Content $latest -Raw | ConvertFrom-Json).apk
}
if (-not (Test-Path $Apk)) { Fail "APK not found: $Apk" }

Write-Host '-- checking the APK before it goes anywhere near the phone'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'qa-inspect-apk.ps1') -Apk $Apk
if ($LASTEXITCODE -ne 0) { Fail 'The APK did not pass inspection. Nothing was installed.' }

$adb = Get-Adb
$state = (Invoke-Native { & $adb -s $Serial get-state }) -join ''
if ($state.Trim() -ne 'device') { Fail "Device $Serial is not ready (state: $state). Unlock it and allow USB debugging yourself." }

$before = (Invoke-Native { & $adb -s $Serial shell pm list packages io.stockmind.app }) | Where-Object { $_ -like 'package:*' }
Write-Host "  packages before: $($before -join ', ')"

Write-Host "-- adb install -r (update in place; QA data kept) on $Serial"
$out = Invoke-Native { & $adb -s $Serial install -r $Apk }
$text = $out -join "`n"
Write-Host $text
if ($text -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match') {
    Fail 'Android refused: an io.stockmind.app.qa with a DIFFERENT signing key is installed. Nothing was changed. Do NOT uninstall it blindly (that deletes its QA data); ask the Director.'
}
if ($text -match 'INSTALL_FAILED_VERSION_DOWNGRADE') { Fail 'Android refused a downgrade. Build a newer QA APK; this script never downgrades.' }
if ($script:LastNativeExit -ne 0 -or $text -notmatch 'Success') { Fail 'Installation did not succeed. Nothing else was attempted.' }

$after = (Invoke-Native { & $adb -s $Serial shell pm list packages io.stockmind.app }) | Where-Object { $_ -like 'package:*' }
Write-Host "  packages after:  $($after -join ', ')"
if (($before -contains 'package:io.stockmind.app') -and -not ($after -contains 'package:io.stockmind.app')) {
    Fail 'io.stockmind.app is no longer listed. Stop and tell the Director.'
}
$dump = Invoke-Native { & $adb -s $Serial shell dumpsys package $script:QaApplicationId }
$vc = ($dump | Select-String -Pattern 'versionCode=(\d+)' | Select-Object -First 1).Matches.Groups[1].Value
$vn = ($dump | Select-String -Pattern 'versionName=(\S+)' | Select-Object -First 1).Matches.Groups[1].Value
Write-Host "StockMind QA installed: $script:QaApplicationId $vn (code $vc). The original app was not touched." -ForegroundColor Green
