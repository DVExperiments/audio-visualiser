namespace AudioViz.Dsp;

public sealed class AnalysisConfig
{
    public double SampleRate { get; init; } = 48000;
    /// <summary>Main FFT (transients, spectral shape, flux, mid/high bands). Power of two.</summary>
    public int FftSize { get; init; } = 2048;
    /// <summary>
    /// Longer FFT used for bands below LowCrossoverHz (sub-bass, bass, low log-bands).
    /// 0 disables multiresolution. At 48 kHz, 4096 gives 11.7 Hz bins (window 85 ms).
    /// </summary>
    public int LowFftSize { get; init; } = 4096;
    public double LowCrossoverHz { get; init; } = 250;
    public int Hop { get; init; } = 512;
    public int LogBandCount { get; init; } = 48;
    public double LogMinHz { get; init; } = 20;
    public double LogMaxHz { get; init; } = 20000;
    /// <summary>Frames whose mean-power level is below this are flagged silent (dBFS).</summary>
    public double SilenceThresholdDb { get; init; } = -100;   // hard floor; the live threshold is Tuning.SilenceDb (default −70)
    public double RolloffFraction { get; init; } = 0.85;
    /// <summary>Compression constant for log-magnitude flux: log(1 + gamma * amplitude).</summary>
    public double FluxLogGamma { get; init; } = 100;
    /// <summary>
    /// SuperFlux vibrato suppression (Böck &amp; Widmer, DAFx 2013): compare each bin with the MAXIMUM
    /// of the previous frame over ±this many bins. Pitch wobble moves energy into a neighbouring bin,
    /// which plain flux counts as new energy (false onsets); the max filter cancels it while real
    /// attacks, which raise many bins at once, still register. 0 = plain flux (v0.1–v0.8).
    /// </summary>
    public int OnsetMaxFilterBins { get; init; } = 1;
    /// <summary>
    /// Widen the max filter in proportion to frequency, to ±this many cents (SuperFlux works on a
    /// log-frequency filterbank, where a vibrato of fixed cents spans a fixed number of bands; on a
    /// linear FFT grid the same vibrato spans more bins at higher harmonics). 0 = fixed width only.
    /// </summary>
    public double OnsetMaxFilterCents { get; init; } = 50;
    /// <summary>A band's normalisation ceiling may not sit more than this far below the loudest band's.</summary>
    public double BandCouplingDb { get; init; } = 20;

    public void Validate()
    {
        if (!(SampleRate >= 8000 && SampleRate <= 768000)) throw new ArgumentOutOfRangeException(nameof(SampleRate));
        if (Hop < 1 || Hop > FftSize) throw new ArgumentOutOfRangeException(nameof(Hop));
        if (LowFftSize != 0 && LowFftSize < FftSize) throw new ArgumentOutOfRangeException(nameof(LowFftSize));
    }
}

/// <summary>
/// Live input tuning (v0.12, set by the calibration wizard or the Audio settings), applied BEFORE
/// analysis: gain scales the samples, so silence detection, adaptive levels and pulses all see the
/// corrected signal (a quiet microphone gets real beat response, not a cosmetic boost).
/// </summary>
public sealed record Tuning(double GainDb = 0, double SilenceDb = -70, double PulseRangeDb = 8, double PulseFloorDb = -85)
{
    public static Tuning Clamp(double gainDb, double silenceDb, double pulseRangeDb) => new(
        Math.Clamp(double.IsFinite(gainDb) ? gainDb : 0, -24, 36),
        Math.Clamp(double.IsFinite(silenceDb) ? silenceDb : -70, -100, -20),
        Math.Clamp(double.IsFinite(pulseRangeDb) ? pulseRangeDb : 8, 3, 16),
        Math.Clamp(double.IsFinite(silenceDb) ? silenceDb - 15 : -85, -115, -35));
}

/// <summary>One analysis frame. All levels are relative to digital full scale (|x| = 1.0).</summary>
public sealed class FeatureFrame
{
    public long Seq;
    /// <summary>Estimated capture time of the last sample in the frame, ms (service monotonic clock).</summary>
    public double TimeMs;
    public bool Silent;
    public bool Clipped;
    public int NonFiniteSamples;

    // Level (window = FftSize samples). dBFS uses the brief's definition 20*log10(RMS):
    // a full-scale sine therefore reads -3.01 dBFS.
    public double RmsL, RmsR, Rms, DbfsL, DbfsR, Dbfs, LevelNorm;
    // Sample peak over the hop's new samples (not true-peak / inter-sample peak).
    public double PeakL, PeakR;

    public double[] BandDb = Array.Empty<double>();     // 10*log10(band mean-square power)
    public double[] BandNorm = Array.Empty<double>();   // adaptive 0..1
    public double[] BandPulse = Array.Empty<double>();  // 0..1: rise above the band's recent typical level
    public double LevelPulse;
    public double[] SpectrumDb = Array.Empty<double>(); // log-spaced bands, 10*log10(power)

    public double FluxLinear, FluxLog;
    public OnsetResult Onset;

    public double CentroidHz, Flatness, RolloffHz, Zcr;
    public double Balance, Correlation, Width;

    public float[] WaveL = Array.Empty<float>(), WaveR = Array.Empty<float>();
}

/// <summary>
/// Streaming feature extractor. Push stereo samples; every Hop samples a FeatureFrame is produced.
/// Mono sources should be pushed with L == R. Thread-compatible (not thread-safe): one producer.
///
/// Stereo handling: spectra are computed per channel and *powers* are averaged, never the
/// samples, so opposite-phase content (L = -R) is not cancelled as it would be by (L+R)/2.
/// </summary>
public sealed class FeatureExtractor
{
    public AnalysisConfig Config { get; }
    public double[] LogBandEdges { get; }
    public double FrameRate => Config.SampleRate / Config.Hop;
    public bool[] BandAvailable { get; }

    private readonly int _histLen;
    private readonly double[] _histL, _histR;
    private int _writePos;
    private long _totalSamples;
    private int _sinceHop;
    private long _seq;

    private readonly SpectrumAnalyzer _main, _low;
    private readonly double[] _winL, _winR, _lowWinL, _lowWinR;
    private readonly double[] _pL, _pR, _aL, _aR, _lpL, _lpR, _laL, _laR;
    private readonly double[] _power, _amp, _lowPower, _prevAmp, _prevLogAmp, _logAmp;
    private bool _havePrev;
    private readonly float[] _hopL, _hopR;
    private int _nonFinite;

    private readonly OnsetDetector _onset;
    private readonly AdaptiveNormalizer[] _bandNorm;
    private readonly AdaptiveNormalizer _levelNorm = new();
    private readonly PulseTracker[] _bandPulse;
    private readonly PulseTracker _levelPulse;

    public FeatureExtractor(AnalysisConfig config)
    {
        config.Validate();
        Config = config;
        _main = new SpectrumAnalyzer(config.FftSize, config.SampleRate);
        _low = new SpectrumAnalyzer(config.LowFftSize == 0 ? config.FftSize : config.LowFftSize, config.SampleRate);
        _histLen = Math.Max(config.FftSize, _low.Size);
        _histL = new double[_histLen]; _histR = new double[_histLen];

        _winL = new double[_main.Size]; _winR = new double[_main.Size];
        _lowWinL = new double[_low.Size]; _lowWinR = new double[_low.Size];
        _pL = new double[_main.BinCount]; _pR = new double[_main.BinCount];
        _aL = new double[_main.BinCount]; _aR = new double[_main.BinCount];
        _lpL = new double[_low.BinCount]; _lpR = new double[_low.BinCount];
        _laL = new double[_low.BinCount]; _laR = new double[_low.BinCount];
        _power = new double[_main.BinCount]; _amp = new double[_main.BinCount];
        _lowPower = new double[_low.BinCount];
        _prevAmp = new double[_main.BinCount];
        _logAmp = new double[_main.BinCount]; _prevLogAmp = new double[_main.BinCount];
        _hopL = new float[config.Hop]; _hopR = new float[config.Hop];

        double maxHz = Math.Min(config.LogMaxHz, config.SampleRate / 2.0);
        LogBandEdges = Bands.LogEdges(config.LogBandCount, config.LogMinHz, maxHz);
        BandAvailable = Bands.Standard.Select(b => Bands.IsAvailable(b, config.SampleRate)).ToArray();
        _bandNorm = Bands.Standard.Select(_ => new AdaptiveNormalizer()).ToArray();
        int pulseHist = Math.Max(3, (int)Math.Round(1.5 * FrameRate));   // 1.5 s median window (1.0 s tested: worse)
        _bandPulse = Bands.Standard.Select(_ => new PulseTracker(pulseHist)).ToArray();
        _levelPulse = new PulseTracker(pulseHist);
        _onset = new OnsetDetector(historyFrames: Math.Max(5, (int)Math.Round(FrameRate)));
    }

    public long TotalSamples => _totalSamples;

    /// <summary>
    /// Push interleaved stereo samples [L0, R0, L1, R1, ...].
    /// endTimeMs = estimated capture time of the LAST sample in this block (or NaN if unknown).
    /// </summary>
    private Tuning _tuning = new();
    public Tuning CurrentTuning => Volatile.Read(ref _tuning);
    /// <summary>Thread-safe: takes effect from the next pushed block.</summary>
    public void SetTuning(Tuning t) => Volatile.Write(ref _tuning, t);

    public void PushInterleaved(ReadOnlySpan<float> interleaved, double endTimeMs, Action<FeatureFrame> onFrame)
    {
        var tuning = Volatile.Read(ref _tuning);
        double gain = Math.Pow(10, tuning.GainDb / 20);
        int frames = interleaved.Length / 2;
        for (int i = 0; i < frames; i++)
        {
            double l = interleaved[2 * i] * gain, r = interleaved[2 * i + 1] * gain;
            if (!double.IsFinite(l)) { l = 0; _nonFinite++; }
            if (!double.IsFinite(r)) { r = 0; _nonFinite++; }
            _histL[_writePos] = l; _histR[_writePos] = r;
            _hopL[_sinceHop] = (float)l; _hopR[_sinceHop] = (float)r;
            _writePos = (_writePos + 1) % _histLen;
            _totalSamples++;
            _sinceHop++;
            if (_sinceHop == Config.Hop)
            {
                _sinceHop = 0;
                double t = double.IsFinite(endTimeMs) ? endTimeMs - (frames - 1 - i) * 1000.0 / Config.SampleRate : double.NaN;
                onFrame(ComputeFrame(t));
            }
        }
    }

    private void CopyLatest(double[] src, double[] dst)
    {
        int n = dst.Length;
        int start = (_writePos - n + _histLen) % _histLen;
        int first = Math.Min(n, _histLen - start);
        Array.Copy(src, start, dst, 0, first);
        if (first < n) Array.Copy(src, 0, dst, first, n - first);
    }

    private FeatureFrame ComputeFrame(double timeMs)
    {
        var cfg = Config;
        double dt = cfg.Hop / cfg.SampleRate;
        var f = new FeatureFrame { Seq = _seq++, TimeMs = timeMs, NonFiniteSamples = _nonFinite };
        _nonFinite = 0;

        CopyLatest(_histL, _winL); CopyLatest(_histR, _winR);

        // ---- time-domain level, stereo, ZCR over the main window ----
        int n = _winL.Length;
        double eL = 0, eR = 0, eLR = 0, eM = 0, eS = 0;
        int zcL = 0, zcR = 0;
        for (int i = 0; i < n; i++)
        {
            double l = _winL[i], r = _winR[i];
            eL += l * l; eR += r * r; eLR += l * r;
            double m = 0.5 * (l + r), s = 0.5 * (l - r);
            eM += m * m; eS += s * s;
            if (i > 0)
            {
                if ((_winL[i - 1] >= 0) != (l >= 0)) zcL++;
                if ((_winR[i - 1] >= 0) != (r >= 0)) zcR++;
            }
        }
        f.RmsL = Math.Sqrt(eL / n); f.RmsR = Math.Sqrt(eR / n);
        f.Rms = Math.Sqrt((eL + eR) / (2.0 * n));      // RMS of the channel-mean power
        f.DbfsL = Bands.AmplitudeToDb(f.RmsL); f.DbfsR = Bands.AmplitudeToDb(f.RmsR); f.Dbfs = Bands.AmplitudeToDb(f.Rms);
        var tune = Volatile.Read(ref _tuning);
        f.Silent = f.Dbfs < Math.Max(cfg.SilenceThresholdDb, tune.SilenceDb);
        f.LevelNorm = _levelNorm.Process(f.Dbfs, dt);
        _levelPulse.RangeDb = tune.PulseRangeDb; _levelPulse.FloorDb = tune.PulseFloorDb;
        f.LevelPulse = _levelPulse.Process(f.Dbfs, dt);

        const double tiny = 1e-20;
        f.Balance = (eL + eR) > tiny ? (eR - eL) / (eR + eL) : 0.0;          // -1 = left only, +1 = right only
        f.Correlation = (eL > tiny && eR > tiny) ? Math.Clamp(eLR / Math.Sqrt(eL * eR), -1, 1) : 0.0; // undefined → 0
        f.Width = (eM + eS) > tiny ? eS / (eM + eS) : 0.0;                    // 0 = mono, 0.5 = one-sided, 1 = antiphase
        f.Zcr = (zcL + zcR) / (2.0 * (n - 1));                                 // crossings per sample

        double pkL = 0, pkR = 0;
        for (int i = 0; i < cfg.Hop; i++) { pkL = Math.Max(pkL, Math.Abs(_hopL[i])); pkR = Math.Max(pkR, Math.Abs(_hopR[i])); }
        f.PeakL = pkL; f.PeakR = pkR;
        f.Clipped = pkL >= 1.0 || pkR >= 1.0;
        f.WaveL = (float[])_hopL.Clone(); f.WaveR = (float[])_hopR.Clone();

        // ---- spectra: per-channel, powers averaged ----
        _main.Analyze(_winL, _pL, _aL);
        _main.Analyze(_winR, _pR, _aR);
        int bins = _main.BinCount;
        for (int k = 0; k < bins; k++)
        {
            _power[k] = 0.5 * (_pL[k] + _pR[k]);
            _amp[k] = Math.Sqrt(0.5 * (_aL[k] * _aL[k] + _aR[k] * _aR[k]));
        }
        bool multires = cfg.LowFftSize != 0;
        if (multires)
        {
            CopyLatest(_histL, _lowWinL); CopyLatest(_histR, _lowWinR);
            _low.Analyze(_lowWinL, _lpL, _laL);
            _low.Analyze(_lowWinR, _lpR, _laR);
            for (int k = 0; k < _low.BinCount; k++) _lowPower[k] = 0.5 * (_lpL[k] + _lpR[k]);
        }

        // Bands: if the band is entirely below the crossover use the long FFT; a band that
        // straddles the crossover is split so each part uses its own resolution.
        double BandPowerMR(double lo, double hi)
        {
            if (!multires) return Bands.BandPower(_power, _main.BinHz, lo, hi);
            double x = cfg.LowCrossoverHz;
            if (hi <= x) return Bands.BandPower(_lowPower, _low.BinHz, lo, hi);
            if (lo >= x) return Bands.BandPower(_power, _main.BinHz, lo, hi);
            return Bands.BandPower(_lowPower, _low.BinHz, lo, x) + Bands.BandPower(_power, _main.BinHz, x, hi);
        }

        var std = Bands.Standard;
        f.BandDb = new double[std.Length];
        f.BandNorm = new double[std.Length];
        double loudestCeiling = double.NegativeInfinity;
        for (int b = 0; b < std.Length; b++)
        {
            f.BandDb[b] = Bands.PowerToDb(BandPowerMR(std[b].LowHz, std[b].HighHz));
            if (!BandAvailable[b]) continue;
            _bandNorm[b].Track(f.BandDb[b], dt);
            loudestCeiling = Math.Max(loudestCeiling, _bandNorm[b].CeilingDb);
        }
        f.BandPulse = new double[std.Length];
        for (int b = 0; b < std.Length; b++)
        {
            f.BandNorm[b] = BandAvailable[b] ? _bandNorm[b].Normalize(f.BandDb[b], loudestCeiling - cfg.BandCouplingDb) : 0.0;
            _bandPulse[b].RangeDb = tune.PulseRangeDb; _bandPulse[b].FloorDb = tune.PulseFloorDb;
            f.BandPulse[b] = BandAvailable[b] ? _bandPulse[b].Process(f.BandDb[b], dt) : 0.0;
        }

        f.SpectrumDb = new double[LogBandEdges.Length - 1];
        for (int b = 0; b < f.SpectrumDb.Length; b++)
            f.SpectrumDb[b] = Bands.PowerToDb(BandPowerMR(LogBandEdges[b], LogBandEdges[b + 1]));

        // ---- spectral shape (main FFT, 20 Hz .. min(20 kHz, Nyquist)) ----
        double binHz = _main.BinHz;
        int kLo = Math.Max(1, (int)Math.Ceiling(20.0 / binHz));
        int kHi = Math.Min(bins - 1, (int)Math.Floor(Math.Min(20000.0, cfg.SampleRate / 2) / binHz));
        double sumA = 0, sumFA = 0, sumP = 0, sumLogP = 0;
        int count = 0;
        for (int k = kLo; k <= kHi; k++)
        {
            double fr = k * binHz;
            sumA += _amp[k]; sumFA += fr * _amp[k];
            sumP += _power[k];
            sumLogP += Math.Log(_power[k] + 1e-30);
            count++;
        }
        if (!f.Silent && sumP > 0 && count > 0)
        {
            f.CentroidHz = sumFA / sumA;                                     // amplitude-weighted
            f.Flatness = Math.Exp(sumLogP / count) / (sumP / count);         // geometric / arithmetic mean of power
            double target = cfg.RolloffFraction * sumP, acc = 0;
            f.RolloffHz = kHi * binHz;
            for (int k = kLo; k <= kHi; k++) { acc += _power[k]; if (acc >= target) { f.RolloffHz = k * binHz; break; } }
        }
        // else: undefined in silence → 0 (consumers must check Silent)

        // ---- spectral flux ----
        double flux = 0, fluxLog = 0;
        int mf = Math.Max(0, cfg.OnsetMaxFilterBins);
        double rel = cfg.OnsetMaxFilterCents > 0 && mf > 0 ? Math.Pow(2, cfg.OnsetMaxFilterCents / 1200.0) - 1 : 0;
        for (int k = 1; k < bins; k++) _logAmp[k] = Math.Log(1.0 + cfg.FluxLogGamma * _amp[k]);
        if (_havePrev)
        {
            for (int k = 1; k < bins; k++)
            {
                flux += Math.Max(0.0, _amp[k] - _prevAmp[k]);              // the brief's linear flux, unchanged
                double ref_ = _prevLogAmp[k];
                int w = Math.Max(mf, (int)Math.Ceiling(k * rel));          // ±50 cents of bin k
                for (int j = Math.Max(1, k - w); j <= Math.Min(bins - 1, k + w); j++) ref_ = Math.Max(ref_, _prevLogAmp[j]);
                fluxLog += Math.Max(0.0, _logAmp[k] - ref_);                // SuperFlux: vs max of neighbours
            }
        }
        fluxLog /= (bins - 1);  // mean over bins → independent of FFT size
        Array.Copy(_amp, _prevAmp, bins);
        Array.Copy(_logAmp, _prevLogAmp, bins);
        _havePrev = true;
        f.FluxLinear = flux;
        f.FluxLog = fluxLog;
        f.Onset = _onset.Process(fluxLog, dt, f.Silent);
        return f;
    }

    public void Reset()
    {
        Array.Clear(_histL); Array.Clear(_histR);
        _writePos = 0; _sinceHop = 0; _havePrev = false;
        _onset.Reset(); _levelNorm.Reset(); _levelPulse.Reset();
        foreach (var n in _bandNorm) n.Reset();
        foreach (var p in _bandPulse) p.Reset();
    }
}
