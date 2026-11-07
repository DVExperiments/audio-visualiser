namespace AudioViz.Dsp;

/// <summary>Window functions and their gain constants.</summary>
public static class Windows
{
    /// <summary>
    /// Periodic (DFT-even) Hann: w[n] = 0.5 * (1 - cos(2*pi*n/N)), n = 0..N-1.
    /// Periodic rather than symmetric so that the window's DFT is exactly
    /// {N/2, -N/4, -N/4} at bins {0, +1, -1} — this makes the gain constants exact.
    /// </summary>
    public static double[] PeriodicHann(int n)
    {
        var w = new double[n];
        for (int i = 0; i < n; i++) w[i] = 0.5 * (1.0 - Math.Cos(2.0 * Math.PI * i / n));
        return w;
    }

    public static double Sum(double[] w) { double s = 0; foreach (var v in w) s += v; return s; }
    public static double SumSquares(double[] w) { double s = 0; foreach (var v in w) s += v * v; return s; }
}

/// <summary>
/// Windowed FFT of one real channel producing calibrated one-sided spectra.
///
/// With S1 = sum(w), S2 = sum(w^2) and k in 0..N/2 (N/2+1 bins):
///   Amplitude[k] = c_k * |X[k]| / S1         c_k = 2 for 0 &lt; k &lt; N/2, else 1
///       → a sinusoid of peak amplitude A centred on bin k reads Amplitude[k] = A.
///   Power[k]     = c_k * |X[k]|^2 / (N * S2)
///       → sum_k Power[k] estimates the mean square (RMS^2) of the signal, for any
///         FFT size. A sine of amplitude A sums (over its main lobe) to A^2/2.
///         White noise of variance s^2 sums to s^2 in expectation.
/// Band sums of Power[] are therefore comparable across FFT sizes and sample rates.
/// For Hann: S1 = N/2 (coherent gain 0.5), S2 = 3N/8 (power gain 0.375), ENBW = 1.5 bins.
/// </summary>
public sealed class SpectrumAnalyzer
{
    public int Size { get; }
    public int BinCount => Size / 2 + 1;
    public double SampleRate { get; }
    public double BinHz => SampleRate / Size;
    public double WindowSum { get; }
    public double WindowSumSquares { get; }

    private readonly Fft _fft;
    private readonly double[] _window;
    private readonly double[] _re, _im;

    public SpectrumAnalyzer(int size, double sampleRate)
    {
        if (sampleRate <= 0 || !double.IsFinite(sampleRate)) throw new ArgumentOutOfRangeException(nameof(sampleRate));
        Size = size;
        SampleRate = sampleRate;
        _fft = new Fft(size);
        _window = Windows.PeriodicHann(size);
        WindowSum = Windows.Sum(_window);
        WindowSumSquares = Windows.SumSquares(_window);
        _re = new double[size];
        _im = new double[size];
    }

    /// <summary>Frequency of bin k in Hz: f[k] = k * fs / N.</summary>
    public double BinFrequency(int k) => k * SampleRate / Size;

    /// <summary>
    /// Analyse exactly Size samples. Writes BinCount values into power and amplitude.
    /// </summary>
    public void Analyze(ReadOnlySpan<double> samples, Span<double> power, Span<double> amplitude)
    {
        if (samples.Length != Size) throw new ArgumentException("Need exactly Size samples.");
        if (power.Length < BinCount || amplitude.Length < BinCount) throw new ArgumentException("Output too small.");

        for (int i = 0; i < Size; i++) { _re[i] = samples[i] * _window[i]; _im[i] = 0.0; }
        _fft.Forward(_re, _im);

        double powerScale = 1.0 / (Size * WindowSumSquares);
        double ampScale = 1.0 / WindowSum;
        int nyq = Size / 2;
        for (int k = 0; k <= nyq; k++)
        {
            double mag2 = _re[k] * _re[k] + _im[k] * _im[k];
            double c = (k == 0 || k == nyq) ? 1.0 : 2.0;
            power[k] = c * mag2 * powerScale;
            amplitude[k] = c * Math.Sqrt(mag2) * ampScale;
        }
    }
}
