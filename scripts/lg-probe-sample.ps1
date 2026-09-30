# Turn scripts/lg-probe.png into numbers.
#
# Eyeballing six swatches is how "looks red enough" replaced measurement in earlier passes. This
# samples the mean channel values inside each swatch's rectangle and reports whether the constant-red
# feColorMatrix actually reached the backdrop.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/lg-probe-sample.ps1
Add-Type -AssemblyName System.Drawing

$png = "scripts\lg-probe.png"
# Page-space rectangles reported by lg-probe.mjs, minus the strip origin (618, 421) = image space.
$cells = @(
    @{ n = "P1 url() alone";            x = 2;   y = 2 },
    @{ n = "P2 blur()+url()";           x = 118; y = 2 },
    @{ n = "P3 ancestor transform";     x = 234; y = 2 },
    @{ n = "P4 ancestor filter";        x = 350; y = 2 },
    @{ n = "P5 url() under a mask";     x = 466; y = 2 },
    @{ n = "P6 control (no backdrop)";  x = 582; y = 2 }
)
$w = 100; $h = 100

$bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $png))
foreach ($c in $cells) {
    $rSum = 0.0; $gSum = 0.0; $bSum = 0.0; $n = 0
    for ($y = 4; $y -lt ($h - 4); $y += 2) {
        for ($x = 4; $x -lt ($w - 4); $x += 2) {
            $p = $bmp.GetPixel(($c.x + $x), ($c.y + $y))
            $rSum += $p.R; $gSum += $p.G; $bSum += $p.B; $n++
        }
    }
    $r = [math]::Round($rSum / $n); $g = [math]::Round($gSum / $n); $b = [math]::Round($bSum / $n)
    # The probe filter outputs (255,0,0) wherever it is applied, so a red-dominant mean is proof.
    $applied = ($r -gt 200) -and ($g -lt 40) -and ($b -lt 40)
    "{0,-26} R={1,3} G={2,3} B={3,3}  -> {4}" -f $c.n, $r, $g, $b, $(if ($applied) { "FILTER APPLIED" } else { "not applied" })

    # P5 is *expected* to average out: its mask fades the effect away down the swatch, so a single
    # mean cannot tell "mask works" from "mask killed it". Sample the two halves and compare.
    if ($c.n -like "P5*") {
        foreach ($half in @( @{ t = "top (masked in)";  y0 = 4; y1 = 46 }, @{ t = "bottom (masked out)"; y0 = 54; y1 = 96 } )) {
            $rr = 0.0; $gg = 0.0; $bb = 0.0; $m = 0
            for ($y = $half.y0; $y -lt $half.y1; $y += 2) {
                for ($x = 4; $x -lt ($w - 4); $x += 2) {
                    $p = $bmp.GetPixel(($c.x + $x), ($c.y + $y))
                    $rr += $p.R; $gg += $p.G; $bb += $p.B; $m++
                }
            }
            "    {0,-20} R={1,3} G={2,3} B={3,3}" -f $half.t, [math]::Round($rr/$m), [math]::Round($gg/$m), [math]::Round($bb/$m)
        }
    }
}
$bmp.Dispose()
