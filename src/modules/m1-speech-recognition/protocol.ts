import type { VoiceCommand } from '../../contracts/m1-speech-recognition'

const commands: Readonly<Record<string, VoiceCommand>> = {
  开始输入: 'START_INPUT', 结束输入: 'STOP_INPUT', 结束录入: 'STOP_INPUT',
  保存: 'SAVE', 确认保存: 'CONFIRM_SAVE', 修改: 'MODIFY',
  删除: 'DELETE', 确认删除: 'CONFIRM_DELETE', 保留: 'KEEP',
}

export function commandOf(text: string): VoiceCommand | undefined {
  const phrase = text.trim().replace(/[，。！？；,.!?;]+$/u, '').trim()
  return Object.hasOwn(commands, phrase) ? commands[phrase] : undefined
}

/** Keep an incomplete stop phrase out of display snapshots and the final segment. */
export function recordingText(text: string, final: boolean): { text: string; stop: boolean } {
  // An append-only chunk is not necessarily an utterance. Require punctuation or a real end.
  const pattern = new RegExp(`(^|[，。！？；,.!?;\\n])\\s*(结束输入|结束录入)\\s*(?=[，。！？；,.!?;\\n]${final ? '|$' : ''})`, 'u')
  const match = pattern.exec(text)
  if (match) return { text: text.slice(0, match.index).trim(), stop: true }
  if (!final) {
    const tail = /(^|[，。！？；,.!?;\n])(\s*(?:结|结束|结束输|结束录|结束输入|结束录入))\s*$/u.exec(text)
    if (tail) return { text: text.slice(0, tail.index).trimEnd(), stop: false }
  }
  return { text: text.trim(), stop: false }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid speech response.')
  return value as Record<string, unknown>
}

export interface IatResult {
  status: 0 | 1 | 2
  ended: boolean
  result?: { sn: number; text: string; replacement?: readonly [number, number]; dynamic: boolean }
}

/** Validate external JSON before it can alter text. Never propagate server messages (may contain secrets). */
export function decodeIat(raw: unknown): IatResult {
  if (typeof raw !== 'string' || raw.length > 262_144) throw new Error('Invalid speech response.')
  const root = object(JSON.parse(raw) as unknown)
  if (root.code !== 0) throw new Error('Speech service rejected the session.')
  const data = object(root.data)
  if (data.status !== 0 && data.status !== 1 && data.status !== 2) throw new Error('Invalid speech status.')
  if (data.result === undefined) return { status: data.status, ended: data.status === 2 }
  const result = object(data.result)
  if (!Number.isSafeInteger(result.sn) || Number(result.sn) < 0 || !Array.isArray(result.ws)) {
    throw new Error('Invalid speech result.')
  }
  let text = ''
  for (const word of result.ws) {
    const candidates = object(word).cw
    if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('Invalid speech word.')
    const value = object(candidates[0]).w
    if (typeof value !== 'string') throw new Error('Invalid speech word.')
    text += value
  }
  let replacement: readonly [number, number] | undefined
  if (result.pgs === 'rpl') {
    const range = result.rg
    if (!Array.isArray(range) || range.length !== 2 || !range.every(n => Number.isSafeInteger(n) && n >= 0)
      || range[0] > range[1]) throw new Error('Invalid replacement range.')
    replacement = [Number(range[0]), Number(range[1])]
  } else if (result.pgs !== undefined && result.pgs !== 'apd') throw new Error('Invalid replacement mode.')
  return {
    status: data.status, ended: data.status === 2,
    result: { sn: Number(result.sn), text, replacement, dynamic: result.pgs !== undefined },
  }
}

/** Physical-session text only. Unexpected dynamic results stay interim until the final frame. */
export class IatText {
  private results = new Map<number, NonNullable<IatResult['result']>>()
  private seen = new Map<number, string>()
  private dynamic = false
  private final = false

  accept(message: IatResult): boolean {
    if (this.final) return false
    const result = message.result
    let changed = false
    if (result) {
      const signature = JSON.stringify(result)
      const previous = this.seen.get(result.sn)
      if (previous !== undefined && previous !== signature) throw new Error('Conflicting result sequence.')
      if (previous === undefined) {
        if (result.dynamic && !this.dynamic && [...this.results.values()].some(value => value.text)) {
          throw new Error('Unexpected change to mutable recognition mode.')
        }
        this.seen.set(result.sn, signature)
        this.results.set(result.sn, result)
        this.dynamic ||= result.dynamic
        changed = true
      }
    }
    this.final = message.ended
    return changed || message.ended
  }

  snapshot(): { confirmedText: string; interimText: string } {
    // A missing sequence may arrive later. Do not execute a command on a reordered suffix.
    // Replay by sequence, not arrival order: a delayed old result must not resurrect replaced text.
    const pieces = new Map<number, string>()
    for (const [sn, result] of [...this.results].sort(([a], [b]) => a - b)) {
      if (result.replacement) {
        for (const key of pieces.keys()) {
          if (key >= result.replacement[0] && key <= result.replacement[1]) pieces.delete(key)
        }
      }
      pieces.set(sn, result.text)
    }
    const text = [...pieces.values()].join('')
    const keys = [...this.seen.keys()].sort((a, b) => a - b)
    // IAT deployments/demos use both zero- and one-based sequence starts.
    const base = keys[0] === 0 ? 0 : 1
    const gapIndex = keys.findIndex((key, index) => key !== index + base)
    if (this.final && gapIndex !== -1) throw new Error('Incomplete speech results.')
    if (this.dynamic && !this.final) return { confirmedText: '', interimText: text }
    // A later gap cannot revoke an already confirmed prefix, especially on interruption.
    const missing = gapIndex === -1 ? Infinity : base + gapIndex
    let confirmedText = '', interimText = ''
    for (const [sn, value] of pieces) {
      if (sn < missing) confirmedText += value
      else interimText += value
    }
    return { confirmedText, interimText }
  }
}

export function audioFrame(pcm: Uint8Array, first: boolean): string {
  let bytes = ''
  for (const byte of pcm) bytes += String.fromCharCode(byte)
  return JSON.stringify({
    // APPID and all business parameters are set by the trusted proxy, never by the page.
    data: { status: first ? 0 : 1, format: 'audio/L16;rate=16000', encoding: 'raw', audio: btoa(bytes) },
  })
}
