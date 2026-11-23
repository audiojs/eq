// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/plugin. Do not edit by hand.

/** Automatable number — scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Transport = Readonly<{ playing: boolean, bpm: number, beat: number, barStart: number, timeSig: [number, number] }>
/** What a host hands a processor it builds: the contract's Context (CONTRACT.d.ts, 1.0) */
type Ctx = { readonly sampleRate: number, readonly maxBlockSize: number, readonly maxChannels: number, readonly layouts?: { readonly inputs: readonly (string | undefined)[], readonly outputs: readonly (string | undefined)[] }, readonly params: Live, readonly buffers: Readonly<Record<string, Float32Array[] | undefined>>, readonly events?: readonly { time: number, kind: 'on' | 'off', midi: number, velocity: number, id: number }[], emit(name: string, value: number): void, readonly transport: Transport }
type Process = (inputs: Float32Array[][], outputs: Float32Array[][], params: Live) => void

/** Chainable-host options for 'baxandall' */
export interface BaxandallOptions {
  /** -15..15 dB (default 0) */
  "bass"?: Auto
  /** -15..15 dB (default 0) */
  "treble"?: Auto
  /** 60..1000 Hz (default 250) */
  "fBass"?: Auto
  /** 1000..12000 Hz (default 4000) */
  "fTreble"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const baxandall: {
  (ctx: Ctx): Process
  channels: "any"
  tail: (at: { sampleRate: number, params: Live, buffers?: {}, transport: Transport }) => number
  params: {
    /** -15..15 dB (default 0) */
    "bass": { type: "number", min: -15, max: 15, default: 0, unit: "dB", smoothing: 0.02 }
    /** -15..15 dB (default 0) */
    "treble": { type: "number", min: -15, max: 15, default: 0, unit: "dB", smoothing: 0.02 }
    /** 60..1000 Hz (default 250) */
    "fBass": { type: "number", min: 60, max: 1000, default: 250, unit: "Hz", curve: "log", smoothing: 0.02 }
    /** 1000..12000 Hz (default 4000) */
    "fTreble": { type: "number", min: 1000, max: 12000, default: 4000, unit: "Hz", curve: "log", smoothing: 0.02 }
  }
}
