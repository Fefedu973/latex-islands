# SPDX-License-Identifier: GPL-3.0-or-later
# Rebuild the manifest PNGs from the monochrome geometry in icons/brand.svg.
# Run from Windows PowerShell or pwsh on Windows; no external dependency.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../icons'))
$background = [System.Drawing.Color]::FromArgb(255, 33, 33, 33)
$foreground = [System.Drawing.Color]::FromArgb(255, 236, 236, 236)

foreach ($size in @(16, 32, 48, 128)) {
    $canvasSize = $size * 4
    $canvas = [System.Drawing.Bitmap]::new($canvasSize, $canvasSize)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $tile = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $brush = [System.Drawing.SolidBrush]::new($background)
    $pen = [System.Drawing.Pen]::new($foreground, [single]($canvasSize * 0.76 / 12))
    $result = $null
    $resampler = $null
    try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $diameter = [single]($canvasSize * 14 / 32)
        $edge = [single]($canvasSize - $diameter)
        $tile.AddArc(0, 0, $diameter, $diameter, 180, 90)
        $tile.AddArc($edge, 0, $diameter, $diameter, 270, 90)
        $tile.AddArc($edge, $edge, $diameter, $diameter, 0, 90)
        $tile.AddArc(0, $edge, $diameter, $diameter, 90, 90)
        $tile.CloseFigure()
        $graphics.FillPath($brush, $tile)

        $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
        $scale = $canvasSize * 0.76 / 24
        $offset = $canvasSize * 0.12
        foreach ($segment in @(@(7, 5, 2, 12, 7, 19), @(17, 5, 22, 12, 17, 19), @(14, 3, 10, 21))) {
            $points = for ($index = 0; $index -lt $segment.Count; $index += 2) {
                [System.Drawing.PointF]::new([single]($offset + $segment[$index] * $scale), [single]($offset + $segment[$index + 1] * $scale))
            }
            $graphics.DrawLines($pen, [System.Drawing.PointF[]]$points)
        }

        $result = [System.Drawing.Bitmap]::new($size, $size)
        $resampler = [System.Drawing.Graphics]::FromImage($result)
        $resampler.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $resampler.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $resampler.DrawImage($canvas, 0, 0, $size, $size)
        $result.Save((Join-Path $iconDirectory "$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Output "Generated icons/$size.png"
    } finally {
        if ($resampler) { $resampler.Dispose() }
        if ($result) { $result.Dispose() }
        $pen.Dispose()
        $brush.Dispose()
        $tile.Dispose()
        $graphics.Dispose()
        $canvas.Dispose()
    }
}
