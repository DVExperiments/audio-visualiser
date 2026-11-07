namespace AudioViz.Dsp;

/// <summary>
/// One-pole attack/release smoother, exact for variable time steps:
///   alpha = 1 - exp(-dt / tau);  y += alpha * (target - y)
/// tau = attack when target &gt; y, release otherwise. After a step input, y reaches
/// 1 - 1/e (63.2%) of the step after one time constant regardless of dt.
/// tau = 0 means "follow instantly".
/// </summary>
public sealed class AttackReleaseSmoother
{
    public double AttackSeconds { get; set; }
    public double ReleaseSeconds { get; set; }
    public double Value { get; private set; }
    private bool _initialised;

    public AttackReleaseSmoother(double attackSeconds, double releaseSeconds, double initial = 0.0, bool initialised = true)
    {
        if (attackSeconds < 0 || releaseSeconds < 0) throw new ArgumentOutOfRangeException();
        AttackSeconds = attackSeconds; ReleaseSeconds = releaseSeconds;
        Value = initial; _initialised = initialised;
    }

    public double Update(double target, double dtSeconds)
    {
        if (!double.IsFinite(target)) return Value;          // ignore invalid input, keep state finite
        if (!_initialised) { Value = target; _initialised = true; return Value; }
        if (!(dtSeconds > 0)) return Value;
        double tau = target > Value ? AttackSeconds : ReleaseSeconds;
        double alpha = tau <= 0 ? 1.0 : 1.0 - Math.Exp(-dtSeconds / tau);
        Value += alpha * (target - Value);
        return Value;
    }

    public void Reset(double value) { Value = value; _initialised = true; }
}

public readonly record struct OnsetResult(bool IsOnset, double Strength, double Threshold, double Confidence);

/// <summary>
/// Real-time spectral-flux onset picker.
/// threshold[t] = median(H) + k * 1.4826 * MAD(H) + delta, over the last H frames (default ~1 s).
/// A frame t-1 is reported as an onset at frame t when:
///   flux[t-1] &gt; threshold, flux[t-1] &gt; flux[t-2], flux[t-1] &gt;= flux[t] (local maximum),
///   the refractory time since the previous onset has elapsed, and the frame is not silent.
/// This costs exactly one hop of extra latency (10.7 ms at 48 kHz / hop 512), reported as LagFrames.
/// Confidence = clamp((flux - threshold) / threshold, 0, 1): a heuristic margin, not a probability.
/// An onset is a detected transient, not a guaranteed musical beat.
/// </summary>
public sealed class OnsetDetector
{
    public const int LagFrames = 1;
    private readonly double[] _history;
    private readonly double[] _scratch;
    private int _count, _head;
    private double _prev1 = 0, _prev2 = 0;
    private double _secondsSinceOnset = double.PositiveInfinity;

    public double K { get; set; } = 3.0;
    public double Delta { get; set; } = 0.002;
    public double RefractorySeconds { get; set; } = 0.060;

    public OnsetDetector(int historyFrames = 94)
    {
        if (historyFrames < 5) throw new ArgumentOutOfRangeException(nameof(historyFrames));
        _history = new double[historyFrames];
        _scratch = new double[historyFrames];
    }

    public OnsetResult Process(double flux, double dtSeconds, bool silent)
    {
        if (!double.IsFinite(flux) || flux < 0) flux = 0;
        _secondsSinceOnset += dtSeconds;

        double threshold = ComputeThreshold();
        double candidate = _prev1;
        bool isPeak = candidate > _prev2 && candidate >= flux;
        bool onset = !silent && _count >= 3 && isPeak && candidate > threshold && _secondsSinceOnset >= RefractorySeconds;
        double confidence = threshold > 0 ? Math.Clamp((candidate - threshold) / threshold, 0.0, 1.0) : 0.0;
        if (onset) _secondsSinceOnset = 0;

        // update history after evaluating, so a frame never raises its own threshold
        _history[_head] = flux;
        _head = (_head + 1) % _history.Length;
        if (_count < _history.Length) _count++;
        _prev2 = _prev1; _prev1 = flux;

        return new OnsetResult(onset, candidate, threshold, onset ? confidence : 0.0);
    }

    private double ComputeThreshold()
    {
        if (_count == 0) return Delta;
        var s = _scratch.AsSpan(0, _count);
        for (int i = 0; i < _count; i++) s[i] = _history[i];
        double median = Median(s);
        for (int i = 0; i < _count; i++) s[i] = Math.Abs(_history[i] - median);
        double mad = Median(s);
        return median + K * 1.4826 * mad + Delta;
    }

    private static double Median(Span<double> s)
    {
        s.Sort();
        int n = s.Length;
        return (n & 1) == 1 ? s[n / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
    }

    public void Reset()
    {
        _count = 0; _head = 0; _prev1 = _prev2 = 0; _secondsSinceOnset = double.PositiveInfinity;
    }
}

/// <summary>
/// Maps a level in dB to 0..1 against an adaptive ceiling, so quiet and loud sources both use
/// the full visual range. The ceiling jumps up instantly to new peaks and falls at
/// DecayDbPerSecond toward the current level, never below MinCeilingDb (so silence and
/// noise are not amplified to full scale).
///   norm = clamp((x - (C - RangeDb)) / RangeDb, 0, 1),   C = max(ceiling, sharedFloorDb)
/// sharedFloorDb lets a group of bands be coupled: FeatureExtractor passes
/// (loudest band ceiling - CouplingDb), so a band 40 dB below the dominant band (e.g. window
/// leakage from a pure tone) is not stretched to full scale.
/// </summary>
public sealed class AdaptiveNormalizer
{
    public double RangeDb { get; set; } = 30.0;
    public double DecayDbPerSecond { get; set; } = 3.0;
    public double MinCeilingDb { get; set; } = -50.0;
    public double CeilingDb { get; private set; } = -50.0;

    /// <summary>Advance the ceiling tracker with a new level.</summary>
    public void Track(double levelDb, double dtSeconds)
    {
        if (!double.IsFinite(levelDb)) levelDb = -120;
        if (levelDb > CeilingDb) CeilingDb = levelDb;
        else CeilingDb = Math.Max(Math.Max(levelDb, MinCeilingDb), CeilingDb - DecayDbPerSecond * Math.Max(0, dtSeconds));
    }

    public double Normalize(double levelDb, double sharedFloorDb = double.NegativeInfinity)
    {
        if (!double.IsFinite(levelDb)) return 0.0;
        double c = Math.Max(CeilingDb, sharedFloorDb);
        return Math.Clamp((levelDb - (c - RangeDb)) / RangeDb, 0.0, 1.0);
    }

    public double Process(double levelDb, double dtSeconds) { Track(levelDb, dtSeconds); return Normalize(levelDb); }

    public void Reset() => CeilingDb = MinCeilingDb;
}

/// <summary>
/// "Pulse": how far a level currently sits above its own recent typical level — the part of
/// the signal that changes. A kick over a sustained bass line spikes; a steady pad reads 0.
///   fast    = attack/release smoothing of the level in dB (attack 5 ms, release 70 ms)
///   typical = max(median of the level in dB over the last 1.5 s, short average τ = 0.4 s)
///   pulse   = clamp((fast − typical − DeadZoneDb) / RangeDb, 0, 1)
/// The median ignores short spikes (kicks occupy a small fraction of the window, so they do not
/// raise the baseline), and a genuine change of level becomes the new normal after half the
/// window (0.75 s). A plain exponential average failed both ways: kicks dragged it up, and after
/// silence it needed ~3 s to climb back, holding the pulse at maximum (caught by the tests).
/// The median alone, though, holds a sustained rise (e.g. a louder bass note at a bar change) as a
/// "pulse" for 0.75 s, blurring the kicks that follow; the short average (snapped to within
/// 24 dB of the current level so it never lags far behind after silence) lets a sustained rise
/// become normal in ≈ 0.4 s. Taking the higher of the two keeps the median's robustness to kicks.
/// Working in dB makes the pulse independent of loudness and band width. Below FloorDb: no pulse.
/// </summary>
public sealed class PulseTracker
{
    public double DeadZoneDb { get; set; } = 1.0;
    public double RangeDb { get; set; } = 8.0;
    public double FloorDb { get; set; } = -85.0;
    private readonly AttackReleaseSmoother _fast = new(0.005, 0.070, initialised: false);
    private readonly AttackReleaseSmoother _short = new(0.4, 0.4, initialised: false);
    private readonly double[] _hist, _scratch;
    private int _count, _head;

    public double Fast => _fast.Value;
    public double Typical { get; private set; } = -120;

    public PulseTracker(int historyFrames = 141)
    {
        if (historyFrames < 3) throw new ArgumentOutOfRangeException(nameof(historyFrames));
        _hist = new double[historyFrames]; _scratch = new double[historyFrames];
    }

    public double Process(double levelDb, double dtSeconds)
    {
        if (!double.IsFinite(levelDb)) levelDb = -120;
        double f = _fast.Update(levelDb, dtSeconds);
        _hist[_head] = levelDb; _head = (_head + 1) % _hist.Length;
        if (_count < _hist.Length) _count++;
        var span = _scratch.AsSpan(0, _count);
        _hist.AsSpan(0, _count).CopyTo(span);
        span.Sort();
        double median = (_count & 1) == 1 ? span[_count / 2] : 0.5 * (span[_count / 2 - 1] + span[_count / 2]);
        double avg = _short.Update(levelDb, dtSeconds);
        if (avg < levelDb - 24) { _short.Reset(levelDb - 24); avg = levelDb - 24; }
        Typical = Math.Max(median, avg);
        if (levelDb < FloorDb && f < FloorDb) return 0.0;
        return Math.Clamp((f - Typical - DeadZoneDb) / RangeDb, 0.0, 1.0);
    }

    public void Reset() { _fast.Reset(-120); _short.Reset(-120); _count = 0; _head = 0; Typical = -120; }
}
