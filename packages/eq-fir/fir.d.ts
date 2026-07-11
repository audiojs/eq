/** A magnitude-response control point: gain in dB at a given frequency. */
export interface FirResponsePoint {
  /** frequency, Hz */
  f: number
  /** gain, dB */
  gain: number
}

/** Options shared by `design` and the default export's design step. */
export interface FirDesignOptions {
  /** FIR length in taps — forced odd (type-I symmetric) internally. Default 511 */
  taps?: number
  /** sample rate, Hz. Default 44100 */
  fs?: number
}

export interface FirEqOptions extends FirDesignOptions {
  /**
   * Target magnitude response: either an array of `{f, gain}` dB points (linearly
   * interpolated between points, clamped to the nearest point's gain outside the given
   * range) or a `frequency => dB` function. Ignored if `coefs` is given.
   */
  response?: FirResponsePoint[] | ((f: number) => number)
  /** Precomputed coefficients from `design()` — skips the design step when given. */
  coefs?: Float64Array
}

/**
 * Design linear-phase FIR coefficients from a target magnitude response.
 *
 * Frequency-sampling design: samples the target response at `taps` points, takes the
 * symmetric inverse transform (`h[n] = (1/N)·[M0 + 2·Σ Mk·cos(2πk(n−α)/N)]`, α = (N−1)/2),
 * and applies a Hann window against Gibbs ripple. Odd-length type-I FIR — exactly linear
 * phase, group delay = (taps−1)/2 samples.
 */
export function design(response: FirResponsePoint[] | ((f: number) => number), options?: FirDesignOptions): Float64Array

/**
 * Apply the FIR EQ in place, zero-latency (the output is shifted back by the filter's
 * group delay so it stays time-aligned with the input — this is the FFmpeg firequalizer /
 * Matchering match-EQ idiom: match a target spectrum exactly, without moving the signal
 * in time).
 *
 * Unlike the biquad-based atoms in this family, `fir` is **not** a params-as-state
 * kernel — it holds no filter memory across calls. `taps`/`response` are re-designed (or
 * `coefs` reused) fresh on every call, and convolution is computed directly from `data`
 * with zero-padded edges — there's no streaming/chunked mode; call it with the whole
 * buffer you want filtered.
 *
 * Only accepts typed arrays (uses `TypedArray#set` internally) — plain `number[]` is not
 * supported, unlike the biquad-based atoms in this family.
 */
export default function firEq<T extends Float32Array | Float64Array>(data: T, options?: FirEqOptions): T
