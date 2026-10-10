# DyCast Android 一键发版：
#   版本号自动 bump → 前端+APK 构建 → 签名 → Gitee Release（只留最新）→ 飞书上传（只留最新）
# 用法：
#   .\scripts\release.ps1 -Notes "修复xxx"              # 版本号自动 patch+1
#   .\scripts\release.ps1 -Version 1.2.0 -Notes "xxx"   # 指定版本号
param(
    [string]$Version = "",
    [string]$Notes = "",
    [string]$GiteeRepo = "jiuyuanjun/dycast",
    [string]$FeishuFolderToken = "KUWzf6phnlApZSdAwBActyUrnke"
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
Set-Location $Root

$zipalign = "$env:LOCALAPPDATA\Android\Sdk\build-tools\37.0.0\zipalign.exe"
$apksigner = "$env:LOCALAPPDATA\Android\Sdk\build-tools\37.0.0\apksigner.bat"

$Pkg = Get-Content -Raw -Path "$Root\package.json" | ConvertFrom-Json
$Current = $Pkg.version
if (-not $Version) {
    $parts = $Current.Split('.')
    $parts[2] = [string]([int]$parts[2] + 1)
    $Version = $parts -join '.'
}
if (-not $Notes) { $Notes = "DyCast Android v$Version" }

Write-Host "[release] $Current -> v$Version" -ForegroundColor Green

# 1. 版本号同步（package.json / tauri.conf.json version+versionCode / Cargo.toml / tauri.properties）
$ConfPath = "$Root\src-tauri\tauri.conf.json"
$Conf = Get-Content -Raw $ConfPath | ConvertFrom-Json
$NewVersionCode = [int]$Conf.bundle.android.versionCode + 1
(Get-Content -Raw "$Root\package.json") -replace "`"$Current`"", "`"$Version`"" | Set-Content "$Root\package.json" -Encoding utf8NoBOM
(Get-Content -Raw $ConfPath) -replace "`"version`": `"$Current`"", "`"version`": `"$Version`"" -replace "`"versionCode`": $($Conf.bundle.android.versionCode)", "`"versionCode`": $NewVersionCode" | Set-Content $ConfPath -Encoding utf8NoBOM
(Get-Content -Raw "$Root\src-tauri\Cargo.toml") -replace "version = `"$Current`"", "version = `"$Version`"" | Set-Content "$Root\src-tauri\Cargo.toml" -Encoding utf8NoBOM
$PropsPath = "$Root\src-tauri\gen\android\app\tauri.properties"
(Get-Content -Raw $PropsPath) -replace "versionName=$Current", "versionName=$Version" -replace "versionCode=\d+", "versionCode=$NewVersionCode" | Set-Content $PropsPath -Encoding utf8NoBOM
Write-Host "[release] 版本号已同步: v$Version / versionCode $NewVersionCode"

# 2. 构建
Write-Host "[release] 构建前端..."
npm run build
if ($LASTEXITCODE -ne 0) { throw "前端构建失败" }
Write-Host "[release] 构建 APK（universal）..."
$env:CI = "true"
cargo tauri android build --apk
if ($LASTEXITCODE -ne 0) { throw "APK 构建失败" }

# 3. 签名
$ApkDir = "$Root\src-tauri\gen\android\app\build\outputs\apk"
$SourceApk = Get-ChildItem -Path $ApkDir -Filter "*.apk" -Recurse | Where-Object { $_.FullName -like "*\release\*" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $SourceApk) { throw "未找到构建产物 APK" }
$OutputDir = "$Root\output"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$AlignedApk = "$OutputDir\dycast-android-v$Version-aligned.apk"
$SignedApk = "$OutputDir\dycast-android-v$Version-signed.apk"
& $zipalign -p -f 4 "$($SourceApk.FullName)" "$AlignedApk"
& $apksigner sign --ks "$Root\keystore\dycast-release-new.keystore" --ks-pass pass:dycast123 --key-pass pass:dycast123 --out $SignedApk $AlignedApk
& $apksigner verify $SignedApk
Remove-Item $AlignedApk -Force -ErrorAction SilentlyContinue
Write-Host "[release] 已签名: $SignedApk"

# 4. Gitee Release（只留最新）
$TokenFile = "$Root\scripts\gitee-token.txt"
$GiteeToken = (Get-Content $TokenFile -Raw).Trim()
$Headers = @{ "Content-Type" = "application/json" }
# 4.1 空仓库兜底：确保有提交（首次发版时创建 README）
try {
    $repo = Invoke-RestMethod -Method Get -Uri "https://gitee.com/api/v5/repos/$GiteeRepo?access_token=$GiteeToken"
    if (-not $repo.default_branch) {
        $readme = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("# DyCast Android Release`n`n抖音弹幕助手 Android 版本发布仓库。"))
        Invoke-RestMethod -Method Post -Uri "https://gitee.com/api/v5/repos/$GiteeRepo/contents/README.md" -Headers $Headers -Body (@{ access_token = $GiteeToken; content = $readme; message = "init" } | ConvertTo-Json) | Out-Null
        Start-Sleep -Seconds 2
    }
} catch { Write-Host "[release] 仓库检查跳过: $_" }
# 4.2 创建 Release
$Body = @{ access_token = $GiteeToken; tag_name = "v$Version"; name = "v$Version"; body = $Notes; target_commitish = "master"; prerelease = $false } | ConvertTo-Json
$Release = Invoke-RestMethod -Method Post -Uri "https://gitee.com/api/v5/repos/$GiteeRepo/releases" -Headers $Headers -Body $Body
Write-Host "[release] Gitee Release 已创建 id=$($Release.id) tag=v$Version"
# 4.3 上传 APK 附件（Gitee 要求 multipart/form-data，用 curl.exe）
$UploadUri = "https://gitee.com/api/v5/repos/$GiteeRepo/releases/$($Release.id)/attach_files?access_token=$GiteeToken"
curl.exe -s -X POST $UploadUri -F "file=@$SignedApk;type=application/octet-stream" | Out-Null
Write-Host "[release] Gitee APK 已上传"
# 4.4 删除旧 Release（保留刚创建的）
try {
    $Releases = Invoke-RestMethod -Method Get -Uri "https://gitee.com/api/v5/repos/$GiteeRepo/releases?access_token=$GiteeToken&per_page=100"
    foreach ($r in $Releases) {
        if ($r.id -ne $Release.id) {
            Invoke-RestMethod -Method Delete -Uri "https://gitee.com/api/v5/repos/$GiteeRepo/releases/$($r.id)?access_token=$GiteeToken" | Out-Null
            Write-Host "[release] 已删除旧 Release: $($r.tag_name)"
        }
    }
} catch { Write-Host "[release] 旧 Release 清理跳过: $_" }

# 5. 飞书上传（只留最新）
Write-Host "[release] 上传飞书..."
Push-Location $OutputDir
try {
    $UploadOut = lark-cli drive +upload --file "./dycast-android-v$Version-signed.apk" --folder-token $FeishuFolderToken 2>&1 | Out-String
    if ($UploadOut -notmatch '"ok": true') { throw "飞书上传失败: $UploadOut" }
    $UploadJson = ($UploadOut | ConvertFrom-Json)
    $NewFileToken = $UploadJson.data.file_token
    Write-Host "[release] 飞书已上传 token=$NewFileToken"
    $ListJson = (lark-cli drive files list --folder-token $FeishuFolderToken 2>&1 | Out-String | ConvertFrom-Json)
    # 飞书保留策略：最新版本 + 至多 1 个历史回滚版本（共至多 2 版），其余删除
    $OldFiles = @()
    foreach ($f in $ListJson.data.files) {
        if ($f.token -eq $NewFileToken) { continue }
        if ($f.name -match 'v(\d+\.\d+\.\d+)') {
            $OldFiles += [pscustomobject]@{ token = $f.token; name = $f.name; ver = [version]::Parse($Matches[0].TrimStart('v')) }
        } else {
            Write-Host "[release] 跳过非版本命名文件（不删除）: $($f.name)" -ForegroundColor Yellow
        }
    }
    $Idx = 0
    foreach ($f in ($OldFiles | Sort-Object ver -Descending)) {
        $Idx++
        if ($Idx -eq 1) {
            Write-Host "[release] 保留回滚版本: $($f.name)"
        } else {
            lark-cli drive +delete --file-token $f.token --type file --yes | Out-Null
            Write-Host "[release] 已删除飞书旧版本: $($f.name)"
        }
    }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "=== 发版完成 ===" -ForegroundColor Green
Write-Host "版本: v$Version (versionCode $NewVersionCode)"
Write-Host "APK: $SignedApk"
Write-Host "Gitee: https://gitee.com/$GiteeRepo/releases/latest"
Write-Host "更新说明: $Notes"
