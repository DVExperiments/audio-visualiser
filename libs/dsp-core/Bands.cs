namespace AudioViz.Dsp;

public readonly record struct BandDefinition(string Name, double LowHz, double HighHz);

public static class Bands
{
    /// <summary>The seven named bands from the brief. Upper edges are capped at Nyquist at run time.</summary>
    public static readonly BandDefinition[] Standard =
    {
        new("subBass",    20,    60),
        new("bass",       60,   250),
        new("lowMid",    250,   500),
        new("mid",       500,  2000),
        new("upperMid", 2000,  4000),
        new("presence", 4000,  8000),
        new("brilliance", 8000, 20000),
    };

    /// <summary>
    /// Sum of calibrated one-sided power (mean-square units) between lowHz and highHz.
    ///
    /// Bin k is treated as covering [(k-0.5)*df, (k+0.5)*df] (clipped to [0, fs/2]); a bin that
    /// straddles a band edge contributes in proportion to its overlap. Because every bin is
    /// fully shared between adjacent bands, contiguous bands sum to the full-spectrum power.
    ///
    /// Caveat (documented in docs/DSP.md): this partitions bins, not signal energy. A Hann
    /// main lobe is 4 bins wide, so a tone within ~2 bins of an edge leaks into the neighbour.
    /// Returns 0 when the band lies entirely above Nyquist.
    /// </summary>
    public static double BandPower(ReadOnlySpan<double> power, double binHz, double lowHz, double highHz)
    {
        int nyqBin = power.Length - 1;
        double nyquist = nyqBin * binHz;
        double lo = Math.Max(0.0, lowHz);
        double hi = Math.Min(highHz, nyquist);
        if (hi <= lo) return 0.0;

        int kStart = Math.Max(0, (int)Math.Floor(lo / binHz + 0.5));
        int kEnd = Math.Min(nyqBin, (int)Math.Ceiling(hi / binHz - 0.5));
        double sum = 0.0;
        for (int k = kStart; k <= kEnd; k++)
        {
            double binLo = Math.Max(0.0, (k - 0.5) * binHz);
            double binHi = Math.Min(nyquist, (k + 0.5) * binHz);
            double width = binHi - binLo;
            if (width <= 0) continue;
            double overlap = Math.Min(hi, binHi) - Math.Max(lo, binLo);
            if (overlap <= 0) continue;
            sum += power[k] * (overlap / width);
        }
        return sum;
    }

    /// <summary>True if any part of the band lies below Nyquist.</summary>
    public static bool IsAvailable(BandDefinition b, double sampleRate) => b.LowHz < sampleRate / 2.0;

    /// <summary>
    /// count+1 logarithmically spaced edges from fMin to fMax: edge[i] = fMin * (fMax/fMin)^(i/count).
    /// </summary>
    public static double[] LogEdges(int count, double fMin, double fMax)
    {
        if (count < 1 || fMin <= 0 || fMax <= fMin) throw new ArgumentException("Invalid log band specification.");
        var e = new double[count + 1];
        double ratio = fMax / fMin;
        for (int i = 0; i <= count; i++) e[i] = fMin * Math.Pow(ratio, (double)i / count);
        return e;
    }

    /// <summary>10*log10(power) with a floor of -120 dB (power is mean-square relative to full scale^2).</summary>
    public static double PowerToDb(double p) => 10.0 * Math.Log10(Math.Max(p, 1e-12));

    /// <summary>20*log10(amplitude) with a floor of -120 dB.</summary>
    public static double AmplitudeToDb(double a) => 20.0 * Math.Log10(Math.Max(a, 1e-6));
}
