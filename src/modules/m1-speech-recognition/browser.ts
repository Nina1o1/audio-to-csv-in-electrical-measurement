// Narrow structural types avoid depending on browser-specific ambient SpeechRecognition declarations.
export interface CommandRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  start(): void
  abort(): void
}

export function commandRecognition(): CommandRecognition {
  const browser = globalThis as typeof globalThis & {
    SpeechRecognition?: new () => CommandRecognition
    webkitSpeechRecognition?: new () => CommandRecognition
  }
  const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition
  if (!Constructor) throw { code: 'NOT_SUPPORTED', message: '当前浏览器不支持语音命令监听。' }
  const recognition = new Constructor()
  recognition.lang = 'zh-CN'
  recognition.continuous = true
  recognition.interimResults = true
  return recognition
}

/** Only a same-origin proxy is allowed; browser configuration contains no vendor credentials. */
export function proxySocket(path: string): WebSocket {
  const url = new URL(path, globalThis.location.href)
  if (url.origin !== globalThis.location.origin || url.username || url.password || url.search || url.hash) {
    throw new Error('Speech proxy must be a same-origin path without credentials.')
  }
  if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.protocol = 'ws:'
  else throw new Error('Speech requires HTTPS.')
  return new WebSocket(url)
}
