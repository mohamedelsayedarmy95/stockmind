# Starts Metro for the StockMind DEVELOPMENT build (io.stockmind.app debug), or reports that it is already running (Series 12).
#
#   powershell -ExecutionPolicy Bypass -File mobile\scripts\dev-metro.ps1
#   powershell -ExecutionPolicy Bypass -File mobile\scripts\dev-metro.ps1 -Online -ApiBaseUrl http://127.0.0.1:3000/api/v1
#   powershell -ExecutionPolicy Bypass -File mobile\scripts\dev-metro.ps1 -AdbReverse -Serial <serial>   # USB phone: forward 8081 (and 3000 with -Online)
#
# The development build has NO JavaScript inside it: it loads it from Metro on the computer. Without Metro (or without the USB
# forwarding/LAN route to it) that app shows "Cannot connect to Metro" / "Unable to load script". That is by design; the app
# the Director uses on their own is StockMind QA (qa-build.ps1), which needs neither.
#
# Safe by construction: never starts a second Metro, never kills a process, never targets a device without an explicit
# -Serial, never uninstalls or clears anything.
param(
    [int]$Port = 8081,
    [switch]$Online,
    [string]$ApiBaseUrl = 'http://127.0.0.1:3000/api/v1',
    [switch]$AdbReverse,
    [string]$Serial,
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'qa-common.ps1')
if (-not (Get-Command Get-MobileRoot -ErrorAction SilentlyContinue)) { throw 'qa-common.ps1 did not load.' }
$mobile = Get-MobileRoot

function Get-MetroStatus([int]$p) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:$p/status"
        return ($r.Content -match 'packager-status:running')
    } catch { return $false }
}

function Set-Reverse([int]$p) {
    $adb = Get-Adb
    $out = Invoke-Native { & $adb -s $Serial reverse "tcp:$p" "tcp:$p" }
    if ($script:LastNativeExit -ne 0) { Fail "adb reverse tcp:$p failed on $Serial : $($out -join ' ')" }
    Write-Host "  adb reverse tcp:$p -> computer tcp:$p on $Serial"
}

if ($AdbReverse -and -not $Serial) { Fail '-AdbReverse needs an explicit -Serial (the scripts never pick a device on their own).' }
if ($Online) { $null = Assert-LocalBackendUrl $ApiBaseUrl }

$marker = Join-Path $mobile 'android\.stockmind-variant'
if (Test-Path $marker) {
    Write-Host 'Note: mobile/android was generated for StockMind QA. Before building the development app again run:' -ForegroundColor Yellow
    Write-Host '      npx expo prebuild --platform android --clean   (without STOCKMIND_VARIANT)' -ForegroundColor Yellow
}

if (Get-MetroStatus $Port) {
    Write-Host "Metro is already running on port $Port. Nothing started." -ForegroundColor Green
} else {
    $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($busy) {
        $procId = ($busy | Select-Object -First 1).OwningProcess
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        Fail "Port $Port is used by another program (PID $procId $($proc.ProcessName)) that is not Metro. Free the port yourself or use -Port."
    }
    $nm = Get-Item (Join-Path $mobile 'node_modules') -Force -ErrorAction SilentlyContinue
    if (-not $nm) { Fail 'mobile/node_modules is missing (npm ci).' }
    if ($nm.LinkType) { Write-Host 'Warning: mobile/node_modules is a junction; Metro may fail to resolve modules through it.' -ForegroundColor Yellow }

    $envLine = ''
    if ($Online) { $envLine = "`$env:EXPO_PUBLIC_ONLINE_MODE='1'; `$env:EXPO_PUBLIC_API_BASE_URL='$ApiBaseUrl'; " }
    $logDir = Join-Path (Get-LocalToolsDir) 'logs'
    $log = Join-Path $logDir ("s12-metro-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $command = "Set-Location '$mobile'; $envLine npx expo start --dev-client --port $Port *>&1 | Tee-Object -FilePath '$log'"
    Start-Process powershell -ArgumentList '-NoProfile', '-NoExit', '-Command', $command | Out-Null
    Write-Host "Starting Metro in a new window (log: $log) ..."
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not (Get-MetroStatus $Port)) {
        if ((Get-Date) -gt $deadline) { Fail "Metro did not report ready on port $Port within $TimeoutSeconds s. See $log" }
        Start-Sleep -Seconds 2
    }
    Write-Host "Metro is ready on port $Port." -ForegroundColor Green
}

if ($AdbReverse) {
    Set-Reverse $Port
    if ($Online) { Set-Reverse ([int]([regex]::Match($ApiBaseUrl, ':(\d+)').Groups[1].Value)) }
}
Write-Host 'USB is needed for the development build only when the phone reaches Metro through adb reverse. StockMind QA needs neither.'
