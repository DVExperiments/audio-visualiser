namespace AudioViz.Dsp;

/// <summary>
/// In-place iterative radix-2 decimation-in-time complex FFT, double precision.
/// Computes X[k] = sum_{n=0}^{N-1} x[n] * exp(-j*2*pi*k*n/N) (no 1/N scaling).
///
/// Why not Math.NET Numerics? This is ~80 lines, has no dependencies, allocates nothing
/// per call, and is verified in the test suite against a direct O(N^2) DFT and Parseval's
/// theorem. Swapping in another FFT later only requires matching this sign/scaling convention.
/// </summary>
public sealed class Fft
{
    public int Size { get; }
    private readonly int _log2;
    private readonly int[] _bitReverse;
    private readonly double[] _cos;
    private readonly double[] _sin;

    public Fft(int size)
    {
        if (size < 2 || (size & (size - 1)) != 0)
            throw new ArgumentException("FFT size must be a power of two >= 2.", nameof(size));
        Size = size;
        _log2 = System.Numerics.BitOperations.Log2((uint)size);

        _bitReverse = new int[size];
        for (int i = 0; i < size; i++)
        {
            int r = 0, v = i;
            for (int b = 0; b < _log2; b++) { r = (r << 1) | (v & 1); v >>= 1; }
            _bitReverse[i] = r;
        }

        // Twiddles W_N^k = exp(-j*2*pi*k/N), k = 0..N/2-1, computed directly (not recursively) for accuracy.
        _cos = new double[size / 2];
        _sin = new double[size / 2];
        for (int k = 0; k < size / 2; k++)
        {
            double a = -2.0 * Math.PI * k / size;
            _cos[k] = Math.Cos(a);
            _sin[k] = Math.Sin(a);
        }
    }

    /// <summary>Forward transform in place. re/im must have length Size.</summary>
    public void Forward(double[] re, double[] im)
    {
        if (re.Length != Size || im.Length != Size)
            throw new ArgumentException("Buffer length must equal FFT size.");

        for (int i = 0; i < Size; i++)
        {
            int j = _bitReverse[i];
            if (j > i)
            {
                (re[i], re[j]) = (re[j], re[i]);
                (im[i], im[j]) = (im[j], im[i]);
            }
        }

        for (int len = 2; len <= Size; len <<= 1)
        {
            int half = len >> 1;
            int step = Size / len;
            for (int start = 0; start < Size; start += len)
            {
                for (int k = 0; k < half; k++)
                {
                    double wr = _cos[k * step], wi = _sin[k * step];
                    int a = start + k, b = a + half;
                    double tr = wr * re[b] - wi * im[b];
                    double ti = wr * im[b] + wi * re[b];
                    re[b] = re[a] - tr; im[b] = im[a] - ti;
                    re[a] += tr; im[a] += ti;
                }
            }
        }
    }
}
