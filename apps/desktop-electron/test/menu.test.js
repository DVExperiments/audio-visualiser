'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MenuController, EDGE_PX } = require('../src/renderer/lib/menu-policy.js');
const H = 800;

test('auto: any mouse movement shows the bar; it hides 3 s after the last activity', () => {
  const m = new MenuController({ mode: 'auto' });
  assert.equal(m.visible(0), false);
  m.pointer(300, H, 1000);
  assert.equal(m.visible(3999), true); assert.equal(m.visible(4001), false);
  m.key(5000); assert.equal(m.visible(5100), true, 'keys show it too');
});

test('always: visible regardless of activity (H hides until the next interaction)', () => {
  const m = new MenuController({ mode: 'always' });
  assert.equal(m.visible(1e9), true);
  m.hide(); assert.equal(m.visible(10), false); m.reveal(20); assert.equal(m.visible(30), true);
});

test('hidden: mouse movement and keys never show it; M and the bottom edge do', () => {
  const m = new MenuController({ mode: 'hidden', edgeReveal: true });
  m.pointer(300, H, 1000); m.pointer(H - EDGE_PX - 1, H, 1100); m.key(1200);
  assert.equal(m.visible(1300), false, 'ordinary movement and keys do nothing');
  m.pointer(H - 2, H, 2000);
  assert.equal(m.visible(2100), true, 'touching the bottom edge shows it');
  assert.equal(m.visible(5001), false, 'and it hides again 3 s later');
  m.reveal(6000); assert.equal(m.visible(6500), true, 'M shows it');
  const noEdge = new MenuController({ mode: 'hidden', edgeReveal: false });
  noEdge.pointer(H - 1, H, 100); assert.equal(noEdge.visible(200), false, 'edge reveal can be switched off');
});

test('never hides while it is being used (pointer over the bar, panel open, field focused)', () => {
  for (const mode of ['auto', 'hidden']) {
    const m = new MenuController({ mode });
    m.reveal(0);
    assert.equal(m.visible(60000, true), true, `${mode}: busy keeps it`);
    assert.equal(m.visible(62000), true, `${mode}: and the 3 s start when use ends`);
    assert.equal(m.visible(63001), false);
  }
});

test('H hides at once in any mode', () => {
  const m = new MenuController({ mode: 'auto' });
  m.pointer(10, H, 0); m.hide(); assert.equal(m.visible(1), false);
  m.pointer(10, H, 2); assert.equal(m.visible(3), true, 'next movement shows it again (auto)');
});
