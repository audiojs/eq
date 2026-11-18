/** One dynamic-EQ band: a sidechain-driven peaking filter at `fc`. */
export interface DynamicBand {
  /** band center frequency, Hz — both the sidechain bandpass and the peaking filter */
  fc: number
  /** sidechain bandpass / peaking filter Q. Default 2 */
  Q?: number
  /** level, in dB, above which gain reduction (or, in `'up'` mode, boost) engages. Default -30 */
  threshold?: number
  /** compression ratio applied to the amount over threshold. Default 3 */
  ratio?: number
  /** envelope attack time, ms. Default 5 */
  attack?: number
  /** envelope release time, ms. Default 80 */
  release?: number
  /** maximum gain change, dB — caps cut depth (`'down'`) or boost (`'up'`). Default 12 */
  maxGain?: number
  /** `'down'` cuts the band when it's over threshold (de-esser/soothe); `'up'` boosts it instead. Default 'down' */
  mode?: 'down' | 'up'
}

/** Dynamic EQ parameters. */
export interface DynamicEqParams {
  /** sample rate, Hz. Default 44100 */
  fs?: number
  /** bands, each independently sidechain-detected and peaking-filtered */
  bands?: DynamicBand[]
}

/**
 * Apply a dynamic EQ in place — per-band peaking gain driven by that band's own energy
 * (Pro-Q3 / soothe class; the generalized de-esser). Per band: a bandpass sidechain feeds
 * an attack/release envelope follower; when the envelope exceeds `threshold`, a peaking
 * filter at `fc` cuts (or, in `'up'` mode, boosts) proportionally to `ratio`, capped at
 * `maxGain`. Peaking coefficients are re-derived every 64-sample block for smoothness
 * without per-sample coefficient cost.
 *
 * Unlike the biquad-based atoms in this family, `params` does **not** persist state
 * across calls — sidechain/audio-path biquad state and envelope followers are allocated
 * fresh inside every call and start at zero, so each call is a self-contained batch pass
 * rather than a streaming chunk. Call it once with the whole buffer, not chunk-by-chunk.
 */
export default function dynamicEq(data: Float32Array, params?: DynamicEqParams): Float32Array

/**
 * One band over `data[pos..end)` in place, allocating nothing: what the streaming `/audio` manifest calls on each
 * 64-frame block. The block's own level sets its gain, then the block is filtered at that gain. `s` the band's state, a
 * `Float64Array(10)` of the sidechain biquad's dx1, dx2, dy1, dy2, the envelope, the audio path's x1, x2, y1, y2 and the
 * gain, kept from block to block; `set` a `Float64Array` of fc, Q, fs, threshold, ratio, maxGain, the attack and
 * release coefficients (exp(−1/(ms·0.001·fs))) and 1 for `'up'`; `det` the sidechain bandpass section; `c` a section
 * the peaking coefficients are written into (computed here, by `@audio/biquad`'s arithmetic). `fade`, when given and
 * under way (`dynamicFade` starts one), moves the output from the mode left to this one over its course.
 */
export function dynamicBlock(data: Float32Array | Float64Array, pos: number, end: number, s: Float64Array, set: Float64Array,
  det: { b0: number, b1: number, b2: number, a1: number, a2: number }, c: { b0: number, b1: number, b2: number, a1: number, a2: number },
  fade?: Float64Array): Float32Array | Float64Array

/**
 * Starts a fade from the mode in force to the other, or turns one under way back, as a host switches `mode`: the other
 * mode's gain is this one's negated (the targets are, and both halve their distance each block from the same history),
 * so `s[9]` is negated, and the band of the mode left runs on beside it, weighted from 1 (or from the weight it has where
 * a fade under way turns back) down along t²(3 − 2t). `fade` a `Float64Array(5)` of where it is (0 to 1; made at 1,
 * none under way), its step a frame, the weight it began from, and the mode left's y1, y2.
 */
export function dynamicFade(fade: Float64Array, s: Float64Array): Float64Array
