import type { SpeechError } from '../../contracts/m1-speech-recognition'

export const permissionDenied: SpeechError = {
  code: 'PERMISSION_DENIED',
  message: '麦克风权限未开启，请在浏览器的网站设置中允许使用麦克风，然后重试。若仍无法访问，请检查操作系统隐私权限或联系管理员检查网站策略。',
}
export const microphoneUnavailable: SpeechError = {
  code: 'MICROPHONE_UNAVAILABLE',
  message: '无法访问麦克风，请检查设备连接和操作系统麦克风隐私权限，关闭可能占用麦克风的应用后重试。',
}

/** Check capabilities without requesting permission or opening an audio stream. */
export function checkMicrophoneEnvironment(): void {
  if (globalThis.isSecureContext === false) {
    throw { code: 'NOT_SUPPORTED', message: '当前页面不是安全连接，无法使用麦克风。请通过 HTTPS 或本机 localhost 地址访问后重试。' } satisfies SpeechError
  }
  if (typeof globalThis.navigator?.mediaDevices?.getUserMedia !== 'function') {
    throw { code: 'NOT_SUPPORTED', message: '当前浏览器或环境不支持麦克风访问，请使用支持麦克风的浏览器，并通过 HTTPS 或本机 localhost 地址访问。' } satisfies SpeechError
  }
  const page = globalThis.document as (Document & {
    permissionsPolicy?: { allowsFeature(feature: string): boolean }
    featurePolicy?: { allowsFeature(feature: string): boolean }
  }) | undefined
  const policy = page?.permissionsPolicy ?? page?.featurePolicy
  if (policy && !policy.allowsFeature('microphone')) {
    throw { code: 'MICROPHONE_UNAVAILABLE', message: '当前网站的安全策略禁止访问麦克风，请联系管理员允许麦克风访问后重试。' } satisfies SpeechError
  }
}

/** Unsupported Permissions API is inconclusive; the native engine remains authoritative. */
export function checkMicrophonePermission(): Promise<void> | undefined {
  const permissions = globalThis.navigator?.permissions
  if (typeof permissions?.query !== 'function') return
  try {
    return permissions.query({ name: 'microphone' as PermissionName }).then(status => {
      if (status.state === 'denied') throw { ...permissionDenied }
    }, () => undefined)
  } catch { return }
}

export function microphoneError(error: unknown): SpeechError {
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : ''
  if (name === 'NotAllowedError') return { ...permissionDenied }
  if (name === 'NotFoundError') return { code: 'MICROPHONE_UNAVAILABLE', message: '未检测到可用麦克风，请检查设备连接后重试。' }
  if (name === 'SecurityError') return { code: 'MICROPHONE_UNAVAILABLE', message: '麦克风访问受到系统或网站安全策略限制，请检查操作系统隐私权限，或联系管理员后重试。' }
  if (name === 'OverconstrainedError') return { code: 'MICROPHONE_UNAVAILABLE', message: '麦克风不满足音频采集要求，请检查设备设置或更换麦克风后重试。' }
  if (name === 'NotReadableError' || name === 'AbortError') return { ...microphoneUnavailable }
  return { code: 'RECOGNITION_FAILED', message: '浏览器音频采集启动失败，请检查浏览器音频功能后重试。' }
}

export function commandError(reason: string): SpeechError {
  if (reason === 'not-allowed') return { ...permissionDenied }
  if (reason === 'audio-capture') return { code: 'MICROPHONE_UNAVAILABLE', message: '未检测到可用麦克风，请检查设备连接后重试。若设备已连接，请检查操作系统麦克风隐私权限，并关闭可能占用设备的应用。' }
  if (reason === 'service-not-allowed') return { code: 'RECOGNITION_FAILED', message: '浏览器禁止使用当前语音识别服务，请检查浏览器语音服务设置或使用支持该服务的浏览器后重试。' }
  if (reason === 'language-not-supported') return { code: 'NOT_SUPPORTED', message: '当前浏览器语音服务不支持中文识别，请使用支持中文语音识别的浏览器后重试。' }
  return { code: 'RECOGNITION_FAILED', message: reason === 'network'
    ? '浏览器语音识别服务连接失败，请检查网络后重试。'
    : '浏览器语音命令监听失败，请重试。' }
}
