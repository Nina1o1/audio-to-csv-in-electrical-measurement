import { m1DiagnosticsEnabled, type Diagnostic } from './debug'

type Times = { T1?: number; T2?: number; T3?: number; T4?: number; T5?: number; T6?: number }
type Dispatch = { trace: Diagnostic; index: number; times: Times }
// Only set during synchronous notification; App captures it before its existing microtask.
let dispatch: Dispatch | undefined
const delta = (end: number | undefined, start: number | undefined) =>
  end === undefined || start === undefined ? undefined : end - start

export function captureStartInputTiming(): (() => void) | undefined {
  const current = dispatch
  if (!current) return
  const receivedAtMs = performance.now()
  return () => {
    const T7 = performance.now()
    current.trace('command-timing', {
      point: 'T7', index: current.index, atMs: T7,
      dispatchToReceiptMs: delta(receivedAtMs, current.times.T6),
      receiptToHandlingMs: T7 - receivedAtMs,
      t6ToT7Ms: delta(T7, current.times.T6),
    })
  }
}

/** Opt-in observation only: no retained text, timers, observers or command decisions. */
export function commandTiming(trace: Diagnostic) {
  if (!m1DiagnosticsEnabled()) return
  let onset: Times = {}
  const results = new Map<number, Times>()
  function mark(times: Times, point: keyof Times, atMs: number, index?: number) {
    if (times[point] !== undefined) return
    times[point] = atMs
    trace('command-timing', { point, index, atMs })
  }
  return {
    sound() {
      onset = {}
      mark(onset, 'T1', performance.now())
    },
    speech() {
      // Some engines omit soundstart between utterances. Do not reuse an old speech onset.
      if (onset.T2 !== undefined) onset = {}
      mark(onset, 'T2', performance.now())
    },
    result(index: number, text: string, final: boolean, atMs: number) {
      let times = results.get(index)
      if (!times) { times = { ...onset }; results.set(index, times) }
      mark(times, 'T3', atMs, index)
      if (text.includes('开始输入')) mark(times, final ? 'T5' : 'T4', atMs, index)
    },
    emit(index: number, notify: () => void) {
      const times = results.get(index) ?? {}
      mark(times, 'T6', performance.now(), index)
      trace('command-latency', {
        index, ...times,
        t2ToT3Ms: delta(times.T3, times.T2),
        t3ToT5Ms: delta(times.T5, times.T3),
        t5ToT6Ms: delta(times.T6, times.T5),
      })
      const previous = dispatch
      dispatch = { trace, index, times }
      try { notify() } finally { dispatch = previous }
    },
  }
}
