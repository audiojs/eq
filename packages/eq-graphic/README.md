# @audio/eq-graphic [![npm](https://img.shields.io/npm/v/@audio/eq-graphic)](https://www.npmjs.com/package/@audio/eq-graphic) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

ISO 266 10-band graphic equalizer

```
npm install @audio/eq-graphic
```

```js
import graphicEq from '@audio/eq-graphic'
```

Fixed 10-band graphic EQ at the ISO 266 / IEC 61260 1/1-octave nominal center frequencies — `31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000` Hz. One RBJ peaking biquad per non-zero band (Q 1.4), cascaded low-to-high; bands left at 0 dB build no filter section, so an all-flat EQ costs nothing.

```js
let params = { gains: { 1000: 6, 8000: -3 }, fs: 44100 }
for (let buf of stream) graphicEq(buf, params)
```

| Param | Default | |
|---|---|---|
| `gains` | `{}` | Per-band gain in dB, keyed by center frequency (e.g. `1000`) or its rounded form |
| `fs` | `44100` | Sample rate, Hz |

Pass the same `params` object across successive calls — the filter cascade is cached on it; a change of `gains`/`fs` by value rebuilds only the coefficients and each band's state carries over, so state continues across block boundaries and automation is click-free.

The `/audio` processor `geq` holds a band above 0.49 of the sample rate there (the 16 kHz band at 22.05 kHz; the 4, 8 and 16 kHz bands at 8 kHz): past Nyquist a band's section has poles outside the unit circle, and every `/audio` processor of @audio/filter and @audio/eq keeps this one rule. Each band's gain is smoothed (20 ms) and glided sample by sample: a host's ramp of it is one line, the same however the host cuts its calls (it hands each call the value at its first frame, so the line is played 32 frames late); held, it is the value itself: while a gain moves, its band's section is designed for each frame's gain. The sections are written by `@audio/biquad`'s peaking arithmetic in the processor itself, so a block allocates nothing whichever `@audio/biquad` is installed.

**Use when:** the classic mixing-console/PA slider EQ — fixed bands, familiar layout, quick broad-strokes shaping.

---

Part of [@audio/eq](https://github.com/audiojs/eq) — the eq family umbrella.

MIT © [audiojs](https://github.com/audiojs)
