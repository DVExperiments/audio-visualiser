using System.Diagnostics;
using System.Text.Json;
using System.Threading.Channels;
using AudioViz.Dsp;

namespace AudioViz.Capture;

/// <summary>Monotonic service clock (ms since start) plus the matching Unix time at start.</summary>
public static class Clock
{
    private static readonly Stopwatch Sw = Stopwatch.StartNew();
    public static readonly double UnixAtStartMs = (DateTime.UtcNow - DateTime.UnixEpoch).TotalMilliseconds;
    public static double NowMs => Sw.Elapsed.TotalMilliseconds;
    public static double ToUnixMs(double monoMs) => UnixAtStartMs + monoMs;
}

/// <summary>Receives converted audio from a source. Called on the source's capture thread; must not block.</summary>
public interface ISampleSink
{
    void OnSamples(ReadOnlySpan<float> interleavedStereo, double arrivalMs);
    void OnStopped(Exception? error);
}

public interface IAudioSource : IDisposable
{
    StreamFormat Format { get; }
    string Kind { get; }        // "loopback" | "input" | "synthetic"
    string DeviceName { get; }
    string? DeviceId { get; }
    void Start(ISampleSink sink);
    void Stop();
}

/// <summary>
/// NDJSON writer for stdout. Control messages are never dropped; feature frames go through a
/// bounded queue that drops the OLDEST frame when Electron is not keeping up, so a stalled
/// consumer can never back-pressure the analysis or capture threads.
/// </summary>
public sealed class ProtocolWriter : IDisposable
{
    public const int ProtocolVersion = 1;
    private readonly Stream _out;
    private readonly Channel<byte[]> _control = Channel.CreateUnbounded<byte[]>();
    private readonly Channel<byte[]> _frames = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(32)
    {
        FullMode = BoundedChannelFullMode.DropOldest,
    }, _ => Interlocked.Increment(ref _droppedFrames));
    private readonly SemaphoreSlim _signal = new(0);
    private static long _droppedFrames;
    private readonly Thread _thread;
    private volatile bool _stopping;

    public static long DroppedFrames => Interlocked.Read(ref _droppedFrames);

    public ProtocolWriter(Stream output)
    {
        _out = output;
        _thread = new Thread(Run) { IsBackground = true, Name = "protocol-writer" };
        _thread.Start();
    }

    public void SendControl(Action<Utf8JsonWriter> build) { _control.Writer.TryWrite(Serialize(build)); _signal.Release(); }
    public void SendFrame(byte[] json) { _frames.Writer.TryWrite(json); _signal.Release(); }

    public static byte[] Serialize(Action<Utf8JsonWriter> build)
    {
        using var ms = new MemoryStream(4096);
        using (var w = new Utf8JsonWriter(ms)) { w.WriteStartObject(); build(w); w.WriteEndObject(); }
        return ms.ToArray();
    }

    private void Run()
    {
        var nl = new byte[] { (byte)'\n' };
        try
        {
            while (!_stopping)
            {
                bool wrote = false;
                while (_control.Reader.TryRead(out var c)) { _out.Write(c); _out.Write(nl); wrote = true; }
                if (_frames.Reader.TryRead(out var f)) { _out.Write(f); _out.Write(nl); wrote = true; }
                if (wrote) { _out.Flush(); continue; }
                _signal.Wait(250);
            }
        }
        catch (IOException) { /* parent closed the pipe; the process will exit on stdin EOF */ }
    }

    public void Dispose()
    {
        // give queued control messages (e.g. final status) a moment to flush
        for (int i = 0; i < 20 && _control.Reader.Count > 0; i++) Thread.Sleep(10);
        _stopping = true;
    }

    public static void Error(ProtocolWriter w, string code, string message) => w.SendControl(j =>
    {
        j.WriteString("type", "error"); j.WriteString("code", code); j.WriteString("message", message);
    });
}

/// <summary>Serialises analysis results. Field names are documented in libs/feature-protocol/PROTOCOL.md.</summary>
public static class FrameJson
{
    static void Num(Utf8JsonWriter w, string name, double v, int digits)
        => w.WriteNumber(name, double.IsFinite(v) ? Math.Round(v, digits) : 0);

    static void Arr(Utf8JsonWriter w, string name, ReadOnlySpan<double> v, int digits)
    {
        w.WriteStartArray(name);
        foreach (var x in v) w.WriteNumberValue(double.IsFinite(x) ? Math.Round(x, digits) : 0);
        w.WriteEndArray();
    }

    static void ArrF(Utf8JsonWriter w, string name, float[] v)
    {
        w.WriteStartArray(name);
        foreach (var x in v) w.WriteNumberValue(float.IsFinite(x) ? MathF.Round(x, 4) : 0f);
        w.WriteEndArray();
    }

    public static byte[] Frame(FeatureFrame f, int sampleRate, bool synthetic, bool gapFilled, long droppedInput) =>
        ProtocolWriter.Serialize(w =>
        {
            w.WriteString("type", "frame");
            w.WriteNumber("seq", f.Seq);
            Num(w, "t", f.TimeMs, 3);
            Num(w, "wall", Clock.ToUnixMs(f.TimeMs), 3);
            w.WriteNumber("sr", sampleRate);
            w.WriteBoolean("silent", f.Silent);
            w.WriteBoolean("clip", f.Clipped);
            w.WriteBoolean("gap", gapFilled);
            w.WriteBoolean("synthetic", synthetic);
            w.WriteNumber("nonFinite", f.NonFiniteSamples);
            w.WriteNumber("droppedInput", droppedInput);
            Arr(w, "rms", new[] { f.RmsL, f.RmsR, f.Rms }, 6);
            Arr(w, "dbfs", new[] { f.DbfsL, f.DbfsR, f.Dbfs }, 2);
            Arr(w, "peak", new[] { f.PeakL, f.PeakR }, 5);
            Num(w, "level", f.LevelNorm, 4);
            Arr(w, "bands", f.BandDb, 2);
            Arr(w, "bandsNorm", f.BandNorm, 4);
            Arr(w, "bandsPulse", f.BandPulse, 4);
            Num(w, "levelPulse", f.LevelPulse, 4);
            Arr(w, "spec", f.SpectrumDb, 2);
            Num(w, "flux", f.FluxLinear, 6);
            Num(w, "fluxLog", f.FluxLog, 6);
            w.WriteStartObject("onset");
            w.WriteBoolean("on", f.Onset.IsOnset);
            Num(w, "strength", f.Onset.Strength, 6);
            Num(w, "threshold", f.Onset.Threshold, 6);
            Num(w, "confidence", f.Onset.Confidence, 3);
            w.WriteEndObject();
            Num(w, "centroid", f.CentroidHz, 1);
            Num(w, "flatness", f.Flatness, 4);
            Num(w, "rolloff", f.RolloffHz, 1);
            Num(w, "zcr", f.Zcr, 5);
            Num(w, "balance", f.Balance, 4);
            Num(w, "correlation", f.Correlation, 4);
            Num(w, "width", f.Width, 4);
            ArrF(w, "waveL", f.WaveL);
            ArrF(w, "waveR", f.WaveR);
        });

    public static void Analysis(Utf8JsonWriter w, FeatureExtractor fx)
    {
        var c = fx.Config;
        w.WriteString("type", "analysis");
        w.WriteNumber("sr", c.SampleRate);
        w.WriteNumber("fftSize", c.FftSize);
        w.WriteNumber("lowFftSize", c.LowFftSize);
        w.WriteNumber("lowCrossoverHz", c.LowCrossoverHz);
        w.WriteNumber("hop", c.Hop);
        w.WriteNumber("frameRate", fx.FrameRate);
        w.WriteNumber("binHz", c.SampleRate / c.FftSize);
        w.WriteNumber("windowMs", 1000.0 * c.FftSize / c.SampleRate);
        w.WriteNumber("silenceThresholdDb", c.SilenceThresholdDb);
        w.WriteNumber("onsetLagFrames", OnsetDetector.LagFrames);
        w.WriteStartArray("bands");
        for (int i = 0; i < Bands.Standard.Length; i++)
        {
            var b = Bands.Standard[i];
            w.WriteStartObject();
            w.WriteString("name", b.Name);
            w.WriteNumber("lo", b.LowHz);
            w.WriteNumber("hi", Math.Min(b.HighHz, c.SampleRate / 2));
            w.WriteBoolean("available", fx.BandAvailable[i]);
            w.WriteEndObject();
        }
        w.WriteEndArray();
        w.WriteStartArray("logEdges");
        foreach (var e in fx.LogBandEdges) w.WriteNumberValue(Math.Round(e, 3));
        w.WriteEndArray();
    }
}
