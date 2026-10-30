import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureStartInputTiming, commandTiming } from '../../../src/modules/m1-speech-recognition/command-timing'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('opt-in command latency observation', () => {
  function setup() {
    vi.stubEnv('DEV', true)
    vi.stubGlobal('location', { search: '?m1Debug=1' })
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const trace = vi.fn()
    return { timing: commandTiming(trace)!, trace, at: (value: number) => { now = value } }
  }

  it('measures result confirmation separately from dispatch and the App microtask', () => {
    const { timing, trace, at } = setup()
    timing.sound(); at(10); timing.speech()
    timing.result(0, '开始', false, 40)
    timing.result(0, '开始输入', false, 80)
    timing.result(0, '开始输入。', true, 500)
    timing.result(0, '开始输入。', true, 501)
    at(502)
    let handled: (() => void) | undefined
    timing.emit(0, () => { at(503); handled = captureStartInputTiming() })
    expect(captureStartInputTiming()).toBeUndefined()
    at(508); handled?.()
    expect(trace).toHaveBeenCalledWith('command-latency', {
      index: 0, T1: 0, T2: 10, T3: 40, T4: 80, T5: 500, T6: 502,
      t2ToT3Ms: 30, t3ToT5Ms: 460, t5ToT6Ms: 2,
    })
    expect(trace).toHaveBeenLastCalledWith('command-timing', {
      point: 'T7', index: 0, atMs: 508,
      dispatchToReceiptMs: 1, receiptToHandlingMs: 5, t6ToT7Ms: 6,
    })
    expect(trace.mock.calls.filter(([event, fields]) => event === 'command-timing' && fields.point === 'T5')).toHaveLength(1)
    expect(JSON.stringify(trace.mock.calls)).not.toMatch(/开始|输入/)
  })

  it('allows absent events and final-only results without fabricating zero durations', () => {
    const { timing, trace, at } = setup()
    timing.result(0, '开始输入', true, 100)
    at(101); timing.emit(0, () => undefined)
    expect(trace).toHaveBeenLastCalledWith('command-latency', {
      index: 0, T3: 100, T5: 100, T6: 101,
      t2ToT3Ms: undefined, t3ToT5Ms: 0, t5ToT6Ms: 1,
    })
  })

  it('keeps separate result indices and does not reuse speechstart when soundstart is absent', () => {
    const { timing, trace, at } = setup()
    at(10); timing.speech(); timing.result(0, '其他', true, 20)
    at(50); timing.speech(); timing.result(1, '开始输入', true, 80)
    at(81); timing.emit(1, () => undefined)
    expect(trace).toHaveBeenLastCalledWith('command-latency', expect.objectContaining({
      index: 1, T2: 50, T3: 80, t2ToT3Ms: 30,
    }))
  })

  it('restores diagnostic context when a notification throws', () => {
    const { timing } = setup()
    expect(() => timing.emit(0, () => { throw new Error('subscriber') })).toThrow('subscriber')
    expect(captureStartInputTiming()).toBeUndefined()
  })

  it('allocates no observation when disabled, including a normal production build', () => {
    vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production')
    vi.stubGlobal('location', { search: '?m1Debug=1' })
    const trace = vi.fn()
    expect(commandTiming(trace)).toBeUndefined()
    expect(trace).not.toHaveBeenCalled()
  })
})
