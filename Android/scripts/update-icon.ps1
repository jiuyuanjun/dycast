Add-Type -AssemblyName System.Drawing

$src = 'C:\Users\jiuyuanjun\Desktop\dycast-main\app-icon.png'
$resBase = 'C:\Users\jiuyuanjun\Desktop\dycast-main\Android\src-tauri\gen\android\app\src\main\res'

$sizes = @{
    'mipmap-mdpi'    = 48
    'mipmap-hdpi'    = 72
    'mipmap-xhdpi'   = 96
    'mipmap-xxhdpi'  = 144
    'mipmap-xxxhdpi' = 192
}

function Resize-Png($sourcePath, $destPath, $size) {
    $srcImg = [System.Drawing.Image]::FromFile($sourcePath)
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $bmp.SetResolution($srcImg.HorizontalResolution, $srcImg.VerticalResolution)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($srcImg, 0, 0, $size, $size)
    $g.Dispose()
    $bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $srcImg.Dispose()
}

function Round-Png($sourcePath, $destPath, $size) {
    $srcImg = [System.Drawing.Image]::FromFile($sourcePath)
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $bmp.SetResolution($srcImg.HorizontalResolution, $srcImg.VerticalResolution)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse(0, 0, $size, $size)
    $g.Clip = New-Object System.Drawing.Region($path)
    $g.DrawImage($srcImg, 0, 0, $size, $size)

    $g.Dispose()
    $bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $srcImg.Dispose()
}

foreach ($folder in $sizes.Keys) {
    $size = $sizes[$folder]
    $dir = Join-Path $resBase $folder
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force }
    Resize-Png $src (Join-Path $dir 'ic_launcher.png') $size
    Resize-Png $src (Join-Path $dir 'ic_launcher_foreground.png') $size
    Round-Png $src (Join-Path $dir 'ic_launcher_round.png') $size
    Write-Host "Generated $folder (${size}x${size})"
}

Write-Host 'Done.'
