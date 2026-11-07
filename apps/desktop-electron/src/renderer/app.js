/* Renderer entry point. Owns UI state and the render loop; audio arrives from the native
 * service via window.studio (preload bridge). No Node APIs are available here by design. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const studio = window.studio;
  const registry = window.Visualizations.collections;

  const store = new window.FeatureStore();
  const flash = new window.DspUtils.FlashLimiter();
  const COLLECTION_ORDER = ['bars-waves', 'experimental', 'alchemy', 'battery', 'ambience'];
  let canvas = $('viz');

  const AS = window.AutoShuffle, Cal = window.Calibration;
  // live objects every renderer reads each frame (Influence panel, calibrated smoothing)
  const influence = { shape: 1, motion: 1, colour: 1 };
  const audioEnv = { smoothing: 1 };
  const ui = {
    settings: null,
    collection: null, preset: null, renderer: null, currentKey: null,
    outgoing: null,                 // { renderer, canvas, t0, dur, trans } while a transition runs
    lastTransition: null,
    devices: null, status: null, service: null, stats: null, lastError: null,
    fullscreen: false, idleTimer: null,
    fps: 0, fpsFrames: 0, fpsT0: performance.now(),
    size: { w: 1, h: 1, dpr: 1 },
    detector: new AS.MusicalChangeDetector(), director: new AS.AutoDirector(), bag: new AS.ShuffleBag([]), bagSig: '',
  };
  const library = () => ui.settings.library;

  // ---------------- collections & presets (real + favourites + your collections) ----------------
  function allCollections() {
    registry.sort((a, b) => COLLECTION_ORDER.indexOf(a.id) - COLLECTION_ORDER.indexOf(b.id));
    // v0.14: ★ Favourites is the only virtual collection (user collections were confusing; data is kept)
    return [...registry, ...AS.virtualCollections(library(), registry.filter((c) => !c.virtual)).filter((c) => c.id === 'favourites')];
  }
  const presetValue = (p) => p.key ?? p.id;                  // virtual entries are identified by key
  const realKey = (coll, p) => p.key ?? AS.keyOf(coll.id, p.id);

  function fillCollections() {
    $('collection').replaceChildren(...allCollections().map((c) => {
      const o = new Option(c.name, c.id);
      o.disabled = !c.available;
      return o;
    }));
    if (ui.collection) $('collection').value = ui.collection.id;
  }

  function fillPresets() {
    $('preset').replaceChildren(...ui.collection.presets.map((p) => new Option(p.label ?? p.name, presetValue(p))));
    $('preset').value = presetValue(ui.preset);
    $('collection').value = ui.collection.id;
    const fav = library().favourites.includes(ui.currentKey);
    $('fav').setAttribute('aria-pressed', String(fav));
    $('fav').querySelector('use').setAttribute('href', fav ? '#i-star' : '#i-star-o');
    $('fav').title = fav ? 'Remove from favourites (S)' : 'Add to favourites (S)';
    renderFavouritesUi();
  }

  function makeCanvas() {
    const c = document.createElement('canvas');
    c.className = 'viz'; c.setAttribute('aria-label', 'Audio visualisation');
    c.addEventListener('webglcontextlost', (e) => {
      if (c !== canvas) return;                  // an outgoing or disposed preset's canvas
      e.preventDefault();                         // allow restoration
      ui.contextLost = true; showError('GPU', 'graphics context lost; waiting for it to be restored');
    });
    c.addEventListener('webglcontextrestored', () => {
      if (c !== canvas) return;
      ui.contextLost = false; activate(ui.collection.id, presetValue(ui.preset), { persist: false });   // rebuild all GPU resources
    });
    return c;
  }

  function finishTransition() {
    const o = ui.outgoing;
    if (!o) return;
    ui.outgoing = null;
    try { o.renderer?.dispose(); } catch (e) { console.error(e); }
    o.canvas.remove();
  }

  /**
   * Show a preset. opts.transition = { type, angle, seconds } keeps the old preset running on top
   * and dissolves it away; without it the switch is instant.
   */
  function activate(collectionId, presetId, opts = {}) {
    const { persist = true, transition = null, auto = false } = opts;
    if (!auto) ui.director.restart();             // a manual change restarts the automatic timer
    const cols = allCollections();
    const coll = cols.find((c) => c.id === collectionId && c.available) || cols.find((c) => c.available);
    const preset = coll.presets.find((p) => presetValue(p) === presetId) || coll.presets[0];
    finishTransition();                                                  // only one transition at a time
    const fresh = makeCanvas();
    if (transition && ui.renderer) {
      canvas.before(fresh);                                              // the old canvas stays on top and dissolves
      ui.outgoing = { renderer: ui.renderer, canvas, t0: performance.now(), dur: transition.seconds * 1000, trans: transition };
      ui.lastTransition = transition.type;
    } else {
      if (ui.renderer) { try { ui.renderer.dispose(); } catch (e) { console.error(e); } }
      canvas.replaceWith(fresh);
    }
    ui.renderer = null;
    canvas = fresh;
    ui.collection = coll; ui.preset = preset; ui.currentKey = realKey(coll, preset);
    resize();
    try {
      ui.renderer = preset.create();
      ui.renderer.initialize(canvas, { flash, influence, audio: audioEnv });
      ui.renderer.resize(ui.size.w, ui.size.h, ui.size.dpr);
    } catch (e) {
      ui.renderer = null;
      finishTransition();
      showError(`${coll.name} › ${preset.name} could not start`, e.message);
      showNotice('This visualisation could not start', `${e.message}\n\nPick another preset, or check Diagnostics.`);
      return;
    }
    hideNoticeIfRenderer();
    fillPresets();
    // Influence is most at home in Experimental: highlight it there, and say so once per session
    const experimental = coll.id === 'experimental' || preset.realCollection === 'experimental';
    $('influence-toggle').classList.toggle('accent', experimental);
    if (experimental && !ui.influenceHinted) { ui.influenceHinted = true; setTimeout(() => showOsd('Influence controls', 'Press U to set how sound shapes, moves and colours Morph'), 2400); }
    showOsd(`${preset.name}`, coll.virtual ? `${coll.name.replace(/^[★▸] /, '')} · ${(registry.find((c) => c.id === preset.realCollection)?.name) ?? ''}` : coll.name);
    if (persist) studio.updateSettings({ collection: coll.id, preset: presetValue(preset) });
  }

  /** A short, smooth transition for manual changes; the chosen one for automatic changes. */
  function manualTransition() {
    return { ...AS.pickTransition(ui.settings.auto.transition, ui.lastTransition), seconds: Math.max(0.6, ui.settings.auto.seconds * 0.5) };
  }

  function stepPreset(delta) {
    const list = ui.collection.presets;
    const i = list.indexOf(ui.preset);
    activate(ui.collection.id, presetValue(list[(i + delta + list.length) % list.length]), { transition: manualTransition() });
  }

  function stepCollection(delta) {
    const avail = allCollections().filter((c) => c.available);
    const i = avail.findIndex((c) => c.id === ui.collection.id);
    const next = avail[(i + delta + avail.length) % avail.length];
    activate(next.id, presetValue(next.presets[0]), { transition: manualTransition() });
  }

  // ---------------- shuffle and automatic mode ----------------
  function poolKeys() {
    const pool = ui.settings.auto.pool;
    if (pool === 'favourites' && library().favourites.length) return library().favourites;
    if (pool === 'collection') return ui.collection.presets.map((p) => realKey(ui.collection, p));
    return registry.filter((c) => c.available && !c.virtual).flatMap((c) => c.presets.map((p) => AS.keyOf(c.id, p.id)));
  }

  /** Go to the next preset in the shuffle bag. In a favourites/collection pool, stay in that list. */
  function shuffleNext(reason, auto) {
    const keys = poolKeys(), sig = keys.join(',');
    if (sig !== ui.bagSig) { ui.bag.setItems(keys); ui.bagSig = sig; }
    const key = ui.bag.next(ui.currentKey);
    if (!key) return;
    const t = auto ? { ...AS.pickTransition(ui.settings.auto.transition, ui.lastTransition), seconds: ui.settings.auto.seconds } : manualTransition();
    const inList = ui.collection.virtual && ui.collection.presets.some((p) => p.key === key);
    if (inList) activate(ui.collection.id, key, { transition: t, auto });
    else { const [c, p] = key.split('/'); activate(c, p, { transition: t, auto }); }
    if (reason) { showOsd(ui.preset.name, `Automatic: ${reason}`); console.log(`[auto] ${reason} → ${key} (${t.type}, ${t.seconds} s) at ${(performance.now() / 1000).toFixed(1)} s`); }
  }
  const randomPreset = () => shuffleNext(null, false);

  function configureAuto() {
    const a = ui.settings.auto;
    ui.director.configure({ mode: a.mode, minutes: a.minutes });
    ui.director.restart();
    $('auto-toggle').setAttribute('aria-pressed', String(a.enabled));
    $('auto-toggle').title = a.enabled
      ? `Automatic mode on: ${a.mode === 'music' ? 'follows the music' : `every ${a.minutes} min`} (A)`
      : 'Automatic mode: switch presets every few minutes or when the music changes (A)';
  }

  function setAuto(patch) {
    ui.settings.auto = { ...ui.settings.auto, ...patch };
    studio.updateSettings({ auto: ui.settings.auto });
    configureAuto();
  }

  // ---------------- favourites and your collections ----------------
  function saveLibrary() {
    studio.updateSettings({ library: library() });
    const keepColl = ui.collection.id, keepPreset = presetValue(ui.preset);
    fillCollections();
    // the current list may have changed (e.g. un-favourited inside ★ Favourites): refresh it
    const fresh = allCollections().find((c) => c.id === keepColl);
    if (fresh) { ui.collection = fresh; ui.preset = fresh.presets.find((p) => presetValue(p) === keepPreset) ?? ui.preset; }
    fillPresets();
  }

  function toggleFavourite() {
    const was = library().favourites.includes(ui.currentKey);
    library().favourites = AS.toggleKey(library().favourites, ui.currentKey);
    saveLibrary();
    showOsd(was ? 'Removed from favourites' : '★ Added to favourites', ui.preset.name);
  }

  /** The Favourites panel: click an item to play it; ✕ removes it. */
  function renderFavouritesUi() {
    const favs = AS.virtualCollections(library(), registry.filter((c) => !c.virtual))[0].presets;
    const items = favs.map((p) => {
      const li = document.createElement('li');
      if (p.key === ui.currentKey) li.className = 'playing';
      const play = document.createElement('button'); play.className = 'fav-play'; play.title = `Play ${p.name}`;
      play.append(Object.assign(document.createElement('strong'), { textContent: p.name }),
        Object.assign(document.createElement('span'), { textContent: registry.find((c) => c.id === p.realCollection)?.name ?? '' }));
      play.onclick = () => { const [c, id] = p.key.split('/'); activate(c, id, { transition: manualTransition() }); };
      const rm = document.createElement('button'); rm.className = 'fav-remove'; rm.textContent = '✕'; rm.title = `Remove ${p.name} from favourites`;
      rm.onclick = () => { library().favourites = AS.toggleKey(library().favourites, p.key); saveLibrary(); };
      li.append(play, rm);
      return li;
    });
    if (!items.length) items.push(Object.assign(document.createElement('li'), { className: 'fav-empty', textContent: 'No favourites yet. Press S, or the ☆ next to the name of the visualisation that is playing, to add it here.' }));
    $('fav-items').replaceChildren(...items);
    const isFav = library().favourites.includes(ui.currentKey);
    $('fav-current').textContent = isFav ? `Remove “${ui.preset?.name ?? ''}” from favourites` : `☆ Add “${ui.preset?.name ?? ''}” to favourites`;
    $('fav-shuffle').disabled = favs.length < 2;
  }

  // ---------------- shuffle source (shared with automatic mode) ----------------
  function setShuffleSource(pool) {
    setAuto({ pool }); ui.bagSig = '';
    $('auto-pool').value = pool;
    for (const b of document.querySelectorAll('#shuffle-menu .menuitem')) b.setAttribute('aria-checked', String(b.dataset.pool === pool));
    $('shuffle-badge').hidden = pool !== 'favourites';
    $('random').title = pool === 'favourites' ? 'Shuffle favourites (R)' : pool === 'collection' ? 'Shuffle this collection (R)' : 'Shuffle all (R)';
  }
  function shuffleFrom(pool) {
    if (pool === 'favourites' && library().favourites.length < 2) {
      showOsd(library().favourites.length ? 'Add another favourite first' : 'No favourites yet', 'Press S to favourite the visualisation that is playing');
      return;
    }
    setShuffleSource(pool);
    shuffleNext(null, false);
  }

  /** Only one panel at a time. */
  const PANELS = { settings: 'settings-toggle', influence: 'influence-toggle', 'fav-panel': 'fav-list-toggle', 'shuffle-menu': 'shuffle-menu-toggle' };
  function openPanel(id, force) {
    const open = force ?? $(id).hidden;
    if (open) closeOthers(id);
    for (const [pid, btn] of Object.entries(PANELS)) {
      const show = pid === id && open;
      $(pid).hidden = !show; $(btn).setAttribute('aria-expanded', String(show));
    }
    if (open && id === 'fav-panel') renderFavouritesUi();
    if (open && id === 'settings') refreshDisplays();
  }

  // ---------------- Influence (shape / movement / colour) ----------------
  function bindInfluence() {
    const save = debounce(() => studio.updateSettings({ influence: { ...influence } }), 300);
    for (const k of ['shape', 'motion', 'colour']) {
      const el = $(`inf-${k}`), out = $(`inf-${k}-v`);
      el.value = String(Math.round(influence[k] * 100)); out.textContent = `${el.value} %`;
      el.oninput = () => { influence[k] = Number(el.value) / 100; out.textContent = `${el.value} %`; save(); };
    }
    $('inf-reset').onclick = () => { Object.assign(influence, { shape: 1, motion: 1, colour: 1 }); bindInfluence(); save(); };
  }
  function toggleInfluence(force) { openPanel('influence', force); }
  function debounce(fn, ms) { let t = null; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

  // ---------------- Audio input tuning (per input: microphone and system audio keep their own) ----------------
  function inputKey() {
    const i = ui.settings.input;
    return `${i.source}:${i.deviceId ?? (i.source === 'synthetic' ? i.signal : 'default')}`;
  }
  function profile() { return { ...Cal.DEFAULTS, ...(ui.settings.audio.profiles[inputKey()] ?? {}) }; }
  function applyAudioProfile() {
    const p = profile();
    audioEnv.smoothing = p.smoothing;
    studio.tune({ gainDb: p.gainDb, silenceDb: p.noiseFloorDb, pulseRangeDb: p.pulseRangeDb }).catch((e) => showError('Tuning', e.message));
    bindAudio();
  }
  const saveAudio = debounce(() => studio.updateSettings({ audio: ui.settings.audio }), 300);
  function setProfile(patch) {
    ui.settings.audio.profiles[inputKey()] = { ...profile(), ...patch };
    applyAudioProfile(); saveAudio();
  }
  function bindAudio() {
    const p = profile(), dev = ui.status?.deviceName ?? inputKey().split(':')[0];
    $('audio-profile').textContent = `(saved for ${dev})`;
    const rows = [['aud-gain', 'gainDb', (v) => `${v > 0 ? '+' : ''}${v} dB`], ['aud-floor', 'noiseFloorDb', (v) => `${v} dB`],
      ['aud-range', 'pulseRangeDb', (v) => `${v} dB`], ['aud-smooth', 'smoothing', (v) => `${Number(v).toFixed(2)}×`]];
    for (const [id, k, fmtv] of rows) {
      const el = $(id), out = $(`${id}-v`);
      el.value = String(p[k]); out.textContent = fmtv(p[k]);
      el.title = { gainDb: 'Gain applied before analysis', noiseFloorDb: 'Below this level counts as silence', pulseRangeDb: 'Pulse range: smaller is more sensitive to beats', smoothing: 'Multiplies every smoothing time' }[k];
      el.onchange = () => setProfile({ [k]: Number(el.value) });
      el.oninput = () => { out.textContent = fmtv(Number(el.value)); };
    }
    $('aud-reset').onclick = () => { delete ui.settings.audio.profiles[inputKey()]; applyAudioProfile(); saveAudio(); };
    $('calibrate').onclick = () => openCalibration();
  }

  // ---------------- Calibration wizard ----------------
  const calib = { open: false, step: null, kind: 'music', rec: null, quiet: null, typical: null, result: null, target: 0 };
  function openCalibration() {
    closeOthers(null);
    Object.assign(calib, { open: true, step: 'choose', kind: ui.settings.input.source === 'input' ? 'mic' : 'music', rec: null, quiet: null, typical: null, result: null });
    $('calib').hidden = false; renderCalibration();
  }
  function closeCalibration() { calib.open = false; calib.rec = null; $('calib').hidden = true; }
  function startRecording(step, seconds) { Object.assign(calib, { step, rec: new Cal.Recorder(), target: seconds }); renderCalibration(); }
  function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
  function button(text, fn, cls = 'plain') { const b = el('button', text, cls); b.onclick = fn; return b; }
  function renderCalibration() {
    const body = [], actions = [];
    if (calib.step === 'choose') {
      body.push(el('p', 'This measures your audio for a few seconds and recommends gain, noise floor, beat sensitivity and smoothing for this input. Nothing is recorded or saved except the four settings.'));
      body.push(el('p', `Input: ${ui.status?.deviceName ?? inputKey()}`));
      actions.push(button('Music or system audio', () => { calib.kind = 'music'; startRecording('typical', 10); }, calib.kind === 'music' ? 'plain accent' : 'plain'));
      actions.push(button('Microphone or environment', () => { calib.kind = 'mic'; startRecording('quiet', 4); }, calib.kind === 'mic' ? 'plain accent' : 'plain'));
    } else if (calib.step === 'quiet' || calib.step === 'typical') {
      body.push(el('p', calib.step === 'quiet' ? 'Step 1 of 2: keep the room quiet for 4 seconds (this measures the background noise).' : `${calib.kind === 'mic' ? 'Step 2 of 2: ' : ''}let typical sound play for 10 seconds: the music you will listen to, or the room, voice or nature you will visualise.`));
      const bar = el('div', null, 'progress'), fill = el('div'); bar.append(fill); body.push(bar);
      calib.fill = fill;
      actions.push(button('Cancel', closeCalibration));
    } else if (calib.step === 'result') {
      const r = calib.result, t = calib.typical, cur = profile();
      body.push(el('p', `Measured over ${t.seconds.toFixed(1)} s: typical level ${t.p50.toFixed(1)} dBFS (with the current ${cur.gainDb} dB gain), dynamic range ${t.dynamicRange.toFixed(1)} dB, ${t.onsetRate.toFixed(1)} onsets per second${calib.quiet ? `, quiet room ${calib.quiet.p95.toFixed(1)} dBFS` : ''}.`));
      const table = el('table');
      for (const [label, now, rec] of [['Input gain', `${cur.gainDb} dB`, `${r.gainDb > 0 ? '+' : ''}${r.gainDb} dB`], ['Noise floor', `${cur.noiseFloorDb} dB`, `${r.noiseFloorDb} dB`], ['Beat sensitivity (pulse range)', `${cur.pulseRangeDb} dB`, `${r.pulseRangeDb} dB`], ['Smoothing', `${cur.smoothing}×`, `${r.smoothing}×`]]) {
        const tr = el('tr'); tr.append(el('td', label), el('td', now, 'v'), el('td', '→', 'v'), el('td', rec, 'v')); table.append(tr);
      }
      body.push(table);
      for (const why of r.reasons) body.push(el('p', `• ${why}`));
      actions.push(button('Apply', () => { setProfile({ gainDb: r.gainDb, noiseFloorDb: r.noiseFloorDb, pulseRangeDb: r.pulseRangeDb, smoothing: r.smoothing }); closeCalibration(); showOsd('Calibration applied', `Saved for ${ui.status?.deviceName ?? 'this input'}`); }, 'plain accent'));
      actions.push(button('Measure again', () => openCalibration()));
      actions.push(button('Cancel', closeCalibration));
    }
    $('calib-body').replaceChildren(...body);
    $('calib-actions').replaceChildren(...actions);
    (actions.find((b) => b.classList.contains('accent')) ?? actions[0])?.focus();   // keyboard: Enter takes the suggestion
  }
  /** Called with each frame batch from the render loop while recording. */
  function calibrationFrames(frames, hop) {
    if (!calib.open || !calib.rec) return;
    for (const f of frames) calib.rec.push(f, hop);
    if (calib.fill) calib.fill.style.width = `${Math.min(100, (100 * calib.rec.seconds) / calib.target)}%`;
    if (calib.rec.seconds < calib.target) return;
    const summary = calib.rec.summary();
    if (calib.step === 'quiet') { calib.quiet = summary; startRecording('typical', 10); return; }
    calib.typical = summary; calib.rec = null;
    calib.result = Cal.recommend({ kind: calib.kind, typical: summary, quiet: calib.quiet, currentGainDb: profile().gainDb });
    calib.step = 'result'; renderCalibration();
  }

  // ---------------- on-screen title (fades) ----------------
  let osdTimer = null;
  function showOsd(title, sub = '') {
    const o = $('osd');
    o.replaceChildren(Object.assign(document.createElement('strong'), { textContent: title }), Object.assign(document.createElement('span'), { textContent: sub }));
    o.classList.add('visible');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => o.classList.remove('visible'), 2200);
  }

  // ---------------- canvas sizing ----------------
  function resize() {
    const r = $('stage').getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ui.size = { w: Math.max(1, r.width), h: Math.max(1, r.height), dpr };
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ui.renderer?.resize(ui.size.w, ui.size.h, dpr);
    ui.outgoing?.renderer?.resize(ui.size.w, ui.size.h, dpr);
  }
  new ResizeObserver(resize).observe($('stage'));

  // ---------------- input selection ----------------
  const SIGNAL_NAMES = {
    beat: 'Synthetic beat (120 BPM)', sine100: 'Sine 100 Hz', sine440: 'Sine 440 Hz', sine1000: 'Sine 1 kHz',
    noise: 'White noise', impulses: 'Impulses (2 per second)', leftOnly: 'Sine 440 Hz, left only',
    antiphase: 'Sine 440 Hz, opposite phase', sweep: 'Sweep 20 Hz to 20 kHz',
    denseMix: 'Dense mastered mix (124 BPM)',
    lissajous: 'Lissajous figure (for the phosphor scope)',
  };
  const encodeInput = (source, deviceId, signal) => `${source}|${source === 'synthetic' ? signal : (deviceId || '')}`;

  function fillInputs() {
    const d = ui.devices;
    const sel = $('input');
    const groups = [];
    const g1 = document.createElement('optgroup'); g1.label = 'What this PC is playing';
    g1.append(new Option('Default output (follows Windows)', encodeInput('loopback', null)));
    (d?.render || []).forEach((x) => g1.append(new Option(x.name + (x.isDefault ? ' (default)' : ''), encodeInput('loopback', x.id))));
    groups.push(g1);
    const g2 = document.createElement('optgroup'); g2.label = 'Microphone or line in';
    g2.append(new Option('Default input (follows Windows)', encodeInput('input', null)));
    (d?.capture || []).forEach((x) => g2.append(new Option(x.name + (x.isDefault ? ' (default)' : ''), encodeInput('input', x.id))));
    groups.push(g2);
    const g3 = document.createElement('optgroup'); g3.label = 'Test signals (simulated)';
    (d?.signals || Object.keys(SIGNAL_NAMES)).forEach((s) => g3.append(new Option(SIGNAL_NAMES[s] || s, encodeInput('synthetic', null, s))));
    groups.push(g3);
    sel.replaceChildren(...groups);
    const inp = ui.settings.input;
    sel.value = encodeInput(inp.source, inp.deviceId, inp.signal);
    if (sel.selectedIndex < 0) sel.value = encodeInput(inp.source, null, inp.signal); // saved device no longer present
  }

  async function chooseInput(value) {
    const [source, rest] = value.split('|');
    const req = source === 'synthetic' ? { source, signal: rest } : { source, deviceId: rest || null };
    try {
      await studio.startCapture(req);
      ui.settings.input = { source, deviceId: req.deviceId ?? null, signal: req.signal ?? ui.settings.input.signal };
      applyAudioProfile();                     // each input keeps its own calibration
    } catch (e) { showError('Could not switch input', e.message); }
  }

  // ---------------- status & notices ----------------
  function span(text, cls) { const s = document.createElement('span'); s.textContent = text; if (cls) s.className = cls; return s; }

  /** v0.14: a status light with the detail in its tooltip (the device text took too much of the bar). */
  function renderStatus() {
    const st = ui.status, f = store.frame, dot = $('status-dot');
    let cls = '', text;
    if (!st) text = 'Connecting to the audio service…';
    else if (st.state === 'running') {
      text = `${st.deviceName} (${st.format})`;
      cls = st.source === 'synthetic' ? 'sim' : f?.gap || f?.silent ? 'quiet' : 'ok';
      if (st.source === 'synthetic') text = `Simulated test signal: ${text}`;
      if (f?.gap) text += '. Nothing playing.'; else if (f?.silent) text += '. Silence.';
      if (f?.clip) { text += ' Clipping.'; cls = 'bad'; }
    } else if (st.state === 'recovering') { text = st.message || 'Reconnecting…'; cls = 'bad'; }
    else text = st.state === 'stopped' ? 'Capture stopped' : 'Starting…';
    dot.className = `dot ${cls}`;
    dot.title = text; dot.setAttribute('aria-label', text);
    $('input').title = `Audio input (I): ${text}`;
  }

  function showNotice(title, body) {
    $('notice-title').textContent = title;
    $('notice-body').textContent = body;
    $('notice').hidden = false;
  }
  function hideNotice() { $('notice').hidden = true; }
  function hideNoticeIfRenderer() { if (ui.service?.state !== 'missing' && ui.service?.state !== 'crashed') hideNotice(); }
  function showError(title, body) { ui.lastError = `${title}: ${body}`; console.warn(ui.lastError); }

  function onService(st) {
    ui.service = st;
    if (st.state === 'missing') {
      showNotice('The audio service is not built yet',
        'Close this window and run scripts\\build-service.ps1 from the project folder, then start the app again.\n\n' +
        `Looked for: ${st.path || 'AudioCapture.exe'}${st.message ? `\n${st.message}` : ''}`);
    } else if (st.state === 'crashed') {
      showNotice('The audio service stopped', `Restarting it in ${(st.restartInMs / 1000).toFixed(1)} s. Details are in the terminal window.`);
    } else hideNotice();
  }

  // ---------------- diagnostics ----------------
  function fmt(v, d = 1, unit = '') { return Number.isFinite(v) ? `${v.toFixed(d)}${unit}` : '–'; }

  function renderDiagnostics() {
    if ($('diagnostics').hidden) return;
    const f = store.frame, a = store.analysis, s = ui.stats, lat = store.latencyStats();
    const rows = [
      ['Input'],
      ['Device', ui.status?.deviceName ?? '–'],
      ['Format', ui.status?.format ?? '–'],
      ['Simulated', f ? (f.synthetic ? 'yes' : 'no') : '–'],
      ['Analysis'],
      ['FFT / low FFT', a ? `${a.fftSize} / ${a.lowFftSize || 'off'}` : '–'],
      ['Hop, bin width', a ? `${a.hop}, ${fmt(a.binHz, 2, ' Hz')}` : '–'],
      ['Frames/s expected', a ? fmt(a.frameRate, 2) : '–'],
      ['Frames/s received', String(store.measuredFrameRate)],
      ['Render FPS', fmt(ui.fps, 0)],
      ['Capture→draw (median, p95)', lat ? `${fmt(lat.median, 0)} / ${fmt(lat.p95, 0)} ms` : '–'],
      ['Dropped: input / IPC / renderer', `${s?.inputFramesDropped ?? 0} / ${s?.framesDroppedIpc ?? 0} / ${store.droppedInRenderer}`],
      ['Overlap trimmed, gap threshold', s ? `${s.overlapFramesDropped ?? 0} samples, ${fmt(s.gapFillThresholdMs, 0, ' ms')}` : '–'],
      ['Sequence gaps', String(store.seqGaps)],
      ['Input tuning (confirmed by service)', ui.tuning ? `${ui.tuning.gainDb > 0 ? '+' : ''}${ui.tuning.gainDb} dB, floor ${ui.tuning.silenceDb} dB, range ${ui.tuning.pulseRangeDb} dB` : '–'],
      ['Influence: shape / move / colour', `${Math.round(influence.shape * 100)} / ${Math.round(influence.motion * 100)} / ${Math.round(influence.colour * 100)} %`],
      ['Features'],
      ['Level L / R', f ? `${fmt(f.dbfs[0])} / ${fmt(f.dbfs[1])} dBFS` : '–'],
      ['Peak L / R', f ? `${fmt(f.peak[0], 3)} / ${fmt(f.peak[1], 3)}` : '–'],
      ['Silent / gap fill / clip', f ? `${f.silent ? 'yes' : 'no'} / ${f.gap ? 'yes' : 'no'} / ${f.clip ? 'yes' : 'no'}` : '–'],
      ['Centroid', f && !f.silent ? fmt(f.centroid, 0, ' Hz') : '–'],
      ['Rolloff (85%)', f && !f.silent ? fmt(f.rolloff, 0, ' Hz') : '–'],
      ['Flatness', f && !f.silent ? fmt(f.flatness, 3) : '–'],
      ['Zero crossings/sample', f ? fmt(f.zcr, 4) : '–'],
      ['Balance / correlation', f ? `${fmt(f.balance, 2)} / ${fmt(f.correlation, 2)}` : '–'],
      ['Stereo width', f ? fmt(f.width, 2) : '–'],
      ['Flux (linear / log)', f ? `${fmt(f.flux, 3)} / ${fmt(f.fluxLog, 4)}` : '–'],
      ['Onset threshold', f ? fmt(f.onset.threshold, 4) : '–'],
      ['Onsets, last confidence', `${store.onsetCount}, ${fmt(store.lastOnsetConfidence, 2)}`],
    ];
    if (ui.renderer?.diagnostics) {
      rows.push([`Renderer: ${ui.preset.name}`]);
      try { rows.push(...ui.renderer.diagnostics()); } catch (e) { rows.push(['Error', e.message]); }
    }
    if (ui.lastError) rows.push(['Last error'], ['', ui.lastError]);
    const nodes = [];
    for (const r of rows) {
      if (r.length === 1) { const dt = document.createElement('dt'); dt.className = 'section'; dt.textContent = r[0]; nodes.push(dt); continue; }
      const dt = document.createElement('dt'); dt.textContent = r[0];
      const dd = document.createElement('dd'); dd.textContent = r[1];
      nodes.push(dt, dd);
    }
    $('diag-list').replaceChildren(...nodes);
  }

  // ---------------- "How it works" ----------------
  const explainState = { key: null, updaters: [] };

  function typeset(tex, el, display) {
    try { window.katex.render(tex, el, { displayMode: display, throwOnError: true, output: 'html' }); }
    catch (e) { el.textContent = tex; el.classList.add('tex-error'); el.title = e.message; }
  }

  function explainSpec() {
    const r = ui.renderer;
    if (!r) return null;
    if (typeof r.explain === 'function') return r.explain();
    const build = window.Explain?.[ui.preset.id];
    return build ? build(() => ({ frame: store.frame, drives: r.values, r })) : null;
  }

  function buildExplain() {
    const body = $('explain-body');
    const spec = explainSpec();
    explainState.updaters = [];
    explainState.key = `${ui.collection.id}/${ui.preset.id}`;
    const nodes = [];
    const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
    if (!spec) {
      nodes.push(el('h2', ui.preset.name), el('p', 'No explanation is available for this preset yet.'));
      body.replaceChildren(...nodes); return;
    }
    nodes.push(el('h2', spec.title), el('p', spec.summary, 'summary'));
    const addVars = (vars) => {
      if (!vars?.length) return;
      const table = el('table');
      for (const [sym, meaning, value] of vars) {
        const tr = el('tr'), tdS = el('td', null, 'sym'), tdM = el('td', meaning, 'meaning'), tdV = el('td', '–', 'val');
        typeset(sym, tdS, false);
        tr.append(tdS, tdM, tdV); table.append(tr);
        explainState.updaters.push(() => { try { tdV.textContent = value(); } catch { tdV.textContent = '–'; } });
      }
      nodes.push(table);
    };
    spec.steps.forEach((s, i) => {
      nodes.push(el('h3', `${i + 1}. ${s.title}`), el('p', s.why));
      for (const t of s.tex || []) { const f = el('div', null, 'formula'); typeset(t, f, true); nodes.push(f); }
      addVars(s.vars);
    });
    // audio → drives: generated from the preset's actual mapping specs
    const maps = ui.renderer?.maps?.mappings;
    if (maps && window.MappingTex) {
      nodes.push(el('h3', `${spec.steps.length + 1}. Audio → drives`),
        el('p', 'How the analysis features become the drives used above. Pulses measure how far each band rises above its recent typical level, which is what carries the beat.'));
      const vars = [];
      for (const [name, m] of Object.entries(maps)) {
        const f = el('div', null, 'formula'); typeset(window.MappingTex(name, m.spec), f, true); nodes.push(f);
        vars.push([`\text{${name}}`, 'current value', () => m.value.toFixed(2)]);
      }
      addVars(vars);
    }
    body.replaceChildren(...nodes);
    updateExplain();
  }

  function updateExplain() { for (const u of explainState.updaters) u(); }

  /** v0.20: every panel takes part in "one at a time": opening How it works closes Settings, and so on. */
  function closeOthers(except) {
    for (const [pid, btn] of Object.entries(PANELS)) if (pid !== except && !$(pid).hidden) { $(pid).hidden = true; $(btn).setAttribute('aria-expanded', 'false'); }
    if (except !== 'explain' && !$('explain').hidden) setExplain(false);
    if (except !== 'diagnostics' && !$('diagnostics').hidden) setDiagnostics(false);
  }
  function setExplain(on) {
    if (on) closeOthers('explain');
    $('explain').hidden = !on;
    $('explain-toggle').setAttribute('aria-pressed', String(on));
    if (on) buildExplain();
  }

  function setDiagnostics(on, persist = true) {
    if (on) closeOthers('diagnostics');
    $('diagnostics').hidden = !on;
    $('diag-toggle').setAttribute('aria-pressed', String(on));
    if (persist) studio.updateSettings({ ui: { diagnostics: on } });
  }

  // ---------------- settings popover ----------------
  function toggleSettings(force) { openPanel('settings', force); }
  async function refreshDisplays() {
    const displays = await studio.listDisplays();
    $('display').replaceChildren(...displays.map((d) => { const o = new Option(d.label, String(d.id)); o.selected = d.current; return o; }));
  }

  // ---------------- fullscreen & idle ----------------
  function setFullscreenUi(on) {
    ui.fullscreen = on;
    document.body.classList.toggle('fullscreen', on);
    if ($('fullscreen-now')) $('fullscreen-now').checked = on;
    poke();
  }

  // ---------------- menu visibility (v0.13: auto / always / hidden, see lib/menu-policy.js) ----------------
  const menu = new window.MenuPolicy.MenuController();
  let lastMouse = performance.now();
  function applyMenuSettings() {
    menu.configure({ mode: ui.settings.ui.menu, edgeReveal: ui.settings.ui.edgeReveal });
    $('edge-reveal').disabled = ui.settings.ui.menu !== 'hidden';
  }
  function updateMenu() {
    const now = performance.now(), visible = menu.visible(now, interfaceBusy());
    document.body.classList.toggle('idle', !visible);
    document.body.classList.toggle('nocursor', !visible && now - lastMouse > 3000);
  }
  function interfaceBusy() {
    return $('bar').matches(':hover') || Object.keys(PANELS).some((p) => !$(p).hidden) || calib.open || document.activeElement?.matches?.('select, input');
  }
  /** An app action happened: shows the menu in auto mode (not in hidden mode). */
  function poke() { menu.key(performance.now()); updateMenu(); }

  // ---------------- render loop ----------------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const tick = store.consume(Date.now());
    tick.dt = dt; tick.nowSec = now / 1000;
    // automatic mode listens to every analysis frame
    if (ui.settings.auto.enabled && store.analysis) {
      const hop = store.analysis.hop / store.analysis.sr;
      let event = null, onset = null;
      for (const f of tick.frames) {
        event = ui.detector.push(f, hop) || event;
        if (f.onset.on && (!onset || f.onset.confidence > onset.confidence)) onset = f.onset;
      }
      // audio clock, like everything else (v0.11 development: the display clock, capped at 0.1 s per
      // frame, ran slow whenever rendering dropped below 10 fps — caught in testing)
      const go = !ui.outgoing && ui.director.step(hop * tick.frames.length, event, onset);
      if (go) shuffleNext(go.reason, true);
    }
    if (calib.open && store.analysis) calibrationFrames(tick.frames, store.analysis.hop / store.analysis.sr);
    if (ui.renderer && store.analysis && !ui.contextLost) {
      try {
        ui.renderer.update(store, tick);
        ui.renderer.render(store);
      } catch (e) { showError('Renderer error', e.message); }
    }
    // the outgoing preset keeps running underneath its dissolve until the transition ends
    const o = ui.outgoing;
    if (o) {
      const p = (now - o.t0) / o.dur;
      if (p >= 1 || !o.renderer) finishTransition();
      else {
        try { if (store.analysis) { o.renderer.update(store, tick); o.renderer.render(store); } }
        catch (e) { showError('Renderer error (transition)', e.message); }
        const st = AS.transitionStyle(o.trans, p);
        o.canvas.style.opacity = st.opacity;
        o.canvas.style.mixBlendMode = st.mixBlendMode;
        o.canvas.style.maskImage = st.maskImage;
        o.canvas.style.setProperty('-webkit-mask-image', st.maskImage);
      }
    }
    ui.fpsFrames++;
    if (now - ui.fpsT0 >= 1000) { ui.fps = ui.fpsFrames * 1000 / (now - ui.fpsT0); ui.fpsFrames = 0; ui.fpsT0 = now; }
    requestAnimationFrame(frame);
  }

  // ---------------- wiring ----------------
  function bindAutoSettings() {
    const a = ui.settings.auto;
    // a saved value that is not in a list (e.g. 0.5 min written by hand) gets its own entry, so the list never shows blank
    for (const [id, v, label] of [['auto-minutes', a.minutes, `${a.minutes}`], ['auto-seconds', a.seconds, `${a.seconds} s`]]) {
      const sel = $(id);
      if (![...sel.options].some((o) => Number(o.value) === v)) sel.add(new Option(label, String(v)));
      sel.value = [...sel.options].find((o) => Number(o.value) === v).value;
    }
    $('auto-mode').value = a.mode; $('auto-pool').value = a.pool;
    $('auto-transition').value = a.transition;
    $('menu-mode').value = ui.settings.ui.menu; $('edge-reveal').checked = ui.settings.ui.edgeReveal;
    $('start-fullscreen').checked = ui.settings.ui.startFullscreen; $('fullscreen-now').checked = ui.fullscreen;
    $('ui-style').value = ui.settings.ui.style; $('ui-theme').value = ui.settings.ui.theme;
    $('ui-style').onchange = (e) => { ui.settings.ui.style = e.target.value; studio.updateSettings({ ui: { style: e.target.value } }); applyAppearance(); };
    $('ui-theme').onchange = (e) => { ui.settings.ui.theme = e.target.value; studio.updateSettings({ ui: { theme: e.target.value } }); applyAppearance(); };
    $('auto-mode').onchange = (e) => setAuto({ mode: e.target.value });
    $('auto-minutes').onchange = (e) => setAuto({ minutes: Math.min(30, Math.max(0.5, Number(e.target.value) || 3)) });
    $('auto-pool').onchange = (e) => setShuffleSource(e.target.value);
    $('auto-transition').onchange = (e) => setAuto({ transition: e.target.value });
    $('auto-seconds').onchange = (e) => setAuto({ seconds: Number(e.target.value) });
    $('menu-mode').onchange = (e) => {
      ui.settings.ui.menu = e.target.value; studio.updateSettings({ ui: { menu: e.target.value } }); applyMenuSettings();
      if (e.target.value === 'hidden') showOsd('Menu hidden', ui.settings.ui.edgeReveal ? 'Press M, or touch the bottom edge of the screen, to show it' : 'Press M to show it');
    };
    $('edge-reveal').onchange = (e) => { ui.settings.ui.edgeReveal = e.target.checked; studio.updateSettings({ ui: { edgeReveal: e.target.checked } }); applyMenuSettings(); };
    $('start-fullscreen').onchange = (e) => { ui.settings.ui.startFullscreen = e.target.checked; studio.updateSettings({ ui: { startFullscreen: e.target.checked } }); };
    $('fullscreen-now').onchange = (e) => studio.setFullscreen(e.target.checked);
    for (const b of document.querySelectorAll('#shuffle-menu .menuitem')) b.onclick = () => { openPanel('shuffle-menu', false); shuffleFrom(b.dataset.pool); };
    $('shuffle-menu-toggle').onclick = () => openPanel('shuffle-menu');
    $('fav-list-toggle').onclick = () => openPanel('fav-panel');
    $('fav-shuffle').onclick = () => shuffleFrom('favourites');
    $('all-shuffle').onclick = () => shuffleFrom('all');
    $('fav-current').onclick = toggleFavourite;
    setShuffleSource(ui.settings.auto.pool);
  }

  function toggleAuto() {
    setAuto({ enabled: !ui.settings.auto.enabled });
    const a = ui.settings.auto;
    showOsd(a.enabled ? 'Automatic mode on' : 'Automatic mode off', a.enabled ? (a.mode === 'music' ? 'Follows the music (at most every 45 s)' : `Every ${a.minutes} min`) : '');
  }

  function wire() {
    $('prev').onclick = () => stepPreset(-1);
    $('next').onclick = () => stepPreset(1);
    $('random').onclick = randomPreset;
    $('fav').onclick = toggleFavourite;
    $('auto-toggle').onclick = toggleAuto;
    $('influence-toggle').onclick = () => toggleInfluence();
    $('collection').onchange = (e) => { const c = allCollections().find((x) => x.id === e.target.value); activate(e.target.value, c ? presetValue(c.presets[0]) : null, { transition: manualTransition() }); };
    $('preset').onchange = (e) => activate(ui.collection.id, e.target.value, { transition: manualTransition() });
    $('input').onchange = (e) => chooseInput(e.target.value);
    $('fullscreen').onclick = () => studio.toggleFullscreen();
    $('diag-toggle').onclick = () => setDiagnostics($('diagnostics').hidden);
    $('explain-toggle').onclick = () => setExplain($('explain').hidden);
    $('settings-toggle').onclick = () => openPanel('settings');
    $('limit-flashes').onchange = (e) => { flash.limited = e.target.checked; studio.updateSettings({ ui: { limitFlashes: flash.limited } }); };
    $('display').onchange = (e) => studio.moveToDisplay(Number(e.target.value));
    bindAutoSettings();
    // on the stage, not a canvas: every preset gets a fresh canvas (v0.10 lost double-click after the first change)
    $('stage').ondblclick = () => studio.toggleFullscreen();
    let wheelAt = 0;
    $('stage').addEventListener('wheel', (e) => {
      const now = performance.now();
      if (now - wheelAt < 350) return;                      // one step per wheel gesture
      wheelAt = now; stepPreset(e.deltaY > 0 ? 1 : -1); poke();
    }, { passive: true });
    document.addEventListener('mousemove', (e) => { lastMouse = performance.now(); menu.pointer(e.clientY, window.innerHeight, lastMouse); updateMenu(); });
    document.addEventListener('mousedown', (e) => { lastMouse = performance.now(); menu.pointer(e.clientY, window.innerHeight, lastMouse); updateMenu(); });
    setInterval(updateMenu, 100);

    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement || e.ctrlKey || e.altKey || e.metaKey) return;
      const k = e.key;
      if (k === 'f' || k === 'F' || k === 'F11') { e.preventDefault(); studio.toggleFullscreen(); }
      else if (k === 'Escape') {
        const openP = Object.keys(PANELS).find((p) => !$(p).hidden);
        if (calib.open) closeCalibration(); else if (openP) openPanel(openP, false); else if (ui.fullscreen) studio.setFullscreen(false);
      }
      else if (k === 'l' || k === 'L') openPanel('fav-panel');
      else if (k === 'u' || k === 'U') toggleInfluence();
      else if (k === 'c' || k === 'C') openCalibration();
      else if (k === 'ArrowLeft' || k === 'PageUp') stepPreset(-1);
      else if (k === 'ArrowRight' || k === 'PageDown') stepPreset(1);
      else if (k === 'ArrowUp') stepCollection(-1);
      else if (k === 'ArrowDown') stepCollection(1);
      else if (k === 'r' || k === 'R') randomPreset();
      else if (k === 'a' || k === 'A') toggleAuto();
      else if (k === 's' || k === 'S') toggleFavourite();
      else if (k === 'h' || k === 'H') { menu.hide(); const p = Object.keys(PANELS).find((x) => !$(x).hidden); if (p) openPanel(p, false); updateMenu(); return; }
      else if (k === 'm' || k === 'M') { menu.reveal(performance.now()); updateMenu(); return; }
      else if (k === 'o' || k === 'O') openPanel('settings', true);
      else if (k === 'd' || k === 'D') setDiagnostics($('diagnostics').hidden);
      else if (k === 'e' || k === 'E') setExplain($('explain').hidden);
      else if (k === 'i' || k === 'I') { e.preventDefault(); $('input').focus(); }
      else if (k === '?') showOsd('Keys', '← → preset · ↑ ↓ collection · R shuffle · A auto · S favourite · L favourites · H hide menu · M show menu · F fullscreen · U influence · C calibrate · E maths · D diagnostics · O options · I input');
      else return;
      poke();
    });

    studio.on('frame', (f) => store.push(f, performance.now()));
    studio.on('analysis', (a) => store.setAnalysis(a));
    studio.on('devices', (d) => { ui.devices = d; fillInputs(); });
    studio.on('status', (s) => { ui.status = s; if (s.state === 'running') ui.lastError = null; renderStatus(); });
    studio.on('stats', (s) => { ui.stats = s; });
    studio.on('tuning', (t) => { ui.tuning = t; });
    studio.on('service', onService);
    studio.on('serviceError', (e) => showError(e.code, e.message));
    studio.on('window', (w) => setFullscreenUi(!!w.fullscreen));

    setInterval(() => {
      renderStatus(); renderDiagnostics();
      if (!$('explain').hidden) {
        if (explainState.key !== `${ui.collection.id}/${ui.preset.id}`) buildExplain(); else updateExplain();
      }
    }, 250);
  }

  /** Appearance: Classic or Modern style, Dark or Light mode (body classes; instant, no reload). */
  function applyAppearance() {
    document.body.classList.toggle('style-modern', ui.settings.ui.style === 'modern');
    document.body.classList.toggle('theme-light', ui.settings.ui.theme === 'light');
  }

  async function start() {
    ui.settings = await studio.getSettings();
    applyAppearance();
    studio.appInfo().then((i) => { $('app-version').textContent = `Version ${i.version}${i.packaged ? '' : ' (development)'} · Electron ${i.electron}`; }).catch(() => {});
    $('open-logs').onclick = () => studio.openLogs();
    // Respect the OS reduced-motion preference on first run as well as the saved choice.
    flash.limited = ui.settings.ui.limitFlashes || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('limit-flashes').checked = flash.limited;
    fillCollections();
    resize();
    activate(ui.settings.collection, ui.settings.preset, { persist: false });
    fillInputs();
    setDiagnostics(ui.settings.ui.diagnostics, false);
    setFullscreenUi(ui.settings.window.fullscreen);
    configureAuto();
    applyMenuSettings();
    if (ui.settings.ui.menu === 'hidden') setTimeout(() => showOsd('Menu hidden', ui.settings.ui.edgeReveal ? 'Press M, or touch the bottom edge of the screen, to show it' : 'Press M to show it'), 1200);
    Object.assign(influence, ui.settings.influence);
    bindInfluence();
    applyAudioProfile();                 // the bridge re-sends it whenever the audio service (re)starts
    wire();
    renderStatus();
    poke();
    requestAnimationFrame(frame);
  }

  // Collections written as ES modules (e.g. Experimental) register before DOMContentLoaded.
  for (const el of document.querySelectorAll('script[type="module"]')) {
    el.addEventListener('error', () => showError('Module failed to load', el.getAttribute('src')));
  }
  document.addEventListener('DOMContentLoaded', () => start().catch((e) => showNotice('The app failed to start', e.message)));
})();
