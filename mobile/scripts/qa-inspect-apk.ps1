# Inspects a StockMind QA APK and FAILS unless it is what a standalone side-by-side QA build must be (Series 12).
# A Gradle exit code is not acceptance; this is. Read-only: it never touches a device.
#
# Checks: application id io.stockmind.app.qa and label; NOT debuggable; an embedded Hermes JavaScript bundle
# (assets/index.android.bundle with the Hermes magic number); the embedded app config says variant "qa", QA id, and has no
# production API URL; launch activity; signed with the local QA key and NOT the public debug key; network policy
# (cleartext only to the configured local backend); ABIs and permissions (reported).
# Usage:  powershell -ExecutionPolicy Bypass -File mobile\scripts\qa-inspect-apk.ps1 -Apk <path> [-ExpectApiHost <host>] [-Json <out.json>]
param(
    [Parameter(Mandatory = $true)][string]$Apk,
    [string]$ExpectApiHost,
    [string]$Json
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'qa-common.ps1')
if (-not (Get-Command Get-BuildTool -ErrorAction SilentlyContinue)) { throw 'qa-common.ps1 did not load.' }
if (-not (Test-Path $Apk)) { Fail "APK not found: $Apk" }
$Apk = (Resolve-Path $Apk).Path

$aapt2 = Get-BuildTool 'aapt2'
$apksigner = Get-BuildTool 'apksigner'
$failures = New-Object System.Collections.Generic.List[string]
function Check([bool]$ok, [string]$what) {
    if ($ok) { Write-Host "  PASS  $what" -ForegroundColor Green } else { Write-Host "  FAIL  $what" -ForegroundColor Red; $failures.Add($what) }
}

Write-Host "Inspecting $Apk"
$badging = Invoke-Native { & $aapt2 dump badging $Apk }
$pkgLine = ($badging | Where-Object { $_ -like 'package:*' } | Select-Object -First 1)
$pkg = [regex]::Match($pkgLine, "name='([^']+)'").Groups[1].Value
$versionCode = [regex]::Match($pkgLine, "versionCode='([^']+)'").Groups[1].Value
$versionName = [regex]::Match($pkgLine, "versionName='([^']+)'").Groups[1].Value
$label = [regex]::Match(($badging | Where-Object { $_ -like 'application-label:*' } | Select-Object -First 1), "'([^']*)'").Groups[1].Value
$debuggable = [bool]($badging | Where-Object { $_ -eq 'application-debuggable' })
$activity = [regex]::Match(($badging | Where-Object { $_ -like 'launchable-activity:*' } | Select-Object -First 1), "name='([^']+)'").Groups[1].Value
$abis = (($badging | Where-Object { $_ -like 'native-code:*' }) -replace "native-code:\s*", '' -replace "'", '').Trim()
$permissions = $badging | Where-Object { $_ -like 'uses-permission:*' } | ForEach-Object { [regex]::Match($_, "name='([^']+)'").Groups[1].Value }

Check ($pkg -eq $script:QaApplicationId) "application id is $script:QaApplicationId (found '$pkg')"
Check ($pkg -ne $script:OriginalApplicationId) "application id is NOT the installed app's $script:OriginalApplicationId"
Check ($label -eq 'StockMind QA') "label is 'StockMind QA' (found '$label')"
Check (-not $debuggable) 'not debuggable'
Check ($activity -eq "$pkg.MainActivity") "launch activity $activity"

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($Apk)
try {
    $bundle = $zip.Entries | Where-Object { $_.FullName -eq 'assets/index.android.bundle' } | Select-Object -First 1
    $bundleBytes = 0; $hermes = $false; $bundleSha = $null
    if ($bundle) {
        $bundleBytes = $bundle.Length
        $s = $bundle.Open(); $ms = New-Object IO.MemoryStream; $s.CopyTo($ms); $s.Dispose()
        $data = $ms.ToArray(); $ms.Dispose()
        $magic = [byte[]](0xC6, 0x1F, 0xBC, 0x03, 0xC1, 0x03, 0x19, 0x1F)
        $hermes = ($data.Length -ge 8) -and (@(0..7 | Where-Object { $data[$_] -ne $magic[$_] }).Count -eq 0)
        $bundleSha = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($data))).Replace('-', '').ToLowerInvariant()
        $text = [Text.Encoding]::UTF8.GetString($data)
    }
    Check ($null -ne $bundle) "embedded JavaScript bundle assets/index.android.bundle ($bundleBytes bytes)"
    Check $hermes 'bundle is Hermes bytecode (magic number)'
    if ($ExpectApiHost) {
        Check ($text -and $text.Contains($ExpectApiHost)) "bundle names the configured local backend host $ExpectApiHost"
    }

    $cfgEntry = $zip.Entries | Where-Object { $_.FullName -eq 'assets/app.config' } | Select-Object -First 1
    $cfg = $null
    if ($cfgEntry) { $r = New-Object IO.StreamReader($cfgEntry.Open()); $cfg = $r.ReadToEnd() | ConvertFrom-Json; $r.Dispose() }
    Check ($null -ne $cfg) 'embedded app config (assets/app.config) present'
    if ($cfg) {
        Check ($cfg.android.package -eq $script:QaApplicationId) "embedded config android.package = $($cfg.android.package)"
        Check ($cfg.extra.stockmindVariant -eq 'qa') "embedded config extra.stockmindVariant = $($cfg.extra.stockmindVariant)"
        Check (-not ($cfg.extra.PSObject.Properties.Name -contains 'apiBaseUrl')) 'embedded config has NO production apiBaseUrl'
    }
} finally { $zip.Dispose() }

$manifest = Invoke-Native { & $aapt2 dump xmltree $Apk --file AndroidManifest.xml }
$nsc = [bool]($manifest | Where-Object { $_ -match 'networkSecurityConfig' })
$cleartextTrue = [bool]($manifest | Where-Object { $_ -match 'usesCleartextTraffic' -and $_ -match '0xffffffff' })
Check $nsc 'manifest uses the QA network security config'
Check (-not $cleartextTrue) 'manifest does not allow cleartext traffic globally'
$nscXml = Invoke-Native { & $aapt2 dump xmltree $Apk --file res/xml/stockmind_qa_network_security.xml }
$cleartextDomains = @($nscXml | Where-Object { $_ -match 'T: ''' } | ForEach-Object { [regex]::Match($_, "T: '([^']+)'").Groups[1].Value } | Where-Object { $_ })
if ($ExpectApiHost) {
    Check (($cleartextDomains.Count -eq 1) -and ($cleartextDomains[0] -eq $ExpectApiHost.Trim('[', ']'))) "cleartext allowed only for $ExpectApiHost (found: $($cleartextDomains -join ', '))"
} else {
    Check ($cleartextDomains.Count -eq 0) "no cleartext host in an offline-only QA build (found: $($cleartextDomains -join ', '))"
}

$certs = Invoke-Native { & $apksigner verify --verbose --print-certs $Apk }
$verified = [bool]($certs | Where-Object { $_ -eq 'Verifies' })
# apksigner prints "Signer #1 certificate SHA-256 digest: <hex>" (older build-tools) or "V2 Signer: certificate SHA-256
# digest: <hex>" (newer). Every signer line must name the same certificate; an unreadable digest is a failure, never a pass.
$signerDigests = @($certs | Where-Object { $_ -match 'Signer.*certificate SHA-256 digest' } |
    ForEach-Object { [regex]::Match($_, '([0-9a-f]{64})').Groups[1].Value } | Where-Object { $_ } | Sort-Object -Unique)
$signerSha = if ($signerDigests.Count -eq 1) { $signerDigests[0] } else { '' }
Check ($signerDigests.Count -eq 1) "exactly one signing certificate readable (found $($signerDigests.Count))"
$v2 = [bool]($certs | Where-Object { $_ -match 'Verified using v2 scheme \(APK Signature Scheme v2\): true' })
$expectedCertFile = Join-Path (Get-SigningDir) 'stockmind-qa.cert-sha256'
$expectedCert = $null
if (Test-Path $expectedCertFile) { $expectedCert = (Get-Content $expectedCertFile -Raw).Trim() }
Check $verified 'APK signature verifies'
Check $v2 'APK Signature Scheme v2'
Check (($signerSha -ne '') -and ($signerSha -ne $script:PublicDebugCertSha256)) 'NOT signed with the public React Native debug key'
Check ($expectedCert -and $signerSha -eq $expectedCert) "signed with the local QA key ($signerSha)"

$summary = [ordered]@{
    apk = $Apk; apkSha256 = (Get-Sha256 $Apk); apkBytes = (Get-Item $Apk).Length
    applicationId = $pkg; label = $label; versionCode = $versionCode; versionName = $versionName
    debuggable = $debuggable; launchActivity = $activity; abis = $abis
    jsBundleBytes = $bundleBytes; jsBundleHermes = $hermes; jsBundleSha256 = $bundleSha
    signerCertSha256 = $signerSha; cleartextHosts = $cleartextDomains; permissions = @($permissions)
    checksFailed = @($failures)
}
if ($Json) { $summary | ConvertTo-Json -Depth 4 | Set-Content -Path $Json -Encoding utf8 }

if ($failures.Count -gt 0) { Fail "$($failures.Count) check(s) failed. This APK is NOT an acceptable StockMind QA build." }
Write-Host "All checks passed: $pkg $versionName (code $versionCode), APK SHA-256 $($summary.apkSha256)" -ForegroundColor Green
