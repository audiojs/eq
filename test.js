import test, { almost, ok, is } from 'tst'
import * as audio from './index.js'
import * as biquad from '@audio/biquad'
import { lowshelf, highshelf } from 'digital-filter/iir/biquad.js'
import { dftMag, magDB, impulse, dc, EPSILON, LOOSE, rings, collections } from './test/util.js'
import { fileURLToPath } from 'node:url'
import { geq } from '@audio/eq-graphic/audio'
import { dyneq } from '@audio/eq-dynamic/audio'
import { baxandall } from '@audio/eq-baxandall/audio'
import { tilt } from '@audio/eq-tilt/audio'

// Complex per-band frequency response (SOS cascade), for verifying flat-sum
// crossover reconstruction — magDB() alone discards phase, which hides
// polarity-cancellation defects (e.g. LR2 without inversion).
function sosComplex (sos, f, fs) {
	let w = 2 * Math.PI * f / fs
	let re = 1, im = 0
	for (let c of sos) {
		let br = c.b0 + c.b1 * Math.cos(w) + c.b2 * Math.cos(2 * w)
		let bi = -(c.b1 * Math.sin(w) + c.b2 * Math.sin(2 * w))
		let ar = 1 + c.a1 * Math.cos(w) + c.a2 * Math.cos(2 * w)
		let ai = -(c.a1 * Math.sin(w) + c.a2 * Math.sin(2 * w))
		let denom = ar * ar + ai * ai
		let hr = (br * ar + bi * ai) / denom
		let hi = (bi * ar - br * ai) / denom
		let nr = re * hr - im * hi, ni = re * hi + im * hr
		re = nr; im = ni
	}
	return { re, im }
}

// Complex sum across bands (a true "sum the outputs" check, unlike summing magnitudes)
function sumBandsDB (bands, f, fs) {
	let re = 0, im = 0
	for (let sos of bands) {
		let h = sosComplex(sos, f, fs)
		re += h.re; im += h.im
	}
	return 10 * Math.log10(re * re + im * im)
}

test('graphicEq — applies gain', () => {
	let data = dc(512)
	audio.graphicEq(data, {gains: {1000: 6}, fs: 44100})
	// DC should still pass (peaking EQ at 1kHz doesn't affect DC)
	almost(data[511], 1, 0.05)
})

test('parametricEq — applies bands', () => {
	let data = dc(256)
	audio.parametricEq(data, {bands: [{fc: 1000, Q: 1, gain: 0, type: 'peak'}], fs: 44100})
	almost(data[255], 1, 0.01)
})

test('crossover — returns correct band count', () => {
	let bands = audio.crossover([500, 2000], 4, 44100)
	is(bands.length, 3, '2 crossover freqs → 3 bands')
	ok(Array.isArray(bands[0]), 'each band is SOS array')
})

test('graphicEq — gains:{1000:6} boosts 1kHz', () => {
	let fs = 44100, N = 4096
	let data = new Float64Array(N)
	for (let i = 0; i < N; i++) data[i] = Math.sin(2 * Math.PI * 1000 * i / fs)
	audio.graphicEq(data, { gains: { 1000: 6 }, fs })
	let peak = 0
	for (let i = N / 2; i < N; i++) if (Math.abs(data[i]) > peak) peak = Math.abs(data[i])
	ok(peak > 1.5, `graphicEq 1kHz boosted: peak ${peak.toFixed(3)}`)
})

test('parametricEq — gain:6 at 1kHz boosts signal', () => {
	let fs = 44100, N = 4096
	let data = new Float64Array(N)
	for (let i = 0; i < N; i++) data[i] = Math.sin(2 * Math.PI * 1000 * i / fs)
	audio.parametricEq(data, { bands: [{ fc: 1000, Q: 1, gain: 6, type: 'peak' }], fs })
	let peak = 0
	for (let i = N / 2; i < N; i++) if (Math.abs(data[i]) > peak) peak = Math.abs(data[i])
	ok(peak > 1.5, `parametricEq boosted 1kHz: peak ${peak.toFixed(3)}`)
})

test('crossover LR4 — allpass property', () => {
	let fs = 44100, fc = 2000
	let bands = audio.crossover([fc], 4, fs)
	is(bands.length, 2, 'single crossover = 2 bands')
	for (let f of [200, 1000, 2000, 4000, 8000]) {
		let lpLin = Math.pow(10, magDB(bands[0], f, fs) / 20)
		let hpLin = Math.pow(10, magDB(bands[1], f, fs) / 20)
		let sumDB = 20 * Math.log10(lpLin + hpLin)
		ok(Math.abs(sumDB) < 1.0, `crossover@${f}Hz: sum=${sumDB.toFixed(2)}dB`)
	}
})

test('lowShelf — boosts bass', () => {
	let fs = 44100, N = 4096
	let data = impulse(N)
	audio.lowShelf(data, { fc: 300, gain: 6, fs })
	let mag100 = dftMag(data, 100, fs)
	let mag5k = dftMag(data, 5000, fs)
	ok(mag100 > mag5k * 1.5, `lowShelf +6dB: 100Hz (${mag100.toFixed(3)}) > 5kHz (${mag5k.toFixed(3)})`)
})

test('highShelf — boosts treble', () => {
	let fs = 44100, N = 4096
	let data = impulse(N)
	audio.highShelf(data, { fc: 4000, gain: 6, fs })
	let mag10k = dftMag(data, 10000, fs)
	let mag200 = dftMag(data, 200, fs)
	ok(mag10k > mag200 * 1.5, `highShelf +6dB: 10kHz (${mag10k.toFixed(3)}) > 200Hz (${mag200.toFixed(3)})`)
})

test('lowShelf — gain=0 is passthrough', () => {
	let data = impulse(256)
	let orig = Float64Array.from(data)
	audio.lowShelf(data, { fc: 300, gain: 0, fs: 44100 })
	let maxErr = 0
	for (let i = 0; i < data.length; i++) { let err = Math.abs(data[i] - orig[i]); if (err > maxErr) maxErr = err }
	ok(maxErr < EPSILON, `lowShelf gain=0 passthrough: err=${maxErr}`)
})

test('baxandall — bass boost, treble flat', () => {
	let fs = 44100, N = 4096
	let data = impulse(N)
	audio.baxandall(data, { bass: 6, treble: 0, fs })
	let mag100 = dftMag(data, 100, fs)
	let mag10k = dftMag(data, 10000, fs)
	ok(mag100 > mag10k * 1.3, `baxandall bass+6: 100Hz (${mag100.toFixed(3)}) > 10kHz (${mag10k.toFixed(3)})`)
})

test('baxandall — treble boost, bass flat', () => {
	let fs = 44100, N = 4096
	let data = impulse(N)
	audio.baxandall(data, { bass: 0, treble: 6, fs })
	let mag10k = dftMag(data, 10000, fs)
	let mag100 = dftMag(data, 100, fs)
	ok(mag10k > mag100 * 1.3, `baxandall treble+6: 10kHz (${mag10k.toFixed(3)}) > 100Hz (${mag100.toFixed(3)})`)
})

test('baxandall — both=0 is passthrough', () => {
	let data = impulse(256)
	let orig = Float64Array.from(data)
	audio.baxandall(data, { bass: 0, treble: 0, fs: 44100 })
	let maxErr = 0
	for (let i = 0; i < data.length; i++) { let err = Math.abs(data[i] - orig[i]); if (err > maxErr) maxErr = err }
	ok(maxErr < EPSILON, `baxandall 0/0 passthrough: err=${maxErr}`)
})

test('tilt — positive tilts bass up, treble down', () => {
	let fs = 44100, N = 4096
	let data = impulse(N)
	audio.tilt(data, { gain: 6, pivot: 1000, fs })
	let mag100 = dftMag(data, 100, fs)
	let mag10k = dftMag(data, 10000, fs)
	ok(mag100 > mag10k, `tilt +6: 100Hz (${mag100.toFixed(3)}) > 10kHz (${mag10k.toFixed(3)})`)
})

test('tilt — negative tilts treble up, bass down', () => {
	let fs = 44100, N = 4096
	let data = impulse(N)
	audio.tilt(data, { gain: -6, pivot: 1000, fs })
	let mag10k = dftMag(data, 10000, fs)
	let mag100 = dftMag(data, 100, fs)
	ok(mag10k > mag100, `tilt -6: 10kHz (${mag10k.toFixed(3)}) > 100Hz (${mag100.toFixed(3)})`)
})

test('tilt — gain=0 is passthrough', () => {
	let data = impulse(256)
	let orig = Float64Array.from(data)
	audio.tilt(data, { gain: 0, pivot: 1000, fs: 44100 })
	let maxErr = 0
	for (let i = 0; i < data.length; i++) { let err = Math.abs(data[i] - orig[i]); if (err > maxErr) maxErr = err }
	ok(maxErr < EPSILON, `tilt gain=0 passthrough: err=${maxErr}`)
})

test('tilt — pivot stays at exactly 0dB for any gain', () => {
	// tilt cascades lowshelf(pivot,0.5,fs,gain) with highshelf(pivot,0.5,fs,-gain)
	// (eq/tilt.js). RBJ's shelf equations give both filters the same magnitude at
	// their own corner frequency independent of gain, so the +gain/-gain pair
	// cancels there exactly. Robert Bristow-Johnson, "Audio EQ Cookbook", shelf design.
	let fs = 44100, pivot = 1000
	for (let gain of [3, 6, -6, 18, -24]) {
		let lo = [lowshelf(pivot, 0.5, fs, gain)]
		let hi = [highshelf(pivot, 0.5, fs, -gain)]
		let db = magDB(lo, pivot, fs) + magDB(hi, pivot, fs)
		almost(db, 0, 1e-9, `tilt gain=${gain}: pivot=${db}dB`)
	}
})

test('baxandall — DC/Nyquist gains match RBJ shelf analytic values exactly', () => {
	// baxandall cascades lowshelf(fBass,...,bass) with highshelf(fTreble,...,treble).
	// RBJ cookbook: lowshelf DC gain = dBgain, Nyquist gain = 0; highshelf DC gain = 0,
	// Nyquist gain = dBgain. Cascaded: DC = bass dB exactly, Nyquist = treble dB exactly.
	let fs = 44100, fBass = 250, fTreble = 4000
	for (let [bass, treble] of [[6, 0], [0, 6], [6, -4], [-9, 12]]) {
		let b = [lowshelf(fBass, 0.707, fs, bass)]
		let t = [highshelf(fTreble, 0.707, fs, treble)]
		let dc = magDB(b, 0, fs) + magDB(t, 0, fs)
		let nyq = magDB(b, fs / 2, fs) + magDB(t, fs / 2, fs)
		almost(dc, bass, 1e-9, `baxandall DC gain (bass=${bass}): ${dc}dB`)
		almost(nyq, treble, 1e-9, `baxandall Nyquist gain (treble=${treble}): ${nyq}dB`)
	}
})

test('crossover — LR2 sums flat with polarity inversion (Linkwitz-Riley 1976)', () => {
	// order=2 (order/2=1, odd) requires inverting alternate bands to sum flat —
	// Linkwitz, S. & Riley, R., "Active Crossover Networks for Noncoincident
	// Drivers", JAES 24(1), 1976. Without inversion this is a ~-60dB notch at fc.
	let fs = 44100, fc = 1000
	let bands = audio.crossover([fc], 2, fs)
	for (let f of [100, 500, 900, 999, 1000, 1001, 1100, 5000, 15000]) {
		almost(sumBandsDB(bands, f, fs), 0, 0.01, `LR2 sum@${f}Hz`)
	}
})

test('crossover — LR8 sums flat without inversion (order/2 even)', () => {
	let fs = 44100, fc = 1000
	let bands = audio.crossover([fc], 8, fs)
	for (let f of [100, 500, 900, 999, 1000, 1001, 1100, 5000, 15000]) {
		almost(sumBandsDB(bands, f, fs), 0, 0.01, `LR8 sum@${f}Hz`)
	}
})

test('crossover — LR4 sums flat (regression, complex-domain check)', () => {
	let fs = 44100, fc = 2000
	let bands = audio.crossover([fc], 4, fs)
	for (let f of [200, 1000, 2000, 4000, 8000]) {
		almost(sumBandsDB(bands, f, fs), 0, 0.01, `LR4 sum@${f}Hz`)
	}
})

test('graphicEq — ISO 266 nominal keys (31.5, 63) build filters', () => {
	// ISO 266:1997 / IEC 61260-1 1/1-octave nominal center frequencies — the low end
	// (31.5, 63) diverges from exact-octave 1000*2^k (31.25, 62.5); readme claims
	// ISO 266 so these exact nominal keys must resolve, not just 1000/2000/...
	let p = { gains: { 31.5: -12, 63: 6 }, fs: 44100 }
	audio.graphicEq(dc(64, 1), p)
	is(p._filters.filter(f => !f.flat).length, 2, 'both ISO nominal keys (31.5, 63) built a filter')
})

test('graphicEq — recomputes filters when gains mutated in place', () => {
	let p = { gains: { 1000: 6 }, fs: 44100 }
	audio.graphicEq(dc(64, 1), p)
	let before = JSON.stringify(p._filters)
	p.gains[1000] = 12
	audio.graphicEq(dc(64, 1), p)
	let after = JSON.stringify(p._filters)
	ok(before !== after, 'gains mutation triggers coefficient rebuild')
})

test('graphicEq — recomputes filters when fs changes on reused params', () => {
	let p = { gains: { 1000: 6 }, fs: 44100 }
	audio.graphicEq(dc(64, 1), p)
	let before = JSON.stringify(p._filters)
	p.fs = 96000
	audio.graphicEq(dc(64, 1), p)
	let after = JSON.stringify(p._filters)
	ok(before !== after, 'fs mutation triggers coefficient rebuild')
})

test('parametricEq — recomputes filters when band content mutated in place', () => {
	let p = { bands: [{ fc: 1000, Q: 1, gain: 6, type: 'peak' }], fs: 44100 }
	audio.parametricEq(dc(64, 1), p)
	let before = JSON.stringify(p._filters)
	p.bands[0].gain = 12
	audio.parametricEq(dc(64, 1), p)
	let after = JSON.stringify(p._filters)
	ok(before !== after, 'band.gain mutation triggers filter rebuild (no _dirty flag needed)')
})

test('parametricEq — lowshelf/highshelf bands default to Q=0.707 (matches standalone filters)', () => {
	// eq/lowshelf.js / eq/highshelf.js default Q to 0.707 (RBJ maximally-flat shelf);
	// parametricEq must match so the same nominal band gives the same curve regardless
	// of entry point.
	let fs = 44100, fc = 300, gain = 6
	let peqData = impulse(4096)
	audio.parametricEq(peqData, { bands: [{ fc, gain, type: 'lowshelf' }], fs })
	let stdData = impulse(4096)
	audio.lowShelf(stdData, { fc, gain, fs })
	let f = 100
	almost(dftMag(peqData, f, fs), dftMag(stdData, f, fs), 1e-9, 'lowshelf band matches standalone lowShelf')

	let peqHi = impulse(4096)
	audio.parametricEq(peqHi, { bands: [{ fc: 4000, gain, type: 'highshelf' }], fs })
	let stdHi = impulse(4096)
	audio.highShelf(stdHi, { fc: 4000, gain, fs })
	almost(dftMag(peqHi, 10000, fs), dftMag(stdHi, 10000, fs), 1e-9, 'highshelf band matches standalone highShelf')
})


// ── FIR EQ ──────────────────────────────────────────────────────────────
import { firEq, firDesign } from './index.js'

function goertzel (data, freq, sr = 44100, from = 2048, to = data.length - 2048) {
	let w = 2 * Math.PI * freq / sr, cw = Math.cos(w)
	let s1 = 0, s2 = 0
	for (let i = from; i < to; i++) { let s0 = data[i] + 2 * cw * s1 - s2; s2 = s1; s1 = s0 }
	return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - 2 * cw * s1 * s2)) / (to - from)
}
function tone (f, n = 44100, sr = 44100) {
	let d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = 0.5 * Math.sin(2 * Math.PI * f * i / sr)
	return d
}

test('firEq — coefficients are symmetric (linear phase)', () => {
	let h = firDesign([{ f: 0, gain: 0 }, { f: 1000, gain: 6 }, { f: 20000, gain: -12 }], { taps: 255 })
	for (let j = 0; j < h.length >> 1; j++) almost(h[j], h[h.length - 1 - j], 1e-12)
})

// Overlap-add (FFT) equals the direct sum Σ h[j]·x[i − j + half] (outside the input silent), sample for sample after the
// Float32 store: kernels on both sides of the switch (32 taps), inputs empty, one sample, shorter than, equal to and
// longer than the kernel, and across several blocks.
test('firEq — FFT overlap-add equals the direct convolution', () => {
	let seed = 3, rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
	let direct = (x, h) => { let N = h.length, half = (N - 1) / 2, out = new Float32Array(x.length); for (let i = 0; i < x.length; i++) { let s = 0; for (let j = 0; j < N; j++) { let idx = i - j + half; if (idx >= 0 && idx < x.length) s += h[j] * x[idx] } out[i] = s } return out }
	let resp = [{ f: 0, gain: 3 }, { f: 500, gain: -6 }, { f: 4000, gain: 6 }, { f: 22050, gain: -12 }]
	for (let taps of [31, 33, 255]) for (let L of [0, 1, 17, taps - 1, taps, taps + 1, 9000]) {
		let x = Float32Array.from({ length: L }, () => rnd() * 2 - 1), h = firDesign(resp, { taps })
		let want = direct(x, h), got = firEq(Float32Array.from(x), { coefs: h }), diff = 0
		for (let i = 0; i < L; i++) if (got[i] !== want[i]) diff++
		is(diff, 0, `${taps} taps, ${L} samples`)
	}
})

test('firEq — flat 0 dB response is exact identity', () => {
	let d = tone(440)
	let ref = Float32Array.from(d)
	firEq(d, { response: [{ f: 0, gain: 0 }, { f: 22050, gain: 0 }] })
	let err = 0
	for (let i = 2048; i < d.length - 2048; i++) err = Math.max(err, Math.abs(d[i] - ref[i]))
	ok(err < 1e-6, 'identity, max err ' + err.toExponential(1))
})

test('firEq — lowpass-shaped response passes 500 Hz, kills 8 kHz', () => {
	let d = tone(500), e = tone(8000)
	let opts = { response: [{ f: 0, gain: 0 }, { f: 1000, gain: 0 }, { f: 4000, gain: -80 }, { f: 22050, gain: -80 }] }
	let r500 = goertzel(Float32Array.from(d), 500)
	let r8k = goertzel(Float32Array.from(e), 8000)
	firEq(d, opts); firEq(e, opts)
	almost(20 * Math.log10(goertzel(d, 500) / r500), 0, 1, '500 Hz within ±1 dB')
	ok(20 * Math.log10(goertzel(e, 8000) / r8k) < -40, '8 kHz ≥40 dB down')
})

test('firEq — +6 dB band boost measures +6 dB', () => {
	let d = tone(1000)
	let ref = goertzel(Float32Array.from(d), 1000)
	firEq(d, { response: [{ f: 0, gain: 0 }, { f: 500, gain: 6 }, { f: 2000, gain: 6 }, { f: 4000, gain: 0 }, { f: 22050, gain: 0 }] })
	almost(20 * Math.log10(goertzel(d, 1000) / ref), 6, 1)
})

// ── Dynamic EQ ─────────────────────────────────────────────────────────
import { dynamicEq } from './index.js'

test('dynamicEq — attenuates only the hot band, transparent below threshold', () => {
	let sr = 44100, n = sr
	let d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = 0.5 * Math.sin(2 * Math.PI * 3000 * i / sr) + 0.1 * Math.sin(2 * Math.PI * 500 * i / sr)
	let hot0 = goertzel(Float32Array.from(d), 3000), cool0 = goertzel(Float32Array.from(d), 500)
	dynamicEq(d, { fs: sr, bands: [{ fc: 3000, Q: 2, threshold: -20, ratio: 4 }] })
	let hotDb = 20 * Math.log10(goertzel(d, 3000) / hot0)
	let coolDb = 20 * Math.log10(goertzel(d, 500) / cool0)
	ok(hotDb < -3, '3 kHz reduced ' + hotDb.toFixed(1) + ' dB')
	ok(Math.abs(coolDb) < 0.7, '500 Hz untouched (' + coolDb.toFixed(2) + ' dB)')
	ok(d.every(isFinite), 'finite')

	let q = new Float32Array(n)
	for (let i = 0; i < n; i++) q[i] = 0.02 * Math.sin(2 * Math.PI * 3000 * i / sr)
	let ref = goertzel(Float32Array.from(q), 3000)
	dynamicEq(q, { fs: sr, bands: [{ fc: 3000, Q: 2, threshold: -20, ratio: 4 }] })
	almost(20 * Math.log10(goertzel(q, 3000) / ref), 0, 0.3, 'below threshold transparent')
})

// =================== eq-fit ===================
test('fitEq — recovers a peaking band from its own response and round-trips Equalizer APO text', () => {
	let fs = 44100
	let [b] = [{ type: 'peak', fc: 1000, Q: 1.5, gain: -6 }]
	let target = f => 20 * Math.log10(audio.eqResponse ? 1 : 1) + 20 * Math.log10(peakMag(f))
	function peakMag (f) { // |H| of the RBJ peaking section, via the same biquad the fitter uses
		let { peaking, magnitude } = biquad
		return magnitude(peaking(b.fc, b.Q, fs, b.gain), f, fs)
	}
	let r = audio.fitEq(target, { fs, bands: 3, shelves: false })
	ok(r.bands.length >= 1, 'at least one band')
	let best = r.bands.reduce((a, c) => Math.abs(c.gain) > Math.abs(a.gain) ? c : a)
	almost(best.fc, 1000, 20, 'fc ' + best.fc.toFixed(1))
	almost(best.gain, -6, 0.2, 'gain ' + best.gain.toFixed(2))
	ok(r.error < 0.1, 'rms error ' + r.error.toFixed(3) + ' dB')
	let txt = audio.toEqualizerApo(r)
	ok(/Filter 1: ON PK Fc \d+ Hz Gain -?[\d.]+ dB Q [\d.]+/.test(txt), 'APO line')
	let back = audio.fromEqualizerApo(txt)
	is(back.bands.length, r.bands.length, 'APO round trip band count')
})

// =================== automation: new coefficients keep the filter's state ===================
// A parameter moving block to block (automation, a slider, audio's 128-sample sub-blocks) replaces the
// coefficients; the transposed-DF-II state carries on, as in the Web Audio BiquadFilterNode. A fresh state
// per change restarted the filter each block: on a 0.5 sine, errors up to 0.47 and a buzz at the block rate.
// Reference: @audio/biquad's kernel over the whole signal with the same coefficient schedule, one state.
test('lowShelf, highShelf, parametricEq, graphicEq: a moving parameter keeps the state, equal to one continuous kernel', () => {
	let fs = 44100, n = fs, B = 128
	let x = new Float64Array(n).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / fs))
	let fcAt = i => 300 + 400 * i / n
	for (let [name, run, coef] of [
		['lowShelf', (blk, p, fc) => { p.fc = fc; p.gain = 6; p.fs = fs; audio.lowShelf(blk, p) }, fc => biquad.lowshelf(fc, 0.707, fs, 6)],
		['highShelf', (blk, p, fc) => { p.fc = fc; p.gain = 6; p.fs = fs; audio.highShelf(blk, p) }, fc => biquad.highshelf(fc, 0.707, fs, 6)],
		['parametricEq', (blk, p, fc) => { p.bands = [{ fc, Q: 1, gain: 6, type: 'peak' }]; p.fs = fs; audio.parametricEq(blk, p) }, fc => biquad.peaking(fc, 1, fs, 6)],
		['graphicEq', (blk, p, fc) => { p.gains = { 1000: 6 + (fc - 300) / 100 }; p.fs = fs; audio.graphicEq(blk, p) }, fc => biquad.peaking(1000, 1.4, fs, 6 + (fc - 300) / 100)],
	]) {
		let y = Float64Array.from(x), ref = Float64Array.from(x), p = {}, s = biquad.state(), max = 0
		for (let i = 0; i < n; i += B) {
			let fc = fcAt(i)
			run(y.subarray(i, i + B), p, fc)
			biquad.process(ref.subarray(i, i + B), coef(fc), s)
		}
		for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(y[i] - ref[i]))
		ok(max < 1e-12, `${name}: max |Δ| ${max.toExponential(1)}`)
	}
})

// A band at exactly 0 dB is the identity, yet its state must stay live. Skipped, it froze: returning to 0 dB dropped
// the band's ringing output at once, and leaving 0 dB resumed the state frozen back then; both clicked on a steady tone.
test('graphicEq: a band returning to 0 dB and leaving it again stays continuous', () => {
	let fs = 44100, n = fs, B = 128, q = n / 4, f0 = 1000, amp = 0.5
	let x = new Float64Array(n).map((_, i) => amp * Math.sin(2 * Math.PI * f0 * i / fs))
	let y = Float64Array.from(x), p = { fs }
	for (let i = 0; i < n; i += B) { p.gains = { 1000: (i / q | 0) % 2 ? 6 : 0 }; audio.graphicEq(y.subarray(i, i + B), p) }  // 0, +6, 0, +6 dB
	// steady-state bound: a sine of amplitude a steps at most 2a·sin(πf/fs) per sample; the loudest here is +6 dB at fc
	let bound = 2 * amp * 10 ** (6 / 20) * Math.sin(Math.PI * f0 / fs)
	let step = i0 => { let m = 0; for (let i = i0; i < i0 + 64; i++) m = Math.max(m, Math.abs(y[i] - y[i - 1])); return m }
	let at = k => Math.ceil(k * q / B) * B  // first block of quarter k
	ok(step(at(3)) <= bound, `+6 dB again: max step ${step(at(3)).toFixed(4)} ≤ ${bound.toFixed(4)}`)
	ok(step(at(2)) <= bound, `back to 0 dB: max step ${step(at(2)).toFixed(4)} ≤ ${bound.toFixed(4)}`)
})

// =================== the /audio manifests, as a host drives them ===================
// A stub ctx (CONTRACT.md, Context), process() called in blocks of `block(i)` frames, numbers as 1-length Float32Arrays,
// `set(i)` the values of call i
const live = (m, set) => Object.fromEntries(Object.entries(m.params).map(([k, s]) => [k, s.type === 'number' ? Float32Array.of(set[k] ?? s.default) : set[k] ?? s.default]))
function host (m, x, fs, set = () => ({}), block = () => 128) {
	let proc = m({ sampleRate: fs, maxBlockSize: 1024, maxChannels: 2, params: live(m, set(0)), buffers: {} })
	let a = Float32Array.from(x), y = new Float32Array(x.length)
	for (let pos = 0, i = 0; pos < x.length; i++) {
		let n = Math.min(block(i), x.length - pos)
		proc([[a.subarray(pos, pos + n)]], [[y.subarray(pos, pos + n)]], live(m, set(i)))
		pos += n
	}
	x.set(y)
	return x
}
const GEQ_BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

// A gain glides: geq's bands, baxandall's bass and treble, tilt's gain. A host ramps it in calls of 32 frames, each
// handed the value at its first frame (CONTRACT.md: Parameters, Time); the gain at frame n is the line through those
// values, each at its call's first frame, played 32 frames late: u(n) = v_k + (v_k+1 − v_k)·(n − 32 − p_k)/32 for
// p_k ≤ n − 32 < p_k + 32, v_0 before; a gain held a call is the gain. Each frame runs the section @audio/biquad
// designs at u(n), transposed direct form II as its process() runs one, computed here, bit for bit: geq's peaking at
// each band (Q 1.4; a band held at 0 dB runs while its state rings out, then rests, graphicBlock's rule, per call);
// baxandall's lowshelf and highshelf at their corners (Q 0.707); tilt's lowshelf at +u and highshelf at −u about the
// pivot (Q 0.5). The gains: held, a 20 ms ramp, held, a jump back with no ramp, held
const glideLine = (v, n) => { let t = n - 32; if (t < 0) return v[0]; let k = Math.floor(t / 32), q = t - 32 * k; return k + 1 < v.length ? v[k] + (v[k + 1] - v[k]) * q / 32 : v[v.length - 1] }
const glidePlan = (a, b, calls) => Array.from({ length: calls }, (_, i) => Math.fround(i < 20 ? a : i < 50 ? a + (b - a) * (i - 20) / 30 : i < 80 ? b : a))
function sections (x, design, s) {   // x through a section a frame (design(n)), in place, state s
	for (let n = 0; n < x.length; n++) {
		let c = design(n), v = x[n], y = c.b0 * v + s[0]
		s[0] = c.b1 * v - c.a1 * y + s[1]
		s[1] = c.b2 * v - c.a2 * y
		x[n] = y
	}
}
test('geq, baxandall, tilt audio.js – a gain glides: each frame @audio/biquad\'s section at the host\'s line, 32 frames late, bit for bit', () => {
	let N = 4096, calls = N / 32
	for (let fs of [44100, 96000]) {
		let u = seed(fs), x = Float32Array.from({ length: N }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 220 * i / fs) + 0.3 * (u() - 0.5)), names = Object.keys(geq.params)
		// geq: each band from 0 dB to its own gain and back, so each rests at 0 dB at the end
		let plans = names.map((n, b) => glidePlan(0, (b - 4.5) * 3, calls)), got = host(geq, Float64Array.from(x), fs, i => Object.fromEntries(names.map((n, b) => [n, plans[b][i]])), () => 32)
		let want = Float64Array.from(x)
		GEQ_BANDS.forEach((fc, b) => {
			let v = plans[b], s = new Float64Array(2), at = Math.min(fc, 0.49 * fs)
			for (let k = 0; k < calls; k++) {
				let part = want.subarray(32 * k, 32 * k + 32), heldAt0 = (k === 0 || v[k] === v[k - 1]) && v[k] === 0
				if (heldAt0 && !(Math.abs(s[0]) + Math.abs(s[1]) > 1e-30)) { s[0] = s[1] = 0; continue }
				sections(part, n => biquad.peaking(at, 1.4, fs, glideLine(v, 32 * k + n)), s)
				for (let n = 0; n < 32; n++) part[n] = Math.fround(part[n])
			}
		})
		ok(got.every((y, i) => Object.is(y, Math.fround(want[i]))), `geq at ${fs}: ten bands 0 dB → −13.5 to +13.5 dB over 20 ms and back at once, each frame the band's peaking at the line`)
		for (let [m, base, keys] of [[baxandall, { fBass: 300, fTreble: 5000 }, [['bass', 0, 12], ['treble', -6, 9]]], [tilt, { pivot: 700 }, [['gain', -6, 6]]]]) {
			let v = Object.fromEntries(keys.map(([k, a, b]) => [k, glidePlan(a, b, calls)]))
			let y = host(m, Float64Array.from(x), fs, i => ({ ...base, ...Object.fromEntries(keys.map(([k]) => [k, v[k][i]])) }), () => 32), w = Float64Array.from(x)
			let at = f => Math.min(f, 0.49 * fs), run = (design) => { let s = new Float64Array(2); for (let k = 0; k < calls; k++) { let part = w.subarray(32 * k, 32 * k + 32); sections(part, n => design(32 * k + n), s) } for (let n = 0; n < N; n++) w[n] = Math.fround(w[n]) }
			if (m === baxandall) { run(n => biquad.lowshelf(at(base.fBass), 0.707, fs, glideLine(v.bass, n))); run(n => biquad.highshelf(at(base.fTreble), 0.707, fs, glideLine(v.treble, n))) }
			else { run(n => biquad.lowshelf(at(base.pivot), 0.5, fs, glideLine(v.gain, n))); run(n => biquad.highshelf(at(base.pivot), 0.5, fs, -glideLine(v.gain, n))) }
			ok(y.every((q, i) => Object.is(q, w[i])), `${m.name} at ${fs}: ${keys.map(([k, a, b]) => `${k} ${a} → ${b}`).join(', ')} over 20 ms and back at once, each frame the shelves at the line`)
		}
	}
})

// dynamicEq sets a 64-frame block's gain from that block's level, so the manifest plays each block out once it is whole:
// latency 63, the whole-buffer call's output that many frames later, whatever the host's blocks
test('dyneq audio.js – streams: any host blocks give dynamicEq\'s whole-buffer output, 63 frames later', () => {
	is(dyneq.latency, 63, 'latency 63')
	is(dyneq.streaming, undefined, 'streams')
	for (let [fs, set] of [[44100, {}], [48000, { fc: 300, Q: 8, threshold: -40, ratio: 10, attack: 0.5, release: 10, maxGain: 24, mode: 'up' }], [96000, { fc: 9000, threshold: -12 }]]) {
		let x = Float64Array.from({ length: 64 * 150 }, (_, i) => (i % 3000 < 1500 ? 0.6 : 0.02) * Math.sin(i * 2 * Math.PI * (set.fc ?? 6000) / fs) + 0.05 * Math.sin(i * 0.01))
		let want = Float32Array.from(x)
		dynamicEq(want, { fs, bands: [{ fc: dyneq.params.fc.default, ...Object.fromEntries(Object.entries(live(dyneq, set)).map(([k, v]) => [k, typeof v === 'string' ? v : v[0]])) }] })
		for (let sizes of [[1], [64], [127], [128], [1000], [5, 300, 61, 2, 1024]]) {
			let k = 0, got = host(dyneq, Float64Array.from(x), fs, () => set, () => sizes[k++ % sizes.length])
			ok(got.subarray(0, 63).every(v => v === 0) && want.subarray(0, x.length - 63).every((v, i) => Object.is(v, got[i + 63])), `${fs}, blocks of ${sizes}: dynamicEq's output 63 frames on`)
		}
	}
})

// Their gains glide (the test above); held through a run at random, the shelves' frequencies retune each call as the
// kernel retunes them
test('baxandall, tilt audio.js – a host\'s blocks, their frequencies moving between calls, give the kernel\'s output, bit for bit', () => {
	for (let [m, kernel] of [[baxandall, audio.baxandall], [tilt, audio.tilt]]) for (let fs of [44100, 96000]) {
		let u = seed(fs + m.name.length), x = Float64Array.from({ length: 20000 }, (_, i) => 0.4 * Math.sin(i * 0.013) + 0.2 * Math.sin(i * 0.9)), k = 0
		let sizes = Array.from({ length: 400 }, () => [1, 7, 64, 128, 333][k++ % 5]), gains = { bass: 1, treble: 1, gain: 1 }
		let draw = s => Math.fround(s.curve === 'log' ? s.min * (s.max / s.min) ** u() : s.min + (s.max - s.min) * u()), held = Object.fromEntries(Object.entries(m.params).filter(([n]) => gains[n]).map(([n, s]) => [n, draw(s)]))
		let sets = Array.from({ length: 400 }, (_, i) => Object.fromEntries(Object.entries(m.params).map(([n, s]) => [n, n in held ? held[n] : (i >> 5) % 3 === 2 ? s.default : draw(s)])))
		let got = host(m, Float64Array.from(x), fs, i => sets[i], i => sizes[i])
		let want = Float32Array.from(x), p = { fs }
		for (let i = 0, pos = 0; pos < x.length; pos += sizes[i++]) kernel(want.subarray(pos, pos + sizes[i]), Object.assign(p, sets[i]))
		ok(got.every((v, i) => Object.is(v, want[i])), `${m.name} at ${fs}: the kernel's output`)
	}
})

// A value at random in a declared range: its min a tenth of the time, its max a tenth, its default a twentieth, else
// uniform (log-uniform on a log curve); an enum's values evenly
function seed (s) { return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 }
const pick = (u, s) => {
	if (s.type === 'enum') return s.values[Math.floor(u() * s.values.length)]
	let r = u()
	return r < 0.1 ? s.min : r < 0.2 ? s.max : r < 0.25 ? s.default : s.curve === 'log' ? s.min * (s.max / s.min) ** u() : s.min + (s.max - s.min) * u()
}
const setting = (m, u) => Object.fromEntries(Object.entries(m.params).map(([k, s]) => [k, pick(u, s)]))
const ATOMS = { geq, dyneq, baxandall, tilt }

// CONTRACT.md, process: never write NaN or Infinity. Every value of every range at every rate a host may run: each number
// param at its min and at its max (the others at their defaults), each enum value, and 50 settings at random; full-scale
// noise in, 2 channels, calls of 128 frames
test('eq audio.js – every processor writes finite numbers for noise in, at the ends of its ranges and 50 points between, 8 to 192 kHz', () => {
	let u = seed(7), noise = Float32Array.from({ length: 4096 }, () => u() * 2 - 1)
	for (let [name, m] of Object.entries(ATOMS)) {
		let sets = [{}], bad = []
		for (let [k, s] of Object.entries(m.params)) {
			if (s.type === 'number') sets.push({ [k]: s.min }, { [k]: s.max })
			else for (let v of s.values) sets.push({ [k]: v })
		}
		for (let i = 0; i < 50; i++) sets.push(setting(m, u))
		for (let fs of [8000, 22050, 44100, 48000, 96000, 192000]) for (let set of sets) {
			let l = live(m, set), p = m({ sampleRate: fs, maxBlockSize: 128, maxChannels: 2, params: l, buffers: {} }), y = [new Float32Array(noise.length), new Float32Array(noise.length)]
			for (let pos = 0; pos < noise.length; pos += 128) p([[noise.subarray(pos, pos + 128), noise.subarray(pos, pos + 128)]], [y.map(c => c.subarray(pos, pos + 128))], l)
			if (!y.every(c => c.every(Number.isFinite))) bad.push(`${JSON.stringify(set)} at ${fs}`)
		}
		ok(!bad.length, `${name}: finite at ${sets.length} settings x 6 rates${bad.length ? `; not at ${bad.length}, e.g. ${bad[0]}` : ''}`)
	}
})

// The declared tail against the rings each processor leaves (test/util.js rings: an impulse, the validator's noise
// burst, a DC step, held tones, each to 60 dB under the input's level): never short, and at most 1.5 times the longest
// ring where that is over 128 frames. Random settings in the ranges at 44.1, 48 and 96 kHz; tones at each band (geq) or
// about the corners, and over the spectrum
test('geq, baxandall, tilt audio.js – each tail: never short of the rings of an impulse, noise, a DC step and held tones; at most 1.5 times the longest', () => {
	for (let [name, m] of Object.entries({ geq, baxandall, tilt })) {
		let u = seed(name.length * 31), worst = 0, n = 0, bad = []
		for (let si = 0; si < 18; si++) {
			let fs = [44100, 48000, 96000][si % 3], set = setting(m, u), T = m.tail({ sampleRate: fs, params: live(m, set) }) * fs
			let at = name === 'geq' ? GEQ_BANDS : name === 'tilt' ? [set.pivot] : [set.fBass, set.fTreble]
			let freqs = [...at.flatMap(f => [0.7, 1, 1.4].map(k => k * f)), ...Array.from({ length: 12 }, (_, i) => 10 * (0.45 * fs / 10) ** (i / 11))]
			let r = rings(x => host(m, x, fs, () => set), T, { fs, freqs })
			if (r.short || r.over > 1.5) bad.push(`${JSON.stringify(set)} at ${fs}: tail ${Math.round(T)} frames, rings impulse ${r.impulse} dc ${r.dc} tone ${r.tone} noise ${r.noise}`)
			worst = Math.max(worst, r.over)
			n++
		}
		ok(!bad.length, `${name}: ${n} settings, tail at most ${worst.toFixed(2)} of the longest ring${bad.length ? `; ${bad.length} off: ${bad[0]}` : ''}`)
		is(m.tail({ sampleRate: 44100, params: live(m, {}) }), 0, `${name} at its defaults: the identity, no tail`)
	}
})

// dyneq's tail (eq-dynamic/audio.js): how long the band keeps moving is bounded for any input within 0 dBFS, its ring
// while it moves is measured. Driven as a band is driven hardest: tones at fc and 5 % either side and square waves at fc
// (their fundamental 4/π of their peak) at -60 to 0 dB in steps of 6 dB, and a DC step, an impulse and the noise burst
// at full scale: never short of any ring, latency counted, in either mode. Random settings, four where a square wave or
// a DC step at full scale rang past the rule before this one (to 1.07 of it), and two where a square wave at fc rings
// past the rule with the band's reach taken at an envelope of 0 dB in place of the sum of the detector's |h| (277 frames
// where that rule declares none, and 1.19 of it). A band that lets go before its ring ends, or that no input here
// charges as far as the bound allows, rings shorter: on 400 random settings (200 at deep cuts and boosts) 356 rang
// within 1.5 of the tail, the rest down to 1/4.8 of it
test('dyneq audio.js – its tail: never short of the rings of tones and square waves about fc at -60 to 0 dB, a DC step, an impulse, noise', () => {
	let u = seed(17), worst = 0, n = 0, over = 0, bad = [], sets = Array.from({ length: 24 }, (_, si) => [[44100, 48000, 96000][si % 3], setting(dyneq, u)])
	sets.push([48000, { fc: 40, Q: 0.3, threshold: -60, ratio: 8.96983, attack: 82.2274, release: 10, maxGain: 24, mode: 'down' }],
		[48000, { fc: 45.8578, Q: 7.01487, threshold: -39.3557, ratio: 19.7869, attack: 23.6527, release: 20.9964, maxGain: 17.3356, mode: 'up' }],
		[96000, { fc: 68.5339, Q: 13.5107, threshold: -25.5844, ratio: 6.29551, attack: 90.4419, release: 15.8295, maxGain: 15.5265, mode: 'up' }],
		[44100, { fc: 106.177, Q: 15.2699, threshold: -20.4048, ratio: 6.19785, attack: 7.20106, release: 34.4775, maxGain: 12.1353, mode: 'down' }],
		[44100, { fc: 209.595, Q: 0.39904, threshold: 0, ratio: 6.88262, attack: 8.42942, release: 76.3655, maxGain: 9.62614, mode: 'up' }],
		[96000, { fc: 2829.6, Q: 12.9755, threshold: -4.34911, ratio: 11.0365, attack: 0.5, release: 882.866, maxGain: 23.4345, mode: 'up' }])
	for (let [fs, set] of sets) {
		let T = dyneq.tail({ sampleRate: fs, params: live(dyneq, set) }) * fs
		if (T > 0.5 * fs) continue
		let fc = Math.min(set.fc, 0.49 * fs), longest = 0, short = false
		for (let dB = -60; dB <= 0; dB += 6) {
			let r = rings(x => host(dyneq, x, fs, () => set), T, { fs, freqs: [0.95 * fc, fc, 1.05 * fc], squares: [fc], amp: 10 ** (dB / 20), latency: 63 })
			short ||= Math.max(r.tone, r.square, dB === 0 ? Math.max(r.impulse, r.dc) : 0) > Math.max(128, Math.ceil(T)) || dB === 0 && r.short
			longest = Math.max(longest, r.tone, r.square, dB === 0 ? r.longest : 0)
		}
		if (short) bad.push(`${JSON.stringify(set)} at ${fs}: tail ${Math.round(T)} frames, longest ring ${longest}`)
		if (longest > 128) { worst = Math.max(worst, T / longest); over += T > 1.5 * longest }
		n++
	}
	ok(!bad.length, `dyneq: ${n} settings, never short; tail at most ${worst.toFixed(2)} of the longest ring, over 1.5 at ${over}${bad.length ? `; short at ${bad.length}: ${bad[0]}` : ''}`)
})

// dyneq's mode: a switch moves the output from the old mode's band to the new one's over 20 ms (the band's gain flips
// sign, and its halving each block would step the output at once). Through a 0.5 tone at 300 Hz with the band cutting
// 12 dB, at instants on and off the 64-frame grid, the host's calls cut at the change: the largest second difference
// from the change on, against the louder of the two modes' steady outputs (a switch back passes through the louder),
// under 1.5; a switch back 5 ms into the fade likewise; the same samples in calls of 1, 7 and 1024
test('dyneq audio.js – a new mode fades: no step, and the same whatever the calls', () => {
	let fs = 44100, N = 2 * fs, x = Float32Array.from({ length: N }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 300 * i / fs))
	let d2 = (y, a, b) => { let m = 0; for (let i = Math.max(a, 2); i < b; i++) m = Math.max(m, Math.abs(y[i] - 2 * y[i - 1] + y[i - 2])); return m }
	// x in calls of `size` frames, cut at each mark, the mode at a frame the last mark's at or before it
	let run = (marks, size) => {
		let p = dyneq({ sampleRate: fs, maxBlockSize: 1024, maxChannels: 1, params: live(dyneq, { fc: 300 }), buffers: {} }), y = new Float32Array(N), pos = 0
		while (pos < N) {
			let next = marks.map(([f]) => f).find(f => f > pos) ?? N, mode = marks.filter(([f]) => f <= pos).at(-1)?.[1] ?? 'down', n = Math.min(size, next - pos)
			p([[x.subarray(pos, pos + n)]], [[y.subarray(pos, pos + n)]], live(dyneq, { fc: 300, mode }))
			pos += n
		}
		return y
	}
	let loud = Math.max(d2(run([], 128), 20000, 30000), d2(run([[0, 'up']], 128), 20000, 30000))
	for (let marks of [[[9001, 'up']], [[13056, 'up']], [[17011, 'up'], [17231, 'down']]]) {
		let at = marks[0][0], label = marks.map(([f, m]) => `${m} at ${f}`).join(', '), y = run(marks, 128), most = d2(y, at - 64, at + 30000) / loud
		ok(most < 1.5, `down → ${label}: x${most.toFixed(2)} from the change on`)
		for (let size of [1, 7, 1024]) ok(run(marks, size).every((v, i) => Object.is(v, y[i])), `down → ${label}: calls of ${size} frames give the same, bit for bit`)
	}
})

// Values moving every call (dyneq's mode every 16) and at fixed values, and a second instance made after the first ran.
// Each retune writes its sections by @audio/biquad's arithmetic in the package, so no number crosses a design call and
// no design returns a new section, whichever @audio/biquad is installed
test('eq audio.js – process() allocates nothing, warm, its values moving every call or fixed; nor a second instance made after the first ran', { timeout: 120000 }, async () => {
	let file = pkg => fileURLToPath(new URL(`./packages/${pkg}/audio.js`, import.meta.url))
	for (let [pkg, name] of [['eq-graphic', 'geq'], ['eq-dynamic', 'dyneq'], ['eq-baxandall', 'baxandall'], ['eq-tilt', 'tilt']])
		for (let how of ['moving', 'fixed', 'second', 'second-fixed']) is(await collections(file(pkg), name, how), 0, `${name}, ${how}: no collection in 2^17 blocks of 8 frames`)
})
