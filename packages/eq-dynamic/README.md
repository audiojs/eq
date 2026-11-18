# @audio/eq-dynamic [![npm](https://img.shields.io/npm/v/@audio/eq-dynamic)](https://www.npmjs.com/package/@audio/eq-dynamic) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Dynamic EQ — per-band peaking gain driven by band energy (Pro-Q3/soothe class)

```
npm install @audio/eq-dynamic
```

```js
import dynamicEq from '@audio/eq-dynamic'
```

The generalized de-esser: each band watches its own energy through a bandpass sidechain and attack/release envelope follower, and only engages a peaking cut (or, in `'up'` mode, a boost) once that band crosses `threshold` — quiet bands stay untouched, loud transients get pulled down proportionally to `ratio`, capped at `maxGain`. Peaking coefficients are re-derived every 64-sample block for smooth gain changes without per-sample coefficient cost.

```js
dynamicEq(data, { fs: 44100, bands: [
  { fc: 6000, threshold: -30, ratio: 4, attack: 3, release: 60 },  // de-ess
  { fc: 250, threshold: -20, mode: 'up', maxGain: 6 },             // upward warmth
]})
```

| Param | Default | |
|---|---|---|
| `bands` | `[]` | Array of per-band settings |
| `bands[].fc` | — | Band center frequency, Hz — both sidechain and peaking filter |
| `bands[].Q` | `2` | Sidechain bandpass / peaking filter Q |
| `bands[].threshold` | `-30` | Level, dB, above which gain reduction (or boost) engages |
| `bands[].ratio` | `3` | Compression ratio applied to the amount over threshold |
| `bands[].attack` | `5` | Envelope attack, ms |
| `bands[].release` | `80` | Envelope release, ms |
| `bands[].maxGain` | `12` | Maximum gain change, dB — caps cut (`'down'`) or boost (`'up'`) |
| `bands[].mode` | `'down'` | `'down'` cuts over-threshold energy; `'up'` boosts it instead |
| `fs` | `44100` | Sample rate, Hz |

Unlike the biquad-based atoms in this family, `params` does **not** persist state across calls — every call allocates fresh sidechain/audio-path biquad state and envelope followers starting at zero. Each call is a self-contained batch pass, not a streaming chunk: call it once with the whole buffer rather than chunk-by-chunk.

The host processor `dyneq` of `@audio/eq-dynamic/audio` streams: it gathers each 64-sample block and plays it out 63 samples later (its declared latency), so its output is this whole-buffer call's, that much later, whatever blocks the host calls it with. It holds `fc` at 0.49 of the sample rate: past Nyquist the band's sections have poles outside the unit circle, and every `/audio` processor of @audio/filter and @audio/eq keeps this one rule. `fc` is smoothed (20 ms): a host ramps it, each block taking the value in force. A new `mode` moves the output from the old mode's band to the new one's over 20 ms (the band's gain flips sign, which its halving each block would step at once). Its tail is, for any input within 0 dBFS, at most as long as the band can stay moving once the input stops (bounded, from the detector's largest output and its ring), and no longer than the band's ring at its reach (measured: never short of tones and square waves at `fc` from -60 to 0 dB, a DC step, an impulse and noise). The band's and the detector's sections are written by `@audio/biquad`'s arithmetic in the processor itself, so a block allocates nothing whichever `@audio/biquad` is installed.

**Use when:** de-essing, resonance taming, mix-bus "automatic EQ" that only reacts when a band gets too loud — anywhere a static EQ would need constant automation.

---

Part of [@audio/eq](https://github.com/audiojs/eq) — the eq family umbrella.

MIT © [audiojs](https://github.com/audiojs)
