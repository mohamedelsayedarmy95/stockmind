# Is the local test backend for StockMind QA / Dev Online Preview reachable? Read-only (Series 12).
#
#   powershell -ExecutionPolicy Bypass -File mobile\scripts\qa-backend-preflight.ps1
#   powershell -ExecutionPolicy Bypass -File mobile\scripts\qa-backend-preflight.ps1 -ApiBaseUrl http://192.168.1.20:3000/api/v1 -Serial <serial>
#
# Refuses production or public hosts before sending anything. Reports: the backend's /health answer, whether the throwaway
# PostgreSQL port answers, and (with -Serial) whether the phone has the adb reverse route to the backend port.
param(
    [string]$ApiBaseUrl = 'http://127.0.0.1:3000/api/v1',
    [int]$PostgresPort = 55433,
    [string]$Serial
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
    Write-Host '  Start the throwaway backend (synthetic data) with _local-tools\scripts\start-backend.ps1, then re-run.'
}

$pg = Get-NetTCPConnection -LocalPort $PostgresPort -State Listen -ErrorAction SilentlyContinue
if ($pg) { Write-Host "  throwaway PostgreSQL port $PostgresPort is listening" } else { Write-Host "  throwaway PostgreSQL port $PostgresPort is NOT listening" -ForegroundColor Yellow; $ok = $false }

if ($Serial) {
    $port = [regex]::Match($ApiBaseUrl, ':(\d+)').Groups[1].Value
    $list = (Invoke-Native { & (Get-Adb) -s $Serial reverse --list }) -join "`n"
    if ($apiHost -in @('127.0.0.1', 'localhost') -and $list -notmatch "tcp:$port") {
        $ok = $false
        Write-Host "  $Serial has no adb reverse for tcp:$port; a QA build pointing at $apiHost cannot reach the backend." -ForegroundColor Yellow
    } else { Write-Host "  $Serial route to the backend port: ok" }
}

if ($ok) { Write-Host 'Preflight: backend reachable.' -ForegroundColor Green; exit 0 }
Write-Host 'Preflight: NOT ready (StockMind QA still works offline; Online Preview will show a connection error).' -ForegroundColor Yellow
exit 2
