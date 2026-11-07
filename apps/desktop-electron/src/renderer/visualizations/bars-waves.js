/* Bars & Waves — accurate, diagnostic-grade displays drawn directly from the analysis frames.
 * Every pixel here is a measured value: no decorative motion is substituted for audio.
 *
 * Renderer lifecycle (shared by every collection):
 *   initialize(canvas, env) → update(store, tick) → render() → resize(w, h, dpr) → dispose()
 */
(function (root) {
  'use strict';
  const U = root.DspUtils;
  const FONT = '11px Tahoma, "Segoe UI", Verdana, sans-serif';
  const FONT_SMALL = '10px Tahoma, "Segoe UI", Verdana, sans-serif';
  const COL = { left: '#5FD0FF', right: '#FF6AD5', grid: 'rgba(120,150,200,0.16)', label: 'rgba(200,215,240,0.62)', text: '#E6EEF9', clip: '#FF4B4B', warn: '#FFB13B' };
  const SPEC_LO = -90, SPEC_HI = 0;
  const FREQ_LABELS = [[20, '20'], [50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k'], [20000, '20k']];
  const BAND_LABELS = ['Sub', 'Bass', 'Low mid', 'Mid', 'Up mid', 'Presence', 'Brilliance'];

  // ---------- drawing helpers ----------
  function panel(ctx, r, title) {
    ctx.strokeStyle = 'rgba(79,110,158,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    if (title) { ctx.font = FONT; ctx.fillStyle = COL.label; ctx.textBaseline = 'top'; ctx.fillText(title, r.x + 8, r.y + 6); }
  }

  function inset(r, l, t, rr, b) { return { x: r.x + l, y: r.y + t, w: Math.max(1, r.w - l - rr), h: Math.max(1, r.h - t - b) }; }

  function logX(f, edges, r) {
    const lo = edges[0], hi = edges[edges.length - 1];
    return r.x + r.w * Math.log(f / lo) / Math.log(hi / lo);
  }

  function drawSpectrum(ctx, outer, store, { gradient, grid = true, reflection = false, title = null }) {
    const a = store.analysis;
    if (!a) return;
    const r = grid ? inset(outer, 34, title ? 22 : 8, 8, 20) : outer;
    const edges = a.logEdges, vals = store.spectrum.values, peaks = store.spectrumPeak.values;
    if (grid) {
      ctx.font = FONT_SMALL; ctx.fillStyle = COL.label; ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
      ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
      for (let db = SPEC_HI; db >= SPEC_LO; db -= 10) {
        const y = Math.round(r.y + r.h * (1 - U.dbTo01(db, SPEC_LO, SPEC_HI))) + 0.5;
        ctx.beginPath(); ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); ctx.stroke();
        ctx.fillText(`${db}`, r.x - 5, y);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const [f, s] of FREQ_LABELS) {
        if (f < edges[0] || f > edges[edges.length - 1]) continue;
        const x = Math.round(logX(f, edges, r)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h); ctx.stroke();
        ctx.fillText(s, x, r.y + r.h + 4);
      }
      ctx.textAlign = 'left';
    }
    const g = ctx.createLinearGradient(0, r.y + r.h, 0, r.y);
    gradient.forEach(([stop, c]) => g.addColorStop(stop, c));
    for (let i = 0; i < vals.length; i++) {
      const x0 = logX(edges[i], edges, r), x1 = logX(edges[i + 1], edges, r);
      const w = Math.max(1, x1 - x0 - 1);
      const h = r.h * U.dbTo01(vals[i], SPEC_LO, SPEC_HI);
      ctx.fillStyle = g;
      ctx.fillRect(x0, r.y + r.h - h, w, h);
      if (reflection) {
        ctx.globalAlpha = 0.18;
        ctx.fillRect(x0, r.y + r.h + 2, w, h * 0.35);
        ctx.globalAlpha = 1;
      }
      const py = r.y + r.h * (1 - U.dbTo01(peaks[i], SPEC_LO, SPEC_HI));
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(x0, py - 1, w, 2);
    }
    if (title) { ctx.font = FONT; ctx.fillStyle = COL.label; ctx.textBaseline = 'top'; ctx.fillText(title, outer.x + 8, outer.y + 6); }
  }

  /** v0.8: centroid and 85 % rolloff marked on a gridded spectrum (same inset as drawSpectrum with a title). */
  function drawSpectrumMarkers(ctx, outer, store) {
    const a = store.analysis, f = store.frame;
    if (!a || !f || f.silent) return;
    const r = inset(outer, 34, 22, 8, 20), edges = a.logEdges;
    const mark = (hz, color, label, row) => {
      if (!(hz > edges[0] && hz < edges[edges.length - 1])) return;
      const x = Math.round(logX(hz, edges, r)) + 0.5;
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = FONT_SMALL; ctx.fillStyle = color; ctx.textBaseline = 'top';
      const t = `${label} ${hz >= 1000 ? (hz / 1000).toFixed(1) + 'k' : hz.toFixed(0)}`;
      ctx.textAlign = x > r.x + r.w - 90 ? 'right' : 'left';
      ctx.fillText(t, x + (ctx.textAlign === 'right' ? -4 : 4), r.y + 4 + row * 12);
      ctx.textAlign = 'left';
    };
    mark(f.centroid, '#FF6AD5', 'centroid', 0);
    mark(f.rolloff, '#7CF29A', 'rolloff 85%', 1);
  }

  function drawMeters(ctx, outer, store) {
    const r = inset(outer, 30, 26, 10, 40);
    const f = store.frame;
    ctx.font = FONT; ctx.fillStyle = COL.label; ctx.textBaseline = 'top';
    ctx.fillText('Level (dBFS RMS)', outer.x + 8, outer.y + 6);
    const lo = -60, hi = 0;
    ctx.font = FONT_SMALL; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = COL.grid;
    for (let db = hi; db >= lo; db -= 6) {
      const y = Math.round(r.y + r.h * (1 - U.dbTo01(db, lo, hi))) + 0.5;
      ctx.beginPath(); ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); ctx.stroke();
      ctx.fillStyle = COL.label; ctx.fillText(`${db}`, r.x - 5, y);
    }
    ctx.textAlign = 'left';
    const barW = Math.min(36, (r.w - 12) / 2);
    const g = ctx.createLinearGradient(0, r.y + r.h, 0, r.y);
    g.addColorStop(0, '#1F7A4D'); g.addColorStop(U.dbTo01(-18, lo, hi), '#3CCB7F');
    g.addColorStop(U.dbTo01(-9, lo, hi), '#FFB13B'); g.addColorStop(1, '#FF4B4B');
    [0, 1].forEach((ch) => {
      const x = r.x + 4 + ch * (barW + 8);
      ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(x, r.y, barW, r.h);
      const h = r.h * U.dbTo01(store.rmsDb.values[ch], lo, hi);
      ctx.fillStyle = g; ctx.fillRect(x, r.y + r.h - h, barW, h);
      const py = r.y + r.h * (1 - U.dbTo01(store.peakDb.values[ch], lo, hi));
      ctx.fillStyle = ch === 0 ? COL.left : COL.right; ctx.fillRect(x, py - 1, barW, 2);
      ctx.font = FONT; ctx.fillStyle = COL.text; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      ctx.fillText(ch === 0 ? 'L' : 'R', x + barW / 2, r.y + r.h + 4);
      // v0.8: the numbers behind the bar (RMS dBFS now, and the sample peak)
      if (f) {
        ctx.font = FONT_SMALL; ctx.fillStyle = COL.label;
        ctx.fillText(`${f.dbfs[ch].toFixed(1)}`, x + barW / 2, r.y + r.h + 15);
        ctx.fillText(`pk ${(20 * Math.log10(Math.max(f.peak[ch], 1e-6))).toFixed(1)}`, x + barW / 2, r.y + r.h + 26);
      }
      ctx.textAlign = 'left';
    });
    if (f && f.clip) { ctx.fillStyle = COL.clip; ctx.font = FONT; ctx.fillText('Clip', outer.x + outer.w - 34, outer.y + 6); }
  }

  /** Find a rising zero crossing so periodic signals stand still (oscilloscope trigger). */
  function trigger(mono, searchLen) {
    for (let i = searchLen; i > 1; i--) if (mono[i - 1] < 0 && mono[i] >= 0) return i;
    return searchLen;
  }

  function scopeBuffers(state, n) {
    if (!state.bufL || state.bufL.length !== n) { state.bufL = new Float32Array(n); state.bufR = new Float32Array(n); state.mono = new Float32Array(n); }
    return state;
  }

  function drawTrace(ctx, r, data, start, len, color, gain) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const x = r.x + (i / (len - 1)) * r.w;
      const y = r.y + r.h / 2 - Math.max(-1, Math.min(1, data[start + i] * gain)) * (r.h / 2);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }

  function drawScope(ctx, outer, store, state, { split = false, title = 'Waveform' } = {}) {
    const W = 1024, N = 2048;
    const s = scopeBuffers(state, N);
    store.recentWave(N, s.bufL, s.bufR);
    let useL = false;
    for (let i = 0; i < N; i++) { s.mono[i] = s.bufL[i] + s.bufR[i]; if (Math.abs(s.mono[i]) < 1e-9 && Math.abs(s.bufL[i]) > 1e-6) useL = true; }
    const start = trigger(useL ? s.bufL : s.mono, N - W) ;
    const begin = Math.min(start, N - W);
    const r = inset(outer, 8, title ? 22 : 8, 8, 8);
    if (title) { ctx.font = FONT; ctx.fillStyle = COL.label; ctx.textBaseline = 'top'; ctx.fillText(title, outer.x + 8, outer.y + 6); }
    const ms = store.analysis ? (W / store.analysis.sr * 1000).toFixed(1) : '';
    if (ms) { ctx.font = FONT_SMALL; ctx.fillStyle = COL.label; ctx.textAlign = 'right'; ctx.fillText(`${ms} ms span, ±1.0 full scale`, outer.x + outer.w - 8, outer.y + 6); ctx.textAlign = 'left'; }
    const rows = split ? [inset(r, 0, 0, 0, r.h / 2 + 4), inset(r, 0, r.h / 2 + 4, 0, 0)] : [r, r];
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    rows.slice(0, split ? 2 : 1).forEach((rr) => { const y = Math.round(rr.y + rr.h / 2) + 0.5; ctx.beginPath(); ctx.moveTo(rr.x, y); ctx.lineTo(rr.x + rr.w, y); ctx.stroke(); });
    drawTrace(ctx, rows[0], s.bufL, begin, W, COL.left, 1);
    drawTrace(ctx, rows[1], s.bufR, begin, W, COL.right, 1);
  }

  function drawGoniometer(ctx, outer, store, state, { title = 'Stereo field', trail = false } = {}) {
    const N = 1024;
    const s = scopeBuffers(state, N);
    store.recentWave(N, s.bufL, s.bufR);
    const r = inset(outer, 8, title ? 22 : 8, 8, 8);
    const size = Math.min(r.w, r.h);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = size / 2 - 4;
    if (title) { ctx.font = FONT; ctx.fillStyle = COL.label; ctx.textBaseline = 'top'; ctx.fillText(title, outer.x + 8, outer.y + 6); }
    // auto-scale on the smoothed sample peak (labelled), so quiet material is still readable
    const pk = Math.max(Math.pow(10, store.peakDb.values[0] / 20), Math.pow(10, store.peakDb.values[1] / 20), 0.02);
    state.gain = state.gain ? state.gain + 0.1 * (0.9 / pk - state.gain) : 0.9 / pk;
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, cy - rad); ctx.lineTo(cx, cy + rad); ctx.moveTo(cx - rad, cy); ctx.lineTo(cx + rad, cy);
    ctx.moveTo(cx - rad * 0.707, cy - rad * 0.707); ctx.lineTo(cx + rad * 0.707, cy + rad * 0.707);
    ctx.moveTo(cx + rad * 0.707, cy - rad * 0.707); ctx.lineTo(cx - rad * 0.707, cy + rad * 0.707); ctx.stroke();
    ctx.font = FONT_SMALL; ctx.fillStyle = COL.label; ctx.textAlign = 'center';
    ctx.fillText('M', cx, cy - rad - 1); ctx.fillText('L', cx - rad * 0.74, cy - rad * 0.80); ctx.fillText('R', cx + rad * 0.74, cy - rad * 0.80);
    ctx.textAlign = 'left';
    ctx.fillStyle = trail ? 'rgba(140,220,255,0.55)' : 'rgba(140,220,255,0.7)';
    const k = Math.SQRT1_2 * state.gain * rad;
    // v0.10: clip to the panel (auto-gained points could land outside it, over the spectrum)
    ctx.save(); ctx.beginPath(); ctx.rect(outer.x + 1, outer.y + 1, outer.w - 2, outer.h - 2); ctx.clip();
    for (let i = 0; i < N; i++) {
      const x = cx + (s.bufR[i] - s.bufL[i]) * k;   // side → horizontal
      const y = cy - (s.bufL[i] + s.bufR[i]) * k;   // mid  → vertical
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    ctx.restore();
    ctx.font = FONT_SMALL; ctx.fillStyle = COL.label; ctx.textAlign = 'right';
    ctx.fillText(`auto gain ×${state.gain.toFixed(1)}`, outer.x + outer.w - 8, outer.y + 6);
    ctx.textAlign = 'left';
  }

  function hBar(ctx, r, value, lo, hi, label, color) {
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(r.x, r.y, r.w, r.h);
    const zero = r.x + r.w * (0 - lo) / (hi - lo);
    const v = r.x + r.w * (Math.max(lo, Math.min(hi, value)) - lo) / (hi - lo);
    ctx.fillStyle = color; ctx.fillRect(Math.min(zero, v), r.y, Math.max(2, Math.abs(v - zero)), r.h);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(zero, r.y - 2, 1, r.h + 4);
    ctx.font = FONT_SMALL; ctx.fillStyle = COL.label; ctx.textBaseline = 'bottom';
    ctx.fillText(`${label} ${value >= 0 ? '+' : ''}${value.toFixed(2)}`, r.x, r.y - 3);
    ctx.textBaseline = 'top';
  }

  function drawStereoBars(ctx, outer, store) {
    const f = store.frame; if (!f) return;
    const w = outer.w - 16, x = outer.x + 8;
    hBar(ctx, { x, y: outer.y + 16, w, h: 6 }, f.correlation, -1, 1, 'Correlation', f.correlation < 0 ? COL.warn : '#3CCB7F');
    hBar(ctx, { x, y: outer.y + 44, w, h: 6 }, f.balance, -1, 1, 'Balance', COL.left);
    hBar(ctx, { x, y: outer.y + 72, w, h: 6 }, f.width, 0, 1, 'Width', COL.right);
  }

  function drawBands(ctx, outer, store) {
    const a = store.analysis, f = store.frame;
    ctx.font = FONT; ctx.fillStyle = COL.label; ctx.textBaseline = 'top';
    ctx.fillText('Bands (adaptive 0–1, brighten on each pulse)', outer.x + 8, outer.y + 6);
    const r = inset(outer, 8, 24, 8, 34);
    const n = 7, gap = 6, bw = (r.w - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const x = r.x + i * (bw + gap);
      const avail = !a || a.bands[i].available;
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x, r.y, bw, r.h);
      const h = r.h * store.bandsNorm.values[i];
      const hue = 200 + i * 22;
      // v0.10: the pulse (rise above the band's recent typical level) brightens the whole bar
      // (v0.8 drew a white inner bar, which you found distracting)
      const pulse = f?.bandsPulse ? f.bandsPulse[i] : 0;
      ctx.fillStyle = avail ? `hsl(${hue},85%,${46 + 26 * pulse}%)` : 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, r.y + r.h - h, bw, h);
      ctx.font = FONT_SMALL; ctx.textAlign = 'center'; ctx.fillStyle = avail ? COL.text : COL.label;
      ctx.fillText(BAND_LABELS[i], x + bw / 2, r.y + r.h + 4);
      ctx.fillStyle = COL.label;
      ctx.fillText(avail && f ? `${f.bands[i].toFixed(0)} dB` : 'n/a', x + bw / 2, r.y + r.h + 17);
      ctx.textAlign = 'left';
    }
  }

  function drawOnsetLamp(ctx, x, y, store) {
    const e = store.onsetEnvelope;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,200,80,${0.12 + 0.88 * e})`; ctx.fill();
    ctx.font = FONT_SMALL; ctx.fillStyle = COL.label; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    ctx.fillText(store.onsetCount ? `Onset ${store.lastOnsetConfidence.toFixed(2)}` : 'Onset', x - 10, y); ctx.textAlign = 'left';
  }

  // ---------- presets ----------
  function base2d() {
    return {
      contextType: '2d',
      canvas: null, ctx: null, w: 0, h: 0, dpr: 1, env: null, state: {},
      initialize(canvas, env) { this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false }); this.env = env; },
      resize(w, h, dpr) { this.w = w; this.h = h; this.dpr = dpr; },
      clear(alpha = 1) {
        const c = this.ctx; c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        c.fillStyle = alpha >= 1 ? '#000' : `rgba(0,0,0,${alpha})`; c.fillRect(0, 0, this.w, this.h);
      },
      dispose() { this.ctx = null; this.canvas = null; this.state = {}; },
    };
  }

  const instruments = () => Object.assign(base2d(), {
    update() {},
    render(store) {
      this.clear();
      const c = this.ctx, W = this.w, H = this.h, pad = 10;
      const topH = Math.round(H * 0.58), meterW = Math.min(170, Math.round(W * 0.2));
      const spec = { x: pad, y: pad, w: W - meterW - pad * 3, h: topH - pad };
      const met = { x: W - meterW - pad, y: pad, w: meterW, h: topH - pad };
      const by = topH + pad, bh = H - by - pad;
      const goniW = Math.min(bh, Math.round(W * 0.24));
      const scope = { x: pad, y: by, w: Math.round((W - goniW - pad * 4) * 0.55), h: bh };
      const gon = { x: scope.x + scope.w + pad, y: by, w: goniW, h: bh };
      const bands = { x: gon.x + gon.w + pad, y: by, w: W - (gon.x + gon.w + pad) - pad, h: Math.round(bh * 0.62) };
      const stereo = { x: bands.x, y: bands.y + bands.h + pad, w: bands.w, h: bh - bands.h - pad };
      [spec, met, scope, gon, bands, stereo].forEach((r) => panel(c, r));
      drawSpectrum(c, spec, store, { title: 'Spectrum (dB power per band)', gradient: [[0, '#13406E'], [0.55, '#2D8BD8'], [0.85, '#5FD0FF'], [1, '#E9FBFF']] });
      drawMeters(c, met, store);
      drawScope(c, scope, store, this.state.scope || (this.state.scope = {}));
      drawGoniometer(c, gon, store, this.state.gon || (this.state.gon = {}));
      drawBands(c, bands, store);
      drawStereoBars(c, stereo, store);
      drawOnsetLamp(c, spec.x + spec.w - 12, spec.y + 13, store);
    },
  });

  const spectrum = () => Object.assign(base2d(), {
    hue: 0, pulse: 0,
    update(store, tick) {
      // autonomous drift so the display is alive in silence; audio drives everything else
      this.hue = (this.hue + tick.dt * 6) % 360;
      if (tick.onsets > 0) this.pulse = Math.max(this.pulse, this.env.flash.request(tick.nowSec, 0.4 + 0.6 * tick.maxConfidence));
      this.pulse *= Math.exp(-tick.dt / 0.15);
    },
    render(store) {
      this.clear();
      const c = this.ctx, W = this.w, H = this.h;
      if (this.pulse > 0.01) { c.fillStyle = `hsla(${(this.hue + 280) % 360},70%,40%,${this.pulse * 0.5})`; c.fillRect(0, 0, W, H); }
      const r = { x: W * 0.05, y: H * 0.08, w: W * 0.9, h: H * 0.6 };
      const h0 = this.hue;
      drawSpectrum(c, r, store, {
        grid: false, reflection: true,
        gradient: [[0, `hsl(${(h0 + 260) % 360},80%,25%)`], [0.4, `hsl(${(h0 + 310) % 360},85%,50%)`], [0.75, `hsl(${(h0 + 20) % 360},95%,58%)`], [1, `hsl(${(h0 + 50) % 360},100%,80%)`]],
      });
    },
  });

  const scope = () => Object.assign(base2d(), {
    update() {},
    render(store) {
      // phosphor persistence: fade previous image instead of clearing
      this.clear(0.22);
      drawScope(this.ctx, { x: 0, y: 0, w: this.w, h: this.h }, store, this.state, { split: true, title: null });
    },
  });

  const stereo = () => Object.assign(base2d(), {
    update() {},
    render(store) {
      this.clear(0.16);
      const W = this.w, H = this.h;
      const side = Math.min(W * 0.7, H);
      drawGoniometer(this.ctx, { x: (W - side) / 2 - W * 0.1, y: (H - side) / 2, w: side, h: side }, store, this.state, { title: null, trail: true });
      const c = this.ctx;
      c.fillStyle = '#000'; c.fillRect(W * 0.78, H * 0.3, W * 0.2, 110);
      drawStereoBars(c, { x: W * 0.78, y: H * 0.3, w: W * 0.2, h: 100 }, store);
    },
  });



  // ---------- v0.15: Circular spectrum ----------
  // 128 thin bars round a ring, mirrored: bass bursts up from 12 o'clock, treble meets at 6 o'clock.
  // The 48 measured bands are interpolated (Catmull-Rom; the bands are evenly spaced in log-frequency)
  // so bars between band centres are smooth, not invented: every band centre is exact.
  const CIRC_BARS = 64;                                   // per side
  const circular = () => Object.assign(base2d(), {
    update(store, tick) {
      const st = this.state, dt = Math.min(0.1, tick.dt || 1 / 60);
      if (!st.vals) {
        Object.assign(st, { vals: new Float32Array(CIRC_BARS), peaks: new Float32Array(CIRC_BARS), holds: new Float32Array(CIRC_BARS),
          wl: new Float32Array(512), wr: new Float32Array(512), low: 0, hue: 0, gain: 4 });
      }
      const spec = store.spectrum.values, nb = spec.length, f = store.frame;
      // display curve: normalised level^1.5 over −75…−12 dB. Mastered music is fairly flat in dB, so a
      // linear map made every bar 57–86 % long (a near-round outline); the curve roughly doubles the
      // contrast while staying monotonic (louder is always longer).
      for (let i = 0; i < CIRC_BARS; i++) st.vals[i] = U.dbTo01(U.catmullRom(spec, ((i + 0.5) / CIRC_BARS) * nb - 0.5), -75, -12) ** 1.5;
      U.peakCapStep(st.vals, st.peaks, st.holds, dt);
      // the "thump": bass pulse, fast attack (30 ms) and gentle release (250 ms)
      const p = f?.bandsPulse ? Math.max(f.bandsPulse[0], f.bandsPulse[1]) : 0;
      st.low += (p - st.low) * (1 - Math.exp(-dt / (p > st.low ? 0.03 : 0.25)));
      st.hue = (st.hue + 4 * dt) % 360;                   // slow colour drift
      st.dt = dt;
    },
    render(store) {
      this.clear();
      const c = this.ctx, st = this.state, W = this.w, H = this.h;
      if (!st.vals) return;
      const m = Math.min(W, H), R0 = 0.2 * m * (1 + 0.07 * st.low), Lmax = 0.27 * m;
      const hueAt = (t) => (st.hue + 190 + 140 * t) % 360;  // cyan → blue → violet → magenta
      c.save(); c.translate(W / 2, H / 2); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
      // soft halo behind the ring, swelling with the bass
      const g = c.createRadialGradient(0, 0, R0 * 0.5, 0, 0, R0 + Lmax);
      g.addColorStop(0, `hsla(${hueAt(0)},90%,45%,${0.08 + 0.22 * st.low})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(-W / 2, -H / 2, W, H);
      const bw = ((Math.PI * R0) / CIRC_BARS) * 0.6;       // bar width at the base of the ring
      for (const side of [1, -1]) {
        for (let i = 0; i < CIRC_BARS; i++) {
          const t = i / (CIRC_BARS - 1), v = st.vals[i], h = hueAt(t), len = 3 + Lmax * v;
          const a = -Math.PI / 2 + side * Math.PI * ((i + 0.5) / CIRC_BARS), x = Math.cos(a), y = Math.sin(a);
          const line = (r0, r1, style, w) => { c.strokeStyle = style; c.lineWidth = w; c.beginPath(); c.moveTo(x * r0, y * r0); c.lineTo(x * r1, y * r1); c.stroke(); };
          line(R0 + 3, R0 + 3 + len, `hsla(${h},100%,60%,0.16)`, bw * 2.6);                       // glow
          line(R0 + 3, R0 + 3 + len, `hsl(${h},100%,${48 + 24 * v}%)`, bw);                      // bar
          line(R0 - 3, Math.max(R0 * 0.55, R0 - 3 - 0.3 * len), `hsla(${h},100%,55%,0.2)`, bw);   // inward reflection
          const pr = R0 + 6 + Lmax * st.peaks[i];                                                  // peak cap
          c.fillStyle = `hsla(${h},70%,88%,0.85)`; c.beginPath(); c.arc(x * pr, y * pr, Math.max(1, bw * 0.45), 0, 2 * Math.PI); c.fill();
        }
      }
      // the ring itself, glowing on the beat
      c.strokeStyle = `hsla(${hueAt(0)},100%,${58 + 25 * st.low}%,${0.45 + 0.55 * st.low})`; c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, R0, 0, 2 * Math.PI); c.stroke();
      // a faint waveform ring inside (the last 512 samples, auto-gained)
      store.recentWave(512, st.wl, st.wr);
      let pk = 0.02; for (let i = 0; i < 512; i++) pk = Math.max(pk, Math.abs(st.wl[i] + st.wr[i]) / 2);
      st.gain += (1 - Math.exp(-(st.dt || 1 / 60) / 0.5)) * (0.5 / pk - st.gain);
      c.strokeStyle = `hsla(${hueAt(0.5)},80%,75%,0.32)`; c.lineWidth = 1.2; c.beginPath();
      for (let i = 0; i <= 256; i++) {
        const k = (i % 256) * 2, w = (st.wl[k] + st.wr[k]) / 2, rr = R0 * (0.78 + 0.16 * Math.max(-1, Math.min(1, st.gain * w))), a = (2 * Math.PI * i) / 256 - Math.PI / 2;
        i ? c.lineTo(rr * Math.cos(a), rr * Math.sin(a)) : c.moveTo(rr * Math.cos(a), rr * Math.sin(a));
      }
      c.stroke();
      c.restore();
    },
  });


  // ---------- v0.16: Ridgeline (the "Unknown Pleasures" look) ----------
  // Stacked spectrum snapshots, newest at the front (bottom), each hiding the lines behind it.
  // Each line is mirrored from the centre: bass in the middle, treble towards the edges.
  const RIDGE = { lines: 44, pts: 72, interval: 1 / 14, taper: 0.35, lo: -60, hi: -12, power: 2 };
  const ridgeline = () => Object.assign(base2d(), {
    update(store, tick) {
      const st = this.state, dt = Math.min(0.1, tick.dt || 1 / 60);
      if (!st.hist) Object.assign(st, { hist: new U.SnapshotHistory(RIDGE.lines, RIDGE.pts, RIDGE.interval), cur: new Float32Array(RIDGE.pts) });
      const spec = store.spectrum.values, nb = spec.length;
      // display curve: level over −60…−12 dB, squared, so moderate levels sit near the baseline and
      // strong components rise out of it (with the circular spectrum's gentler curve every line floated
      // on a raised plateau: dense mixes sit at −40…−30 dB). Monotonic: louder is always higher.
      for (let j = 0; j < RIDGE.pts; j++) st.cur[j] = U.dbTo01(U.catmullRom(spec, (j / (RIDGE.pts - 1)) * (nb - 1)), RIDGE.lo, RIDGE.hi) ** RIDGE.power;
      st.hist.step(st.cur, dt);
    },
    render() {
      this.clear();
      const c = this.ctx, st = this.state, W = this.w, H = this.h;
      if (!st.hist) return;
      const n = RIDGE.lines, P = RIDGE.pts, cx = W / 2;
      const half = Math.min(W * 0.27, H * 0.5), top = H * 0.13, bottom = H * 0.9;
      const gap = (bottom - top) / n, amp = gap * 9, phase = st.hist.phase;
      // edges taper to the baseline over the outer 35 % (a display envelope, as in the original plot)
      const env = (j) => { const u = j / (P - 1), e = Math.min(1, (1 - u) / RIDGE.taper); return e * e * (3 - 2 * e); };
      const draw = (vals, yBase, alpha, front) => {
        c.beginPath();
        for (let k = -(P - 1); k <= P - 1; k++) {           // left edge → centre → right edge
          const j = Math.abs(k), x = cx + (k / (P - 1)) * half, y = yBase - amp * vals[j] * env(j);
          k === -(P - 1) ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.lineTo(cx + half, yBase + gap); c.lineTo(cx - half, yBase + gap); c.closePath();
        c.fillStyle = '#000'; c.fill();                      // hide the lines behind
        c.beginPath();
        for (let k = -(P - 1); k <= P - 1; k++) {
          const j = Math.abs(k), x = cx + (k / (P - 1)) * half, y = yBase - amp * vals[j] * env(j);
          k === -(P - 1) ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.strokeStyle = `rgba(236,240,246,${alpha})`; c.lineWidth = front ? 1.8 : 1.4; c.lineJoin = 'round'; c.stroke();
      };
      // back (oldest, top) to front (newest, bottom); lines scroll up smoothly with the phase
      for (let a = n - 1; a >= 0; a--) {
        const v = st.hist.line(a);
        if (!v) continue;
        const yBase = bottom - (a + 1 + phase) * gap;
        const leaving = Math.min(1, (n - 1 - a - phase) / 3);  // the oldest lines fade out as they leave
        draw(v, yBase, Math.max(0, leaving) * (0.45 + 0.55 * (1 - a / n)), false);
      }
      draw(st.cur, bottom, 1, true);                         // the live line, at the front
    },
  });


  // ---------- v0.19: VU meters ----------
  // Two analogue VU meters with standard ballistics (99 % in 300 ms, 1.25 % overshoot). The scale is
  // linear in voltage with decibel markings, as on real meters: deflection d = 0.708·10^(VU/20), so
  // 0 VU sits at 70.8 % and +3 VU at 100 %.
  // Alignment is automatic, like an engineer trimming the meter for the material: the reference follows
  // the long-term power-average level so typical sound reads about −3 VU (limits −26…−8 dB, the range
  // of real alignments). A fixed broadcast alignment (0 VU = −18 dBFS sine, −21 dB in this app's RMS
  // convention) pinned both needles on modern masters: the test mix reads +8.6 VU against it.
  const VU = { swing: (50 * Math.PI) / 180, marks: [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3], peakDb: -3, peakHold: 0.5, typical: -3, alignRange: [-26, -8], tauStart: 1, tauLong: 20 };
  const vuDeflection = (db, alignDb) => 0.708 * Math.pow(10, (db - alignDb) / 20);
  const vu = () => Object.assign(base2d(), {
    update(store, tick) {
      const st = this.state;
      if (!st.needles) Object.assign(st, { needles: [{ x: 0, v: 0 }, { x: 0, v: 0 }], peakT: [0, 0], power: 0, heard: 0, align: -21 });
      const hop = store.analysis ? store.analysis.hop / store.analysis.sr : 512 / 48000;
      for (const f of tick.frames) {                          // the needles run on the audio clock
        if (!f.silent) {                                      // auto-alignment: power average, fast at first, then ~20 s
          const p = (Math.pow(10, f.dbfs[0] / 10) + Math.pow(10, f.dbfs[1] / 10)) / 2;
          st.heard += hop;
          st.power = st.heard <= hop ? p : st.power + (p - st.power) * (1 - Math.exp(-hop / (st.heard < 3 ? VU.tauStart : VU.tauLong)));
          st.align = Math.min(VU.alignRange[1], Math.max(VU.alignRange[0], 10 * Math.log10(st.power) - VU.typical));
        }
        for (let ch = 0; ch < 2; ch++) {
          const target = f.silent ? 0 : Math.min(1.2, vuDeflection(f.dbfs[ch], st.align));
          U.needleStep(st.needles[ch], target, hop);
          st.needles[ch].x = Math.max(-0.02, Math.min(1.12, st.needles[ch].x));   // the pin stops at both ends
          if (f.peak[ch] >= Math.pow(10, VU.peakDb / 20)) st.peakT[ch] = VU.peakHold;
        }
      }
      const dt = Math.min(0.1, tick.dt || 1 / 60);
      st.peakT = st.peakT.map((t) => Math.max(0, t - dt));
    },
    render() {
      this.clear();
      const c = this.ctx, st = this.state, W = this.w, H = this.h;
      if (!st.needles) return;
      const mw = Math.min((W - 60) / 2, (H - 80) * 1.55), mh = mw / 1.55, gap = Math.max(20, mw * 0.06);
      const x0 = (W - 2 * mw - gap) / 2, y0 = (H - mh) / 2 - 10;
      ['L', 'R'].forEach((label, ch) => this.drawMeter(c, x0 + ch * (mw + gap), y0, mw, mh, st.needles[ch].x, st.peakT[ch] > 0, label));
      c.font = '11px Tahoma, Verdana, sans-serif'; c.fillStyle = '#8E9AB0'; c.textAlign = 'center'; c.textBaseline = 'top';
      c.fillText(`0 VU = ${st.align.toFixed(1)} dB RMS (auto-aligned to the music; typical level reads −3 VU)`, W / 2, y0 + mh + 18);
    },
    drawMeter(c, x, y, w, h, d, peak, label) {
      // bezel and warm, backlit face
      c.fillStyle = '#16120E'; roundRect(c, x - 8, y - 8, w + 16, h + 16, 10); c.fill();
      const face = c.createLinearGradient(x, y, x, y + h);
      face.addColorStop(0, '#F6E7C1'); face.addColorStop(0.7, '#EFD49A'); face.addColorStop(1, '#D9B26C');
      c.fillStyle = face; roundRect(c, x, y, w, h, 6); c.fill();
      const glow = c.createRadialGradient(x + w / 2, y + h * 0.95, 0, x + w / 2, y + h * 0.95, w * 0.7);
      glow.addColorStop(0, 'rgba(255,214,140,0.45)'); glow.addColorStop(1, 'rgba(255,214,140,0)');
      c.fillStyle = glow; roundRect(c, x, y, w, h, 6); c.fill();
      // geometry: pivot below the visible face, scale arc above it
      const px = x + w / 2, py = y + h * 1.02, R = h * 0.78, ang = (dd) => -Math.PI / 2 - VU.swing + 2 * VU.swing * dd;
      c.save(); roundRect(c, x, y, w, h, 6); c.clip();
      c.lineCap = 'butt';
      // scale: black to 0 VU, a thick red arc above it
      c.strokeStyle = '#1A1410'; c.lineWidth = Math.max(1.2, h * 0.008);
      const dv = (vuMark) => 0.708 * Math.pow(10, vuMark / 20);   // deflection of a VU mark (alignment-free)
      c.beginPath(); c.arc(px, py, R, ang(dv(-20)), ang(dv(0))); c.stroke();
      c.strokeStyle = '#C8241B'; c.lineWidth = Math.max(4, h * 0.035);
      c.beginPath(); c.arc(px, py, R + h * 0.012, ang(dv(0)), ang(dv(3))); c.stroke();
      c.font = `${Math.round(h * 0.075)}px Tahoma, Verdana, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (const m of VU.marks) {
        const a = ang(dv(m)), red = m > 0, big = [-20, -10, -7, -5, -3, 0, 3].includes(m);
        c.strokeStyle = red ? '#C8241B' : '#1A1410'; c.lineWidth = Math.max(1, h * (big ? 0.012 : 0.007));
        c.beginPath(); c.moveTo(px + Math.cos(a) * R, py + Math.sin(a) * R); c.lineTo(px + Math.cos(a) * (R + h * (big ? 0.07 : 0.045)), py + Math.sin(a) * (R + h * (big ? 0.07 : 0.045))); c.stroke();
        if (big || m === -1 || m === 1 || m === -2 || m === 2) {
          c.fillStyle = red ? '#C8241B' : '#1A1410';
          c.fillText(m > 0 ? `+${m}` : String(Math.abs(m)), px + Math.cos(a) * (R + h * 0.13), py + Math.sin(a) * (R + h * 0.13));
        }
      }
      // percentage scale under the arc (100 % at 0 VU)
      c.font = `${Math.round(h * 0.05)}px Tahoma, Verdana, sans-serif`; c.fillStyle = '#5A4A36';
      for (const pc of [0, 20, 40, 60, 80, 100]) { const a = ang(0.708 * pc / 100); c.fillText(String(pc), px + Math.cos(a) * (R - h * 0.08), py + Math.sin(a) * (R - h * 0.08)); }
      c.fillStyle = '#1A1410'; c.font = `bold ${Math.round(h * 0.16)}px Georgia, 'Times New Roman', serif`;
      c.fillText('VU', px, y + h * 0.62);
      c.font = `${Math.round(h * 0.06)}px Tahoma, Verdana, sans-serif`; c.fillStyle = '#5A4A36';
      c.fillText(label === 'L' ? 'LEFT' : 'RIGHT', x + w * 0.12, y + h * 0.9);
      // peak lamp
      const lx = x + w * 0.88, ly = y + h * 0.88, lr = h * 0.035;
      c.fillStyle = peak ? '#FF3B2F' : '#5C2A22'; c.beginPath(); c.arc(lx, ly, lr, 0, 2 * Math.PI); c.fill();
      if (peak) { const lg = c.createRadialGradient(lx, ly, 0, lx, ly, lr * 4); lg.addColorStop(0, 'rgba(255,70,50,0.55)'); lg.addColorStop(1, 'rgba(255,70,50,0)'); c.fillStyle = lg; c.fillRect(lx - lr * 4, ly - lr * 4, lr * 8, lr * 8); }
      c.fillStyle = '#5A4A36'; c.textAlign = 'right'; c.fillText('PEAK', lx - lr * 1.8, ly);
      // needle, with a soft shadow, then the pivot cover
      const a = ang(d), tipR = R + h * 0.1, base = h * 0.12;
      for (const [dx, col, lw] of [[h * 0.012, 'rgba(0,0,0,0.18)', h * 0.012], [0, '#141010', h * 0.008]]) {
        c.strokeStyle = col; c.lineWidth = Math.max(1, lw); c.lineCap = 'round';
        c.beginPath(); c.moveTo(px + dx + Math.cos(a) * base, py + dx * 0.5 + Math.sin(a) * base); c.lineTo(px + dx + Math.cos(a) * tipR, py + dx * 0.5 + Math.sin(a) * tipR); c.stroke();
      }
      c.restore();
      const cover = c.createLinearGradient(x, y + h * 0.84, x, y + h);
      cover.addColorStop(0, '#3A2E22'); cover.addColorStop(1, '#1E1812');
      c.fillStyle = cover; c.beginPath(); c.ellipse(px, y + h, w * 0.16, h * 0.13, 0, Math.PI, 2 * Math.PI); c.fill();
    },
  });
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // ---------- v0.8: Analysis (features over time) ----------
  const HIST = 560;   // ≈ 6 s of analysis frames at 93.75 / s

  function ring(n = HIST) { return { d: new Float32Array(n).fill(NaN), w: 0, n }; }
  function push(rg, v) { rg.d[rg.w] = v; rg.w = (rg.w + 1) % rg.n; }
  function at(rg, i) { return rg.d[(rg.w + i) % rg.n]; }        // i = 0 oldest … n−1 newest

  /** Perceptually ordered dark → purple → orange → pale yellow colour map for t ∈ [0, 1]. */
  const CMAP = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
  function cmap(t) {
    const x = Math.max(0, Math.min(1, t)) * (CMAP.length - 1), i = Math.min(CMAP.length - 2, Math.floor(x)), f = x - i;
    return CMAP[i].map((c, k) => c + (CMAP[i + 1][k] - c) * f);
  }

  /** Line chart of several rings; NaN gaps break the line. map(v) → 0..1 (bottom..top). */
  function chart(ctx, r, series) {
    for (const { rg, color, map, width = 1.5 } of series) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
      let pen = false;
      for (let i = 0; i < rg.n; i++) {
        const v = at(rg, i);
        if (!Number.isFinite(v)) { pen = false; continue; }
        const x = r.x + (i / (rg.n - 1)) * r.w, y = r.y + r.h * (1 - Math.max(0, Math.min(1, map(v))));
        pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true;
      }
      ctx.stroke();
    }
  }

  /** Legend in the panel's title row, right-aligned, so chart lines never draw over it. */
  function legend(ctx, outer, items) {
    ctx.font = FONT_SMALL; ctx.textBaseline = 'top';
    const widths = items.map(([t]) => ctx.measureText(t).width + 26);
    let x = outer.x + outer.w - 8 - widths.reduce((a, b) => a + b, 0);
    items.forEach(([text, color], i) => { ctx.fillStyle = color; ctx.fillRect(x, outer.y + 10, 10, 3); ctx.fillStyle = COL.label; ctx.fillText(text, x + 14, outer.y + 6); x += widths[i]; });
  }

  const logPos = (hz) => Math.log(Math.max(hz, 20) / 20) / Math.log(1000);   // 20 Hz → 0, 20 kHz → 1

  const analysis = () => Object.assign(base2d(), {
    initializeHistory() {
      const st = this.state;
      for (const k of ['flux', 'thr', 'onset', 'centroid', 'rolloff', 'flat', 'zcr', 'bal', 'cor', 'width', 'db', 'lvl', 'lp']) st[k] = ring();
      st.specCanvas = document.createElement('canvas'); st.specCanvas.width = HIST; st.specCanvas.height = 48;
      st.specImg = st.specCanvas.getContext('2d').createImageData(HIST, 48);
      for (let i = 3; i < st.specImg.data.length; i += 4) st.specImg.data[i] = 255;
    },
    update(store, tick) {
      const st = this.state;
      if (!st.flux) this.initializeHistory();
      for (const f of tick.frames) {
        push(st.flux, f.fluxLog); push(st.thr, f.onset.threshold); push(st.onset, f.onset.on ? Math.max(0.15, f.onset.confidence) : 0);
        push(st.centroid, f.silent ? NaN : f.centroid); push(st.rolloff, f.silent ? NaN : f.rolloff);
        push(st.flat, f.silent ? NaN : f.flatness); push(st.zcr, f.zcr);
        push(st.bal, f.balance); push(st.cor, f.correlation); push(st.width, f.width);
        push(st.db, f.dbfs[2]); push(st.lvl, f.level); push(st.lp, f.levelPulse ?? 0);
        // spectrogram: shift one column left, write the newest column (low bands at the bottom)
        const d = st.specImg.data, rows = Math.min(48, f.spec.length);
        for (let y = 0; y < 48; y++) {
          const row = y * HIST * 4;
          d.copyWithin(row, row + 4, row + HIST * 4);
          const band = rows - 1 - y, c = band >= 0 ? cmap((f.spec[band] + 90) / 80) : [0, 0, 0];
          d[row + (HIST - 1) * 4] = c[0]; d[row + (HIST - 1) * 4 + 1] = c[1]; d[row + (HIST - 1) * 4 + 2] = c[2];
        }
      }
      this.dirty = tick.frames.length > 0;
    },
    render(store) {
      this.clear();
      const c = this.ctx, st = this.state, W = this.w, H = this.h, pad = 10;
      if (!st.flux) return;
      const secs = (HIST * (store.analysis?.hop ?? 512) / (store.analysis?.sr ?? 48000)).toFixed(1);
      const rows = [0.34, 0.2, 0.2, 0.26].map((k) => k * (H - pad * 5));
      let y = pad;
      const box = (h, w = W - 2 * pad, x = pad) => { const r = { x, y, w, h }; return r; };
      // 1. spectrogram
      const r1 = box(rows[0]); panel(c, r1, `Spectrogram, last ${secs} s (low frequencies at the bottom; colour = dB power, −90 → −10)`);
      if (this.dirty) st.specCanvas.getContext('2d').putImageData(st.specImg, 0, 0);
      const s1 = inset(r1, 34, 22, 8, 6);
      c.imageSmoothingEnabled = true; c.drawImage(st.specCanvas, s1.x, s1.y, s1.w, s1.h);
      c.font = FONT_SMALL; c.fillStyle = COL.label; c.textAlign = 'right'; c.textBaseline = 'middle';
      for (const [hz, t] of [[50, '50'], [200, '200'], [1000, '1k'], [5000, '5k'], [20000, '20k']]) c.fillText(t, s1.x - 5, s1.y + s1.h * (1 - logPos(hz)));
      c.textAlign = 'left';
      y += rows[0] + pad;
      // 2. onset detection function
      const r2 = box(rows[1]); panel(c, r2, 'Onset detection');
      const s2 = inset(r2, 34, 22, 8, 6);
      let top = 0.01; for (let i = 0; i < HIST; i++) { top = Math.max(top, at(st.flux, i) || 0, at(st.thr, i) || 0); }
      for (let i = 0; i < HIST; i++) { const o = at(st.onset, i); if (o > 0) { c.fillStyle = `rgba(255,200,80,${0.25 + 0.6 * o})`; c.fillRect(s2.x + (i / (HIST - 1)) * s2.w - 1, s2.y, 2, s2.h); } }
      chart(c, s2, [{ rg: st.thr, color: COL.warn, map: (v) => v / top, width: 1 }, { rg: st.flux, color: COL.left, map: (v) => v / top }]);
      legend(c, r2, [['log spectral flux', COL.left], ['adaptive threshold', COL.warn], ['detected onset', '#FFC850']]);
      y += rows[1] + pad;
      // 3. timbre
      const r3 = box(rows[2]); panel(c, r3, 'Timbre (frequencies on a log scale, 20 Hz – 20 kHz; flatness and ZCR on 0–1)');
      const s3 = inset(r3, 34, 22, 8, 6);
      chart(c, s3, [
        { rg: st.flat, color: 'rgba(230,238,249,0.6)', map: (v) => v, width: 1 },
        { rg: st.zcr, color: 'rgba(255,177,59,0.7)', map: (v) => v * 4, width: 1 },
        { rg: st.rolloff, color: '#7CF29A', map: logPos }, { rg: st.centroid, color: '#FF6AD5', map: logPos },
      ]);
      legend(c, r3, [['centroid', '#FF6AD5'], ['85% rolloff', '#7CF29A'], ['flatness', 'rgba(230,238,249,0.8)'], ['ZCR ×4', COL.warn]]);
      y += rows[2] + pad;
      // 4. bottom row: pulses now | stereo history | level history
      const third = (W - 4 * pad) / 3;
      const r4 = box(rows[3], third), r5 = box(rows[3], third, pad * 2 + third), r6 = box(rows[3], third, pad * 3 + 2 * third);
      panel(c, r4, 'Pulses now (7 bands + overall level)');
      const s4 = inset(r4, 10, 24, 10, 22), f = store.frame, names = ['Sub', 'Bass', 'LoM', 'Mid', 'UpM', 'Pres', 'Bril', 'Lvl'];
      const pulses = f ? [...(f.bandsPulse ?? [0, 0, 0, 0, 0, 0, 0]), f.levelPulse ?? 0] : [];
      const bw = s4.w / 8 - 4;
      pulses.forEach((pv, i) => {
        const x = s4.x + i * (bw + 4);
        c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(x, s4.y, bw, s4.h);
        c.fillStyle = i < 7 ? `hsl(${200 + i * 22},90%,${45 + 30 * pv}%)` : '#E6EEF9'; c.fillRect(x, s4.y + s4.h * (1 - pv), bw, s4.h * pv);
        c.font = FONT_SMALL; c.fillStyle = COL.label; c.textAlign = 'center'; c.fillText(names[i], x + bw / 2, s4.y + s4.h + 4); c.textAlign = 'left';
      });
      panel(c, r5, 'Stereo (−1 … +1)');
      const s5 = inset(r5, 10, 24, 10, 8);
      c.strokeStyle = COL.grid; c.beginPath(); c.moveTo(s5.x, s5.y + s5.h / 2); c.lineTo(s5.x + s5.w, s5.y + s5.h / 2); c.stroke();
      chart(c, s5, [{ rg: st.width, color: COL.right, map: (v) => 0.5 + v / 2, width: 1 }, { rg: st.bal, color: COL.left, map: (v) => 0.5 + v / 2 }, { rg: st.cor, color: '#3CCB7F', map: (v) => 0.5 + v / 2 }]);
      legend(c, r5, [['correlation', '#3CCB7F'], ['balance', COL.left], ['width', COL.right]]);
      panel(c, r6, 'Level');
      const s6 = inset(r6, 10, 24, 10, 8);
      chart(c, s6, [{ rg: st.lp, color: 'rgba(255,255,255,0.8)', map: (v) => v, width: 1 }, { rg: st.lvl, color: COL.warn, map: (v) => v, width: 1 }, { rg: st.db, color: COL.left, map: (v) => (v + 60) / 60 }]);
      legend(c, r6, [['dBFS (−60…0)', COL.left], ['adaptive', COL.warn], ['pulse', 'rgba(255,255,255,0.8)']]);
    },
  });

  // ---------- v0.8: Mashup (every measurement in one radial machine) ----------
  const mashup = () => ({
    contextType: '2d',
    initialize(canvas, env) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false }); this.env = env;
      this.prev = document.createElement('canvas'); this.pctx = this.prev.getContext('2d');
      this.waves = []; this.wl = new Float32Array(1024); this.wr = new Float32Array(1024); this.gain = 4; this.dt = 1 / 60;
      this.shake = 0; this.shakeV = 0; this.spinDir = 1;
    },
    resize(w, h, dpr) { this.dpr = dpr; this.prev.width = Math.round(w * dpr); this.prev.height = Math.round(h * dpr); },
    update(store, tick) {
      this.dt = Math.min(tick.dt || 1 / 60, 0.1);
      for (const f of tick.frames) if (f.onset.on) {
        this.waves.push({ age: 0, a: 0.35 + 0.65 * f.onset.confidence, hue: 330 - 300 * logPos(f.centroid || 1000) });
        this.shakeV += (0.6 + 0.8 * f.onset.confidence) * (this.waves.length % 2 ? 1 : -1);   // alternating kick jolts
      }
      // shake: a damped angular spring (≈ 7 Hz, ζ 0.25) kicked by onsets — the wobble you liked, now intentional
      const w0 = 2 * Math.PI * 7, z = 0.25, steps = Math.max(1, Math.ceil(this.dt * 480));
      for (let i = 0; i < steps; i++) { const h = this.dt / steps; this.shakeV += (-w0 * w0 * this.shake - 2 * z * w0 * this.shakeV) * h; this.shake += this.shakeV * h; }
      this.shake = Math.max(-0.05, Math.min(0.05, this.shake));
      // spin direction follows the stereo balance with hysteresis (v0.8 flipped on its sign every frame: an accidental jitter)
      const bal = store.frame?.balance ?? 0;
      if (bal > 0.08) this.spinDir = 1; else if (bal < -0.08) this.spinDir = -1;
      for (const w of this.waves) w.age += this.dt;
      this.waves = this.waves.filter((w) => w.age < 1.2);
    },
    render(store) {
      const c = this.ctx, W = this.canvas.width, H = this.canvas.height, f = store.frame, a = store.analysis, dpr = this.dpr || 1;
      if (!f || !a) return;
      const dt = this.dt, pulse = f.bandsPulse ?? [0, 0, 0, 0, 0, 0, 0];
      const low = Math.max(pulse[0], pulse[1]), mid = pulse[3];
      // feedback: the previous picture, zoomed out and turned a little, fading (rates × dt)
      this.pctx.globalCompositeOperation = 'copy'; this.pctx.drawImage(this.canvas, 0, 0);
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      const turn = (0.1 + 0.5 * mid) * dt * this.spinDir + this.shake * Math.min(1, dt * 30);
      // the turned picture must still cover the screen, or its rectangular edge shows:
      // a W×H rectangle turned by θ covers itself when scaled by cos|θ| + max(W/H, H/W)·sin|θ|
      const cover = Math.cos(Math.abs(turn)) + Math.max(W / H, H / W) * Math.sin(Math.abs(turn));
      const zoom = Math.max(Math.exp((0.25 + 0.9 * low) * dt), cover);
      c.globalAlpha = Math.pow(0.5, dt / 0.28);
      c.translate(W / 2, H / 2); c.rotate(turn); c.scale(zoom, zoom); c.drawImage(this.prev, -W / 2, -H / 2);
      c.setTransform(1, 0, 0, 1, W / 2, H / 2); c.globalAlpha = 1;
      // circular fade: trails dissolve before reaching the frame edge, so the shape reads round, not as a
      // rectangle being shaken (v0.8 trails filled the whole canvas and its rotated edges showed)
      const Rmin = 0.5 * Math.min(W, H), Rmax = 0.5 * Math.hypot(W, H);
      const fadeG = c.createRadialGradient(0, 0, Rmin * 0.85, 0, 0, Rmax);
      fadeG.addColorStop(0, 'rgba(0,0,0,0)'); fadeG.addColorStop(0.45, 'rgba(0,0,0,0.35)'); fadeG.addColorStop(1, 'rgba(0,0,0,1)');
      c.fillStyle = fadeG; c.fillRect(-W / 2, -H / 2, W, H);
      c.globalCompositeOperation = 'lighter';
      const R = 0.28 * Math.min(W, H);
      // 0. band-level bullseye filling the core: sub-bass at the centre … brilliance at the waveform
      //    ring, each ring as bright as that band's adaptive level (so the middle is never empty)
      const lv = store.bandsNorm.values;
      for (let j = 6; j >= 0; j--) {
        const r0 = R * 0.85 * (j / 7), r1 = R * 0.85 * ((j + 1) / 7);
        const grd = c.createRadialGradient(0, 0, r0, 0, 0, r1);
        const col = `hsla(${280 - 260 * (j / 6)},100%,50%,`;
        grd.addColorStop(0, col + (0.05 + 0.2 * lv[j]) + ')'); grd.addColorStop(1, col + (0.02 + 0.1 * lv[j]) + ')');
        c.fillStyle = grd; c.beginPath(); c.arc(0, 0, r1, 0, 2 * Math.PI); c.arc(0, 0, r0, 0, 2 * Math.PI, true); c.fill();
      }
      // 1. polar spectrum: mirrored spokes, lows at the bottom, highs at the top; brightness = band pulse
      const spec = store.spectrum.values, n = spec.length, sw = Math.max(1, (Math.PI * R) / n * 0.7);
      c.lineWidth = sw;
      for (let i = 0; i < n; i++) {
        const len = R * 0.65 * U.dbTo01(spec[i], -90, -10), band = Math.min(6, Math.floor((i / n) * 7));
        c.strokeStyle = `hsla(${280 - 260 * (i / (n - 1))},100%,${40 + 18 * pulse[band]}%,0.8)`;
        for (const side of [1, -1]) {
          const ang = Math.PI / 2 - side * Math.PI * ((i + 0.5) / n), cx = Math.cos(ang), cy = Math.sin(ang);
          c.beginPath(); c.moveTo(cx * R * 1.1, cy * R * 1.1); c.lineTo(cx * (R * 1.1 + len), cy * (R * 1.1 + len)); c.stroke();
        }
      }
      // 2. waveform ring (mid signal), auto-gained
      store.recentWave(1024, this.wl, this.wr);
      let pk = 0.02; for (let i = 0; i < 1024; i++) pk = Math.max(pk, Math.abs(this.wl[i] + this.wr[i]) / 2);
      this.gain += (1 - Math.exp(-dt / 0.5)) * (0.18 / pk - this.gain);
      c.strokeStyle = 'rgba(200,225,255,0.55)'; c.lineWidth = 1.5 * dpr; c.beginPath();
      for (let i = 0; i <= 512; i++) {
        const k = (i % 512) * 2, w = (this.wl[k] + this.wr[k]) / 2, taper = Math.sin(Math.PI * (i % 512) / 512) ** 0.3;
        const rr = R * (0.95 + this.gain * w * taper), ang = (2 * Math.PI * i) / 512;
        i ? c.lineTo(rr * Math.cos(ang), rr * Math.sin(ang)) : c.moveTo(rr * Math.cos(ang), rr * Math.sin(ang));
      }
      c.stroke();
      // 3. band-pulse halos (7 rings between the core and the waveform)
      c.lineWidth = 3 * dpr;
      for (let j = 0; j < 7; j++) if (pulse[j] > 0.02) { c.strokeStyle = `hsla(${200 + j * 22},100%,55%,${0.7 * pulse[j]})`; c.beginPath(); c.arc(0, 0, R * (0.55 + 0.05 * j), 0, 2 * Math.PI); c.stroke(); }
      // 4. goniometer core, coloured by correlation (green = mono … red = opposite phase)
      const hue = 60 + 60 * f.correlation;
      c.fillStyle = `hsla(${hue},100%,55%,0.45)`;
      const g = R * 0.5 * Math.min(4, 0.25 / pk) * Math.SQRT1_2;
      for (let i = 0; i < 1024; i += 2) c.fillRect((this.wr[i] - this.wl[i]) * g, -(this.wl[i] + this.wr[i]) * g, 1.5 * dpr, 1.5 * dpr);
      // 5. centroid needle (angle = log frequency: bottom 20 Hz → round the right → top 20 kHz)
      if (!f.silent) {
        const ang = Math.PI / 2 - Math.PI * logPos(f.centroid);
        c.strokeStyle = '#FF6AD5'; c.lineWidth = 2 * dpr; c.beginPath(); c.moveTo(Math.cos(ang) * R * 0.5, Math.sin(ang) * R * 0.5); c.lineTo(Math.cos(ang) * R * 1.08, Math.sin(ang) * R * 1.08); c.stroke();
      }
      // 6. level arcs: each channel's arc is centred on its own side (left at 180°, right at 0°) and
      //    widens symmetrically with its RMS level: sweep = ½π · (dBFS + 60)/60
      c.lineWidth = 5 * dpr;
      [[0, Math.PI, COL.left], [1, 0, COL.right]].forEach(([ch, centre, col]) => {
        const sweep = (Math.PI / 2) * U.dbTo01(store.rmsDb.values[ch], -60, 0);
        if (sweep <= 0) return;
        c.strokeStyle = col; c.beginPath(); c.arc(0, 0, R * 1.85, centre - sweep / 2, centre + sweep / 2); c.stroke();
      });
      // 7. onset shockwaves expanding from the spectrum ring
      for (const w of this.waves) {
        c.strokeStyle = `hsla(${w.hue},100%,58%,${0.75 * w.a * (1 - w.age / 1.2)})`; c.lineWidth = 4 * dpr;
        c.beginPath(); c.arc(0, 0, R * 1.1 + w.age * H * 1.1, 0, 2 * Math.PI); c.stroke();
      }
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over';
    },
    dispose() { this.ctx = null; this.prev = null; },
  });

  root.Visualizations = root.Visualizations || { collections: [] };
  root.Visualizations.collections.push({
    id: 'bars-waves', name: 'Bars & Waves', available: true,
    presets: [
      { id: 'instruments', name: 'Instruments', create: instruments },
      { id: 'spectrum', name: 'Spectrum glow', create: spectrum },
      { id: 'scope', name: 'Oscilloscope', create: scope },
      { id: 'stereo', name: 'Stereo field', create: stereo },
      { id: 'circular', name: 'Circular spectrum', create: circular },
      { id: 'ridgeline', name: 'Ridgeline', create: ridgeline },
      { id: 'vu', name: 'VU meters', create: vu },
      { id: 'analysis', name: 'Analysis', create: analysis },
      { id: 'mashup', name: 'Mashup', create: mashup },
    ],
  });
  // Fallback entries: the module collections replace these when they load. If a module fails to
  // load, its entry stays listed but unavailable (and Diagnostics shows the error).
  for (const [id, name] of [['experimental', 'Experimental (failed to load)'], ['alchemy', 'Alchemy-inspired (failed to load)'], ['battery', 'Battery-inspired (failed to load)'], ['ambience', 'Ambience-inspired (failed to load)']]) {
    root.Visualizations.collections.push({ id, name, available: false, presets: [] });
  }
})(self);
