import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkMicrophoneEnvironment, checkMicrophonePermission } from '../../../src/modules/m1-speech-recognition/microphone'

afterEach(() => vi.unstubAllGlobals())
describe('microphone capability and permission preflight', () => {
  it('rejects missing capture APIs with browser and secure connection guidance', () => {
    vi.stubGlobal('navigator', {})
    expect(checkMicrophoneEnvironment).toThrow(expect.objectContaining({ code: 'NOT_SUPPORTED', message: expect.stringContaining('HTTPS') }))
  })
  it('accepts a browser secure context such as HTTPS or localhost', () => {
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } })
    expect(checkMicrophoneEnvironment).not.toThrow()
  })
  it.each(['missing', 'throws', 'rejects', 'prompt', 'granted'])('falls back to native recognition for permission query %s', async kind => {
    const query = kind === 'throws' ? () => { throw new TypeError('Unsupported permission') }
      : kind === 'rejects' ? () => Promise.reject(new TypeError('Unsupported permission'))
        : () => Promise.resolve({ state: kind })
    vi.stubGlobal('navigator', kind === 'missing' ? {} : { permissions: { query } })
    await expect(Promise.resolve(checkMicrophonePermission())).resolves.toBeUndefined()
  })
})
