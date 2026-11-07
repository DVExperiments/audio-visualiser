using System.Collections.Concurrent;
using System.Text.Json;
using AudioViz.Capture.Windows;
using AudioViz.Dsp;
using NAudio.CoreAudioApi;

namespace AudioViz.Capture;

public sealed record CaptureRequest(string Source, string? DeviceId, string? Signal);

/// <summary>
/// All device/session state changes happen on ONE control thread (commands from stdin, device
/// notifications and recovery timers are posted here), so there are no start/stop races.
/// </summary>
public sealed class Controller : IDisposable
{
    private readonly ProtocolWriter _out;
    private readonly BlockingCollection<Action> _queue = new();
    private readonly Thread _thread;
    private DeviceCatalog? _catalog;
    private Session? _session;
    private CaptureRequest? _request;
    private int _restartAttempt;
    private Timer? _restartTimer, _debounce, _statsTimer;
    private long _framesSent;
    private Tuning _tuning = new();

    public Controller(ProtocolWriter output)
    {
        _out = output;
        _thread = new Thread(Loop) { IsBackground = true, Name = "control" };
        _thread.Start();
        Post(() =>
        {
            try { _catalog = new DeviceCatalog(OnDeviceEvent); }
            catch (Exception e) { ProtocolWriter.Error(_out, "deviceEnumeration", e.Message); }
        });
        _statsTimer = new Timer(_ => Post(SendStats), null, 1000, 1000);
    }

    public void Post(Action a) { if (!_queue.IsAddingCompleted) _queue.Add(a); }

    private void Loop()
    {
        foreach (var a in _queue.GetConsumingEnumerable())
        {
            try { a(); }
            catch (Exception e) { Console.Error.WriteLine($"[control] {e}"); ProtocolWriter.Error(_out, "internal", e.Message); }
        }
    }

    // ---------------- commands ----------------
    public void Handle(JsonElement cmd)
    {
        string name = cmd.TryGetProperty("cmd", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString()! : "";
        switch (name)
        {
            case "listDevices": Post(SendDevices); break;
            case "start":
                {
                    string source = Str(cmd, "source") ?? "loopback";
                    if (source is not ("loopback" or "input" or "synthetic")) { ProtocolWriter.Error(_out, "badCommand", $"Unknown source '{source}'."); return; }
                    var req = new CaptureRequest(source, Str(cmd, "deviceId"), Str(cmd, "signal"));
                    Post(() => { _request = req; _restartAttempt = 0; StartSession(); });
                    break;
                }
            case "stop": Post(() => { _request = null; StopSession("stopped"); }); break;
            case "tune":
                {
                    double G(string k, double d) => cmd.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : d;
                    var t = Tuning.Clamp(G("gainDb", 0), G("silenceDb", -70), G("pulseRangeDb", 8));
                    Post(() =>
                    {
                        _tuning = t;
                        _session?.Extractor.SetTuning(t);
                        _out.SendControl(w => { w.WriteString("type", "tuning"); w.WriteNumber("gainDb", t.GainDb); w.WriteNumber("silenceDb", t.SilenceDb); w.WriteNumber("pulseRangeDb", t.PulseRangeDb); });
                    });
                    break;
                }
            case "ping": _out.SendControl(w => { w.WriteString("type", "pong"); w.WriteNumber("t", Clock.NowMs); }); break;
            default: ProtocolWriter.Error(_out, "badCommand", $"Unknown command '{name}'."); break;
        }
    }

    static string? Str(JsonElement e, string p)
    {
        if (!e.TryGetProperty(p, out var v) || v.ValueKind != JsonValueKind.String) return null;
        var s = v.GetString();
        return string.IsNullOrWhiteSpace(s) || s.Length > 512 ? null : s;
    }

    // ---------------- sessions ----------------
    private void StartSession()
    {
        StopSession(null);
        var req = _request;
        if (req is null) return;
        Status("starting", req, null);

        IAudioSource source;
        try
        {
            if (req.Source == "synthetic") source = new SyntheticSource(req.Signal ?? "beat");
            else
            {
                if (_catalog is null) throw new InvalidOperationException("Audio device enumeration is unavailable.");
                var flow = req.Source == "loopback" ? DataFlow.Render : DataFlow.Capture;
                var dev = _catalog.Resolve(flow, req.DeviceId)
                          ?? throw new InvalidOperationException(req.DeviceId is null
                                ? $"No default {(flow == DataFlow.Render ? "output" : "input")} device is available."
                                : "The selected device is not available (unplugged or disabled).");
                source = new WasapiSource(dev, loopback: req.Source == "loopback");
            }
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"[control] open failed: {e.Message}");
            ScheduleRestart(req, e.Message);
            return;
        }

        var cfg = new AnalysisConfig { SampleRate = source.Format.SampleRate };
        bool synthetic = req.Source == "synthetic";
        Session? session = null;
        session = new Session(source, cfg, gapFill: !synthetic,
            onFrame: (f, gap) =>
            {
                _out.SendFrame(FrameJson.Frame(f, source.Format.SampleRate, synthetic, gap, session?.DroppedInputFrames ?? 0));
                Interlocked.Increment(ref _framesSent);
                if (f.Seq == 200) Post(() => _restartAttempt = 0); // ~2 s of healthy frames resets backoff
            },
            onStopped: err => Post(() =>
            {
                if (_session != session) return; // stale
                if (err is null) return;            // normal stop
                Console.Error.WriteLine($"[control] capture stopped: {err.Message}");
                StopSession(null);
                ScheduleRestart(req, err.Message);
            }));
        try
        {
            session.Start();
            _session = session;
            session.Extractor.SetTuning(_tuning);      // the input's calibration survives restarts and device changes
            _out.SendControl(w => FrameJson.Analysis(w, session.Extractor));
            Status("running", req, source);
        }
        catch (Exception e)
        {
            session.Dispose();
            ScheduleRestart(req, e.Message);
        }
    }

    private void StopSession(string? reportState)
    {
        _restartTimer?.Dispose(); _restartTimer = null;
        var s = _session; _session = null;
        s?.Dispose();
        if (reportState != null) Status(reportState, _request, null);
    }

    private void ScheduleRestart(CaptureRequest req, string reason)
    {
        double[] delays = { 0.5, 1, 2, 4, 5 };
        double d = delays[Math.Min(_restartAttempt, delays.Length - 1)];
        _restartAttempt++;
        Status("recovering", req, null, $"{reason} Retrying in {d:0.#} s.");
        _restartTimer?.Dispose();
        _restartTimer = new Timer(_ => Post(() => { if (_request == req) StartSession(); }), null, (int)(d * 1000), Timeout.Infinite);
    }

    // ---------------- device notifications ----------------
    private void OnDeviceEvent(string kind, string? deviceId)
    {
        // COM thread: debounce bursts (Windows often sends several events per change) then handle on control thread
        _debounce?.Dispose();
        _debounce = new Timer(_ => Post(() => HandleDeviceChange()), null, 300, Timeout.Infinite);
        if (kind is "defaultRender" or "defaultCapture") Post(() => _pendingDefault = kind);
    }
    private string? _pendingDefault;

    private void HandleDeviceChange()
    {
        SendDevices();
        var req = _request;
        if (req is null || req.Source == "synthetic") return;
        var flow = req.Source == "loopback" ? DataFlow.Render : DataFlow.Capture;
        bool followsDefault = req.DeviceId is null;
        bool defaultChanged = (_pendingDefault == "defaultRender" && flow == DataFlow.Render) || (_pendingDefault == "defaultCapture" && flow == DataFlow.Capture);
        _pendingDefault = null;

        if (_session is null) { _restartAttempt = 0; StartSession(); return; } // device may have come back
        if (followsDefault && defaultChanged) { StartSession(); return; }
        using var still = _catalog?.Resolve(flow, _session.Source.DeviceId);
        if (still is null) { StopSession(null); ScheduleRestart(req, "The capture device was removed."); }
    }

    // ---------------- outgoing messages ----------------
    private void SendDevices()
    {
        if (_catalog is null) return;
        List<DeviceInfo> render, capture;
        try { render = _catalog.List(DataFlow.Render); capture = _catalog.List(DataFlow.Capture); }
        catch (Exception e) { ProtocolWriter.Error(_out, "deviceEnumeration", e.Message); return; }
        _out.SendControl(w =>
        {
            w.WriteString("type", "devices");
            void Write(string name, List<DeviceInfo> list)
            {
                w.WriteStartArray(name);
                foreach (var d in list)
                {
                    w.WriteStartObject();
                    w.WriteString("id", d.Id); w.WriteString("name", d.Name); w.WriteBoolean("isDefault", d.IsDefault);
                    w.WriteEndObject();
                }
                w.WriteEndArray();
            }
            Write("render", render);
            Write("capture", capture);
            w.WriteStartArray("signals");
            foreach (var s in SyntheticSource.Signals) w.WriteStringValue(s);
            w.WriteEndArray();
        });
    }

    private void Status(string state, CaptureRequest? req, IAudioSource? src, string? message = null) => _out.SendControl(w =>
    {
        w.WriteString("type", "status");
        w.WriteString("state", state);
        if (req != null) { w.WriteString("source", req.Source); if (req.DeviceId != null) w.WriteString("requestedDeviceId", req.DeviceId); }
        if (src != null)
        {
            w.WriteString("deviceName", src.DeviceName);
            if (src.DeviceId != null) w.WriteString("deviceId", src.DeviceId);
            w.WriteString("format", src.Format.ToString());
            w.WriteNumber("channels", src.Format.Channels);
        }
        if (message != null) w.WriteString("message", message);
    });

    private void SendStats()
    {
        var s = _session;
        _out.SendControl(w =>
        {
            w.WriteString("type", "stats");
            w.WriteNumber("t", Clock.NowMs);
            w.WriteNumber("framesSent", Interlocked.Read(ref _framesSent));
            w.WriteNumber("framesDroppedIpc", ProtocolWriter.DroppedFrames);
            w.WriteNumber("inputFramesDropped", s?.DroppedInputFrames ?? 0);
            w.WriteNumber("overlapFramesDropped", s?.OverlapDroppedFrames ?? 0);
            w.WriteNumber("gapFillThresholdMs", Math.Round(s?.GapFillThresholdMs ?? 0, 1));
            w.WriteNumber("managedMemoryMb", Math.Round(GC.GetTotalMemory(false) / 1048576.0, 1));
        });
    }

    public void Dispose()
    {
        var done = new ManualResetEventSlim();
        Post(() => { bool had = _session != null; _request = null; StopSession(had ? "stopped" : null); _catalog?.Dispose(); done.Set(); });
        done.Wait(3000);
        _statsTimer?.Dispose();
        _queue.CompleteAdding();
    }
}
