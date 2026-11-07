using AudioViz.Capture;

namespace AudioViz.Dsp.Tests;

/// <summary>
/// Real-time tests of the capture session (each runs for a few seconds of wall-clock time).
/// PollingSource imitates NAudio's WasapiLoopbackCapture, which does not use event callbacks:
/// it sleeps ~half its 100 ms buffer, and Windows' 15.6 ms timer granularity stretches each
/// sleep, so packets arrive every 50–65 ms in bursts.
/// </summary>
public sealed class PollingSource : IAudioSource
{
    public StreamFormat Format { get; } = new(48000, 2, 32, SampleEncoding.Float);
    public string Kind => "loopback";
    public string DeviceName => "fake polling loopback";
    public string? DeviceId => "fake";
    private readonly int _minMs, _maxMs, _stopAfterMs;
    private Thread? _t; private volatile bool _run;
    public long SamplesDelivered;

    public PollingSource(int minIntervalMs, int maxIntervalMs, int stopAfterMs = int.MaxValue)
    { _minMs = minIntervalMs; _maxMs = maxIntervalMs; _stopAfterMs = stopAfterMs; }

    public void Start(ISampleSink sink)
    {
        _run = true;
        _t = new Thread(() =>
        {
            var rng = new Random(7);
            double start = Clock.NowMs; long produced = 0; long n = 0;
            var buf = new float[48000];
            while (_run)
            {
                Thread.Sleep(rng.Next(_minMs, _maxMs + 1));
                double now = Clock.NowMs;
                if (now - start > _stopAfterMs) continue;          // device went quiet: no packets at all
                long due = (long)((now - start) * 48.0);
                int frames = (int)Math.Min(due - produced, buf.Length / 2);
                for (int i = 0; i < frames; i++) { float v = (float)(0.5 * Math.Sin(2 * Math.PI * 440 * n++ / 48000)); buf[2 * i] = v; buf[2 * i + 1] = v; }
                produced += frames; SamplesDelivered += frames;
                sink.OnSamples(buf.AsSpan(0, frames * 2), now);
            }
        }) { IsBackground = true };
        _t.Start();
    }
    public void Stop() { _run = false; _t?.Join(500); }
    public void Dispose() => Stop();
}

public static class SessionTests
{
    static (int frames, int gapFrames, int onsets) Run(IAudioSource src, int ms)
    {
        int frames = 0, gaps = 0, onsets = 0;
        using var s = new Session(src, new AnalysisConfig { SampleRate = 48000 }, gapFill: true,
            (f, gap) => { Interlocked.Increment(ref frames); if (gap) Interlocked.Increment(ref gaps); if (f.Onset.IsOnset) Interlocked.Increment(ref onsets); }, _ => { });
        s.Start();
        Thread.Sleep(ms);
        return (frames, gaps, onsets);
    }

    [Test]
    public static void BurstyLoopbackDeliveryDoesNotDuplicateTime()
    {
        var (frames, gaps, onsets) = Run(new PollingSource(50, 66), 3000);
        double rate = frames / 3.0;
        Runner.Note($"bursty 50–66 ms delivery: {rate:F1} frames/s (expect ≤ 93.75), {gaps} gap-filled frames, {onsets} onsets on a steady tone");
        Assert.InRange(85, 95, rate, "frame rate must follow real time");
        Assert.True(gaps == 0, $"no gap fill while audio is flowing (got {gaps})");
        Assert.True(onsets <= 1, $"steady tone must not produce onsets (got {onsets})");
    }

    [Test]
    public static void GapFillKeepsTimeWhenDeliveryReallyStops()
    {
        // packets for 1 s, then nothing (loopback with nothing playing)
        var (frames, gaps, _) = Run(new PollingSource(50, 66, stopAfterMs: 1000), 3000);
        double rate = frames / 3.0;
        Runner.Note($"stop after 1 s: {rate:F1} frames/s overall, {gaps} gap-filled frames");
        Assert.InRange(80, 95, rate, "frames keep flowing at the real rate through silence");
        Assert.True(gaps > 100, "silence after the stop is gap-filled and flagged");
    }
}
