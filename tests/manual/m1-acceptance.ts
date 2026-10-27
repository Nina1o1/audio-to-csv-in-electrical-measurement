import { createSpeechRecognition } from '../../src/modules/m1-speech-recognition'
import type { SpeechRecognitionModule } from '../../src/contracts/m1-speech-recognition'

function element<T extends HTMLElement>(id: string, constructor: new (...args: never[]) => T): T {
  const value = document.getElementById(id)
  if (!(value instanceof constructor)) throw new Error(`Missing acceptance control: ${id}`)
  return value
}
const state = element('state', HTMLElement)
const events = element('events', HTMLElement)
const confirmed = element('confirmed', HTMLElement)
const interim = element('interim', HTMLElement)
const complete = element('complete', HTMLElement)
const lastCommand = element('command', HTMLElement)
const lastError = element('error', HTMLElement)
const password = element('password', HTMLInputElement)
const auth = element('auth', HTMLElement)
const route = element('route', HTMLInputElement)
const environment = element('environment', HTMLElement)
const transport = element('transport', HTMLElement)
environment.textContent = `环境：${navigator.userAgent}；安全上下文：${window.isSecureContext}；来源：${location.origin}`

type Entry = { instance: number; sequence: number; atMs: number; timestamp: string; kind: string; payload: unknown }
let entries: Entry[] = []
let sequence = 0, instance = 0
let speech: SpeechRecognitionModule | undefined
let subscriptions: (() => void)[] = []

function log(kind: string, payload: unknown, owner = instance): void {
  entries.push({ instance: owner, sequence: ++sequence, atMs: performance.now(), timestamp: new Date().toISOString(), kind, payload })
  if (entries.length > 500) entries.shift()
  events.textContent = JSON.stringify(entries, null, 2)
}

const nativeDebug = console.debug
console.debug = (...args: unknown[]) => {
  nativeDebug(...args)
  if (args[0] === '[M1]') log('m1-diagnostic', args[1])
}

// Manual-only metadata trace. Preserve native transport behavior; never log URLs,
// headers, audio, or raw responses. Public M1 events alone cannot locate a physical-session gap.
const NativeWebSocket = window.WebSocket
let connection = 0
window.WebSocket = class extends NativeWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols)
    const target = new URL(url, location.href)
    if (target.host !== location.host || target.pathname !== '/api/m1/iat') return
    const id = ++connection, owner = instance, started = performance.now()
    let sent = 0
    const report = (kind: string, details: object = {}) => log(kind, {
      connection: id, elapsedMs: Math.round(performance.now() - started), ...details,
    }, owner)
    const send = this.send.bind(this)
    this.send = data => {
      send(data)
      if (++sent === 1) report('iat-first-send')
    }
    transport.textContent = `连接 ${id} 建立中，请等待`
    report('iat-connect')
    this.addEventListener('open', () => {
      if (id === connection) transport.textContent = `连接 ${id} 已就绪，可以讲话`
      report('iat-open')
    }, { once: true })
    this.addEventListener('message', event => {
      try {
        const value: unknown = JSON.parse(typeof event.data === 'string' ? event.data : '')
        if (typeof value !== 'object' || value === null) return
        const data = 'data' in value ? value.data : undefined
        report('iat-response', {
          code: 'code' in value && typeof value.code === 'number' ? value.code : undefined,
          status: typeof data === 'object' && data !== null && 'status' in data && typeof data.status === 'number'
            ? data.status : undefined,
        })
      } catch { report('iat-invalid-response') }
    })
    this.addEventListener('close', event => {
      if (id === connection) transport.textContent = `连接 ${id} 已关闭`
      report('iat-close', { closeCode: event.code, sentMessages: sent, bufferedBytes: this.bufferedAmount })
    }, { once: true })
    this.addEventListener('error', () => report('iat-error'), { once: true })
  }
}
function release(): void {
  speech?.stopListening()
  for (const unsubscribe of subscriptions) unsubscribe()
  subscriptions = []; speech = undefined
  state.textContent = '实例已释放；通过网络面板和浏览器麦克风指示检查资源关闭。'
}
function create(): void {
  release(); instance++
  const owner = instance, current = createSpeechRecognition()
  speech = current
  confirmed.textContent = ''; interim.textContent = ''; complete.textContent = ''
  lastCommand.textContent = '暂无'; lastError.textContent = '暂无'
  state.textContent = current.getState()
  subscriptions = [
    current.onStateChange(value => {
      state.textContent = value
      if (value === 'RECORDING') {
        confirmed.textContent = ''; interim.textContent = ''; complete.textContent = ''
      }
      log('state', value, owner)
    }),
    current.onCommand(command => {
      lastCommand.textContent = command
      log('command', command, owner)
      if (route.checked) queueMicrotask(() => {
        if (speech !== current) return
        if (command === 'START_INPUT' && current.getState() === 'LISTENING') current.startRecording()
        if (command === 'STOP_INPUT' && current.getState() === 'RECORDING') current.stopRecording()
      })
    }),
    current.onTranscriptUpdate(value => {
      confirmed.textContent = value.confirmedText; interim.textContent = value.interimText
      log('update', { confirmedLength: value.confirmedText.length, interimLength: value.interimText.length }, owner)
    }),
    current.onTranscriptComplete(value => { complete.textContent = value.text; log('complete', { confirmedLength: value.text.length }, owner) }),
    current.onError(value => {
      lastError.textContent = `${value.code}：${value.message}`
      log('error', value, owner)
    }),
  ]
  log('instance-created', { state: current.getState() }, owner)
}
function click(id: string, action: () => void): void {
  element(id, HTMLButtonElement).addEventListener('click', action)
}
click('listen', () => {
  const current = speech, owner = instance
  if (!current) return
  log('start-request', null)
  void current.startListening().then(() => log('start-resolved', null, owner))
    .catch((error: unknown) => log('start-rejected', error, owner))
})
click('close', () => { log('stop-listening-request', null); speech?.stopListening() })
click('record', () => { log('start-recording-request', null); speech?.startRecording() })
click('stop', () => { log('stop-recording-request', null); speech?.stopRecording() })
click('recreate', create)
click('dispose', release)
click('clear', () => { entries = []; events.textContent = '' })
click('copy', () => {
  void navigator.clipboard.writeText(JSON.stringify({ environment: environment.textContent, entries }, null, 2))
    .catch(() => log('copy-unavailable', '请手动复制事件记录。'))
})

let authenticating = false
async function authenticate(path: 'login' | 'logout'): Promise<void> {
  if (authenticating) return
  authenticating = true
  const body = path === 'login' ? JSON.stringify({ password: password.value }) : undefined
  password.value = ''
  try {
    const result = await fetch(`/api/m1/${path}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body,
    })
    auth.textContent = `${path} HTTP ${result.status}；${result.ok ? '成功' : '未成功，请检查安全代理配置。'}`
  } catch { auth.textContent = '代理请求失败，请检查 HTTPS、同源路由与网络。' }
  finally { authenticating = false }
}
click('login', () => { void authenticate('login') })
click('logout', () => { release(); void authenticate('logout') })
window.addEventListener('pagehide', () => { release(); window.WebSocket = NativeWebSocket; console.debug = nativeDebug })
create()
