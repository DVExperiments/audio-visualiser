using AudioViz.Dsp;

namespace AudioViz.Dsp.Tests;

public static class FftTests
{
    [Test]
    public static void MatchesDirectDft()
    {
        foreach (int n in new[] { 2, 8, 64, 1024 })
        {
            var rng = new Random(1234 + n);
            var re = new double[n]; var im = new double[n];
            for (int i = 0; i < n; i++) { re[i] = rng.NextDouble() * 2 - 1; im[i] = rng.NextDouble() * 2 - 1; }
            var xr = (double[])re.Clone(); var xi = (double[])im.Clone();
            new Fft(n).Forward(re, im);
            double maxErr = 0;
            for (int k = 0; k < n; k++)
            {
                double sr = 0, si = 0;
                for (int t = 0; t < n; t++)
                {
                    double a = -2 * Math.PI * (double)k * t / n;
                    sr += xr[t] * Math.Cos(a) - xi[t] * Math.Sin(a);
                    si += xr[t] * Math.Sin(a) + xi[t] * Math.Cos(a);
                }
                maxErr = Math.Max(maxErr, Math.Max(Math.Abs(sr - re[k]), Math.Abs(si - im[k])));
            }
            Assert.True(maxErr < 1e-9 * n, $"N={n}: FFT vs DFT max error {maxErr:G3}");
        }
    }

    [Test]
    public static void SatisfiesParseval()
    {
        int n = 4096;
        var rng = new Random(7);
        var re = new double[n]; var im = new double[n];
        double timeEnergy = 0;
        for (int i = 0; i < n; i++) { re[i] = rng.NextDouble() - 0.5; timeEnergy += re[i] * re[i]; }
        new Fft(n).Forward(re, im);
        double freqEnergy = 0;
        for (int k = 0; k < n; k++) freqEnergy += re[k] * re[k] + im[k] * im[k];
        Assert.Near(n * timeEnergy, freqEnergy, 1e-9 * n * timeEnergy, "sum|X|^2 = N*sum|x|^2");
    }

    [Test]
    public static void RejectsNonPowerOfTwo()
    {
        bool threw = false;
        try { _ = new Fft(1000); } catch (ArgumentException) { threw = true; }
        Assert.True(threw, "FFT size 1000 should be rejected");
    }
}

public static class WindowTests
{
    [Test]
    public static void PeriodicHannGainConstants()
    {
        foreach (int n in new[] { 512, 2048, 4096, 8192 })
        {
            var w = Windows.PeriodicHann(n);
            Assert.Near(0.0, w[0], 1e-15, "w[0]");
            Assert.Near(1.0, w[n / 2], 1e-15, "w[N/2] (periodic peak)");
            Assert.Near(n / 2.0, Windows.Sum(w), 1e-9, $"N={n} coherent sum S1 = N/2");
            Assert.Near(3.0 * n / 8.0, Windows.SumSquares(w), 1e-9, $"N={n} power sum S2 = 3N/8");
            double enbw = n * Windows.SumSquares(w) / Math.Pow(Windows.Sum(w), 2);
            Assert.Near(1.5, enbw, 1e-12, "ENBW (bins)");
        }
    }
}

public static class SpectrumScalingTests
{
    static double[] SineSamples(int n, double hz, double amp, double sr, double phase = 0.3)
        => Enumerable.Range(0, n).Select(i => amp * Math.Sin(2 * Math.PI * hz * i / sr + phase)).ToArray();

    [Test]
    public static void BinCentredSineAmplitudeAndPower()
    {
        double sr = 48000; int n = 2048;
        var sa = new SpectrumAnalyzer(n, sr);
        Assert.Near(23.4375, sa.BinHz, 1e-12, "bin spacing at 48 kHz / 2048");
        int k0 = 40; double hz = sa.BinFrequency(k0), amp = 0.5;
        var p = new double[sa.BinCount]; var a = new double[sa.BinCount];
        sa.Analyze(SineSamples(n, hz, amp, sr), p, a);
        Assert.Near(amp, a[k0], 1e-9, "amplitude at bin centre = A");
        Assert.Near(amp / 2, a[k0 - 1], 1e-9, "Hann neighbour bin = A/2");
        Assert.Near(amp * amp / 2, p.Sum(), 1e-9, "sum of one-sided power = A^2/2");
    }

    [Test]
    public static void OffBinSinePowerConservedAcrossFftSizes()
    {
        double sr = 48000, amp = 0.7, hz = 440;
        foreach (int n in new[] { 1024, 2048, 4096, 8192 })
        {
            var sa = new SpectrumAnalyzer(n, sr);
            var p = new double[sa.BinCount]; var a = new double[sa.BinCount];
            sa.Analyze(SineSamples(n, hz, amp, sr), p, a);
            Assert.Near(amp * amp / 2, p.Sum(), 0.01 * amp * amp / 2, $"N={n} total power");
            int argmax = Array.IndexOf(p, p.Max());
            Assert.Near(hz, sa.BinFrequency(argmax), sa.BinHz / 2 + 1e-9, $"N={n} peak bin frequency");
            // scalloping: Hann worst-case amplitude loss is 1.42 dB (factor 0.849)
            Assert.InRange(0.849 * amp, amp + 1e-9, a[argmax], $"N={n} peak amplitude within Hann scalloping");
        }
    }

    [Test]
    public static void WhiteNoisePowerIndependentOfFftSize()
    {
        double sr = 48000, sigma = 0.1;
        var rng = new Random(99);
        var x = new double[8192];
        for (int i = 0; i < x.Length; i++) { double u1 = 1 - rng.NextDouble(), u2 = rng.NextDouble(); x[i] = sigma * Math.Sqrt(-2 * Math.Log(u1)) * Math.Cos(2 * Math.PI * u2); }
        foreach (int n in new[] { 1024, 2048, 4096, 8192 })
        {
            var sa = new SpectrumAnalyzer(n, sr);
            var p = new double[sa.BinCount]; var a = new double[sa.BinCount];
            sa.Analyze(x.AsSpan(0, n), p, a);
            Assert.Near(sigma * sigma, p.Sum(), 0.08 * sigma * sigma, $"N={n} noise power ≈ variance");
            // Exact identity for real input (conjugate symmetry + Parseval):
            //   sum_k c_k |X[k]|^2 / (N*S2) == sum_n (x[n] w[n])^2 / S2
            var w = Windows.PeriodicHann(n);
            double direct = 0; for (int i = 0; i < n; i++) direct += x[i] * x[i] * w[i] * w[i];
            direct /= Windows.SumSquares(w);
            Assert.Near(direct, p.Sum(), 1e-10 * direct, $"N={n} one-sided scaling is exactly Parseval-consistent");
        }
    }

    [Test]
    public static void BandsPartitionTotalPower()
    {
        double sr = 48000; int n = 2048;
        var sa = new SpectrumAnalyzer(n, sr);
        var rng = new Random(5);
        var x = Enumerable.Range(0, n).Select(_ => rng.NextDouble() - 0.5).ToArray();
        var p = new double[sa.BinCount]; var a = new double[sa.BinCount];
        sa.Analyze(x, p, a);
        var edges = new[] { 0.0, 20, 60, 250, 500, 2000, 4000, 8000, 20000, 24000 };
        double sum = 0;
        for (int i = 0; i < edges.Length - 1; i++) sum += Bands.BandPower(p, sa.BinHz, edges[i], edges[i + 1]);
        Assert.Near(p.Sum(), sum, 1e-12 * p.Sum() + 1e-18, "contiguous bands sum to total power");
        // fractional overlap: half of bin 10 alone
        double half = Bands.BandPower(p, sa.BinHz, 10 * sa.BinHz, 10.5 * sa.BinHz);
        Assert.Near(p[10] / 2, half, 1e-15, "half-bin overlap weight");
    }

    [Test]
    public static void BandsCappedAtNyquist()
    {
        double sr = 16000;
        var sa = new SpectrumAnalyzer(1024, sr);
        // flat density in one-sided form: DC and Nyquist bins carry half (c_k = 1, not 2)
        var p = Enumerable.Repeat(1.0, sa.BinCount).ToArray(); p[0] = 0.5; p[^1] = 0.5;
        Assert.Near(0.0, Bands.BandPower(p, sa.BinHz, 8000, 20000), 0, "brilliance above Nyquist is empty");
        Assert.True(!Bands.IsAvailable(Bands.Standard[6], sr), "brilliance unavailable at 16 kHz");
        double presence = Bands.BandPower(p, sa.BinHz, 4000, 8000);
        Assert.Near((8000 - 4000) / sa.BinHz, presence, 1e-9, "presence integrates up to Nyquist only");
    }

    [Test]
    public static void LogEdgesAreGeometric()
    {
        var e = Bands.LogEdges(10, 20, 20000);
        Assert.Near(20, e[0], 1e-12, "first edge"); Assert.Near(20000, e[^1], 1e-9, "last edge");
        for (int i = 1; i < e.Length - 1; i++) Assert.Near(e[i] / e[i - 1], e[i + 1] / e[i], 1e-12, "constant ratio");
    }
}
