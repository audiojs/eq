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

/** Chainable-host options for 'dyneq' */
export interface DyneqOptions {
  /** 40..16000 Hz (default 6000) */
  "fc"?: Auto
  /** 0.3..20 (default 2) */
  "Q"?: Auto
  /** -60..0 dB (default -30) */
  "threshold"?: Auto
  /** 1..20 (default 3) */
  "ratio"?: Auto
  /** 0.5..100 ms (default 5) */
  "attack"?: Auto
  /** 10..1000 ms (default 80) */
  "release"?: Auto
  /** 0..24 dB (default 12) */
  "maxGain"?: Auto
  /** default "down" */
  "mode"?: "down" | "up"
  at?: number | string
  duration?: number | string
}

export declare const dyneq: {
  (ctx: Ctx): Process
  channels: "any"
  latency: 63
  tail: (at: { sampleRate: number, params: Live, buffers?: {}, transport: Transport }) => number
  params: {
    /** 40..16000 Hz (default 6000) */
    "fc": { type: "number", min: 40, max: 16000, default: 6000, unit: "Hz", curve: "log", smoothing: 0.02 }
    /** 0.3..20 (default 2) */
    "Q": { type: "number", min: 0.3, max: 20, default: 2, curve: "log" }
    /** -60..0 dB (default -30) */
    "threshold": { type: "number", min: -60, max: 0, default: -30, unit: "dB" }
    /** 1..20 (default 3) */
    "ratio": { type: "number", min: 1, max: 20, default: 3 }
    /** 0.5..100 ms (default 5) */
    "attack": { type: "number", min: 0.5, max: 100, default: 5, unit: "ms" }
    /** 10..1000 ms (default 80) */
    "release": { type: "number", min: 10, max: 1000, default: 80, unit: "ms" }
    /** 0..24 dB (default 12) */
    "maxGain": { type: "number", min: 0, max: 24, default: 12, unit: "dB" }
    /** default "down" */
    "mode": { type: "enum", values: ["down","up"], default: "down" }
  }
}
