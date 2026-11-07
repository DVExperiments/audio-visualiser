namespace AudioViz.Dsp.Tests;

/// <summary>Live input tuning (calibration): applied before analysis.</summary>
public static class TuningTests
{
    static List<FeatureFrame> Run(Tuning t, float[] sig)
    {
        var fx = new FeatureExtractor(new AnalysisConfig());
        fx.SetTuning(t);
        return Signals.Run(fx, sig);
    }

    [Test]
    public static void GainShiftsEveryLevelByExactlyItsDecibels()
    {
        var sig = Signals.Sine(440, 0.01, 48000, 1);          // a quiet microphone: −43 dBFS
        var a = Run(new Tuning(), sig)[^1]; var b = Run(new Tuning(GainDb: 20), sig)[^1];
        Assert.Near(a.Dbfs + 20, b.Dbfs, 1e-6, "RMS dBFS +20");
        Assert.Near(a.BandDb[2] + 20, b.BandDb[2], 1e-6, "band power +20 dB");
    }

    [Test]
    public static void SilenceThresholdIsLive()
    {
        var sig = Signals.Sine(440, 0.003, 48000, 1);         // ≈ −53.5 dBFS (room noise level)
        Assert.True(!Run(new Tuning(SilenceDb: -70), sig)[^1].Silent, "−53 dB is sound with the default −70 dB threshold");
        Assert.True(Run(Tuning.Clamp(0, -45, 8), sig)[^1].Silent, "and silence with a calibrated −45 dB noise floor");
    }

    [Test]
    public static void PulseRangeSetsBeatSensitivity()
    {
        // +6 dB step: with an 8 dB range the pulse peaks at (6−1)/8; with 4 dB it saturates
        var a = Signals.Sine(100, 0.1, 48000, 3); var b = Signals.Sine(100, 0.2, 48000, 1.5, phase: 2 * Math.PI * 100 * 3);
        var sig = a.Concat(b).ToArray();
        double Peak(double range) => Run(Tuning.Clamp(0, -70, range), sig).Where(f => f.TimeMs > 3000).Max(f => f.BandPulse[1]);
        double p8 = Peak(8), p4 = Peak(4);
        Runner.Note($"+6 dB step: pulse peak {p8:F2} at 8 dB range, {p4:F2} at 4 dB");
        // ideal (6 − 1)/8 = 0.625, less the 0.4 s short average's rise during the ~85 ms attack
        Assert.InRange(0.45, 0.65, p8, "8 dB range: about (6 − 1)/8");
        Assert.Near(1.0, p4, 1e-6, "4 dB range: saturated (more sensitive)");
    }

    [Test]
    public static void TuningIsClamped()
    {
        var t = Tuning.Clamp(99, -999, 0.1);
        Assert.True(t.GainDb == 36 && t.SilenceDb == -100 && t.PulseRangeDb == 3, "clamped to safe ranges");
        Assert.True(Tuning.Clamp(double.NaN, double.NaN, double.NaN) == new Tuning(), "NaN → defaults");
    }
}
