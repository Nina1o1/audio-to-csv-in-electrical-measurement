import { reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useManualWorkflow } from '../../src/app/useManualWorkflow'
import { createSpeechRecognition } from '../../src/modules/m1-speech-recognition'
import { captureAudio } from '../../src/modules/m1-speech-recognition/audio'
import { createTextParser } from '../../src/modules/m2-text-parser'

vi.mock('../../src/modules/m1-speech-recognition/audio', () => ({ captureAudio: vi.fn() }))
class Commands {
  static instances: Commands[] = []
  lang = ''; continuous = false; interimResults = false
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onresult: ((event: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null
  start() {}
  abort() {}
  constructor() { Commands.instances.push(this) }
  result(text: string) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }) }
}
class Socket {
  static instances: Socket[] = []
  bufferedAmount = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn()
  constructor() { Socket.instances.push(this) }
  result(text: string, sn: number, status: number) {
    this.onmessage?.({ data: JSON.stringify({ code: 0, data: { status, result: { sn, ws: [{ cw: [{ w: text }] }] } } }) })
  }
}
const currentCommand = () => Commands.instances.at(-1)!
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
let dispose: (() => void) | undefined

afterEach(() => { dispose?.(); dispose = undefined; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('real M1 → App → M2 → M3, with browser/audio boundaries replaced', () => {
  it.each(['natural', 'voice-stop', 'interrupted', 'offline'] as const)('merges exactly once on %s completion without nested mutations', async ending => {
    vi.useFakeTimers(); Commands.instances = []; Socket.instances = []
    vi.stubGlobal('SpeechRecognition', Commands); vi.stubGlobal('WebSocket', Socket)
    vi.stubGlobal('location', { href: 'https://inspection.example/', origin: 'https://inspection.example' })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    const network = new EventTarget()
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('addEventListener', network.addEventListener.bind(network))
    const removeOffline = vi.fn(network.removeEventListener.bind(network))
    vi.stubGlobal('removeEventListener', removeOffline)
    const stopAudio = vi.fn()
    let frame!: (data: Uint8Array) => void
    vi.mocked(captureAudio).mockImplementation(async (_abort, send, _fault, prepared) => {
      frame = send; prepared?.(() => undefined); return { stop: stopAudio }
    })
    const parser = createTextParser(), parse = vi.spyOn(parser, 'parse')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ui = reactive(useManualWorkflow({ speechRecognition: createSpeechRecognition(), textParser: parser }))
    dispose = ui.dispose; ui.initialize(); ui.updateField('workOrder', 'MANUAL')
    const listening = ui.toggleListening(); currentCommand().onstart?.(); await listening
    currentCommand().result('开始输入'); await flush()
    const socket = Socket.instances[0]!
    socket.onopen?.(); frame(new Uint8Array(1280))
    socket.result('接触电阻0.012欧姆，', 0, 1)
    expect(parse).not.toHaveBeenCalled(); expect(ui.draft.contactResistance).toBeNull()
    if (ending === 'voice-stop') {
      socket.result('结束输入。', 1, 1)
      await flush(); socket.result('', 2, 2)
    } else if (ending === 'natural') socket.result('', 1, 2)
    else if (ending === 'offline') network.dispatchEvent(new Event('offline'))
    else socket.onerror?.()
    const failed = ending === 'interrupted' || ending === 'offline'
    if (!failed) currentCommand().onstart?.()
    await flush()
    expect(ui.draft).toMatchObject({ workOrder: 'MANUAL', contactResistance: 12 })
    expect(parse).toHaveBeenCalledOnce(); expect(report).not.toHaveBeenCalled()
    expect(stopAudio).toHaveBeenCalledOnce()
    expect(ui.microphone).toBe(failed ? 'IDLE' : 'LISTENING')
    if (ending === 'offline') {
      expect(ui.speechError).toContain('网络已断开')
      expect(ui.editable).toBe(true)
      ui.updateField('partNumber', 'AFTER-OFFLINE')
      expect(ui.draft.partNumber).toBe('AFTER-OFFLINE')
      expect(removeOffline).toHaveBeenCalledOnce()
    }
    else if (ending === 'interrupted') expect(ui.speechError).toContain('中断')
    else expect(ui.speechError).toBe('')
    ui.dispose(); expect(vi.getTimerCount()).toBe(0)
  })
})
