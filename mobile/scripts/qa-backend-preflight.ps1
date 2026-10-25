# Is the local test backend for StockMind QA / Dev Online Preview reachable? Read-only (Series 12).
#
#   powershell -ExecutionPolicy Bypass -File mobile\scripts\qa-backend-preflight.ps1
#   powershell -ExecutionPolicy Bypass -File mobile\scripts\qa-backend-preflight.ps1 -ApiBaseUrl http://192.168.1.20:3000/api/v1 -Serial <serial>
#
#   powershell -ExecutionPolicy Bypass -File mobile\scripts\qa-backend-preflight.ps1 -Serial <serial> -RestoreReverse
#
# Refuses production or public hosts before sending anything. Reports: the backend's /health answer, whether the throwaway
# PostgreSQL port answers, and (with -Serial) whether the phone has the adb reverse route to the backend port and a listener
# on its own loopback port (the phone end of the tunnel). Every USB reconnect drops adb reverse rules; -RestoreReverse
# re-adds the one rule for the named device (the only change this script can make), then checks again.
param(
    [string]$ApiBaseUrl = 'http://127.0.0.1:3000/api/v1',
    [int]$PostgresPort = 55433,
    [string]$Serial,
    [switch]$RestoreReverse
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'qa-common.ps1')
if (-not (Get-Command Assert-LocalBackendUrl -ErrorAction SilentlyContinue)) { throw 'qa-common.ps1 did not load.' }

$apiHost = Assert-LocalBackendUrl $ApiBaseUrl
$ok = $true
Write-Host "Backend: $ApiBaseUrl"
try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri ($ApiBaseUrl.TrimEnd('/') + '/health')
    Write-Host "  /health -> HTTP $($r.StatusCode): $($r.Content.Substring(0, [Math]::Min(200, $r.Content.Length)))" -ForegroundColor Green
} catch {
    $ok = $false
    Write-Host "  /health unreachable: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host '  Start the throwaway backend (synthetic data) with mobile\scripts\qa-local-backend.ps1, then re-run.'
}

$pg = Get-NetTCPConnection -LocalPort $PostgresPort -State Listen -ErrorAction SilentlyContinue
if ($pg) { Write-Host "  throwaway PostgreSQL port $PostgresPort is listening" } else { Write-Host "  throwaway PostgreSQL port $PostgresPort is NOT listening" -ForegroundColor Yellow; $ok = $false }

if ($Serial -and $apiHost -in @('127.0.0.1', 'localhost')) {
    $adb = Get-Adb
    $port = [regex]::Match($ApiBaseUrl, ':(\d+)').Groups[1].Value
    $hasRule = { ((Invoke-Native { & $adb -s $Serial reverse --list }) -join "`n") -match "tcp:$port\s+tcp:$port" }
    if (-not (& $hasRule) -and $RestoreReverse) {
        $null = Invoke-Native { & $adb -s $Serial reverse "tcp:$port" "tcp:$port" }
        Write-Host "  re-added adb reverse tcp:$port -> tcp:$port on $Serial"
    }
    if (-not (& $hasRule)) {
        $ok = $false
        Write-Host "  $Serial has no adb reverse for tcp:$port (USB reconnects drop it); a QA build pointing at $apiHost cannot reach the backend." -ForegroundColor Yellow
        Write-Host "  Fix: re-run with -RestoreReverse, or: adb -s $Serial reverse tcp:$port tcp:$port"
    } else {
        # The phone end of the tunnel: a LISTEN socket on the phone's own 127.0.0.1:<port> (read-only check).
        $hex = '{0:X4}' -f [int]$port
        $sock = (Invoke-Native { & $adb -s $Serial shell "grep -i ':$hex ' /proc/net/tcp /proc/net/tcp6" }) -join "`n"
        if ($sock -match ":$hex 0+:0000 0A") { Write-Host "  $Serial route to the backend port: ok (rule present, phone listening on 127.0.0.1:$port)" }
        else { $ok = $false; Write-Host "  $Serial has the rule but no listener on its 127.0.0.1:$port yet; retry in a few seconds." -ForegroundColor Yellow }
    }
}

if ($ok) { Write-Host 'Preflight: backend reachable.' -ForegroundColor Green; exit 0 }
Write-Host 'Preflight: NOT ready (StockMind QA still works offline; Online Preview will show a connection error).' -ForegroundColor Yellow
exit 2
