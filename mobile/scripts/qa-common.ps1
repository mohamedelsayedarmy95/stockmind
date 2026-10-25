# Shared helpers for the StockMind QA / Dev scripts (Series 12). Dot-source it; it defines functions only.
# Windows PowerShell 5.1 compatible. No secrets are printed by anything here.

$ErrorActionPreference = 'Stop'

$script:QaApplicationId = 'io.stockmind.app.qa'
$script:OriginalApplicationId = 'io.stockmind.app'
# The public React Native template debug certificate (anyone can sign with it). StockMind QA must never be signed with it.
$script:PublicDebugCertSha256 = 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c'
$script:ProductionHosts = @('stockmind-api-vmht.onrender.com', 'api.stockmind.io')

function Fail([string]$message) {
    Write-Host "ERROR: $message" -ForegroundColor Red
    exit 1
}

function Get-MobileRoot {
    $root = Split-Path -Parent $PSScriptRoot
    if (-not (Test-Path (Join-Path $root 'app.json'))) { Fail "Cannot find mobile/app.json next to $PSScriptRoot" }
    return $root
}

function Get-LocalToolsDir {
    if ($env:STOCKMIND_LOCAL_TOOLS) { $dir = $env:STOCKMIND_LOCAL_TOOLS } else { $dir = 'D:\Projects\StockMind-wt\_local-tools' }
    if (-not (Test-Path $dir)) { Fail "Local tools directory not found: $dir (set STOCKMIND_LOCAL_TOOLS)" }
    return $dir
}

function Get-AndroidSdk {
    foreach ($candidate in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android\Sdk'))) {
        if ($candidate -and (Test-Path (Join-Path $candidate 'platform-tools'))) { return $candidate }
    }
    Fail 'Android SDK not found (set ANDROID_HOME).'
}

function Get-Adb {
    $adb = Join-Path (Get-AndroidSdk) 'platform-tools\adb.exe'
    if (-not (Test-Path $adb)) { Fail "adb not found at $adb" }
    return $adb
}

function Get-BuildTool([string]$name) {
    $dir = Join-Path (Get-AndroidSdk) 'build-tools'
    $versions = Get-ChildItem $dir -Directory | Sort-Object { [version]($_.Name -replace '[^0-9.]', '') } -Descending
    foreach ($v in $versions) {
        foreach ($ext in @('.exe', '.bat', '')) {
            $p = Join-Path $v.FullName ($name + $ext)
            if (Test-Path $p) { return $p }
        }
    }
    Fail "Android build tool '$name' not found under $dir"
}

function Get-UrlHost([string]$url) {
    if (-not $url) { return $null }
    $m = [regex]::Match($url.Trim(), '^(?i)(https?)://(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?(?:[/?#]|$)')
    if (-not $m.Success) { return $null }
    return $m.Groups[2].Value.ToLowerInvariant()
}

function Test-ProductionHost([string]$hostName) {
    foreach ($p in $script:ProductionHosts) { if ($hostName -eq $p -or $hostName.EndsWith(".$p")) { return $true } }
    return $false
}

# Same rules as mobile/src/domain/build-variant.ts (loopback or RFC 1918; no names other than localhost).
function Test-PrivateNetworkHost([string]$hostName) {
    if ($hostName -eq 'localhost' -or $hostName -eq '[::1]') { return $true }
    $m = [regex]::Match($hostName, '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$')
    if (-not $m.Success) { return $false }
    $o = 1..4 | ForEach-Object { [int]$m.Groups[$_].Value }
    if (($o | Where-Object { $_ -gt 255 }).Count -gt 0) { return $false }
    return ($o[0] -eq 127) -or ($o[0] -eq 10) -or ($o[0] -eq 172 -and $o[1] -ge 16 -and $o[1] -le 31) -or ($o[0] -eq 192 -and $o[1] -eq 168)
}

function Assert-LocalBackendUrl([string]$url) {
    $h = Get-UrlHost $url
    if (-not $h) { Fail "Not an http(s) URL: $url" }
    if (Test-ProductionHost $h) { Fail "Refusing the production host ${h}. StockMind QA only talks to a local test backend." }
    if (-not (Test-PrivateNetworkHost $h)) { Fail "Refusing ${h}: StockMind QA only talks to a loopback or private-network address (127.x, 10.x, 172.16-31.x, 192.168.x, localhost)." }
    return $h
}

function Get-SigningDir {
    if ($env:STOCKMIND_QA_SIGNING_DIR) { return $env:STOCKMIND_QA_SIGNING_DIR }
    return (Join-Path (Get-LocalToolsDir) 'qa-signing')
}

# Reads the DPAPI-protected keystore password (only this Windows user on this machine can decrypt it).
function Read-QaSigningPassword([string]$signingDir) {
    $passFile = Join-Path $signingDir 'stockmind-qa.pass.dpapi'
    if (-not (Test-Path $passFile)) { Fail "QA signing password file not found: $passFile. Run mobile/scripts/qa-signing-init.ps1 once." }
    $secure = (Get-Content $passFile -Raw).Trim() | ConvertTo-SecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Get-Sha256([string]$path) { return (Get-FileHash -Algorithm SHA256 $path).Hash.ToLowerInvariant() }

# Runs a native tool and returns its combined output as strings. Windows PowerShell 5.1 turns any stderr line of a native
# program into a terminating error under ErrorActionPreference=Stop, even when the program succeeds; the exit code is the
# real signal, so it is returned in $script:LastNativeExit.
function Invoke-Native([scriptblock]$block) {
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $block 2>&1 | ForEach-Object { "$_" }
        $script:LastNativeExit = $LASTEXITCODE
        return $out
    } finally { $ErrorActionPreference = $saved }
}
