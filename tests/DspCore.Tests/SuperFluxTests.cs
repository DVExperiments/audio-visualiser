namespace AudioViz.Dsp.Tests;

/// <summary>SuperFlux vibrato suppression: measured against plain flux (OnsetMaxFilterBins = 0).</summary>
public static class SuperFluxTests
{
    /// <summary>Steady-level tone with vibrato: f(t) = f0 + d·sin(2π·rate·t); phase is the integral of f.</summary>
    static float[] Vibrato(double f0, double depthHz, double rateHz, double seconds, double sr = 48000)
        => Signals.Stereo((int)(sr * seconds), i =>
        {
            double t = i / sr, phase = 2 * Math.PI * (f0 * t - depthHz / (2 * Math.PI * rateHz) * Math.Cos(2 * Math.PI * rateHz * t));
            double v = 0.4 * Math.Sin(phase) + 0.2 * Math.Sin(2 * phase) + 0.1 * Math.Sin(3 * phase);   // a few harmonics, like a voice or violin
            return (v, v);
        });

    static int Onsets(float[] sig, int maxFilter, double cents = 50) =>
        Signals.Run(new FeatureExtractor(new AnalysisConfig { OnsetMaxFilterBins = maxFilter, OnsetMaxFilterCents = cents }), sig).Count(f => f.TimeMs > 1500 && f.Onset.IsOnset);

    /// <summary>Vibrato that comes and goes (depth envelope), with rich harmonics, like a sung note.</summary>
    static float[] IntermittentVibrato(double f0, double depthHz, double rateHz, double seconds, double sr = 48000)
    {
        // integrate the instantaneous frequency numerically (depth varies, so no closed form)
        var buf = new float[(int)(sr * seconds) * 2]; double phase = 0;
        for (int i = 0; i < buf.Length / 2; i++)
        {
            double t = i / sr, env = Math.Max(0, Math.Sin(2 * Math.PI * 0.2 * t));          // vibrato on for 2.5 s, off for 2.5 s
            phase += 2 * Math.PI * (f0 + depthHz * env * Math.Sin(2 * Math.PI * rateHz * t)) / sr;
            double v = 0; for (int h = 1; h <= 8; h++) v += Math.Sin(h * phase) * 0.35 / h;
            buf[2 * i] = buf[2 * i + 1] = (float)v;
        }
        return buf;
    }

    [Test]
    public static void VibratoNoLongerTriggersFalseOnsets()
    {
        // vibrato that comes and goes, with harmonics — where plain flux fails (measured, v0.9 review)
        foreach (var (name, sig) in new[] { ("±15 Hz @ 5.5 Hz", IntermittentVibrato(330, 15, 5.5, 12)), ("±30 Hz @ 6.5 Hz", IntermittentVibrato(440, 30, 6.5, 12)) })
        {
            int plain = Onsets(sig, 0), fixedBin = Onsets(sig, 1, 0), super = Onsets(sig, 1, 50);
            Runner.Note($"intermittent vibrato {name}, 10.5 s, no real onsets: plain {plain}, ±1 bin {fixedBin}, SuperFlux ±50 cents {super}");
            Assert.True(plain >= 10, "the problem is real: plain flux fires false onsets");
            Assert.True(super <= 1, "frequency-proportional max filter removes them");
        }
        Assert.True(Onsets(Vibrato(440, 25, 6, 12), 1, 50) == 0, "steady vibrato: still none");
    }

    [Test]
    public static void RealAttacksStillDetected()
    {
        // impulses, plus the dense mastered mix: same detection as before
        var imp = Signals.Run(new FeatureExtractor(new AnalysisConfig()), Signals.Impulses(0.9, 48000, 5.0, 0.25, 0.5));
        Assert.True(imp.Count(f => f.Onset.IsOnset) == 10, "10/10 impulses");
        var rng = new Random(1);
        var dense = Signals.Stereo(48000 * 12, i => { var (l, r) = AudioViz.Capture.SyntheticSource.DenseMix(i / 48000.0, 48000, rng); return (l, r); });
        int beats = 0, hit = 0; double beatMs = 60000.0 / 124;
        var frames = Signals.Run(new FeatureExtractor(new AnalysisConfig()), dense).Where(f => f.TimeMs > 4000).ToList();
        for (double tb = Math.Ceiling(4000 / beatMs) * beatMs; tb < 11900; tb += beatMs) { beats++; if (frames.Any(f => f.TimeMs >= tb && f.TimeMs <= tb + 80 && f.Onset.IsOnset)) hit++; }
        Runner.Note($"dense mix kicks found by the onset detector alone: {hit}/{beats}");
        Assert.True(hit >= beats - 2, "kicks in a dense mix still detected");
    }
}
