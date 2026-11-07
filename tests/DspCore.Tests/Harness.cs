using System.Reflection;
using AudioViz.Dsp;

namespace AudioViz.Dsp.Tests;

[AttributeUsage(AttributeTargets.Method)]
public sealed class TestAttribute : Attribute { }

public sealed class AssertionException(string message) : Exception(message);

public static class Assert
{
    public static void True(bool cond, string message) { if (!cond) throw new AssertionException(message); }

    public static void Near(double expected, double actual, double tolerance, string what)
    {
        if (!double.IsFinite(actual) || Math.Abs(expected - actual) > tolerance)
            throw new AssertionException($"{what}: expected {expected:G6} ± {tolerance:G3}, got {actual:G6}");
    }

    public static void InRange(double lo, double hi, double actual, string what)
    {
        if (!double.IsFinite(actual) || actual < lo || actual > hi)
            throw new AssertionException($"{what}: expected in [{lo:G6}, {hi:G6}], got {actual:G6}");
    }

    public static void AllFinite(FeatureFrame f)
    {
        void Check(double v, string n) { if (!double.IsFinite(v)) throw new AssertionException($"frame {f.Seq}: {n} is not finite"); }
        Check(f.Rms, "Rms"); Check(f.Dbfs, "Dbfs"); Check(f.DbfsL, "DbfsL"); Check(f.DbfsR, "DbfsR");
        Check(f.PeakL, "PeakL"); Check(f.PeakR, "PeakR"); Check(f.LevelNorm, "LevelNorm");
        Check(f.FluxLinear, "FluxLinear"); Check(f.FluxLog, "FluxLog");
        Check(f.CentroidHz, "Centroid"); Check(f.Flatness, "Flatness"); Check(f.RolloffHz, "Rolloff"); Check(f.Zcr, "Zcr");
        Check(f.Balance, "Balance"); Check(f.Correlation, "Correlation"); Check(f.Width, "Width");
        Check(f.Onset.Strength, "OnsetStrength"); Check(f.Onset.Threshold, "OnsetThreshold"); Check(f.Onset.Confidence, "OnsetConfidence");
        foreach (var v in f.BandDb) Check(v, "BandDb");
        foreach (var v in f.BandNorm) { Check(v, "BandNorm"); if (v < 0 || v > 1) throw new AssertionException("BandNorm out of [0,1]"); }
        foreach (var v in f.SpectrumDb) Check(v, "SpectrumDb");
    }
}

/// <summary>Deterministic synthetic signals (seeded) — the DSP fixtures.</summary>
public static class Signals
{
    public static float[] Stereo(int frames, Func<int, (double l, double r)> gen)
    {
        var buf = new float[frames * 2];
        for (int i = 0; i < frames; i++) { var (l, r) = gen(i); buf[2 * i] = (float)l; buf[2 * i + 1] = (float)r; }
        return buf;
    }

    public static float[] Sine(double hz, double amp, double sr, double seconds, double phase = 0)
        => Stereo((int)(sr * seconds), i => { double v = amp * Math.Sin(2 * Math.PI * hz * i / sr + phase); return (v, v); });

    public static float[] Silence(double sr, double seconds) => new float[(int)(sr * seconds) * 2];

    /// <summary>Gaussian white noise (Box–Muller), independent per channel, standard deviation sigma.</summary>
    public static float[] WhiteNoise(double sigma, double sr, double seconds, int seed)
    {
        var rng = new Random(seed);
        double G() { double u1 = 1.0 - rng.NextDouble(), u2 = rng.NextDouble(); return Math.Sqrt(-2 * Math.Log(u1)) * Math.Cos(2 * Math.PI * u2); }
        return Stereo((int)(sr * seconds), _ => (sigma * G(), sigma * G()));
    }

    public static float[] Impulses(double amp, double sr, double seconds, double firstAt, double interval)
    {
        int frames = (int)(sr * seconds);
        var buf = new float[frames * 2];
        for (double t = firstAt; t < seconds; t += interval)
        {
            int i = (int)Math.Round(t * sr);
            if (i < frames) { buf[2 * i] = (float)amp; buf[2 * i + 1] = (float)amp; }
        }
        return buf;
    }

    public static List<FeatureFrame> Run(FeatureExtractor fx, float[] interleaved, int blockFrames = 480)
    {
        var frames = new List<FeatureFrame>();
        double sr = fx.Config.SampleRate;
        for (int off = 0; off < interleaved.Length; off += blockFrames * 2)
        {
            int len = Math.Min(blockFrames * 2, interleaved.Length - off);
            long endSample = fx.TotalSamples + len / 2 - 1;
            fx.PushInterleaved(interleaved.AsSpan(off, len), endSample * 1000.0 / sr, frames.Add);
        }
        return frames;
    }

    /// <summary>Frames after the analysis windows are completely filled with signal.</summary>
    public static IEnumerable<FeatureFrame> Settled(FeatureExtractor fx, List<FeatureFrame> frames)
    {
        int skip = (int)Math.Ceiling((double)Math.Max(fx.Config.FftSize, fx.Config.LowFftSize) / fx.Config.Hop) + 1;
        return frames.Skip(skip);
    }
}

public static class Runner
{
    public static int Main(string[] args)
    {
        int soakAt = Array.IndexOf(args, "--soak");
        if (soakAt >= 0) return Soak.Run(soakAt + 1 < args.Length && int.TryParse(args[soakAt + 1], out var m) ? m : 30);
        var tests = typeof(Runner).Assembly.GetTypes()
            .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Static))
            .Where(m => m.GetCustomAttribute<TestAttribute>() != null)
            .OrderBy(m => m.DeclaringType!.Name).ThenBy(m => m.Name).ToList();
        int failed = 0;
        foreach (var t in tests)
        {
            var name = $"{t.DeclaringType!.Name}.{t.Name}";
            try { t.Invoke(null, null); Console.WriteLine($"  PASS  {name}"); }
            catch (TargetInvocationException e) { failed++; Console.WriteLine($"  FAIL  {name}\n        {e.InnerException?.Message}"); }
        }
        Console.WriteLine($"\n{tests.Count - failed}/{tests.Count} tests passed.");
        return failed == 0 ? 0 : 1;
    }

    /// <summary>Informational measurements printed by tests (not assertions).</summary>
    public static void Note(string s) => Console.WriteLine($"        note: {s}");
}
