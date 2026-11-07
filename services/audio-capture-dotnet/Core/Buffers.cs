using System.Buffers.Binary;

namespace AudioViz.Capture;

/// <summary>
/// Single-producer / single-consumer lock-free ring of floats. The producer (audio callback)
/// never blocks: if there is not enough space the whole block is dropped and counted.
/// </summary>
public sealed class SpscFloatRing
{
    private readonly float[] _buf;
    private readonly int _mask;
    private long _write; // only producer writes
    private long _read;  // only consumer writes
    private long _dropped;

    public SpscFloatRing(int capacityPow2)
    {
        if (capacityPow2 < 2 || (capacityPow2 & (capacityPow2 - 1)) != 0) throw new ArgumentException("capacity must be a power of two");
        _buf = new float[capacityPow2];
        _mask = capacityPow2 - 1;
    }

    public int Capacity => _buf.Length;
    public long DroppedFloats => Interlocked.Read(ref _dropped);
    public int Available => (int)(Volatile.Read(ref _write) - Volatile.Read(ref _read));

    /// <summary>Producer side. Returns false (and drops the data) if the ring is too full.</summary>
    public bool TryWrite(ReadOnlySpan<float> data)
    {
        long w = _write, r = Volatile.Read(ref _read);
        if (_buf.Length - (w - r) < data.Length) { Interlocked.Add(ref _dropped, data.Length); return false; }
        int start = (int)(w & _mask);
        int first = Math.Min(data.Length, _buf.Length - start);
        data[..first].CopyTo(_buf.AsSpan(start));
        data[first..].CopyTo(_buf.AsSpan(0));
        Volatile.Write(ref _write, w + data.Length);
        return true;
    }

    /// <summary>Consumer side. Reads up to dest.Length floats; returns count read.</summary>
    public int Read(Span<float> dest)
    {
        long r = _read, w = Volatile.Read(ref _write);
        int n = (int)Math.Min(dest.Length, w - r);
        if (n <= 0) return 0;
        int start = (int)(r & _mask);
        int first = Math.Min(n, _buf.Length - start);
        _buf.AsSpan(start, first).CopyTo(dest);
        _buf.AsSpan(0, n - first).CopyTo(dest[first..]);
        Volatile.Write(ref _read, r + n);
        return n;
    }

    public void Clear() { Volatile.Write(ref _read, Volatile.Read(ref _write)); }
}

public enum SampleEncoding { Float, Pcm }

public readonly record struct StreamFormat(int SampleRate, int Channels, int BitsPerSample, SampleEncoding Encoding)
{
    public int BytesPerFrame => Channels * BitsPerSample / 8;
    public bool IsSupported =>
        SampleRate > 0 && Channels >= 1 && Channels <= 32 &&
        ((Encoding == SampleEncoding.Float && BitsPerSample == 32) ||
         (Encoding == SampleEncoding.Pcm && (BitsPerSample == 16 || BitsPerSample == 24 || BitsPerSample == 32)));
    public override string ToString() => $"{SampleRate} Hz, {Channels} ch, {BitsPerSample}-bit {(Encoding == SampleEncoding.Float ? "float" : "PCM")}";
}

/// <summary>
/// Converts device-format bytes into interleaved stereo float [-1, 1].
/// Channel handling:
///   1 ch  → L = R = ch0
///   2 ch  → L = ch0, R = ch1
///   6 ch (5.1, WAVEFORMATEXTENSIBLE standard order FL FR FC LFE BL BR) and
///   8 ch (7.1, FL FR FC LFE BL BR SL SR) → ITU-R BS.775-style fold-down without normalisation:
///         L = FL + 0.7071*FC + 0.7071*(BL [+ SL]),  R likewise; LFE omitted (as BS.775 does).
///   other → L = ch0, R = ch1 (documented limitation).
/// Assumes the standard speaker order because NAudio 2.2.1 does not expose dwChannelMask.
/// </summary>
public static class SampleConverter
{
    const float K = 0.70710678f;

    public static int Convert(ReadOnlySpan<byte> src, StreamFormat fmt, Span<float> dstStereo)
    {
        int bpf = fmt.BytesPerFrame;
        int frames = src.Length / bpf;
        if (dstStereo.Length < frames * 2) throw new ArgumentException("destination too small");
        int bps = fmt.BitsPerSample / 8;
        int ch = fmt.Channels;

        for (int i = 0; i < frames; i++)
        {
            var frame = src.Slice(i * bpf, bpf);
            float l, r;
            switch (ch)
            {
                case 1: l = r = Read(frame, 0, bps, fmt); break;
                case 6:
                    {
                        float c = Read(frame, 2, bps, fmt) * K;
                        l = Read(frame, 0, bps, fmt) + c + K * Read(frame, 4, bps, fmt);
                        r = Read(frame, 1, bps, fmt) + c + K * Read(frame, 5, bps, fmt);
                        break;
                    }
                case 8:
                    {
                        float c = Read(frame, 2, bps, fmt) * K;
                        l = Read(frame, 0, bps, fmt) + c + K * (Read(frame, 4, bps, fmt) + Read(frame, 6, bps, fmt));
                        r = Read(frame, 1, bps, fmt) + c + K * (Read(frame, 5, bps, fmt) + Read(frame, 7, bps, fmt));
                        break;
                    }
                default: l = Read(frame, 0, bps, fmt); r = Read(frame, 1, bps, fmt); break;
            }
            dstStereo[2 * i] = l; dstStereo[2 * i + 1] = r;
        }
        return frames;
    }

    static float Read(ReadOnlySpan<byte> frame, int channel, int bytesPerSample, StreamFormat fmt)
    {
        var b = frame.Slice(channel * bytesPerSample, bytesPerSample);
        if (fmt.Encoding == SampleEncoding.Float) return BinaryPrimitives.ReadSingleLittleEndian(b);
        return fmt.BitsPerSample switch
        {
            16 => BinaryPrimitives.ReadInt16LittleEndian(b) / 32768f,
            24 => ((b[0] | (b[1] << 8) | (b[2] << 16)) << 8 >> 8) / 8388608f,  // sign-extend 24-bit
            32 => (float)(BinaryPrimitives.ReadInt32LittleEndian(b) / 2147483648.0),
            _ => 0f,
        };
    }
}
