// atom manifest — dynamic EQ (band energy drives that band's peaking gain; Pro-Q3 /
// soothe class, the generalized de-esser) per @audio/compile CONTRACT. It streams: the kernel sets a 64-frame block's
// gain from that block's own level, counted from the stream's start, so each block is gathered here and played out
// 63 frames later (latency 63), the whole-buffer call's sound delayed. Each channel's state and block buffers are made
// here, so a block allocates nothing; every param is live, taken by the next block. fc is held to 0.49 of the rate, as
// the filter family's ladders hold it: past Nyquist the band's sections have poles outside the unit circle. fc retunes
// the band, so a host ramps it (smoothing 0.02), the band taking each block's value. A new mode moves the output from
// the old mode's band to the new one's over FADE seconds (dynamicFade): its gain flips sign, a step a block would make
// at once. Scalar form is ONE band; multi-band curves take an array argument — direct-import for those.

import { dynamicBlock, dynamicFade } from './dynamic.js'
import { bandpass, peaking } from '@audio/biquad'

const BLOCK = 64, FADE = 0.02, PI2 = Math.PI * 2

export const dyneq = (ctx) => {
	const fs = ctx.sampleRate, st = [], held = [], done = [], fades = [], at = new Int32Array(1)   // at: the next frame's place in its block
	const set = new Float64Array(9), last = Float64Array.of(NaN, NaN, NaN, NaN, NaN)   // the fc, Q, attack, release set was made for, and the mode
	const det = bandpass(1000, 2, fs), c = peaking(1000, 2, fs, 0)
	for (let ch = 0; ch < ctx.maxChannels; ch++) {
		st.push(new Float64Array(10))
		held.push(new Float32Array(BLOCK))
		done.push(new Float32Array(BLOCK))
		fades.push(Float64Array.of(1, 1 / (FADE * fs), 0, 0, 0))   // where a fade is, its step, the weight it began from, the mode left's y1, y2
	}
	set[2] = fs
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0], n = inp[0].length
		const fc = Math.min(params.fc[0], fs * 0.49), Q = params.Q[0], attack = params.attack[0], release = params.release[0], up = params.mode === 'up' ? 1 : 0
		set[0] = fc
		set[1] = Q
		// both compared, not short-circuited: with || V8 (Node 25.9) boxed a number at each retune where fc alone moved
		if ((fc !== last[0]) | (Q !== last[1])) { last[0] = fc; last[1] = Q; bandpassInto(det, set) }
		if (attack !== last[2]) { set[6] = Math.exp(-1 / (attack * 0.001 * fs)); last[2] = attack }
		if (release !== last[3]) { set[7] = Math.exp(-1 / (release * 0.001 * fs)); last[3] = release }
		if (up !== last[4]) { if (last[4] === last[4]) for (let ch = 0; ch < st.length; ch++) dynamicFade(fades[ch], st[ch]); last[4] = up }
		set[3] = params.threshold[0]
		set[4] = params.ratio[0]
		set[5] = params.maxGain[0]
		set[8] = up
		let j = at[0]
		for (let i = 0; i < n; i++) {
			for (let ch = 0; ch < inp.length; ch++) held[ch][j] = inp[ch][i]
			if (j === BLOCK - 1) for (let ch = 0; ch < inp.length; ch++) {
				done[ch].set(held[ch])
				dynamicBlock(done[ch], 0, BLOCK, st[ch], set, det, c, fades[ch])
			}
			// a block plays out from the frame that completes it: its first frame now, the rest over the next block
			j = j === BLOCK - 1 ? 0 : j + 1
			for (let ch = 0; ch < inp.length; ch++) out[ch][i] = done[ch][j]
		}
		at[0] = j
	}
}
dyneq.channels = 'any'
dyneq.latency = BLOCK - 1
dyneq.params = {
	fc:        { type: 'number', min: 40, max: 16000, default: 6000, unit: 'Hz', curve: 'log', smoothing: 0.02 },
	Q:         { type: 'number', min: 0.3, max: 20, default: 2, curve: 'log' },
	threshold: { type: 'number', min: -60, max: 0, default: -30, unit: 'dB' },
	ratio:     { type: 'number', min: 1, max: 20, default: 3 },
	attack:    { type: 'number', min: 0.5, max: 100, default: 5, unit: 'ms' },
	release:   { type: 'number', min: 10, max: 1000, default: 80, unit: 'ms' },
	maxGain:   { type: 'number', min: 0, max: 24, default: 12, unit: 'dB' },
	mode:      { type: 'enum', values: ['down', 'up'], default: 'down' },
}
// @audio/biquad's bandpass into det, the same arithmetic, at the fc, Q and rate of k[0], k[1], k[2]: written here so
// that a retune passes no number to a call (one the engine leaves uninlined is handed its numbers boxed) and makes no
// section
function bandpassInto (det, k) {
	let w = PI2 * k[0] / k[2], cw = Math.cos(w), alpha = Math.sin(w) / (2 * k[1]), a0 = 1 + alpha
	det.b0 = alpha / a0; det.b1 = 0 / a0; det.b2 = -alpha / a0; det.a1 = -2 * cw / a0; det.a2 = (1 - alpha) / a0
}

// The tail at the values in force, for any input within 0 dBFS. The band rests (and passes its input as it is, 0 once
// the input stops) from the first block whose gain is within 0.05 dB; until then it rings. How long it stays moving is
// bounded here, not measured: the detector hands the envelope at most the sum of its |h| (an input matched to its ring
// reaches that: a square wave at fc comes within a few percent), and k frames after the input stops at most the rest of
// that sum past frame k (`rest`). The envelope, its gain and the halving of the band's gain each block only grow with
// what they are given, so the band's gain is at most what those bounds give it, from the reach (the gain at that
// envelope) on. One block more for where in a block the input stopped. And no longer than the band's own ring, which is
// measured, not proven: that of the peaking section at the reach, and of that section's state on the poles of 0 dB,
// where a cut's poles go as it lets go (both by @audio/biquad's rule), never short of the rings of tones about fc and
// square waves at fc at -60 to 0 dB, a DC step, an impulse and noise, over random settings, both modes (eq test.js)
dyneq.tail = ({ sampleRate: fs, params }) => {
	let fc = Math.min(params.fc[0], fs * 0.49), Q = params.Q[0], thr = params.threshold[0], ratio = params.ratio[0], top = params.maxGain[0]
	let det = bandpass(fc, Q, fs), d1 = det.a1, d2 = det.a2, reach = env => { let over = 20 * Math.log10(env + 1e-9) - thr; return over > 0 ? Math.min(top, over * (1 - 1 / ratio)) : 0 }
	// a bound on the rest of the detector's Σ|h| from the frame whose ring is y0 and the next y1 on. Two real poles: rest2.
	// A conjugate pair rings as E·rʲ·cos(jθ + φ), and Σ rʲ·|cos(jθ + φ)| is at most (2/π)/(1 − r) + (4/π)·Σ_k 1/((4k² − 1)·
	// |1 − r·e^(2ikθ)|) whatever φ (|cos x| = 2/π + (4/π)·Σ (−1)^(k+1)·cos(2kx)/(4k² − 1)), to k = 64, the rest at most
	// (2/π)/(129·(1 − r)): within a few percent of the sum, where E/(1 − r) is up to π/2 over it
	let F = 0, r = Math.sqrt(d2), th = d1 * d1 < 4 * d2 ? Math.acos(-d1 / (2 * r)) : 0
	if (th) {
		F = 2 / Math.PI / (1 - r) * (1 + 1 / 129)
		for (let k = 1; k <= 64; k++) F += 4 / Math.PI / ((4 * k * k - 1) * Math.hypot(1 - r * Math.cos(2 * k * th), r * Math.sin(2 * k * th)))
		F = Math.min(F, 1 / (1 - r))
	}
	let rest = (y0, y1) => th ? Math.sqrt(4 * (y1 * y1 + d1 * y0 * y1 + d2 * y0 * y0) / (4 * d2 - d1 * d1)) * F : rest2(d1, d2, y0, y1)
	// its sum of |h|: the first 4096 frames as they ring, the rest bounded
	let l1 = 0, z1 = 0, z2 = 0
	for (let j = 0; j < 4096; j++) { let x = j === 0 ? 1 : 0, y = det.b0 * x + z1; z1 = det.b1 * x - d1 * y + z2; z2 = det.b2 * x - d2 * y; l1 += Math.abs(y) }
	l1 += rest(z1, z2 - d1 * z1)
	let g = reach(l1)
	if (!(g > 0.05)) return 0
	let at = peaking(fc, Q, fs, params.mode === 'up' ? g : -g), zero = peaking(fc, Q, fs, 0)
	let ring = Math.max(tail(at, fs), tail({ b0: at.b0, b1: at.b1, b2: at.b2, a1: zero.a1, a2: zero.a2 }, fs)) * fs
	if (!(ring < Infinity)) return ring
	// the detector's ring a block on: [y_k, y_k+1] → [y_k+64, y_k+65], its step [[0, 1], [−a2, −a1]] squared six times
	let M = Float64Array.of(0, 1, -d2, -d1), T = new Float64Array(4)
	for (let i = 0; i < 6; i++) { T[0] = M[0] * M[0] + M[1] * M[2]; T[1] = M[0] * M[1] + M[1] * M[3]; T[2] = M[2] * M[0] + M[3] * M[2]; T[3] = M[2] * M[1] + M[3] * M[3]; M.set(T) }
	let h1 = det.b1 - d1 * det.b0, fall = Math.exp(-BLOCK / (params.release[0] * 0.001 * fs)), env = l1, y0 = h1, y1 = det.b2 - d2 * det.b0 - d1 * h1, blocks = 0
	while ((blocks + 1) * BLOCK < ring) {
		let a = Math.min(l1, rest(y0, y1))   // the most |y| of the detector over this block
		env = env > a ? a + (env - a) * fall : a
		g += (reach(env) - g) * 0.5
		if (!(g > 0.05)) break
		let z = M[0] * y0 + M[1] * y1; y1 = M[2] * y0 + M[3] * y1; y0 = z
		blocks++
	}
	let N = Math.min(ring, (blocks + 1) * BLOCK)
	return N <= 128 ? 0 : N / fs
}

// Seconds a section or SOS cascade rings once its input stops, until it stays 60 dB under the input (0 at 128 frames or
// under): @audio/biquad's tail() and rest2(), the same lines, here until this family's @audio/biquad has it (it resolves 1.2.1, which has no tail())
function tail (sos, fs = 44100) {
	let S = Array.isArray(sos) ? sos : [sos], n = S.length, L = new Float64Array(n), z = new Float64Array(2 * n)
	// what a section passes on, at most: the sum of its own |h|, b0 and then the ring of its state after the impulse
	for (let i = 0; i < n; i++) {
		let { b0, b1, b2, a1, a2 } = S[i], h1 = b1 - a1 * b0
		L[i] = Math.abs(b0) + rest2(a1, a2, h1, b2 - a2 * b0 - a1 * h1)
		if (!(L[i] < Infinity)) return Infinity
	}
	// one section: past frame 0 its h is the free ring from h1, h2, the frames until its rest is under 1e-3 found in
	// closed form, at a cost that does not grow with the ring
	if (n === 1) {
		let { b0, b1, b2, a1, a2 } = S[0], h1 = b1 - a1 * b0, N = ring1(a1, a2, h1, b2 - a2 * b0 - a1 * h1, 1e-3)
		return N <= 128 ? 0 : N / fs
	}
	// the cascade's rest from its states: each section's own ring, and on it what the sections before still feed it
	let rest = () => {
		let u = 0
		for (let i = 0; i < n; i++) u = rest2(S[i].a1, S[i].a2, z[2 * i], z[2 * i + 1] - S[i].a1 * z[2 * i]) + (u > 0 ? L[i] * u : 0)
		return u
	}
	// frames k to k + m of h through the sections, as process() runs them; the sum of their |h|
	let run = (k, m) => {
		let sum = 0
		for (let end = k + m; k < end; k++) {
			let x = k === 0 ? 1 : 0
			for (let i = 0; i < n; i++) {
				let c = S[i], y = c.b0 * x + z[2 * i]
				z[2 * i] = c.b1 * x - c.a1 * y + z[2 * i + 1]
				z[2 * i + 1] = c.b2 * x - c.a2 * y
				x = y
			}
			sum += Math.abs(x)
		}
		return sum
	}
	let total = 0, k = 0, r
	do { total += run(k, 256); k += 256; r = rest() } while (!(r <= 1e-4) && k < 1 << 22)
	if (!(r <= 1e-3)) return Infinity
	// from the impulse again: the first frame from which what is left (the sum past it and the bound on the rest) is
	// under 1e-3. The ring is the frames before it, after the input's last
	z.fill(0)
	let left = total + r, keep = new Float64Array(2 * n), N = 0
	for (; ; N += 256) { keep.set(z); let m = run(N, 256); if (left - m <= 1e-3) { z.set(keep); break } left -= m }
	while (left > 1e-3) left -= run(N++, 1)
	return N - 1 <= 128 ? 0 : (N - 1) / fs
}

// A bound on Σ|y_j|, j ≥ 0, for y_j = −a1·y_{j−1} − a2·y_{j−2}: the ring of a section's poles from y0 and y1. With p, q
// the roots of z² + a1·z + a2 and r the larger radius, y_j = y0·pʲ + (y1 − p·y0)·(qʲ − pʲ)/(q − p), and that last ratio
// is at most j·r^(j−1) however close p and q are: Σ ≤ |y0|/(1 − r) + |y1 − p·y0|/(1 − r)². A conjugate pair r·e^(±iθ)
// rings as E·rʲ·cos(jθ + φ), E² = 4(y1² + a1·y0·y1 + a2·y0²)/(4a2 − a1²): Σ ≤ E/(1 − r). Two real roots ring as their
// two parts, each bounded by its own geometric sum. The least of those that apply
function rest2 (a1, a2, y0, y1) {
	if (y0 === 0 && y1 === 0) return 0
	let d = a1 * a1 - 4 * a2, s = Math.sqrt(Math.abs(d)), Y0 = Math.abs(y0)
	if (d < 0) {
		let r = Math.sqrt(a2)
		if (!(r < 1)) return Infinity
		return Math.min(Math.sqrt(4 * (y1 * y1 + a1 * y0 * y1 + a2 * y0 * y0) / -d) / (1 - r), Y0 / (1 - r) + Math.hypot(y1 + a1 / 2 * y0, s / 2 * y0) / (1 - r) ** 2)
	}
	let p = (s - a1) / 2, q = (-s - a1) / 2, r = Math.max(Math.abs(p), Math.abs(q))
	if (!(r < 1)) return Infinity
	let u = Y0 / (1 - r) + Math.min(Math.abs(y1 - p * y0), Math.abs(y1 - q * y0)) / (1 - r) ** 2
	return s > 0 ? Math.min(u, Math.abs(y1 - q * y0) / s / (1 - Math.abs(p)) + Math.abs(y1 - p * y0) / s / (1 - Math.abs(q))) : u
}

// The first frame m from which Σ_{j≥m} |y_j| is at most `eps`, y_j = −a1·y_{j−1} − a2·y_{j−2} from y0, y1 (the ring of one
// section once its input stops), from closed forms, so the cost does not grow with the ring. Infinity for a root on or
// past the unit circle.
// - A conjugate pair r·e^(±iθ) rings as E·rʲ·cos(jθ + φ) (ringPair). |cos| is the same with π − θ for θ, so θ ≤ π/2.
//   Where it turns slowly against its decay (θ under 64·(1 − r)), the sum over each stretch of one sign is the geometric
//   Re(e^(iφ)·Σ zʲ), z = r·e^(iθ): exact. Where it turns fast, the stretches are many and |cos x| is summed by its
//   Fourier series, 2/π + (4/π)·Σ (−1)^(k+1)·cos(2kx)/(4k² − 1), a geometric sum at each k, to k = 64 with the rest
//   bounded: within 0.8 % of the sum.
// - Two real roots p, q (|q| ≤ |p|): |y_j| = |p|ʲ·|A + B·ρʲ|, ρ = q/p, whose sign changes at most once over the even j
//   and once over the odd, each stretch a geometric sum (sumTwo). Repeated, or within 1e-9 of it: |p|ʲ·|C + D·j|, one
//   change (sumLin)
function ring1 (a1, a2, y0, y1, eps) {
	if (y0 === 0 && y1 === 0) return 0
	if (a1 === 0 && a2 === 0) return Math.abs(y0) + Math.abs(y1) <= eps ? 0 : Math.abs(y1) <= eps ? 1 : 2   // no poles: y0, y1, then 0
	let d = a1 * a1 - 4 * a2
	if (d < 0) {
		let r = Math.sqrt(a2)
		if (!(r < 1)) return Infinity
		let c = -a1 / (2 * r), sn = Math.sqrt(-d) / (2 * r)
		if (sn > 1e-9) return ringPair(r, c, sn, y0, y1, eps)
	}
	let s = Math.sqrt(Math.max(d, 0)), p = (s - a1) / 2, q = (-s - a1) / 2
	if (Math.abs(q) > Math.abs(p)) { let t = p; p = q; q = t }
	if (!(Math.abs(p) < 1)) return Infinity
	let A, B, D = 0, rho = 0
	if (Math.abs(p - q) > 1e-9 * Math.max(1e-300, Math.abs(p))) { A = (y1 - q * y0) / (p - q); B = (p * y0 - y1) / (p - q); rho = q / p }
	else { A = y0; D = p ? y1 / p - y0 : 0; B = 0 }
	let P = Math.abs(p), sum = m => D ? sumLin(P, A, D, m) : rho >= 0 ? sumTwo(P, A, B, rho, m, 1) : sumTwo(P, A, B, -rho, m + (m & 1), 2) + sumTwo(P, A, -B, -rho, m + 1 - (m & 1), 2)
	// the rest only falls: the least m with sum(m) ≤ eps, between 0 and where the plain bound is under eps
	if (sum(0) <= eps) return 0
	let hi = 1
	while (sum(hi) > eps) { hi *= 2; if (hi > 2 ** 52) return Infinity }
	let lo = hi >> 1
	while (hi - lo > 1) { let mid = Math.floor((lo + hi) / 2); if (sum(mid) > eps) lo = mid; else hi = mid }
	return hi
}

// Σ_{j ≥ m, j ≡ m mod st} P^j·|A + B·σ^j| (0 ≤ σ ≤ 1, P < 1): A + B·σ^j keeps its sign but for one change, where σ^j = −A/B
function sumTwo (P, A, B, sig, m, st) {
	let g = (x, a, b) => { // Σ x^j over j = a, a + st, … below b (b may be Infinity)
		if (x === 0) return a === 0 ? 1 : 0
		let n = b === Infinity ? Infinity : Math.ceil((b - a) / st), xa = x ** a, xs = x ** st
		return n === Infinity ? xa / (1 - xs) : xa * (1 - x ** (st * n)) / (1 - xs)
	}
	let seg = (a, b) => Math.abs(A * g(P, a, b) + B * g(P * sig, a, b)), cut = Infinity, t = -A / B
	if (sig === 0) cut = m === 0 ? st : Infinity   // σ^0 = 1, then 0: the first term apart
	else if (B !== 0 && t > 0 && t < 1 && sig < 1) { let j = Math.log(t) / Math.log(sig); cut = m + Math.max(0, Math.ceil((j - m) / st)) * st }
	return cut <= m || cut === Infinity ? seg(m, Infinity) : seg(m, cut) + seg(cut, Infinity)
}

// Σ_{j ≥ m} P^j·|C + D·j|: one change of sign, at j = −C/D
function sumLin (P, C, D, m) {
	let G = a => P ** a / (1 - P), H = a => P ** a * (a - (a - 1) * P) / (1 - P) ** 2   // Σ_{j≥a} P^j, Σ_{j≥a} j·P^j
	let seg = (a, b) => Math.abs(C * (G(a) - (b === Infinity ? 0 : G(b))) + D * (H(a) - (b === Infinity ? 0 : H(b))))
	let j = Math.ceil(-C / D)
	return j > m && j < Infinity ? seg(m, j) + seg(j, Infinity) : seg(m, Infinity)
}

// ring1 for a conjugate pair of radius r, cos θ = c, sin θ = sn
function ringPair (r, c, sn, y0, y1, eps) {
	let E = Math.hypot(y0, (y0 * c - y1 / r) / sn), ph = Math.atan2((y0 * c - y1 / r) / sn, y0), th = Math.atan2(sn, c)
	if (th > Math.PI / 2) { th = Math.PI - th; ph = -ph }   // |cos(jθ + φ)| = |cos(j(π − θ) − φ)|
	if (th >= 64 * (1 - r)) {
		// turning fast: Σ_(t≥0) rᵗ·|cos(x + tθ)| = (2/π)/(1 − r) + (4/π)·Σ_k (−1)^(k+1)·Re(e^(2ikx)/(1 − r·e^(2ikθ)))/(4k² − 1),
		// summed to k = 64; the rest of the series is at most (2/π)/(129·(1 − r)) and is added whole, so S(m) is at most
		// E·r^m times that, at the phase x = mθ + φ
		let wr = new Float64Array(65), wi = new Float64Array(65)
		for (let k = 1; k <= 64; k++) { let cr = 1 - r * Math.cos(2 * k * th), ci = -r * Math.sin(2 * k * th), dd = cr * cr + ci * ci; wr[k] = cr / dd; wi[k] = -ci / dd }
		let S = m => {
			let x = m * th + ph, er = Math.cos(2 * x), ei = Math.sin(2 * x), pr = 1, pi = 0, f = 2 / Math.PI / (1 - r) * (1 + 1 / 129)
			for (let k = 1; k <= 64; k++) { let t = pr * er - pi * ei; pi = pr * ei + pi * er; pr = t; f += (k & 1 ? 4 : -4) / Math.PI / (4 * k * k - 1) * (pr * wr[k] - pi * wi[k]) }
			return E * r ** m * f
		}
		if (S(0) <= eps) return 0
		let lo = 0, hi = Math.ceil(Math.log(eps * (1 - r) / E) / Math.log(r)) + 1
		while (S(hi) > eps) hi *= 2
		while (hi - lo > 1) { let mid = Math.floor((lo + hi) / 2); if (S(mid) > eps) lo = mid; else hi = mid }
		return hi
	}
	// turning slowly: stretches between the zeros of cos at x = π/2 + kπ, x = jθ + φ (φ moved into (−π/2, π/2])
	while (ph > Math.PI / 2) ph -= Math.PI
	while (ph <= -Math.PI / 2) ph += Math.PI
	let cs = Math.cos(th), si = Math.sin(th), den = (1 - r * cs) ** 2 + (r * si) ** 2, wr = (1 - r * cs) / den, wi = r * si / den
	// Σ over [a, b) of rʲ·cos(jθ + φ): Re((r^a·e^(i·x_a) − r^b·e^(i·x_b))·w), w = 1/(1 − r·e^(iθ))
	let pc = j => r ** j * Math.cos(j * th + ph), ps = j => r ** j * Math.sin(j * th + ph)
	let part = (a, b) => E * Math.abs((pc(a) - (b === Infinity ? 0 : pc(b))) * wr - (ps(a) - (b === Infinity ? 0 : ps(b))) * wi)
	let starts = [0], sums = [], end = Math.log(1e-9 * eps * (1 - r) / E) / Math.log(r)
	for (let k = 0; ; k++) {
		let a = starts[k], b = Math.max(a + 1, Math.ceil((Math.PI / 2 + k * Math.PI - ph) / th))
		if (b > end) { sums.push(part(a, Infinity) + E * r ** a / (1 - r) * 1e-9); break }
		sums.push(part(a, b)); starts.push(b)
	}
	let k = sums.length - 1, rest = 0
	while (k >= 0 && rest + sums[k] <= eps) rest += sums[k--]
	if (k < 0) return 0
	// the crossing in stretch k: the least m in (a, b] with the stretch from m on and the rest under eps
	let a = starts[k], b = k + 1 < starts.length ? starts[k + 1] : Infinity, lo = a, hi = b === Infinity ? a + 1 : b
	if (b === Infinity) while (part(hi, Infinity) > eps) hi = a + 2 * (hi - a)
	while (hi - lo > 1) { let mid = Math.floor((lo + hi) / 2); if (part(mid, b) + rest > eps) lo = mid; else hi = mid }
	return hi
}
