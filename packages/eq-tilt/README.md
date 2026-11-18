# @audio/eq-tilt [![npm](https://img.shields.io/npm/v/@audio/eq-tilt)](https://www.npmjs.com/package/@audio/eq-tilt) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

One-knob see-saw tilt EQ

```
npm install @audio/eq-tilt
```

```js
import tilt from '@audio/eq-tilt'
```

One knob, one pivot frequency: a low-shelf at `pivot` boosted by `gain` and a high-shelf at `pivot` cut by the same `gain` (both fixed Q 0.5), cascaded. The two shelves meet near-flat at `pivot` and diverge oppositely on either side — positive `gain` tilts bass up / treble down, negative does the opposite. Mastering-bus "warmer"/"brighter" macro; broadcast tilt EQ.

```js
let params = { gain: 2, pivot: 1000, fs: 44100 }
for (let buf of stream) tilt(buf, params)
```

| Param | Default | |
|---|---|---|
| `gain` | `0` | Tilt amount, dB — positive tilts bass up / treble down, negative the opposite |
| `pivot` | `1000` | Pivot frequency, Hz — the point the tilt see-saws around |
| `fs` | `44100` | Sample rate, Hz |

Pass the same `params` object across successive calls — both shelves' coefficients and filter memory are cached on it and only rebuilt when `gain`/`pivot`/`fs` change, so state carries across block boundaries automatically.

The `/audio` processor holds `pivot` at 0.49 of the sample rate: past Nyquist a shelf has poles outside the unit circle, and every `/audio` processor of @audio/filter and @audio/eq keeps this one rule. `gain` is smoothed (20 ms) and glided sample by sample: a host's ramp of it is one line, the same however the host cuts its calls (it hands each call the value at its first frame, so the line is played 32 frames late); held, it is the value itself: while it moves, both shelves are designed for each frame's gain. `pivot` is smoothed (20 ms): a host ramps it, the shelves retuned at each call's value. The shelves are written by `@audio/biquad`'s arithmetic in the processor itself, so a block allocates nothing whichever `@audio/biquad` is installed.

**Use when:** one-knob mastering-bus balance — a single control that trades bass for treble without a multi-band EQ; broadcast/mastering tilt.

---

Part of [@audio/eq](https://github.com/audiojs/eq) — the eq family umbrella.

MIT © [audiojs](https://github.com/audiojs)
