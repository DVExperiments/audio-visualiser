using System.Diagnostics;
namespace AudioViz.Dsp.Tests;

/// <summary>
/// Long-session soak (v0.20): streams synthetic music through the analyser block by block, as the
/// service does, for N simulated minutes, and checks that memory stays flat and every frame is finite.
/// Run: dotnet run -c Release -- --soak 120   (minutes; default 30)
/// </summary>
public static class Soak
{
    public static int Run(int minutes)
    {
        const int sr = 48000, block = 480;
        var fx = new FeatureExtractor(new AnalysisConfig());
        var rng = new Random(7);
        var buf = new float[block * 2];
        long frames = 0, bad = 0, n = 0;
        var sw = Stopwatch.StartNew();
        var mem = new List<long>();
        Console.WriteLine($"Soak: {minutes} simulated minutes of a dense mastered mix at {sr} Hz");
        Console.WriteLine(" minute  managed MB  allocated MB/min  frames/s  CPU ×realtime");
        long alloc0 = GC.GetAllocatedBytesForCurrentThread(); double t0 = 0;
        for (int minute = 1; minute <= minutes; minute++)
        {
            long end = (long)minute * 60 * sr; long f0 = frames;
            while (n < end)
            {
                for (int i = 0; i < block; i++, n++) { var (l, r) = AudioViz.Capture.SyntheticSource.DenseMix(n / (double)sr, sr, rng); buf[2 * i] = l; buf[2 * i + 1] = r; }
                fx.PushInterleaved(buf, n * 1000.0 / sr, f =>
                {
                    frames++;
                    if (!double.IsFinite(f.Dbfs) && !f.Silent) bad++;
                    foreach (var v in f.BandDb) if (double.IsNaN(v)) { bad++; break; }
                    if (!double.IsFinite(f.CentroidHz) || !double.IsFinite(f.FluxLog) || !double.IsFinite(f.Flatness)) bad++;
                });
            }
            GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
            long managed = GC.GetTotalMemory(true), alloc = GC.GetAllocatedBytesForCurrentThread();
            mem.Add(managed);
            double now = sw.Elapsed.TotalSeconds;
            if (minute == 1 || minute % Math.Max(1, minutes / 10) == 0 || minute == minutes)
                Console.WriteLine($" {minute,6}  {managed / 1048576.0,10:F2}  {(alloc - alloc0) / 1048576.0,16:F1}  {(frames - f0) / 60.0,8:F2}  {60 / (now - t0),12:F0}");
            alloc0 = alloc; t0 = now;
        }
        double growth = (mem[^1] - mem[0]) / 1048576.0;
        bool ok = bad == 0 && Math.Abs(growth) < 1.0 && frames > 0;
        Console.WriteLine($"Frames: {frames:N0} ({frames / (minutes * 60.0):F2}/s), non-finite: {bad}, managed memory change after minute 1: {growth:+0.00;-0.00} MB");
        Console.WriteLine(ok ? "SOAK PASSED" : "SOAK FAILED");
        return ok ? 0 : 1;
    }
}
