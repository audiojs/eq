// Dynamic EQ — per-band peaking gain driven by that band's energy (Pro-Q3 / soothe class;
// the generalized de-esser). Bandpass sidechain → envelope → over-threshold → peaking cut
// (or upward gain), coefficients re-derived per block for smoothness without per-sample cost.

import { bandpass, peaking } from '@audio/biquad'

const BLOCK = 64, PI2 = Math.PI * 2

/**
 * @param {Float32Array} data — mono PCM, processed in place
 * @param {object} opts — { fs=44100, bands: [{ fc, Q=2, threshold=-30 (dB), ratio=3,
 *   attack=5 (ms), release=80 (ms), maxGain=12 (dB, cut depth), mode='down' }] }
 */
export default function dynamicEq (data, { fs = 44100, bands = [] } = {}) {
	let states = bands.map(b => ({
		det: bandpass(b.fc, b.Q ?? 2, fs),
		c: peaking(b.fc, b.Q ?? 2, fs, 0),
		s: new Float64Array(10),
		set: Float64Array.of(b.fc, b.Q ?? 2, fs, b.threshold ?? -30, b.ratio ?? 3, b.maxGain ?? 12,
			Math.exp(-1 / ((b.attack ?? 5) * 0.001 * fs)), Math.exp(-1 / ((b.release ?? 80) * 0.001 * fs)),
			(b.mode ?? 'down') === 'up' ? 1 : 0),
	}))

	for (let pos = 0; pos < data.length; pos += BLOCK) {
		let end = Math.min(data.length, pos + BLOCK)
		for (let bi = 0; bi < bands.length; bi++) {
			let t = states[bi]
			dynamicBlock(data, pos, end, t.s, t.set, t.det, t.c)
		}
	}
	return data
}

/**
 * One band over data[pos..end), in place: the block's own level sets its gain, then the block is filtered at that gain.
 * `s` the band's state, a Float64Array of the sidechain biquad's dx1, dx2, dy1, dy2, the envelope, the audio path's x1,
 * x2, y1, y2 and the gain, kept from block to block; `set` a Float64Array of fc, Q, fs, threshold, ratio, maxGain, the
 * attack and release coefficients and 1 for 'up'; `det` the sidechain bandpass section; `c` a section the peaking
 * coefficients are written into. `fade`, when given and under way (dynamicFade starts one), moves the output from the
 * mode left to this one over its course
 */
export function dynamicBlock (data, pos, end, s, set, det, c, fade) {
	let fc = set[0], Q = set[1], fs = set[2], aCoef = set[6], rCoef = set[7]
	let d0 = det.b0, d1 = det.b1, d2 = det.b2, e1 = det.a1, e2 = det.a2
	let dx1 = s[0], dx2 = s[1], dy1 = s[2], dy2 = s[3], env = s[4]

	// detect on the incoming block
	for (let i = pos; i < end; i++) {
		let x = data[i]
		let y = d0 * x + d1 * dx1 + d2 * dx2 - e1 * dy1 - e2 * dy2
		dx2 = dx1; dx1 = x; dy2 = dy1; dy1 = y
		let a = Math.abs(y)
		env = a > env ? a + (env - a) * aCoef : a + (env - a) * rCoef
	}
	s[0] = dx1; s[1] = dx2; s[2] = dy1; s[3] = dy2; s[4] = env
	let levelDb = 20 * Math.log10(env + 1e-9)
	let over = levelDb - set[3]
	let target = over > 0 ? -Math.min(set[5], over * (1 - 1 / set[4])) : 0
	if (set[8] === 1) target = -target
	let gain = s[9] += (target - s[9]) * 0.5 // block-rate smoothing

	let x1 = s[5], x2 = s[6], y1 = s[7], y2 = s[8], F = fade && fade[0] < 1 ? fade : null
	if (Math.abs(gain) > 0.05) {
		// @audio/biquad's peaking, the same arithmetic, written here so that the block designs it without a call: one the
		// engine leaves uninlined is handed its numbers boxed, and a version of it that returns a new section allocates
		let w = PI2 * fc / fs, cw = Math.cos(w), alpha = Math.sin(w) / (2 * Q), A = 10 ** (gain / 40), a0 = 1 + alpha / A
		let b0 = (1 + alpha * A) / a0, b1 = -2 * cw / a0, b2 = (1 - alpha * A) / a0, a1 = -2 * cw / a0, a2 = (1 - alpha / A) / a0
		c.b0 = b0; c.b1 = b1; c.b2 = b2; c.a1 = a1; c.a2 = a2
		if (F === null) for (let i = pos; i < end; i++) {
			let x = data[i]
			let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
			x2 = x1; x1 = x; y2 = y1; y1 = data[i] = y
		}
		else {
			// the mode left runs on beside it: the band at −gain, the peaking section with its numerator and denominator
			// swapped (1/H), on the same input and its own output's history; the output moves from it to this mode's along
			// t²(3 − 2t), from the weight it had when the fade began
			let p0 = 1 / b0, p1 = a1 / b0, p2 = a2 / b0, q1 = b1 / b0, q2 = b2 / b0, u1 = F[3], u2 = F[4], t = F[0], dt = F[1], w0 = F[2]
			for (let i = pos; i < end; i++) {
				let x = data[i], e = t * t * (3 - 2 * t), w = (1 - e) * w0
				let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2, v = p0 * x + p1 * x1 + p2 * x2 - q1 * u1 - q2 * u2
				x2 = x1; x1 = x; y2 = y1; y1 = y; u2 = u1; u1 = v
				data[i] = y + w * (v - y)
				t = t + dt < 1 ? t + dt : 1
			}
			F[0] = t; F[3] = u1; F[4] = u2
		}
	} else {
		// keep state warm on bypassed blocks (both modes pass the input there)
		for (let i = pos; i < end; i++) {
			let x = data[i]
			x2 = x1; x1 = x; y2 = y1; y1 = x
		}
		if (F !== null) { F[0] = F[0] + (end - pos) * F[1] < 1 ? F[0] + (end - pos) * F[1] : 1; F[3] = x1; F[4] = x2 }
	}
	s[5] = x1; s[6] = x2; s[7] = y1; s[8] = y2
	return data
}

/**
 * Starts a fade from the mode in force to the other, or turns one under way back, as a host switches `mode`. The gain
 * the other mode has is this one's negated (the targets are, and both move halfway each block from the same history),
 * so `s[9]` is negated; the audio path of the mode left goes on, in `fade` (its output's history), weighted from 1, or
 * from the weight it has where a fade under way turns back. `fade` a Float64Array(5) of where the fade is (0 to 1), its
 * step a sample, the weight it began from, and the mode left's y1, y2; made at 1 (none under way)
 */
export function dynamicFade (fade, s) {
	let t = fade[0], e = t * t * (3 - 2 * t)
	if (t < 1) {
		let w = (1 - e) * fade[2], u1 = fade[3], u2 = fade[4]
		fade[3] = s[7]; fade[4] = s[8]; s[7] = u1; s[8] = u2; fade[2] = 1 - w
	} else { fade[3] = s[7]; fade[4] = s[8]; fade[2] = 1 }
	s[9] = -s[9]
	fade[0] = 0
	return fade
}
