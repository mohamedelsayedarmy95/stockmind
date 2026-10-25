# Starts a THROWAWAY local backend for StockMind QA / Dev Online Preview (Series 12): this worktree's compiled backend
# (dist/main.js) against a disposable PostgreSQL database on 127.0.0.1:55433, synthetic data only.
#
#   npx nest build            # in the repository root, once per backend change (check dist/main.js and 12 migrations)
#   powershell -ExecutionPolicy Bypass -File mobile\scripts\qa-local-backend.ps1 [-Db stockmind_qa_local]
#   node mobile\scripts\qa-seed-synthetic.mjs           # synthetic company, warehouses, products, Owner/Manager/Staff
#
# Safety: database names must match stockmind_qa_*; it runs from the local tools folder so no .env file is ever loaded;
# every external integration (Firebase, Google, Cloudinary, S3, Redis, SAML, DATABASE_URL, DB_SSL) is unset;
# CAPABILITY_MODE is pinned to shadow (Series 11 default; enforce is NOT enabled here); throwaway JWT secrets live in the
# local tools folder, never in the repository. It never touches Production or Neon.
param(
    [string]$Db = 'stockmind_qa_local',
    [int]$Port = 3000,
    [int]$PostgresPort = 55433,
    [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'qa-common.ps1')
if (-not (Get-Command Get-LocalToolsDir -ErrorAction SilentlyContinue)) { throw 'qa-common.ps1 did not load.' }

if ($Db -notmatch '^stockmind_qa_[a-z0-9_]+$') { Fail 'Refusing: only throwaway stockmind_qa_* databases.' }
$repo = Split-Path -Parent (Get-MobileRoot)
$tools = Get-LocalToolsDir
$main = Join-Path $repo 'dist\main.js'
if (-not (Test-Path $main)) { Fail "No compiled backend at $main. Run 'npx nest build' in $repo first." }
$migrations = @(Get-ChildItem (Join-Path $repo 'dist\migrations') -Filter '*.js' | Where-Object { $_.Name -match '^\d{13}-' }).Count
Write-Host "Backend: $main ($migrations compiled migrations)"

if (-not (Get-NetTCPConnection -LocalPort $PostgresPort -State Listen -ErrorAction SilentlyContinue)) {
    Fail "The throwaway PostgreSQL is not listening on $PostgresPort. Start it: $tools\pg15\pgsql\bin\pg_ctl.exe -D $tools\pgdata-s04 -o `"-p $PostgresPort -c listen_addresses=127.0.0.1`" start"
}
$health = "http://127.0.0.1:$Port/api/v1/health"
try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri $health; Write-Host "A backend already answers on port $Port. Nothing started." -ForegroundColor Green; exit 0 } catch { }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { Fail "Port $Port is used by another program. Free it yourself or pass -Port." }

$secretFile = Join-Path $tools 'backend-throwaway-secrets.json'
if (-not (Test-Path $secretFile)) {
    $rand = { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ }) }
    @{ access = & $rand; refresh = & $rand; twofa = & $rand; enc = & $rand } | ConvertTo-Json | Set-Content $secretFile -Encoding utf8
}

$bin = Join-Path $tools 'pg15\pgsql\bin'
$exists = (Invoke-Native { & "$bin\psql.exe" -h 127.0.0.1 -p $PostgresPort -U stockmind -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$Db'" }) -join ''
if ($exists.Trim() -ne '1') {
    $null = Invoke-Native { & "$bin\createdb.exe" -h 127.0.0.1 -p $PostgresPort -U stockmind $Db }
    if ($script:LastNativeExit -ne 0) { Fail "Could not create the throwaway database $Db." }
    Write-Host "Created throwaway database $Db"
}

$log = Join-Path $tools ("logs\s12-backend-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$unset = 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_PROJECT_ID', 'GOOGLE_WEB_CLIENT_ID', 'HF_API_KEY',
    'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CLOUDINARY_CLOUD_NAME', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
    'S3_BUCKET', 'REDIS_URL', 'SAML_ENABLED', 'AUTH_PROVIDER', 'ALLOWED_IPS', 'ENTITLEMENTS_ENFORCED', 'DB_SSL', 'DATABASE_URL',
    'RECOVERY_OPERATIONS_ENABLED'
$script = @"
`$ErrorActionPreference = 'Stop'
foreach (`$v in '$($unset -join "','")') { Remove-Item "Env:`$v" -ErrorAction SilentlyContinue }
`$s = Get-Content '$secretFile' -Raw | ConvertFrom-Json
`$env:NODE_ENV = 'development'
`$env:CAPABILITY_MODE = 'shadow'
`$env:PORT = '$Port'
`$env:DB_HOST = '127.0.0.1'; `$env:DB_PORT = '$PostgresPort'; `$env:DB_USERNAME = 'stockmind'; `$env:DB_PASSWORD = 'local-trust-auth'; `$env:DB_DATABASE = '$Db'
`$env:JWT_ACCESS_SECRET = `$s.access; `$env:JWT_REFRESH_SECRET = `$s.refresh; `$env:JWT_2FA_SECRET = `$s.twofa; `$env:DB_ENCRYPTION_KEY = `$s.enc
`$env:STORAGE_DRIVER = 'local'; `$env:UPLOAD_DIR = '$(Join-Path $tools 'uploads')'
`$env:JWT_ACCESS_EXPIRES_IN = '4h'
Set-Location '$tools'
node '$main' *>&1 | Tee-Object -FilePath '$log'
"@
Start-Process powershell -ArgumentList '-NoProfile', '-NoExit', '-Command', $script -WindowStyle Minimized | Out-Null
Write-Host "Starting the throwaway backend (db $Db, CAPABILITY_MODE=shadow, log $log) ..."
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ($true) {
    try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri $health; break } catch { }
    if ((Get-Date) -gt $deadline) { Fail "The backend did not answer $health within $TimeoutSeconds s. See $log" }
    Start-Sleep -Seconds 2
}
Write-Host "Backend ready: http://127.0.0.1:$Port/api/v1 (synthetic data only)." -ForegroundColor Green
