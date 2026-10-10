# Quick dev loop for DyCast Android.
# Builds only arm64, signs, installs, starts app, forwards CDP, and optionally runs tests or takes a screenshot.

param(
    [string]$Target = "aarch64",
    [string]$Device = "emulator-5554",
    [string]$TestScript = "",
    [switch]$Screenshot
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
Set-Location $Root

$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$zipalign = "$env:LOCALAPPDATA\Android\Sdk\build-tools\37.0.0\zipalign.exe"
$apksigner = "$env:LOCALAPPDATA\Android\Sdk\build-tools\37.0.0\apksigner.bat"

$PackageJson = Get-Content -Raw -Path "$Root\package.json" | ConvertFrom-Json
$Version = $PackageJson.version
$ApkName = "dycast-android-v$Version-signed.apk"

Write-Host "[dev-loop] Building version $Version for $Target" -ForegroundColor Green

# Build frontend.
Write-Host "[dev-loop] Installing frontend dependencies..."
npm install

Write-Host "[dev-loop] Building frontend..."
npm run build

# Build Android APK for single architecture only.
Write-Host "[dev-loop] Building Android APK ($Target)..."
$env:CI = "true"
cargo tauri android build --apk --target $Target

# Locate the generated APK.
$ApkDir = "$Root\src-tauri\gen\android\app\build\outputs\apk"
$ApkFiles = Get-ChildItem -Path $ApkDir -Filter "*.apk" -Recurse | Where-Object {
    $_.FullName -like "*\release\*.apk"
}
if (-not $ApkFiles) {
    throw "No APK file found under $ApkDir"
}
$SourceApk = $ApkFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1

# Sign APK.
Write-Host "[dev-loop] Signing APK..."
$OutputDir = "$Root\output"
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}
$AlignedApk = "$OutputDir\dycast-android-v$Version-aligned.apk"
$OutputApk = "$OutputDir\$ApkName"

& $zipalign -p -f 4 "$($SourceApk.FullName)" "$AlignedApk"
& $apksigner sign --ks "$Root\keystore\dycast-release-new.keystore" --ks-pass pass:dycast123 --key-pass pass:dycast123 --out $OutputApk $AlignedApk
& $apksigner verify -v $OutputApk
Remove-Item $AlignedApk -Force -ErrorAction SilentlyContinue

Write-Host "[dev-loop] Signed APK: $OutputApk" -ForegroundColor Green

# Wait for device.
Write-Host "[dev-loop] Waiting for device $Device..."
& $adb -s $Device wait-for-device

# Install and start app.
Write-Host "[dev-loop] Installing APK..."
& $adb -s $Device install -r $OutputApk

Write-Host "[dev-loop] Starting app..."
& $adb -s $Device shell am force-stop com.dycast.app
Start-Sleep -Seconds 1
& $adb -s $Device shell am start -n com.dycast.app/.MainActivity

# Forward CDP port for WebView debugging.
Start-Sleep -Seconds 5
$Socket = & $adb -s $Device shell cat /proc/net/unix |
    Select-String -Pattern 'webview_devtools_remote_\d+' |
    ForEach-Object { ($_.Line -split ' ')[-1] } |
    Select-Object -First 1

if ($Socket) {
    & $adb -s $Device forward tcp:9222 "localabstract:$($Socket.Substring(1))"
    Write-Host "[dev-loop] CDP forwarded to tcp:9222" -ForegroundColor Green
} else {
    Write-Warning "[dev-loop] WebView devtools socket not found, CDP forwarding skipped"
}

# Run optional test script.
if ($TestScript) {
    Start-Sleep -Seconds 3
    $TestPath = "$Root\scripts\$TestScript"
    if (Test-Path $TestPath) {
        Write-Host "[dev-loop] Running test: $TestScript"
        node $TestPath
    } else {
        Write-Warning "[dev-loop] Test script not found: $TestPath"
    }
}

# Take optional screenshot.
if ($Screenshot) {
    $ScreenshotName = "screen_$(Get-Date -Format 'yyyyMMdd_HHmmss').png"
    & $adb -s $Device shell screencap -p /data/local/tmp/screen.png
    & $adb -s $Device pull /data/local/tmp/screen.png "$Root\screenshots\$ScreenshotName"
    Write-Host "[dev-loop] Screenshot saved: screenshots\$ScreenshotName" -ForegroundColor Green
}

Write-Host "[dev-loop] Done." -ForegroundColor Green
