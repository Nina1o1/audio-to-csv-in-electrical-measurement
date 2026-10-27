import { afterEach, describe, expect, it, vi } from 'vitest'
import { m1Diagnostic } from '../../../src/modules/m1-speech-recognition/debug'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('M1 development diagnostics', () => {
  it.each([
    [false, 'production', '?m1Debug=1'],
    [true, 'development', ''],
  ] as const)('stays silent with DEV=%s, mode=%s, query=%s', (dev, mode, search) => {
    vi.stubEnv('DEV', dev); vi.stubEnv('MODE', mode); vi.stubGlobal('location', { search })
    const log = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    m1Diagnostic()('recording-requested')
    expect(log).not.toHaveBeenCalled()
  })
  it('supports the explicit local debug build and isolates logging failures', () => {
    vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'm1-debug')
    vi.stubGlobal('location', { search: '?m1Debug=1' })
    const log = vi.spyOn(console, 'debug').mockImplementation(() => { throw new Error('console unavailable') })
    expect(() => m1Diagnostic()('recording-requested')).not.toThrow()
    expect(log).toHaveBeenCalledOnce()
  })
})
