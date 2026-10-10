# Build and release the DyCast Android APK.
# Requirements: Node.js, cargo, cargo-tauri, Android SDK/NDK.
# On Windows 10/11 you may need Developer Mode enabled for Tauri to create symlinks.

param(
    [string]$BuildMode = "release"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
Set-Location $Root

# Feishu sync configuration.
$FEISHU_FOLDER_TOKEN = "KUWzf6phnlApZSdAwBActyUrnke"
$FEISHU_ROBOT_WEBHOOK = "YOUR_ROBOT_WEBHOOK_URL"
$FEISHU_RECIPIENT_USER_ID = "ou_65c60acbc589026566c7f562b7bfeb37"

# Android signing configuration.
$KEYSTORE_FILE = "$Root\keystore\dycast-release-new.keystore"
$KEYSTORE_PASS = "dycast123"
$KEY_PASS = "dycast123"
$BUILD_TOOLS_DIR = "$env:LOCALAPPDATA\Android\Sdk\build-tools\37.0.0"
$ZIPALIGN = "$BUILD_TOOLS_DIR\zipalign.exe"
$APKSIGNER = "$BUILD_TOOLS_DIR\apksigner.bat"

# Read version from package.json.
$PackageJson = Get-Content -Raw -Path "$Root\package.json" | ConvertFrom-Json
$Version = $PackageJson.version
$ApkName = "dycast-android-v$Version-signed.apk"

Write-Host "[dycast-android] Building version $Version (mode: $BuildMode)" -ForegroundColor Green

# Install frontend dependencies.
Write-Host "[dycast-android] Installing frontend dependencies..."
npm install

# Build frontend.
Write-Host "[dycast-android] Building frontend..."
npm run build

# Build Android APK.
Write-Host "[dycast-android] Building Android APK..."
$env:CI = "true"
if ($BuildMode -eq "release") {
    cargo tauri android build --apk
} else {
    cargo tauri android build --apk --debug
}

# Locate the generated APK (Tauri places universal APKs under apk/universal/<mode>).
$ApkDir = "$Root\src-tauri\gen\android\app\build\outputs\apk"
$ApkFiles = Get-ChildItem -Path $ApkDir -Filter "*.apk" -Recurse | Where-Object {
    $_.FullName -like "*\$BuildMode\*.apk"
}
if (-not $ApkFiles) {
    throw "No APK file found under $ApkDir for mode $BuildMode"
}
$SourceApk = $ApkFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1

# Align and sign the APK.
Write-Host "[dycast-android] Aligning and signing APK..."
$OutputDir = "$Root\output"
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}
$AlignedApk = "$OutputDir\dycast-android-v$Version-aligned.apk"
$OutputApk = "$OutputDir\$ApkName"

& $ZIPALIGN -p -f 4 "$($SourceApk.FullName)" "$AlignedApk"
& $APKSIGNER sign --ks $KEYSTORE_FILE --ks-pass pass:$KEYSTORE_PASS --key-pass pass:$KEY_PASS --out $OutputApk $AlignedApk
& $APKSIGNER verify -v $OutputApk
Remove-Item $AlignedApk -Force -ErrorAction SilentlyContinue

Write-Host "[dycast-android] Signed APK: $OutputApk" -ForegroundColor Green

# Upload to Feishu Cloud Disk.
Write-Host "[dycast-android] Uploading to Feishu Cloud Disk..."
try {
    $UploadResult = lark-cli drive +upload --folder-token $FEISHU_FOLDER_TOKEN --file $OutputApk 2>$null
    Write-Host "[dycast-android] Feishu upload result: $UploadResult"
} catch {
    Write-Warning "[dycast-android] Feishu upload skipped or failed: $_"
}

# Send Feishu robot notification.
Write-Host "[dycast-android] Sending Feishu robot notification..."
try {
    $Body = @{
        msg_type = "text"
        content = @{
            text = "DyCast Android $Version build completed. APK: $ApkName"
        }
    } | ConvertTo-Json
    Invoke-RestMethod -Uri $FEISHU_ROBOT_WEBHOOK -Method POST -ContentType "application/json" -Body $Body
} catch {
    Write-Warning "[dycast-android] Feishu notification skipped or failed: $_"
}

Write-Host "[dycast-android] Done." -ForegroundColor Green
