using AudioViz.Capture;

namespace AudioViz.Dsp.Tests;

public static class PulseTests
{
    const int Bass = 1;

    [Test]
    public static void SteadyToneHasNoPulse()
    {
        var fx = new FeatureExtractor(new AnalysisConfig());
        var frames = Signals.Run(fx, Signals.Sine(100, 0.5, 48000, 6));
        var late = frames.Where(f => f.TimeMs > 1000).ToList();   // after the 1.5 s median window is half full
        double max = late.Max(f => f.BandPulse[Bass]);
        Runner.Note($"steady 100 Hz: max bass pulse {max:F3} after settling");
        Assert.True(max < 0.02, "a steady tone is not a pulse");
    }

    [Test]
    public static void LevelStepPulsesThenDecays()
    {
        // 3 s at 0.1, then 3 s at 0.4 (+12 dB): pulse saturates, then fades as the slow average catches up
        var fx = new FeatureExtractor(new AnalysisConfig());
        var a = Signals.Sine(100, 0.1, 48000, 3);
        var b = Signals.Sine(100, 0.4, 48000, 3, phase: 2 * Math.PI * 100 * 3);
        var frames = Signals.Run(fx, a.Concat(b).ToArray());
        double stepMs = 3000;
        var after = frames.Where(f => f.TimeMs > stepMs).ToList();
        var peak = after.Take(30).Max(f => f.BandPulse[Bass]);
        var at3s = after.First(f => f.TimeMs > stepMs + 1000).BandPulse[Bass];
        Runner.Note($"+12 dB step: pulse peak {peak:F2}, 1.0 s later {at3s:F3}");
        Assert.Near(1.0, peak, 1e-6, "+12 dB jump saturates the 8 dB range");
        Assert.True(at3s < 0.05, "pulse fades once the level is the new normal");
        // the pulse must respond within ~1 frame of the change
        var first = after.First(f => f.BandPulse[Bass] > 0.5);
        Assert.True(first.TimeMs - stepMs < 2048 / 48.0 + 25, $"responds within one window + a frame ({first.TimeMs - stepMs:F0} ms)");
    }

    [Test]
    public static void SilenceHasNoPulse()
    {
        var fx = new FeatureExtractor(new AnalysisConfig());
        foreach (var f in Signals.Run(fx, Signals.Silence(48000, 2)))
        {
            Assert.True(f.BandPulse.All(p => p == 0) && f.LevelPulse == 0, "silence → no pulse");
        }
    }

    [Test]
    public static void DenseMixPulsesOnKicksWhileNormalisedLevelStaysPinned()
    {
        // the case behind "Morph isn't reactive": mastered music keeps every band near its ceiling
        var rng = new Random(1);
        var sig = Signals.Stereo(48000 * 12, i => { var (l, r) = SyntheticSource.DenseMix(i / 48000.0, 48000, rng); return (l, r); });
        var fx = new FeatureExtractor(new AnalysisConfig());
        var frames = Signals.Run(fx, sig).Where(f => f.TimeMs > 4000).ToList();
        double Mean(Func<FeatureFrame, double> g) => frames.Average(g);
        double Std(Func<FeatureFrame, double> g) { double m = Mean(g); return Math.Sqrt(frames.Average(f => (g(f) - m) * (g(f) - m))); }
        double normMean = Mean(f => f.BandNorm[Bass]), normStd = Std(f => f.BandNorm[Bass]);
        double pulseMean = Mean(f => f.BandPulse[Bass]), pulseStd = Std(f => f.BandPulse[Bass]);

        // kicks every 60/124 s: how many beats show a low-end pulse > 0.5 within 80 ms of the beat?
        // (sub-bass OR bass: in the bar where the bass line sits at 65 Hz, inside the bass band, the
        //  kick is masked there but stands out in sub-bass — visuals must read both, as Morph does)
        static double Low(FeatureFrame f) => Math.Max(f.BandPulse[0], f.BandPulse[1]);
        double beatMs = 60000.0 / 124; int beats = 0, hit = 0, either = 0;
        for (double tb = Math.Ceiling(4000 / beatMs) * beatMs; tb < 11900; tb += beatMs)
        {
            beats++;
            var win = frames.Where(f => f.TimeMs >= tb && f.TimeMs <= tb + 80).ToList();
            if (win.Any(f => Low(f) > 0.5)) hit++;
            if (win.Any(f => Low(f) > 0.5 || f.Onset.IsOnset)) either++;
            else Runner.Note($"miss at {tb:F0} ms (bar {(int)(tb / (4 * beatMs)) % 4}): max sub {win.Max(f => f.BandPulse[0]):F2}, bass {win.Max(f => f.BandPulse[1]):F2}; within 150 ms: {frames.Where(f => f.TimeMs >= tb && f.TimeMs <= tb + 150).Max(Low):F2}");
        }
        // and between kicks (middle of each beat) the pulse should be low
        double between = frames.Where(f => { double ph = (f.TimeMs % beatMs) / beatMs; return ph > 0.45 && ph < 0.75; }).Average(f => Low(f));
        Runner.Note($"dense mix bass: normalised mean {normMean:F2} ± {normStd:F2} | pulse mean {pulseMean:F2} ± {pulseStd:F2}, kicks in low-end pulse {hit}/{beats}, in pulse or onset {either}/{beats}, mid-beat pulse {between:F2}");
        Assert.True(normMean > 0.75 && normStd < 0.12, "normalised level stays pinned high (the v0.2 problem)");
        // In the bar whose bass line sits inside the bass band, the soft-clipped mix genuinely masks
        // some kicks' low end; the broadband onset detector covers those. Morph uses both.
        Assert.True(hit >= beats * 0.75, "low-end pulse fires on ≥75% of kicks");
        Assert.True(either >= beats - 1, "pulse or onset catches all but at most one kick");
        Assert.True(between < 0.2, "pulse falls back between kicks");
        Assert.True(pulseStd > 2 * normStd, "pulse carries far more modulation than the normalised level");
    }
}
