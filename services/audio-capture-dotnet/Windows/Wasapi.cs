using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wave;

namespace AudioViz.Capture.Windows;

public sealed record DeviceInfo(string Id, string Name, string Flow, bool IsDefault);

/// <summary>
/// Shared-mode WASAPI capture. "loopback" captures what a render (output) device is playing —
/// playback is not muted or altered. "input" captures a microphone/line input. Nothing is ever
/// rendered back to speakers, so there is no monitoring/feedback path.
/// </summary>
public sealed class WasapiSource : IAudioSource
{
    public StreamFormat Format { get; }
    public string Kind { get; }
    public string DeviceName { get; }
    public string? DeviceId { get; }

    private readonly MMDevice _device;
    private readonly WasapiCapture _capture;
    private ISampleSink? _sink;
    private float[] _scratch = new float[48000 * 2];
    private readonly ManualResetEventSlim _stopped = new(true);

    public WasapiSource(MMDevice device, bool loopback)
    {
        _device = device;
        Kind = loopback ? "loopback" : "input";
        DeviceId = device.ID;
        DeviceName = SafeName(device);
        // input: 20 ms event-driven. loopback: polled (event callbacks are not reliable for loopback
        // across Windows versions) with a 60 ms buffer → ~30 ms poll period instead of NAudio's 100/50.
        _capture = loopback ? new PolledLoopbackCapture(device, 60) : new WasapiCapture(device, true, 20);
        Format = ToStreamFormat(_capture.WaveFormat);
        if (!Format.IsSupported)
        {
            _capture.Dispose();
            throw new NotSupportedException($"Unsupported device mix format: {_capture.WaveFormat}");
        }
        _capture.DataAvailable += OnData;
        _capture.RecordingStopped += OnStopped;
    }

    internal static StreamFormat ToStreamFormat(WaveFormat wf)
    {
        // NAudio's WasapiCapture.WaveFormat already converts WAVEFORMATEXTENSIBLE to IeeeFloat/Pcm.
        var enc = wf.Encoding == WaveFormatEncoding.IeeeFloat ? SampleEncoding.Float : SampleEncoding.Pcm;
        bool known = wf.Encoding == WaveFormatEncoding.IeeeFloat || wf.Encoding == WaveFormatEncoding.Pcm;
        return new StreamFormat(wf.SampleRate, wf.Channels, known ? wf.BitsPerSample : 0, enc);
    }

    public void Start(ISampleSink sink)
    {
        _sink = sink;
        _stopped.Reset();
        _capture.StartRecording();
    }

    private void OnData(object? sender, WaveInEventArgs e)
    {
        if (e.BytesRecorded <= 0 || _sink is null) return;
        double arrival = Clock.NowMs;
        int frames = e.BytesRecorded / Format.BytesPerFrame;
        if (_scratch.Length < frames * 2) _scratch = new float[frames * 2];
        int n = SampleConverter.Convert(e.Buffer.AsSpan(0, frames * Format.BytesPerFrame), Format, _scratch);
        _sink.OnSamples(_scratch.AsSpan(0, n * 2), arrival);
    }

    private void OnStopped(object? sender, StoppedEventArgs e)
    {
        _stopped.Set();
        _sink?.OnStopped(e.Exception);
    }

    public void Stop()
    {
        try { _capture.StopRecording(); } catch { }
        _stopped.Wait(2000);
    }

    public void Dispose()
    {
        Stop();
        _capture.DataAvailable -= OnData;
        _capture.RecordingStopped -= OnStopped;
        try { _capture.Dispose(); } catch { }
        try { _device.Dispose(); } catch { }
    }

    internal static string SafeName(MMDevice d)
    {
        try { return d.FriendlyName; } catch { return "(unnamed device)"; }
    }
}

/// <summary>WASAPI loopback with a configurable buffer (NAudio's WasapiLoopbackCapture fixes it at 100 ms).</summary>
internal sealed class PolledLoopbackCapture : WasapiCapture
{
    public PolledLoopbackCapture(MMDevice device, int bufferMs) : base(device, false, bufferMs) { }
    protected override AudioClientStreamFlags GetAudioClientStreamFlags() => AudioClientStreamFlags.Loopback | base.GetAudioClientStreamFlags();
}

/// <summary>Device enumeration plus IMMNotificationClient change events (forwarded, never handled on the COM thread).</summary>
public sealed class DeviceCatalog : IMMNotificationClient, IDisposable
{
    private readonly MMDeviceEnumerator _enumerator = new();
    private readonly Action<string, string?> _onChange; // (kind, deviceId)
    private bool _registered;

    public DeviceCatalog(Action<string, string?> onChange)
    {
        _onChange = onChange;
        _registered = _enumerator.RegisterEndpointNotificationCallback(this) == 0;
    }

    public List<DeviceInfo> List(DataFlow flow)
    {
        string? defaultId = null;
        try { if (_enumerator.HasDefaultAudioEndpoint(flow, Role.Multimedia)) defaultId = _enumerator.GetDefaultAudioEndpoint(flow, Role.Multimedia).ID; } catch { }
        var list = new List<DeviceInfo>();
        foreach (var d in _enumerator.EnumerateAudioEndPoints(flow, DeviceState.Active))
        {
            try { list.Add(new DeviceInfo(d.ID, WasapiSource.SafeName(d), flow == DataFlow.Render ? "render" : "capture", d.ID == defaultId)); }
            finally { d.Dispose(); }
        }
        return list;
    }

    /// <summary>Resolve a device by id, or the current default when id is null. Returns null if unavailable.</summary>
    public MMDevice? Resolve(DataFlow flow, string? id)
    {
        try
        {
            if (id is null)
                return _enumerator.HasDefaultAudioEndpoint(flow, Role.Multimedia) ? _enumerator.GetDefaultAudioEndpoint(flow, Role.Multimedia) : null;
            var d = _enumerator.GetDevice(id);
            if (d.State != DeviceState.Active) { d.Dispose(); return null; }
            return d;
        }
        catch { return null; }
    }

    // IMMNotificationClient — called on a COM thread: only forward.
    public void OnDeviceStateChanged(string deviceId, DeviceState newState) => _onChange("state", deviceId);
    public void OnDeviceAdded(string pwstrDeviceId) => _onChange("added", pwstrDeviceId);
    public void OnDeviceRemoved(string deviceId) => _onChange("removed", deviceId);
    public void OnDefaultDeviceChanged(DataFlow flow, Role role, string defaultDeviceId)
    {
        if (role == Role.Multimedia) _onChange(flow == DataFlow.Render ? "defaultRender" : "defaultCapture", defaultDeviceId);
    }
    public void OnPropertyValueChanged(string pwstrDeviceId, PropertyKey key) { /* names/format changes: ignored in v0.1 */ }

    public void Dispose()
    {
        if (_registered) { try { _enumerator.UnregisterEndpointNotificationCallback(this); } catch { } _registered = false; }
        _enumerator.Dispose();
    }
}
