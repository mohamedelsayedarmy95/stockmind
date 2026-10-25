# Creates the local StockMind QA signing key ONCE (Series 12). Never overwrites an existing key: every later QA build must be
# signed with the same key, or Android refuses to update the installed QA app (and its QA data would be lost on reinstall).
#
# Where: <local tools>\qa-signing\ (outside every repository; never commit it).
#   stockmind-qa.p12           PKCS12 keystore, alias "stockmind-qa"
#   stockmind-qa.pass.dpapi    its random password, encrypted with Windows DPAPI for the current user
#   stockmind-qa.cert-sha256   the public certificate fingerprint (not secret)
# Usage:  powershell -ExecutionPolicy Bypass -File mobile\scripts\qa-signing-init.ps1
param([string]$SigningDir)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'qa-common.ps1')
if (-not (Get-Command Get-SigningDir -ErrorAction SilentlyContinue)) { throw 'qa-common.ps1 did not load.' }

if (-not $SigningDir) { $SigningDir = Get-SigningDir }
$store = Join-Path $SigningDir 'stockmind-qa.p12'
$passFile = Join-Path $SigningDir 'stockmind-qa.pass.dpapi'

if ((Test-Path $store) -or (Test-Path $passFile)) {
    Write-Host "A QA signing key already exists in $SigningDir. Nothing was changed." -ForegroundColor Yellow
    exit 0
}

$keytool = $null
if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\keytool.exe'))) { $keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe' }
if (-not $keytool) { $cmd = Get-Command keytool -ErrorAction SilentlyContinue; if ($cmd) { $keytool = $cmd.Source } }
if (-not $keytool) { Fail 'keytool not found (install a JDK 17 or set JAVA_HOME).' }

New-Item -ItemType Directory -Force $SigningDir | Out-Null

# 32 random characters from a URL-safe alphabet, from the OS CSPRNG.
$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$password = [Convert]::ToBase64String($bytes).Replace('+', 'A').Replace('/', 'B')

$env:STOCKMIND_QA_INIT_PASS = $password
try {
    $null = Invoke-Native { & $keytool -genkeypair -storetype PKCS12 -keystore $store -alias stockmind-qa -keyalg RSA -keysize 2048 -validity 10000 `
        -dname 'CN=StockMind QA (local testing only - not for release), O=StockMind Development' `
        -storepass:env STOCKMIND_QA_INIT_PASS -keypass:env STOCKMIND_QA_INIT_PASS }
    if ($script:LastNativeExit -ne 0 -or -not (Test-Path $store)) { Fail 'keytool could not create the QA keystore.' }
    ConvertTo-SecureString $password -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -Path $passFile -Encoding ascii
    $certOut = Invoke-Native { & $keytool -list -v -keystore $store -alias stockmind-qa -storepass:env STOCKMIND_QA_INIT_PASS }
    $sha = ($certOut | Select-String -Pattern 'SHA256:\s*([0-9A-F:]+)').Matches[0].Groups[1].Value.Replace(':', '').ToLowerInvariant()
    Set-Content -Path (Join-Path $SigningDir 'stockmind-qa.cert-sha256') -Value $sha -Encoding ascii
} finally {
    Remove-Item Env:\STOCKMIND_QA_INIT_PASS -ErrorAction SilentlyContinue
    $password = $null
}

Write-Host "Created the StockMind QA signing key in $SigningDir"
Write-Host "Certificate SHA-256: $sha"
Write-Host 'Keep a backup of this folder. If the key is lost, the QA app must be uninstalled (losing its QA data) before a new key can be used.'
