using AudioViz.Dsp;

namespace AudioViz.Dsp.Tests;

public static class FeatureTests
{
    const int SubBass = 0, Bass = 1, LowMid = 2, Mid = 3, UpperMid = 4, Presence = 5, Brilliance = 6;
    static double Db(double p) => 10 * Math.Log10(p);

    static FeatureExtractor Fx(double sr = 48000, int lowFft = 4096) => new(new AnalysisConfig { SampleRate = sr, LowFftSize = lowFft });

    [Test]
    public static void FrameRateAndTimestamps()
    {
        var fx = Fx();
        Assert.Near(93.75, fx.FrameRate, 1e-12, "frames/s at 48 kHz, hop 512");
        var frames = Signals.Run(fx, Signals.Silence(48000, 1.0), blockFrames: 441); // odd block size on purpose
        Assert.True(frames.Count == 48000 / 512, $"frame count {frames.Count}");
        for (int i = 1; i < frames.Count; i++)
            Assert.Near(512 * 1000.0 / 48000, frames[i].TimeMs - frames[i - 1].TimeMs, 1e-9, "frame spacing ms");
        Assert.Near(511 * 1000.0 / 48000, frames[0].TimeMs, 1e-9, "first frame stamped at its last sample");
    }

    [Test]
    public static void Silence()
    {
        var fx = Fx();
        var frames = Signals.Run(fx, Signals.Silence(48000, 2));
        foreach (var f in frames)
        {
            Assert.AllFinite(f);
            Assert.True(f.Silent, "silence flagged");
            Assert.True(!f.Onset.IsOnset, "no onsets in silence");
            Assert.Near(-120, f.Dbfs, 1e-9, "dBFS floor");
            Assert.Near(0, f.CentroidHz, 0, "centroid undefined → 0");
            foreach (var b in f.BandDb) Assert.Near(-120, b, 1e-9, "band floor");
            foreach (var b in f.BandNorm) Assert.Near(0, b, 1e-12, "normalised silence is 0");
        }
    }

    [Test]
    public static void Sine100Hz()
    {
        double a = 0.5;
        var fx = Fx();
        var frames = Signals.Settled(fx, Signals.Run(fx, Signals.Sine(100, a, 48000, 2))).ToList();
        foreach (var f in frames)
        {
            Assert.AllFinite(f);
            // RMS over N samples holding a non-integer number of cycles ripples. Mean-square relative
            // error is bounded by 1/(N*|sin w|), w = 2*pi*f/fs → 3.73% here, i.e. ≈1.9% in RMS.
            double w = 2 * Math.PI * 100 / 48000, msBound = 1.0 / (2048 * Math.Abs(Math.Sin(w)));
            Assert.InRange(a / Math.Sqrt(2) * Math.Sqrt(1 - msBound), a / Math.Sqrt(2) * Math.Sqrt(1 + msBound), f.Rms, "RMS = A/sqrt2 within finite-window ripple bound");
            Assert.Near(Db(a * a / 2), f.BandDb[Bass], 0.05, "bass band power = A^2/2");
            Assert.True(f.BandDb[SubBass] < f.BandDb[Bass] - 40, $"sub-bass leakage {f.BandDb[SubBass] - f.BandDb[Bass]:F1} dB");
            Assert.True(f.BandDb[LowMid] < f.BandDb[Bass] - 40, "low-mid leakage < -40 dB");
        }
    }

    [Test]
    public static void Sine440Hz()
    {
        double a = 0.5, sr = 48000;
        var fx = Fx();
        var frames = Signals.Settled(fx, Signals.Run(fx, Signals.Sine(440, a, sr, 2))).ToList();
        foreach (var f in frames)
        {
            Assert.AllFinite(f);
            Assert.Near(Db(a * a / 2), f.BandDb[LowMid], 0.05, "low-mid band power");
            Assert.Near(440, f.CentroidHz, 5, "spectral centroid");
            Assert.Near(2 * 440 / sr, f.Zcr, 0.02 * 2 * 440 / sr, "ZCR = 2f/fs crossings/sample");
            Assert.InRange(0, 0.01, f.Flatness, "tonal flatness");
            Assert.InRange(400, 500, f.RolloffHz, "85% rolloff");
            Assert.Near(0, f.Balance, 1e-9, "balance"); Assert.Near(1, f.Correlation, 1e-9, "correlation");
            Assert.Near(0, f.Width, 1e-9, "width");
            Assert.Near(a, f.PeakL, 0.01, "sample peak");
        }
        // log-spectrum: the band containing 440 Hz is the maximum
        var last = frames[^1];
        int argmax = Array.IndexOf(last.SpectrumDb, last.SpectrumDb.Max());
        Assert.True(fx.LogBandEdges[argmax] <= 440 && 440 < fx.LogBandEdges[argmax + 1] * 1.02, $"log band {argmax} [{fx.LogBandEdges[argmax]:F0}, {fx.LogBandEdges[argmax + 1]:F0}] Hz");
    }

    [Test]
    public static void Sine1000HzAtSeveralSampleRates()
    {
        double a = 0.25;
        foreach (double sr in new[] { 44100.0, 48000.0, 88200.0, 96000.0 })
        {
            var fx = Fx(sr);
            var frames = Signals.Settled(fx, Signals.Run(fx, Signals.Sine(1000, a, sr, 1))).ToList();
            Assert.Near(sr / 512, fx.FrameRate, 1e-9, $"{sr}: frame rate");
            foreach (var f in frames)
            {
                Assert.AllFinite(f);
                Assert.Near(Db(a * a / 2), f.BandDb[Mid], 0.05, $"{sr}: mid band power");
                Assert.Near(1000, f.CentroidHz, 10, $"{sr}: centroid");
                Assert.Near(2000 / sr, f.Zcr, 0.02 * 2000 / sr, $"{sr}: ZCR");
                Assert.Near(Db(a * a / 2), f.Dbfs, 0.05, $"{sr}: dBFS = 20log10(A/sqrt2) = 10log10(A^2/2)");
            }
        }
    }

    [Test]
    public static void FullScaleSineReadsMinus3Dbfs()
    {
        var fx = Fx();
        var f = Signals.Run(fx, Signals.Sine(1000, 1.0, 48000, 0.5))[^1];
        Assert.Near(20 * Math.Log10(Math.Sqrt(0.5)), f.Dbfs, 0.01, "full-scale sine RMS dBFS (-3.01)");
    }

    [Test]
    public static void WhiteNoise()
    {
        double sigma = 0.1, sr = 48000;
        var fx = Fx();
        var frames = Signals.Settled(fx, Signals.Run(fx, Signals.WhiteNoise(sigma, sr, 10, seed: 42))).ToList();
        double meanFlat = frames.Average(f => f.Flatness);
        double meanCentroid = frames.Average(f => f.CentroidHz);
        double meanRolloff = frames.Average(f => f.RolloffHz);
        double totalBand = frames.Average(f => f.BandDb.Sum(db => Math.Pow(10, db / 10)));
        int onsets = frames.Count(f => f.Onset.IsOnset);
        Runner.Note($"noise: flatness {meanFlat:F3} (theory for 2 independent channels e^(1-γ)/2 = 0.763), centroid {meanCentroid:F0} Hz, rolloff {meanRolloff:F0} Hz, false onsets {onsets} in 10 s");
        foreach (var f in frames) Assert.AllFinite(f);
        // Per-bin power of white noise is exponential: E[ln P] = ln E[P] - γ  → flatness e^-γ = 0.5615 for one channel.
        // We average two independent channels' powers → Gamma(2): E[ln P] = ln E[P] + ψ(2) - ln 2 → e^(1-γ)/2 = 0.7629.
        Assert.Near(Math.Exp(1 - 0.5772156649) / 2, meanFlat, 0.02, "independent-stereo noise flatness");
        Assert.Near((20 + 20000) / 2.0, meanCentroid, 500, "centroid ≈ midpoint of 20 Hz–20 kHz");
        Assert.Near(20 + 0.85 * 19980, meanRolloff, 300, "85% rolloff");
        // bands cover 20–20000 of 0–24000 Hz → expect sigma^2 * 19980/24000
        Assert.Near(sigma * sigma * 19980 / 24000, totalBand, 0.03 * sigma * sigma, "band powers sum to in-band variance");
        Assert.True(onsets <= 10, $"steady noise must not produce excessive onsets (got {onsets} in 10 s)");
    }

    [Test]
    public static void MonoWhiteNoiseFlatness()
    {
        var fx = Fx();
        var stereo = Signals.WhiteNoise(0.1, 48000, 5, seed: 11);
        for (int i = 0; i < stereo.Length; i += 2) stereo[i + 1] = stereo[i]; // L == R
        double flat = Signals.Settled(fx, Signals.Run(fx, stereo)).Average(f => f.Flatness);
        Runner.Note($"mono noise flatness {flat:F3} (theory e^-γ = 0.561)");
        Assert.Near(Math.Exp(-0.5772156649), flat, 0.02, "mono white-noise flatness = e^-γ");
    }

    [Test]
    public static void ImpulseTrainOnsets()
    {
        double sr = 48000;
        var fx = Fx();
        var sig = Signals.Impulses(0.9, sr, 5.0, firstAt: 0.25, interval: 0.5); // 10 impulses
        var frames = Signals.Run(fx, sig);
        var onsets = frames.Where(f => f.Onset.IsOnset).ToList();
        Runner.Note($"impulses: {onsets.Count} onsets at " + string.Join(", ", onsets.Select(o => $"{o.TimeMs:F0}")) + " ms");
        Assert.True(onsets.Count == 10, $"expected 10 onsets, got {onsets.Count}");
        for (int i = 0; i < onsets.Count; i++)
        {
            double impulseMs = (0.25 + 0.5 * i) * 1000;
            // detection happens once the impulse is in the window, plus one frame of peak-picking lag
            Assert.InRange(impulseMs, impulseMs + (2048 + 2 * 512) * 1000 / sr, onsets[i].TimeMs, $"onset {i} timing");
            Assert.InRange(0, 1, onsets[i].Onset.Confidence, "confidence range");
        }
        foreach (var f in frames) Assert.AllFinite(f);
    }

    [Test]
    public static void SteadySineHasNoRepeatedOnsets()
    {
        var fx = Fx();
        var frames = Signals.Run(fx, Signals.Sine(440, 0.5, 48000, 10));
        int n = frames.Count(f => f.Onset.IsOnset);
        Assert.True(n <= 1, $"steady tone produced {n} onsets (≤1 allowed for the start)");
    }

    [Test]
    public static void LeftOnlyStereo()
    {
        double a = 0.5;
        var fx = Fx();
        var sig = Signals.Stereo(48000, i => (a * Math.Sin(2 * Math.PI * 440 * i / 48000), 0));
        foreach (var f in Signals.Settled(fx, Signals.Run(fx, sig)))
        {
            Assert.AllFinite(f);
            Assert.Near(-1, f.Balance, 1e-9, "balance −1 (left)");
            Assert.Near(0, f.Correlation, 0, "correlation undefined with silent R → 0");
            Assert.Near(0.5, f.Width, 1e-9, "one-sided width 0.5");
            Assert.Near(-120, f.DbfsR, 1e-9, "right channel silent");
            Assert.Near(Db(a * a / 4), f.BandDb[LowMid], 0.05, "channel-mean power = (A^2/2)/2");
        }
    }

    [Test]
    public static void OppositePhaseStereoIsNotCancelled()
    {
        double a = 0.5;
        var fx = Fx();
        var sig = Signals.Stereo(48000, i => { double v = a * Math.Sin(2 * Math.PI * 440 * i / 48000); return (v, -v); });
        double naiveMonoSum = 0;
        for (int i = 0; i < sig.Length; i += 2) naiveMonoSum += Math.Abs(0.5 * (sig[i] + sig[i + 1]));
        Assert.Near(0, naiveMonoSum, 1e-9, "(L+R)/2 would cancel completely");
        foreach (var f in Signals.Settled(fx, Signals.Run(fx, sig)))
        {
            Assert.Near(-1, f.Correlation, 1e-9, "correlation −1");
            Assert.Near(1, f.Width, 1e-9, "width 1 (all side)");
            Assert.Near(Db(a * a / 2), f.BandDb[LowMid], 0.05, "band power preserved");
            Assert.True(!f.Silent, "antiphase is not silence");
        }
    }

    [Test]
    public static void MultiresolutionImprovesLowBandSeparation()
    {
        // 40 Hz (sub-bass) + 120 Hz (bass), equal amplitude. Each band should hold A^2/2.
        double a = 0.3, sr = 48000, expected = Db(a * a / 2);
        var sig = Signals.Stereo((int)sr, i => { double v = a * Math.Sin(2 * Math.PI * 40 * i / sr) + a * Math.Sin(2 * Math.PI * 120 * i / sr); return (v, v); });
        double Err(int lowFft)
        {
            var fx = Fx(sr, lowFft);
            var f = Signals.Run(fx, sig)[^1];
            return Math.Max(Math.Abs(f.BandDb[SubBass] - expected), Math.Abs(f.BandDb[Bass] - expected));
        }
        double single = Err(0), multi = Err(4096);
        Runner.Note($"40+120 Hz band error: 2048-only {single:F2} dB, with 4096 low FFT {multi:F2} dB");
        Assert.True(multi < 0.1, $"multiresolution low-band error {multi:F3} dB");
        Assert.True(multi < single, "multiresolution must beat single resolution");
    }

    [Test]
    public static void LowSampleRateNyquistCap()
    {
        var fx = new FeatureExtractor(new AnalysisConfig { SampleRate = 16000, LogMaxHz = 20000 });
        Assert.True(!fx.BandAvailable[Brilliance], "brilliance unavailable at 16 kHz");
        Assert.Near(8000, fx.LogBandEdges[^1], 1e-9, "log bands capped at Nyquist");
        foreach (var f in Signals.Run(fx, Signals.WhiteNoise(0.1, 16000, 1, 3))) Assert.AllFinite(f);
    }

    [Test]
    public static void ClippingAndNonFiniteInput()
    {
        var fx = Fx();
        var sig = Signals.Sine(440, 1.2, 48000, 0.5);
        sig[1000] = float.NaN; sig[2001] = float.PositiveInfinity; sig[3000] = float.NegativeInfinity;
        var frames = Signals.Run(fx, sig);
        Assert.True(frames.Any(f => f.Clipped), "over-range input flagged as clipped");
        Assert.True(frames.Sum(f => f.NonFiniteSamples) == 3, "non-finite samples counted");
        foreach (var f in frames) Assert.AllFinite(f);
    }

    [Test]
    public static void LoudnessChangeMovesNormalisedBand()
    {
        var fx = Fx();
        var quiet = Signals.Run(fx, Signals.Sine(100, 0.05, 48000, 3));
        var loud = Signals.Run(fx, Signals.Sine(100, 0.5, 48000, 0.2));
        Assert.True(loud[^1].BandNorm[Bass] > quiet[^1].BandNorm[Bass] - 1e-9, "louder → higher or equal normalised bass");
        Assert.Near(1.0, loud[^1].BandNorm[Bass], 1e-6, "new peak hits ceiling");
        Assert.True(quiet[^1].BandNorm[Bass] > 0.5, "adapted quiet signal still uses the range");
    }
}

public static class NormalisationTests
{
    [Test]
    public static void LeakageIsNotStretchedToFullScale()
    {
        // pure 440 Hz: low-mid dominant; the mid band holds only Hann leakage ~40 dB down
        var fx = new FeatureExtractor(new AnalysisConfig());
        var last = Signals.Run(fx, Signals.Sine(440, 0.5, 48000, 2))[^1];
        Runner.Note($"440 Hz: lowMid {last.BandDb[2]:F1} dB → {last.BandNorm[2]:F2}, mid {last.BandDb[3]:F1} dB → {last.BandNorm[3]:F2}");
        Assert.Near(1.0, last.BandNorm[2], 0.01, "dominant band at full scale");
        Assert.True(last.BandNorm[3] < 0.4, $"leakage band normalised to {last.BandNorm[3]:F2}");
    }

    [Test]
    public static void QuieterRealBandStillUsesRange()
    {
        // two tones 12 dB apart: the quieter one should still read clearly
        var fx = new FeatureExtractor(new AnalysisConfig());
        var sig = Signals.Stereo(96000, i => { double v = 0.5 * Math.Sin(2 * Math.PI * 100 * i / 48000) + 0.125 * Math.Sin(2 * Math.PI * 1000 * i / 48000); return (v, v); });
        var last = Signals.Run(fx, sig)[^1];
        Runner.Note($"bass {last.BandNorm[1]:F2}, mid (−12 dB) {last.BandNorm[3]:F2}");
        Assert.True(last.BandNorm[3] > 0.55, "a real band 12 dB down stays well visible");
    }
}

public static class DynamicsTests
{
    [Test]
    public static void AttackReleaseTimeConstantIsDtIndependent()
    {
        foreach (double dt in new[] { 1.0 / 1000, 1.0 / 93.75, 1.0 / 60, 0.05 })
        {
            var s = new AttackReleaseSmoother(0.1, 0.5);
            int steps = (int)Math.Round(0.1 / dt);
            double t = 0;
            for (int i = 0; i < steps; i++) { s.Update(1.0, dt); t += dt; }
            Assert.Near(1 - Math.Exp(-t / 0.1), s.Value, 1e-12, $"dt={dt:F4}: attack after {t:F3}s");
            double v0 = s.Value; double t2 = 0;
            for (int i = 0; i < (int)Math.Round(0.5 / dt); i++) { s.Update(0.0, dt); t2 += dt; }
            Assert.Near(v0 * Math.Exp(-t2 / 0.5), s.Value, 1e-12, $"dt={dt:F4}: release");
        }
    }

    [Test]
    public static void SmootherIgnoresNonFiniteAndZeroTau()
    {
        var s = new AttackReleaseSmoother(0, 0);
        s.Update(0.7, 0.01); Assert.Near(0.7, s.Value, 0, "tau=0 follows instantly");
        s.Update(double.NaN, 0.01); Assert.Near(0.7, s.Value, 0, "NaN ignored");
    }

    [Test]
    public static void NormalizerStaysBounded()
    {
        var n = new AdaptiveNormalizer();
        var rng = new Random(1);
        for (int i = 0; i < 10000; i++)
        {
            double v = n.Process(rng.NextDouble() * 200 - 150, 0.01);
            Assert.InRange(0, 1, v, "normalised value");
        }
        Assert.Near(0, n.Process(double.NaN, 0.01), 1e-12, "NaN level → 0");
    }
}
