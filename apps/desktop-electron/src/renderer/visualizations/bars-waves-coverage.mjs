// Where every field of an analysis frame is shown (v0.8 audit). The test compares this with the
// fields the real service sends, so a new analysis feature cannot go unshown.
//   visual: Bars & Waves presets that draw it.   panel: shown as numbers in Diagnostics.
export const COVERAGE = Object.freeze({
  type: { meta: 'message type' }, seq: { panel: 'Sequence gaps' }, t: { panel: 'Capture→draw' }, wall: { panel: 'Capture→draw' },
  sr: { panel: 'Format' }, silent: { panel: 'Silent', status: 'status bar' }, gap: { panel: 'gap fill', status: 'status bar' },
  clip: { visual: ['instruments'], panel: 'clip' }, synthetic: { status: 'Simulated badge', panel: 'Simulated' },
  nonFinite: { meta: 'sanitised input (counted in the service)' }, droppedInput: { panel: 'Dropped: input' },
  rms: { visual: ['instruments', 'mashup', 'vu'] }, dbfs: { visual: ['instruments', 'analysis', 'vu'], panel: 'Level L / R' },
  peak: { visual: ['instruments', 'vu'], panel: 'Peak L / R' }, level: { visual: ['analysis'] },
  bands: { visual: ['instruments'] }, bandsNorm: { visual: ['instruments', 'mashup'] },
  bandsPulse: { visual: ['instruments', 'analysis', 'mashup', 'circular'] }   /* instruments: bars brighten on pulses */, levelPulse: { visual: ['analysis'] },
  spec: { visual: ['instruments', 'spectrum', 'analysis', 'mashup', 'circular', 'ridgeline', 'terrain'] },
  flux: { panel: 'Flux (linear / log)' }, fluxLog: { visual: ['analysis'], panel: 'Flux' },
  onset: { visual: ['instruments', 'analysis', 'mashup'], panel: 'Onsets, last confidence' },
  centroid: { visual: ['analysis', 'mashup'], panel: 'Centroid' },
  rolloff: { visual: ['analysis'], panel: 'Rolloff' },
  flatness: { visual: ['analysis'], panel: 'Flatness' }, zcr: { visual: ['analysis'], panel: 'Zero crossings' },
  balance: { visual: ['stereo', 'instruments', 'analysis', 'mashup'] }, correlation: { visual: ['stereo', 'instruments', 'analysis', 'mashup'] },
  width: { visual: ['stereo', 'instruments', 'analysis'] },
  waveL: { visual: ['scope', 'instruments', 'stereo', 'mashup', 'circular', 'phosphor'] }, waveR: { visual: ['scope', 'instruments', 'stereo', 'mashup', 'circular', 'phosphor'] },
});
