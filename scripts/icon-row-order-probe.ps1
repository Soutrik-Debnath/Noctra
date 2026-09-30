# Does CreateIcon place the first row of its XOR buffer at the TOP or the BOTTOM?
#
# taskbar.rs stores glyph rows top-down (BUG-054 removed an earlier pre-flip). The whole fix rests on
# that convention, and the comment in rasterize() is an assertion, not a measurement - so this probe
# measures it. It builds an icon whose buffer row 0-15 is RED and whose buffer row 48-63 is BLUE,
# renders it with DrawIconEx into a top-down DIB section, and reports which colour lands at the top.
#
#   top rows RED   -> buffer row 0 draws at the top  -> taskbar.rs is correct, heart is lobes-up
#   top rows BLUE  -> buffer row 0 draws at the bottom -> the glyph is inverted in the shell
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/icon-row-order-probe.ps1
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class IconProbe
{
    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr CreateIcon(IntPtr hInstance, int nWidth, int nHeight,
                                    byte cPlanes, byte cBitsPixel,
                                    byte[] lpbANDbits, byte[] lpbXORbits);

    [DllImport("user32.dll")]
    static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern int ReleaseDC(IntPtr hWnd, IntPtr hdc);

    [DllImport("gdi32.dll")]
    static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    static extern IntPtr SelectObject(IntPtr hdc, IntPtr h);

    [DllImport("gdi32.dll")]
    static extern bool DeleteObject(IntPtr h);

    [DllImport("gdi32.dll")]
    static extern IntPtr CreateDIBSection(IntPtr hdc, ref BITMAPINFO pbmi,
                                          uint usage, out IntPtr ppvBits,
                                          IntPtr hSection, uint offset);

    [DllImport("user32.dll")]
    static extern bool DrawIconEx(IntPtr hdc, int xLeft, int yTop, IntPtr hIcon,
                                  int cxWidth, int cyWidth, uint istepIfAniCur,
                                  IntPtr hbrFlickerFreeDraw, uint diFlags);

    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr hIcon);

    [StructLayout(LayoutKind.Sequential)]
    struct RGBQUAD { public byte blue, green, red, reserved; }

    [StructLayout(LayoutKind.Sequential)]
    struct BITMAPINFOHEADER
    {
        public uint biSize;
        public int biWidth, biHeight;
        public ushort biPlanes, biBitCount;
        public uint biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct BITMAPINFO
    {
        public BITMAPINFOHEADER bmiHeader;
        public RGBQUAD bmiColors;
    }

    const uint DI_NORMAL = 0x0003;

    public static string Run(int size)
    {
        int stride = size * 4;
        byte[] xor = new byte[size * stride];

        // Buffer rows 0..1/4 = red (BGRA 0,0,255,255); last 1/4 = blue (255,0,0,255).
        for (int row = 0; row < size; row++)
        {
            int band = size / 4;
            for (int col = 0; col < size; col++)
            {
                int i = row * stride + col * 4;
                if (row < band) { xor[i] = 0; xor[i + 1] = 0; xor[i + 2] = 255; xor[i + 3] = 255; }
                else if (row >= size - band) { xor[i] = 255; xor[i + 1] = 0; xor[i + 2] = 0; xor[i + 3] = 255; }
            }
        }

        int maskStride = ((size + 31) / 32) * 4;
        byte[] and = new byte[size * maskStride];   // all zero = fully opaque

        IntPtr hIcon = CreateIcon(IntPtr.Zero, size, size, 1, 32, and, xor);
        if (hIcon == IntPtr.Zero) return "CreateIcon failed: " + Marshal.GetLastWin32Error();

        IntPtr screen = GetDC(IntPtr.Zero);
        IntPtr mem = CreateCompatibleDC(screen);

        BITMAPINFO bmi = new BITMAPINFO();
        bmi.bmiHeader.biSize = (uint)Marshal.SizeOf(typeof(BITMAPINFOHEADER));
        bmi.bmiHeader.biWidth = size;
        bmi.bmiHeader.biHeight = -size;             // negative => top-down: bits[0] is the TOP row
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;

        IntPtr bits;
        IntPtr bmp = CreateDIBSection(mem, ref bmi, 0, out bits, IntPtr.Zero, 0);
        IntPtr old = SelectObject(mem, bmp);
        DrawIconEx(mem, 0, 0, hIcon, size, size, 0, IntPtr.Zero, DI_NORMAL);

        byte[] px = new byte[stride * size];
        Marshal.Copy(bits, px, 0, px.Length);

        int firstRed = -1, firstBlue = -1, lastRed = -1, lastBlue = -1;
        for (int row = 0; row < size; row++)
        {
            int i = row * stride + (size / 2) * 4;
            int b = px[i], r = px[i + 2];
            if (r > 128 && b < 128) { if (firstRed < 0) firstRed = row; lastRed = row; }
            if (b > 128 && r < 128) { if (firstBlue < 0) firstBlue = row; lastBlue = row; }
        }

        SelectObject(mem, old);
        DeleteObject(bmp); DeleteDC(mem); ReleaseDC(IntPtr.Zero, screen); DestroyIcon(hIcon);

        return "size=" + size +
               " | topmost RED row=" + firstRed + " bottommost RED row=" + lastRed +
               " | topmost BLUE row=" + firstBlue + " bottommost BLUE row=" + lastBlue +
               " | buffer row 0 renders at " + (firstRed == 0 ? "TOP (top-down confirmed)" :
                                          firstBlue == 0 ? "BOTTOM (icon is flipped)" : "neither (no band found)");
    }
}
'@

foreach ($s in 64, 32, 48) { [IconProbe]::Run($s) }
