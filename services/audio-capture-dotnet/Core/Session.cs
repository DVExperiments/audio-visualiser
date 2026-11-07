using AudioViz.Dsp;

namespace AudioViz.Capture;

/// <summary>
/// One capture session: source → lock-free ring → analysis thread → frame callback.
///
/// The capture callback only converts and copies into the ring (never blocks on analysis,
/// IPC or UI). The analysis thread drains the ring and runs the FeatureExtractor.
///
/// Gap fill: WASAPI loopback delivers NO packets while nothing is playing, which would freeze
/// analysis. When enabled, the analysis thread feeds digital silence to keep frames flowing at
/// the real rate; such frames are flagged gap=true so consumers know they are not captured audio.
///
/// Loopback capture is polled, so packets normally arrive in bursts 30–65 ms apart. Gap fill
/// therefore waits for 3 x the longest recent inter-packet interval (minimum 150 ms) before
/// deciding the device has gone quiet. If real audio nevertheless arrives for a stretch that was
/// already filled, the overlapping samples are dropped, so time is never counted twice
/// (v0.1.0 bug: a 60 ms fixed threshold duplicated time → ~150 frames/s on Windows).
/// </summary>
public sealed class Session : ISampleSink, IDisposable
{
    public FeatureExtractor Extractor { get; }
    public IAudioSource Source { get; }
    public bool GapFillEnabled { get; }
    public const double GapFillMinMs = 150, GapFillMaxMs = 600;
    const double GapFillLagMs = 20;
    private double _prevArrivalMs = double.NaN;
    private double _maxIntervalMs = 0;      // decaying peak of inter-packet intervals (producer writes)
    private bool _filledSinceReal;          // consumer only
    private long _overlapDroppedFrames;
    public long OverlapDroppedFrames => Interlocked.Read(ref _overlapDroppedFrames);
    public double GapFillThresholdMs => Math.Clamp(3 * Volatile.Read(ref _maxIntervalMs), GapFillMinMs, GapFillMaxMs);

    private readonly SpscFloatRing _ring;
    private readonly Action<FeatureFrame, bool> _onFrame;
    private readonly Action<Exception?> _onStopped;
    private readonly Thread _thread;
    private readonly AutoResetEvent _wake = new(false);
    private volatile bool _running = true;

    // latest arrival stamp: (total stereo frames written after this block, arrival time ms)
    private sealed record Stamp(long FramesEnd, double ArrivalMs);
    private Stamp? _stamp;
    private long _framesWritten; // producer only
    private long _framesConsumed; // consumer only
    private double _lastFedMs = double.NaN;
    private double _startedMs;
    private bool _gapSinceFrame;

    public long DroppedInputFrames => _ring.DroppedFloats / 2;
    public double LastDataMs => _stamp?.ArrivalMs ?? double.NaN;

    public Session(IAudioSource source, AnalysisConfig config, bool gapFill,
                   Action<FeatureFrame, bool> onFrame, Action<Exception?> onStopped)
    {
        Source = source;
        Extractor = new FeatureExtractor(config);
        GapFillEnabled = gapFill;
        _onFrame = onFrame;
        _onStopped = onStopped;
        // ~2.7 s of stereo audio at 48 kHz; generous so analysis hiccups never drop input
        _ring = new SpscFloatRing(1 << 18);
        _thread = new Thread(AnalysisLoop) { IsBackground = true, Name = "analysis", Priority = ThreadPriority.AboveNormal };
    }

    public void Start()
    {
        _lastFedMs = _startedMs = Clock.NowMs;
        _thread.Start();
        Source.Start(this);
    }

    // ---- ISampleSink (capture thread) ----
    public void OnSamples(ReadOnlySpan<float> interleavedStereo, double arrivalMs)
    {
        if (!_running || interleavedStereo.Length == 0) return;
        if (!double.IsNaN(_prevArrivalMs))
        {
            double interval = arrivalMs - _prevArrivalMs;
            // peak follower with ~10 s memory at typical packet rates
            Volatile.Write(ref _maxIntervalMs, Math.Max(interval, _maxIntervalMs * 0.997));
        }
        _prevArrivalMs = arrivalMs;
        if (_ring.TryWrite(interleavedStereo))
        {
            _framesWritten += interleavedStereo.Length / 2;
            Volatile.Write(ref _stamp, new Stamp(_framesWritten, arrivalMs));
        }
        _wake.Set();
    }

    public void OnStopped(Exception? error) { if (_running) _onStopped(error); }

    // ---- analysis thread ----
    private void AnalysisLoop()
    {
        var buf = new float[8192];
        double sr = Extractor.Config.SampleRate;
        while (_running)
        {
            _wake.WaitOne(10);
            int n;
            while (_running && (n = _ring.Read(buf)) > 0)
            {
                long framesEnd = _framesConsumed + n / 2;
                _framesConsumed = framesEnd;
                var st = Volatile.Read(ref _stamp);
                double endMs = st is null ? Clock.NowMs : st.ArrivalMs - (st.FramesEnd - framesEnd) * 1000.0 / sr;
                int skip = 0;
                if (_filledSinceReal)
                {
                    // silence was fed for a stretch this real audio also covers: drop the overlap
                    double startMs = endMs - (n / 2) * 1000.0 / sr;
                    if (startMs < _lastFedMs)
                        skip = (int)Math.Min(n / 2, Math.Ceiling((_lastFedMs - startMs) * sr / 1000.0));
                    _filledSinceReal = false;
                    Interlocked.Add(ref _overlapDroppedFrames, skip);
                }
                _lastFedMs = Math.Max(_lastFedMs, endMs);
                if (skip < n / 2) Extractor.PushInterleaved(buf.AsSpan(skip * 2, n - skip * 2), endMs, Emit);
            }

            if (GapFillEnabled && _running && _ring.Available == 0)
            {
                double now = Clock.NowMs;
                var st = Volatile.Read(ref _stamp);
                double lastReal = st?.ArrivalMs ?? _startedMs;   // grace period before the first packet too
                if (now - lastReal > GapFillThresholdMs)
                {
                    // feed silence up to (now - lag) so we stay just behind real time
                    int frames = (int)Math.Floor((now - GapFillLagMs - _lastFedMs) * sr / 1000.0);
                    frames = Math.Clamp(frames, 0, buf.Length / 2);
                    if (frames > 0)
                    {
                        Array.Clear(buf, 0, frames * 2);
                        _lastFedMs += frames * 1000.0 / sr;
                        _gapSinceFrame = true;
                        _filledSinceReal = true;
                        Extractor.PushInterleaved(buf.AsSpan(0, frames * 2), _lastFedMs, Emit);
                    }
                }
            }
        }
    }

    private void Emit(FeatureFrame f)
    {
        bool gap = _gapSinceFrame;
        _gapSinceFrame = false;
        _onFrame(f, gap);
    }

    public void Dispose()
    {
        if (!_running) return;
        _running = false;
        try { Source.Stop(); } catch { /* device may already be gone */ }
        _wake.Set();
        if (Thread.CurrentThread != _thread) _thread.Join(1000);
        try { Source.Dispose(); } catch { }
        _wake.Dispose();
    }
}
