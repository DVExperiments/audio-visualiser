using AudioViz.Capture;

namespace AudioViz.Dsp.Tests;

public static class CaptureCoreTests
{
    static float[] Conv(byte[] bytes, StreamFormat fmt)
    {
        var dst = new float[bytes.Length / fmt.BytesPerFrame * 2];
        SampleConverter.Convert(bytes, fmt, dst);
        return dst;
    }

    [Test]
    public static void Pcm16And32AndFloat()
    {
        var f16 = new StreamFormat(48000, 2, 16, SampleEncoding.Pcm);
        var o = Conv(new byte[] { 0x00, 0x80, 0xFF, 0x7F }, f16); // -32768, 32767
        Assert.Near(-1.0, o[0], 0, "PCM16 min"); Assert.Near(32767 / 32768.0, o[1], 1e-7, "PCM16 max");
        var f32 = new StreamFormat(48000, 1, 32, SampleEncoding.Pcm);
        o = Conv(BitConverter.GetBytes(int.MinValue / 2), f32);
        Assert.Near(-0.5, o[0], 1e-9, "PCM32"); Assert.Near(-0.5, o[1], 1e-9, "mono duplicated to R");
        var ff = new StreamFormat(48000, 2, 32, SampleEncoding.Float);
        o = Conv(BitConverter.GetBytes(0.25f).Concat(BitConverter.GetBytes(-0.75f)).ToArray(), ff);
        Assert.Near(0.25, o[0], 0, "float L"); Assert.Near(-0.75, o[1], 0, "float R");
    }

    [Test]
    public static void Pcm24SignExtension()
    {
        var f24 = new StreamFormat(48000, 2, 24, SampleEncoding.Pcm);
        // L = -8388608 (0x800000), R = -1 (0xFFFFFF); then L = 8388607, R = 1
        var o = Conv(new byte[] { 0x00, 0x00, 0x80, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x7F, 0x01, 0x00, 0x00 }, f24);
        Assert.Near(-1.0, o[0], 0, "24-bit min");
        Assert.Near(-1.0 / 8388608, o[1], 1e-12, "24-bit -1");
        Assert.Near(8388607 / 8388608.0, o[2], 1e-7, "24-bit max");
        Assert.Near(1.0 / 8388608, o[3], 1e-12, "24-bit +1");
    }

    [Test]
    public static void Surround51FoldDown()
    {
        var fmt = new StreamFormat(48000, 6, 32, SampleEncoding.Float);
        // FL FR FC LFE BL BR
        float[] ch = { 0.1f, 0.2f, 0.4f, 0.9f, 0.3f, 0.5f };
        var o = Conv(ch.SelectMany(BitConverter.GetBytes).ToArray(), fmt);
        const double k = 0.70710678;
        Assert.Near(0.1 + k * 0.4 + k * 0.3, o[0], 1e-6, "L = FL + k·FC + k·BL (LFE omitted)");
        Assert.Near(0.2 + k * 0.4 + k * 0.5, o[1], 1e-6, "R = FR + k·FC + k·BR");
    }

    [Test]
    public static void RingWrapsAndDropsWithoutBlocking()
    {
        var ring = new SpscFloatRing(16);
        var a = Enumerable.Range(0, 12).Select(i => (float)i).ToArray();
        Assert.True(ring.TryWrite(a), "first write fits");
        var outBuf = new float[10];
        Assert.True(ring.Read(outBuf) == 10, "read 10");
        Assert.True(ring.TryWrite(Enumerable.Range(12, 12).Select(i => (float)i).ToArray()), "wrapping write fits (14 used)");
        Assert.True(!ring.TryWrite(new float[3]), "overflow rejected, not blocked");
        Assert.True(ring.DroppedFloats == 3, "drop counted");
        var rest = new float[20];
        int n = ring.Read(rest);
        Assert.True(n == 14, $"read {n}");
        for (int i = 0; i < n; i++) Assert.Near(10 + i, rest[i], 0, "order preserved across wrap");
    }

    [Test]
    public static void RingIsSafeUnderConcurrentProducerConsumer()
    {
        var ring = new SpscFloatRing(1 << 10);
        const int total = 2_000_000;
        long sum = 0; int got = 0;
        var consumer = new Thread(() =>
        {
            var buf = new float[300];
            float expect = 0;
            while (got < total)
            {
                int n = ring.Read(buf);
                for (int i = 0; i < n; i++) { if (buf[i] != expect) throw new Exception($"sequence broken at {got + i}"); expect = (expect + 1) % 1000; sum += (long)buf[i]; }
                got += n;
            }
        });
        consumer.Start();
        var block = new float[100]; int sent = 0; float v = 0;
        while (sent < total)
        {
            for (int i = 0; i < block.Length; i++) { block[i] = v; v = (v + 1) % 1000; }
            while (!ring.TryWrite(block)) { Thread.SpinWait(20); }   // test only: retry instead of dropping
            sent += block.Length;
        }
        Assert.True(consumer.Join(20000), "consumer finished");
        Assert.True(got == total, "all samples received in order");
    }
}
