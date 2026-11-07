namespace AudioViz.Capture;

/// <summary>
/// SIMULATED INPUT for testing the pipeline without any audio device. Every frame produced from
/// it is flagged synthetic=true and the UI labels it. Paced against the monotonic clock so it
/// runs at the true sample rate. Signals mirror the DSP test fixtures.
/// </summary>
public sealed class SyntheticSource : IAudioSource
{
    public static readonly string[] Signals =
        { "sine100", "sine440", "sine1000", "noise", "impulses", "leftOnly", "antiphase", "sweep", "beat", "denseMix", "lissajous" };

    public StreamFormat Format { get; } = new(48000, 2, 32, SampleEncoding.Float);
    public string Kind => "synthetic";
    public string DeviceName => $"Test signal: {_signal}";
    public string? DeviceId => null;

    private readonly string _signal;
    private Thread? _thread;
    private volatile bool _running;
    private long _n; // sample index
    private readonly Random _rng = new(1234);

    public SyntheticSource(string signal)
    {
        if (Array.IndexOf(Signals, signal) < 0) throw new ArgumentException($"Unknown test signal '{signal}'.");
        _signal = signal;
    }

    public void Start(ISampleSink sink)
    {
        _running = true;
        _thread = new Thread(() => Run(sink)) { IsBackground = true, Name = "synthetic-source" };
        _thread.Start();
    }

    private void Run(ISampleSink sink)
    {
        double sr = Format.SampleRate;
        var buf = new float[4800 * 2];
        double startMs = Clock.NowMs;
        long produced = 0;
        while (_running)
        {
            Thread.Sleep(5);
            long due = (long)((Clock.NowMs - startMs) * sr / 1000.0);
            int frames = (int)Math.Min(due - produced, buf.Length / 2);
            if (frames <= 0) continue;
            for (int i = 0; i < frames; i++) { var (l, r) = Sample(sr); buf[2 * i] = l; buf[2 * i + 1] = r; _n++; }
            produced += frames;
            sink.OnSamples(buf.AsSpan(0, frames * 2), Clock.NowMs);
        }
    }

    private (float, float) Sample(double sr)
    {
        double t = _n / sr;
        double S(double hz, double a) => a * Math.Sin(2 * Math.PI * hz * t);
        double Gauss() { double u1 = 1 - _rng.NextDouble(), u2 = _rng.NextDouble(); return Math.Sqrt(-2 * Math.Log(u1)) * Math.Cos(2 * Math.PI * u2); }
        switch (_signal)
        {
            case "sine100": { var v = (float)S(100, 0.5); return (v, v); }
            case "sine440": { var v = (float)S(440, 0.5); return (v, v); }
            case "sine1000": { var v = (float)S(1000, 0.5); return (v, v); }
            case "noise": return ((float)(0.1 * Gauss()), (float)(0.1 * Gauss()));
            case "impulses": { float v = (_n % (long)(sr / 2) == 0) ? 0.9f : 0f; return (v, v); }
            case "leftOnly": return ((float)S(440, 0.5), 0f);
            case "antiphase": { var v = (float)S(440, 0.5); return (v, -v); }
            case "sweep":
                {
                    // exponential sweep 20 Hz → 20 kHz over 10 s, repeating; phase = integral of f(t)
                    double T = 10, f0 = 20, f1 = 20000, k = Math.Log(f1 / f0);
                    double tt = t % T;
                    double phase = 2 * Math.PI * f0 * T / k * (Math.Exp(tt * k / T) - 1);
                    var v = (float)(0.3 * Math.Sin(phase)); return (v, v);
                }
            case "beat":
                {
                    // 120 BPM: decaying 55 Hz kick every 0.5 s, hi-hat noise burst on off-beats, pad underneath
                    double beat = t % 0.5, off = (t + 0.25) % 0.5;
                    double kick = Math.Exp(-beat * 18) * Math.Sin(2 * Math.PI * (55 + 90 * Math.Exp(-beat * 30)) * beat) * 0.8;
                    double hat = Math.Exp(-off * 60) * Gauss() * 0.15;
                    double pad = 0.05 * (Math.Sin(2 * Math.PI * 220 * t) + Math.Sin(2 * Math.PI * 277.18 * t) + Math.Sin(2 * Math.PI * 329.63 * t));
                    double pan = 0.5 + 0.4 * Math.Sin(2 * Math.PI * 0.1 * t);
                    return ((float)(kick + hat * (1 - pan) * 2 + pad), (float)(kick + hat * pan * 2 + pad * 0.9));
                }
            case "denseMix": return DenseMix(t, sr);
            // v0.18: a classic X/Y-scope figure: left and right at 2:3 with a slowly drifting phase, so
            // the Lissajous knot turns (one full turn every 8 s); for the phosphor scope
            case "lissajous": return ((float)(0.7 * Math.Sin(2 * Math.PI * 200 * t)), (float)(0.7 * Math.Sin(2 * Math.PI * 300 * t + 2 * Math.PI * t / 8)));
            default: return (0f, 0f);
        }
    }

    /// <summary>
    /// Like mastered pop/electronic music: every band is busy all the time (sustained bass line,
    /// chords, a continuous 16th-note hi-hat bed), kicks on every beat at 124 BPM, and the sum
    /// is soft-clipped (tanh), compressing the dynamics. Exposes visuals that only follow
    /// absolute band level — those stay pinned near maximum.
    /// </summary>
    public static (float, float) DenseMix(double t, double sr, Random? rng = null)
    {
        rng ??= SharedRng;
        double beatLen = 60.0 / 124, b = t % beatLen, s16 = t % (beatLen / 4);
        int bar = (int)(t / (4 * beatLen)) % 4;
        double[] roots = { 55.0, 43.65, 65.41, 49.0 };            // A1 F1 C2 G1
        double root = roots[bar];
        double bassLine = 0.30 * Math.Tanh(2.5 * Math.Sin(2 * Math.PI * root * t));
        double kick = 0.9 * Math.Exp(-b * 22) * Math.Sin(2 * Math.PI * (50 + 110 * Math.Exp(-b * 35)) * b);
        double chord = 0.07 * (Math.Sin(2 * Math.PI * root * 4 * t) + Math.Sin(2 * Math.PI * root * 5 * t) + Math.Sin(2 * Math.PI * root * 6 * t + 0.3));
        double u1 = 1 - rng.NextDouble(), u2 = rng.NextDouble();
        double noise = Math.Sqrt(-2 * Math.Log(u1)) * Math.Cos(2 * Math.PI * u2);
        double hat = noise * (0.05 + 0.10 * Math.Exp(-s16 * 70));
        double snare = ((int)(t / beatLen) % 2 == 1) ? noise * 0.35 * Math.Exp(-b * 25) : 0;
        double x = Math.Tanh(1.6 * (bassLine + kick + chord + hat + snare)) * 0.6;
        return ((float)x, (float)(x * 0.97 + 0.03 * hat));
    }
    private static readonly Random SharedRng = new(4321);

    public void Stop() { _running = false; _thread?.Join(500); }
    public void Dispose() => Stop();
}
