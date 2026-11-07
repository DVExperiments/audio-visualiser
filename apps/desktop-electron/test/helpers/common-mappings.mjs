// The COMMON_MAPPINGS object lives in engine/feedback.mjs, which imports Three.js (browser-only
// bare specifier). Tests read the same object from source to avoid loading Three in node.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../../src/renderer/engine/feedback.mjs', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('export const COMMON_MAPPINGS'));
const literal = body.slice(body.indexOf('Object.freeze(') + 'Object.freeze('.length, body.indexOf('});') + 1);
export const COMMON_MAPPINGS = Function(`return (${literal});`)();
