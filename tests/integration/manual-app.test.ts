import { createRenderer, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App.vue'
import type { InspectionRecord } from '../../src/shared/data-models'
import * as speechModule from '../../src/modules/m1-speech-recognition'
import { mockSpeech } from '../helpers/mock-speech'

// A small Vue renderer host exercises the actual SFC events/lifecycle without a new DOM dependency.
// It models only the input values, tree operations and dialog methods these components use.
class Element {
  parent: Element | null = null
  children: Element[] = []
  props: Record<string, unknown> = {}
  text = ''
  value = ''
  listeners: Record<string, EventListener> = {}
  constructor(readonly tag: string) {}
  get type() { return this.props.type }
  get valueAsNumber() { return this.value === '' ? NaN : Number(this.value) }
  get options() { return this.children.filter(child => child.tag === 'option') }
  get textContent(): string { return this.tag === '#comment' ? '' : this.text + this.children.map(child => child.textContent).join('') }
  showModal() {}
  showPopover() {}
  hidePopover() {}
  close() {}
  focus() {}
  addEventListener(event: string, listener: EventListener) { this.listeners[event] = listener }
  removeEventListener(event: string) { delete this.listeners[event] }
  matches(selector: string) { return selector === ':disabled' && this.props.disabled !== undefined && this.props.disabled !== false }
  querySelectorAll() { return [] }
}
class Input extends Element {}
class Select extends Element {}

function walk(node: Element): Element[] { return [node, ...node.children.flatMap(walk)] }
function mountPage() {
  const root = new Element('root')
  vi.stubGlobal('HTMLInputElement', Input)
  vi.stubGlobal('HTMLSelectElement', Select)
  vi.stubGlobal('HTMLElement', Element)
  vi.stubGlobal('document', { activeElement: null, getElementById: (id: string) => walk(root).find(el => el.props.id === id) })
  function remove(node: Element) {
    if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node)
    node.parent = null
  }
  const renderer = createRenderer<Element, Element>({
    createElement: tag => tag === 'input' ? new Input(tag) : tag === 'select' ? new Select(tag) : new Element(tag),
    createText: text => Object.assign(new Element('#text'), { text }),
    createComment: text => Object.assign(new Element('#comment'), { text }),
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => { node.text = text; node.children = [] },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[(node.parent.children.indexOf(node)) + 1] ?? null,
    insert(node, parent, anchor) {
      remove(node)
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
      node.parent = parent
    },
    remove,
    insertStaticContent(html, parent, anchor) {
      const node = Object.assign(new Element('#static'), { text: html })
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
      node.parent = parent
      return [node, node]
    },
    patchProp(node, key, _previous, value) {
      node.props[key] = value
      if (key === 'value') node.value = String(value ?? '')
    },
  })
  const app = renderer.createApp(App)
  app.mount(root)
  const input = (id: string) => {
    const node = walk(root).find(el => el.props.id === id)
    if (!node) throw new Error(`Missing input: ${id}; ${root.textContent}`)
    return node
  }
  const button = (label: string, scope = root) => {
    const node = walk(scope).find(el => el.tag === 'button' && el.textContent === label)
    if (!node) throw new Error(`Missing button: ${label}; ${root.textContent}`)
    return node
  }
  const emit = (node: Element, event: string) => {
    const handler = node.props[event]
    if (typeof handler !== 'function') throw new Error(`Missing event: ${event}`)
    handler({ target: node })
  }
  async function edit(id: string, value: string) {
    const node = input(id)
    node.value = value
    emit(node, node.tag === 'select' ? 'onChange' : 'onInput')
    await nextTick()
  }
  async function click(label: string, scope = root) {
    const node = button(label, scope)
    expect(node.matches(':disabled')).toBe(false)
    emit(node, 'onClick')
    await nextTick()
  }
  return { root, app, input, button, edit, click }
}

async function fill(page: ReturnType<typeof mountPage>) {
  await page.edit('draft-work-order', 'WO-007')
  await page.edit('draft-part-number', 'P-007')
  await page.edit('draft-contactResistance', '0')
  await page.edit('draft-insulationResistance', '200')
  await page.edit('draft-withstandVoltage', '1500')
  await page.edit('draft-result', 'PASS')
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Checkpoint B: actual voice component bindings', () => {
  it('shows interim text separately and preserves confirmed text on an IDLE interruption', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    const speech = mockSpeech()
    vi.spyOn(speechModule, 'createSpeechRecognition').mockReturnValue(speech.module)
    const page = mountPage()
    await nextTick()
    await page.click('开始监听'); speech.ready(); await nextTick(); await nextTick()
    await page.click('开始输入')
    speech.update('接触电阻12毫欧', '耐压待确认')
    await nextTick()
    expect(page.root.textContent).toContain('临时文本（待确认）：耐压待确认')
    expect(page.input('draft-contactResistance').value).toBe('')
    speech.complete('接触电阻12毫欧'); speech.fault('网络中断')
    await nextTick(); await nextTick()
    const transcript = walk(page.root).find(node => node.props['aria-label'] === '本次实时转写文本')!
    expect(transcript.textContent).toContain('接触电阻12毫欧')
    expect(transcript.textContent).not.toContain('耐压待确认')
    expect(page.input('draft-contactResistance').value).toBe('12')
    page.app.unmount()
  })
  it('shares input handlers between buttons and spoken commands without duplicate recording or completion', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    const speech = mockSpeech()
    vi.spyOn(speechModule, 'createSpeechRecognition').mockReturnValue(speech.module)
    const page = mountPage()
    await nextTick()
    expect(page.button('开始输入').matches(':disabled')).toBe(true)
    expect(page.button('结束输入').matches(':disabled')).toBe(true)
    await page.click('开始监听')
    expect(page.button('开始输入').matches(':disabled')).toBe(true)
    speech.ready(); await nextTick(); await nextTick()
    expect(page.button('开始输入').matches(':disabled')).toBe(false)
    expect(page.button('结束输入').matches(':disabled')).toBe(true)

    await page.click('开始输入')
    expect(speech.module.startRecording).toHaveBeenCalledOnce()
    expect(page.button('开始输入').matches(':disabled')).toBe(true)
    expect(page.button('结束输入').matches(':disabled')).toBe(false)
    speech.command('START_INPUT'); await nextTick(); await nextTick()
    expect(speech.module.startRecording).toHaveBeenCalledOnce()
    speech.update('接触电阻12毫欧'); await nextTick()
    expect(page.input('draft-contactResistance').value).toBe('')
    speech.command('STOP_INPUT'); await nextTick(); await nextTick()
    expect(page.button('结束输入').matches(':disabled')).toBe(true)
    expect(speech.module.stopRecording).toHaveBeenCalledOnce()
    speech.complete('接触电阻12毫欧')
    speech.complete('接触电阻99毫欧')
    speech.ready(); await nextTick(); await nextTick()
    expect(page.input('draft-contactResistance').value).toBe('12')

    speech.command('START_INPUT'); await nextTick(); await nextTick()
    expect(speech.module.startRecording).toHaveBeenCalledTimes(2)
    await page.click('结束输入')
    speech.command('STOP_INPUT'); await nextTick(); await nextTick()
    expect(speech.module.stopRecording).toHaveBeenCalledTimes(2)
    expect(page.button('结束输入').matches(':disabled')).toBe(true)
    speech.complete('接触电阻18毫欧'); speech.ready(); await nextTick(); await nextTick()
    expect(page.input('draft-contactResistance').value).toBe('18')

    await page.click('开始输入')
    await page.click('结束输入')
    speech.complete('绝缘电阻200兆欧'); speech.ready(); await nextTick(); await nextTick()
    expect(speech.module.startRecording).toHaveBeenCalledTimes(3)
    expect(speech.module.stopRecording).toHaveBeenCalledTimes(3)
    expect(page.input('draft-insulationResistance').value).toBe('200')
    await page.click('删除')
    expect(page.button('开始输入').matches(':disabled')).toBe(true)
    await page.click('保留')
    expect(page.button('开始输入').matches(':disabled')).toBe(false)
    expect(page.button('结束输入').matches(':disabled')).toBe(true)
    page.app.unmount()
  })

  it('renders real state/text and merges voice with manual fields, then saves through spoken confirmation', async () => {
    let contents: string | null = null
    const setItem = vi.fn((_key: string, value: string) => { contents = value })
    vi.stubGlobal('localStorage', { getItem: () => contents, setItem })
    const speech = mockSpeech()
    vi.spyOn(speechModule, 'createSpeechRecognition').mockReturnValue(speech.module)
    const page = mountPage()
    await nextTick()
    const keywords = walk(page.root).find(node => node.props['aria-labelledby'] === 'keywords-title')!
    const transcript = walk(page.root).find(node => node.props['aria-label'] === '本次实时转写文本')!
    expect(page.button('开始监听', keywords)).toBeDefined()
    expect(keywords.textContent).toContain('未在监听')
    expect(transcript.textContent).toContain('请先点击“开始监听”')
    await page.edit('draft-work-order', 'MANUAL')
    await page.click('开始监听'); expect(page.root.textContent).toContain('取消启动')
    speech.ready(); await nextTick()
    expect(keywords.textContent).toContain('监听中')
    expect(keywords.textContent).not.toContain('未在监听')
    expect(transcript.textContent).toContain('请说“开始输入”')
    speech.command('START_INPUT'); await nextTick(); await nextTick()
    expect(page.root.textContent).toContain('RECORDING')
    expect(keywords.textContent).toContain('监听中')
    expect(transcript.textContent).toContain('连接中')
    expect(transcript.textContent).not.toContain('请开始说话')
    vi.mocked(speechModule.createSpeechRecognition).mock.calls[0]![0]!.onServiceReady?.()
    await nextTick()
    expect(transcript.textContent).toContain('请开始说话')
    expect(page.button('停止监听').matches(':disabled')).toBe(true)
    speech.update('', '仅临时识别内容'); await nextTick()
    expect(transcript.textContent).not.toContain('请开始说话')
    expect(transcript.textContent).toContain('临时文本（待确认）：仅临时识别内容')
    speech.update('接触电阻12毫欧', '耐压…'); await nextTick()
    expect(transcript.textContent).toContain('接触电阻12毫欧')
    expect(transcript.textContent).toContain('临时文本（待确认）：耐压…')
    expect(transcript.textContent).not.toContain('请开始说话')
    expect(page.input('draft-contactResistance').value).toBe('')
    speech.command('STOP_INPUT'); await nextTick(); await nextTick()
    expect(speech.module.stopRecording).toHaveBeenCalledOnce()
    speech.complete('料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏通过，检验结果合格')
    speech.ready(); await nextTick(); await nextTick()
    expect(keywords.textContent).toContain('监听中')
    expect(transcript.textContent).toContain('料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏通过，检验结果合格')
    expect(transcript.textContent).toContain('请说“开始输入”继续输入')
    await page.click('停止监听')
    expect(keywords.textContent).toContain('未在监听')
    expect(transcript.textContent).toContain('请先点击“开始监听”')
    expect(transcript.textContent).toContain('料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏通过，检验结果合格')
    expect(transcript.textContent).not.toContain('请说')
    await page.click('开始监听'); speech.ready(); await nextTick(); await nextTick()
    expect(transcript.textContent).toContain('料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏通过，检验结果合格')
    expect(transcript.textContent).toContain('请说“开始输入”继续输入')
    expect(page.input('draft-work-order').value).toBe('MANUAL')
    expect(page.input('draft-contactResistance').value).toBe('12')
    speech.command('SAVE'); await nextTick(); await nextTick()
    expect(page.root.textContent).toContain('确认保存当前草稿？')
    expect(page.input('draft-work-order').matches(':disabled')).toBe(true)
    speech.command('CONFIRM_SAVE'); await nextTick(); await nextTick()
    expect(setItem).toHaveBeenCalledOnce()
    expect(JSON.parse(contents ?? '[]')[0]).toMatchObject({ workOrder: 'MANUAL', contactResistance: 12, result: 'PASS' })
    expect(page.input('draft-work-order').value).toBe('')
    const history = walk(page.root).find(node => node.props.class === 'history-table')!
    expect(history.textContent).toContain('MANUAL')
    expect(history.textContent).toContain('C-045')
    expect(history.textContent).toContain('PASS · 合格')
    page.app.unmount(); await nextTick()
    expect(speech.listenerCount()).toBe(0)
    expect(speech.module.stopListening).toHaveBeenCalledTimes(2)
    const reloaded = mountPage()
    await nextTick()
    const reloadedHistory = walk(reloaded.root).find(node => node.props.class === 'history-table')!
    expect(reloadedHistory.textContent).toBe(history.textContent)
    expect(reloaded.input('draft-work-order').value).toBe('')
    expect(setItem).toHaveBeenCalledOnce()
    reloaded.app.unmount(); await nextTick()
    expect(speech.listenerCount()).toBe(0)
  })

  it('resets the connection hint for each input and preserves connection errors', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    const speech = mockSpeech()
    const factory = vi.spyOn(speechModule, 'createSpeechRecognition').mockReturnValue(speech.module)
    const page = mountPage()
    await nextTick(); await page.click('开始监听'); speech.ready(); await nextTick()
    const transcript = walk(page.root).find(node => node.props['aria-label'] === '本次实时转写文本')!
    await page.click('开始输入')
    expect(transcript.textContent).toContain('连接中')
    factory.mock.calls[0]![0]!.onServiceReady?.(); await nextTick()
    expect(transcript.textContent).toContain('请开始说话')
    await page.click('结束输入')
    expect(transcript.textContent).not.toContain('请开始说话')
    speech.complete(''); speech.ready(); await nextTick(); await nextTick()
    await page.click('开始输入')
    expect(transcript.textContent).toContain('连接中')
    expect(transcript.textContent).not.toContain('请开始说话')
    speech.fault('语音连接中断。'); await nextTick()
    expect(page.root.textContent).toContain('语音错误：语音连接中断。')
    expect(transcript.textContent).not.toContain('请开始说话')
    expect(transcript.textContent).not.toContain('连接中')
    page.app.unmount()
  })

  it('preserves a manual numeric edit through the actual input event and a later voice segment', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    const speech = mockSpeech()
    vi.spyOn(speechModule, 'createSpeechRecognition').mockReturnValue(speech.module)
    const page = mountPage()
    await nextTick(); await page.click('开始监听'); speech.ready(); await nextTick()
    speech.command('START_INPUT'); await nextTick(); await nextTick()
    speech.complete('接触电阻12毫欧'); speech.ready(); await nextTick(); await nextTick()
    const transcript = walk(page.root).find(node => node.props['aria-label'] === '本次实时转写文本')!
    expect(transcript.textContent).toContain('请说“开始输入”继续输入')
    expect(page.input('draft-contactResistance').value).toBe('12')
    await page.edit('draft-contactResistance', '18')
    speech.command('START_INPUT'); await nextTick(); await nextTick()
    expect(transcript.textContent).not.toContain('继续输入')
    expect(transcript.textContent).toContain('连接中')
    vi.mocked(speechModule.createSpeechRecognition).mock.calls[0]![0]!.onServiceReady?.()
    await nextTick()
    expect(transcript.textContent).toContain('请开始说话')
    speech.complete('绝缘电阻500兆欧'); speech.ready(); await nextTick(); await nextTick()
    expect(page.input('draft-contactResistance').value).toBe('18')
    expect(page.input('draft-insulationResistance').value).toBe('500')
    page.app.unmount(); await nextTick()
    expect(speech.listenerCount()).toBe(0)
  })

  it('clears the access password, binds login/logout, and keeps manual edits usable on speech failure', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    const speech = mockSpeech()
    vi.spyOn(speechModule, 'createSpeechRecognition').mockReturnValue(speech.module)
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetch)
    const page = mountPage()
    await nextTick()
    await page.edit('voice-password', 'test-access-password')
    await page.click('登录语音代理'); await nextTick()
    expect(page.input('voice-password').value).toBe('')
    expect(fetch).toHaveBeenCalledWith('/api/m1/login', expect.objectContaining({ body: JSON.stringify({ password: 'test-access-password' }) }))
    expect(page.root.textContent).toContain('登录成功')
    await page.click('开始监听'); speech.fault(); await nextTick(); await nextTick()
    expect(page.root.textContent).toContain('麦克风权限被拒绝')
    expect(page.root.textContent).toContain('请先点击“开始监听”')
    expect(page.root.textContent).not.toContain('监听中')
    await page.edit('draft-work-order', 'STILL EDITABLE')
    expect(page.input('draft-work-order').value).toBe('STILL EDITABLE')
    await page.click('退出语音代理'); await nextTick()
    expect(fetch).toHaveBeenCalledWith('/api/m1/logout', expect.objectContaining({ method: 'POST' }))
    page.app.unmount(); await nextTick()
  })
})

describe('Checkpoint A: actual App component bindings', () => {
  it('routes real input/confirmation events, preserves zero, clears empty input, and reloads persisted history', async () => {
    let contents: string | null = null
    const setItem = vi.fn((_key: string, value: string) => { contents = value })
    vi.stubGlobal('localStorage', { getItem: () => contents, setItem })
    const page = mountPage()
    await nextTick()
    await fill(page)
    await page.edit('draft-contactResistance', '')
    await page.click('保存')
    expect(page.root.textContent).toContain('接触电阻（mΩ）：必填')
    expect(walk(page.root).some(el => el.tag === 'dialog')).toBe(false)
    await page.edit('draft-contactResistance', '0')
    await page.click('保存')
    expect(page.input('draft-work-order').matches(':disabled')).toBe(true)
    expect(setItem).not.toHaveBeenCalled()
    await page.click('修改')
    expect(page.input('draft-work-order').value).toBe('WO-007')
    await page.click('保存'); await page.click('确认保存')
    expect(setItem).toHaveBeenCalledOnce()
    expect(JSON.parse(contents ?? '[]')[0]).toMatchObject({ workOrder: 'WO-007', contactResistance: 0 })
    expect(page.input('draft-work-order').value).toBe('')
    expect(page.root.textContent).toContain('保存成功')
    expect(page.root.textContent).toContain('WO-007')
    expect(page.button('编辑').matches(':disabled')).toBe(false)
    expect(page.button('导出全部记录至 CSV').matches(':disabled')).toBe(false)
    await page.edit('draft-work-order', 'unsaved')
    page.app.unmount()
    await nextTick()
    const reloaded = mountPage()
    await nextTick()
    expect(reloaded.root.textContent).toContain('WO-007')
    expect(reloaded.input('draft-work-order').value).toBe('')
    expect(setItem).toHaveBeenCalledOnce()
    reloaded.app.unmount()
    await nextTick()
  })

  it('shows initialization failure, disables saving, and still routes manual edits', async () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => 'broken', setItem })
    const page = mountPage()
    await nextTick()
    expect(page.root.textContent).toContain('历史读取失败')
    expect(page.button('保存').matches(':disabled')).toBe(true)
    expect(page.input('draft-work-order').matches(':disabled')).toBe(false)
    await page.edit('draft-work-order', 'editable')
    expect(page.input('draft-work-order').value).toBe('editable')
    expect(setItem).not.toHaveBeenCalled()
    page.app.unmount()
    await nextTick()
  })

  it('contains an actual history render exception after save without reporting persistence failure', async () => {
    let contents: string | null = null
    const setItem = vi.fn((_key: string, value: string) => { contents = value })
    vi.stubGlobal('localStorage', { getItem: () => contents, setItem })
    const page = mountPage()
    await nextTick()
    await fill(page)
    await page.click('保存')
    // The standard library types this native accessor as a method; expose it as a property for spying.
    const formatterPrototype: { readonly format: unknown } = Intl.DateTimeFormat.prototype
    vi.spyOn(formatterPrototype, 'format', 'get').mockReturnValue(() => { throw new Error('render fault') })
    await page.click('确认保存')
    await nextTick()
    expect(setItem).toHaveBeenCalledOnce()
    expect(JSON.parse(contents ?? '[]')).toHaveLength(1)
    expect(page.root.textContent).toContain('保存成功')
    expect(page.root.textContent).toContain('页面渲染异常')
    expect(page.root.textContent).not.toContain('保存失败')
    expect(page.input('draft-work-order').matches(':disabled')).toBe(false)
    await page.edit('draft-work-order', 'draft survives history fault')
    expect(page.input('draft-work-order').value).toBe('draft survives history fault')
    vi.restoreAllMocks()
    await page.click('恢复页面展示')
    expect(page.root.textContent).toContain('WO-007')
    expect(page.input('draft-work-order').value).toBe('draft survives history fault')
    page.app.unmount()
    await nextTick()
  })

  it('edits and deletes through actual history buttons, retaining the draft and requiring confirmation', async () => {
    let contents: string | null = null
    const setItem = vi.fn((_key: string, value: string) => { contents = value })
    vi.stubGlobal('localStorage', { getItem: () => contents, setItem })
    const page = mountPage()
    await nextTick()
    await fill(page); await page.click('保存'); await page.click('确认保存')
    const original = JSON.parse(contents ?? '[]')[0]
    await page.edit('draft-work-order', 'UNSAVED')
    await page.click('编辑')
    expect(page.input('draft-work-order').matches(':disabled')).toBe(true)
    expect(page.input('history-edit-work-order').value).toBe('WO-007')
    await page.edit('history-edit-part-number', 'CANCELLED')
    await page.click('取消')
    expect(JSON.parse(contents ?? '[]')[0]).toEqual(original)
    await page.click('编辑')
    await page.edit('history-edit-part-number', '')
    await page.click('确认修改')
    expect(page.root.textContent).toContain('修改失败')
    expect(page.input('history-edit-part-number').value).toBe('')
    await page.edit('history-edit-part-number', 'UPDATED')
    await page.click('确认修改')
    expect(JSON.parse(contents ?? '[]')[0]).toMatchObject({ id: original.id, createdAt: original.createdAt, partNumber: 'UPDATED' })
    expect(page.input('draft-work-order').value).toBe('UNSAVED')
    const history = () => walk(page.root).find(el => el.props['aria-labelledby'] === 'history-title')!
    await page.click('删除', history())
    expect(page.root.textContent).toContain('确认删除历史记录？')
    expect(page.root.textContent).toContain(original.id)
    const values = walk(page.root).find(el => el.tag === 'dl' && el.props.class === 'confirmation-values')!
    const detailRows = values.children.filter(child => child.tag === 'div')
    expect(detailRows.length).toBe(9)
    const details = Object.fromEntries(detailRows.map(row => [
      row.children.find(child => child.tag === 'dt')!.textContent,
      row.children.find(child => child.tag === 'dd')!.textContent,
    ]))
    const latest = JSON.parse(contents ?? '[]')[0]
    expect(details).toEqual({
      '记录 ID': latest.id, '工单': latest.workOrder, '料号': latest.partNumber,
      '接触电阻（mΩ）': '0', '绝缘电阻（MΩ）': '200', '耐电压（V）': '1500',
      '检验结果': 'PASS', '创建时间（UTC）': latest.createdAt, '修改时间（UTC）': latest.updatedAt,
    })
    await page.click('取消')
    expect(JSON.parse(contents ?? '[]')).toHaveLength(1)
    await page.click('删除', history()); await page.click('确认删除历史记录')
    expect(JSON.parse(contents ?? '[]')).toEqual([])
    expect(page.root.textContent).toContain('删除成功')
    expect(page.input('draft-work-order').value).toBe('UNSAVED')
    expect(setItem).toHaveBeenCalledTimes(3)
    page.app.unmount(); await nextTick()
  })

  it('offers an in-page cancellation and remount after a confirmation lifecycle error', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    const page = mountPage()
    await nextTick(); await fill(page)
    vi.spyOn(Element.prototype, 'showModal').mockImplementationOnce(() => { throw new Error('dialog fault') })
    await page.click('保存')
    expect(page.root.textContent).toContain('草稿仍保留在本页')
    expect(page.root.textContent).toContain('WO-007')
    await page.click('取消当前草稿确认'); await page.click('恢复页面展示')
    expect(page.input('draft-work-order').value).toBe('WO-007')
    expect(page.input('draft-work-order').matches(':disabled')).toBe(false)
    page.app.unmount(); await nextTick()
  })

  it('applies the real query input and refreshes its filter after a history edit', async () => {
    let contents: string | null = null
    vi.stubGlobal('localStorage', { getItem: () => contents, setItem: (_key: string, value: string) => { contents = value } })
    const page = mountPage()
    await nextTick(); await fill(page); await page.click('保存'); await page.click('确认保存')
    const search = () => walk(page.root).find(el => el.tag === 'input' && el.type === 'search')!
    async function filter(value: string) {
      const node = search()
      node.value = value
      const event = new Event('input')
      Object.defineProperty(event, 'target', { value: node })
      node.listeners.input!(event)
      await page.click('查询')
    }
    await filter('WO-007')
    await page.click('编辑'); await page.edit('history-edit-work-order', 'OTHER'); await page.click('确认修改')
    expect(page.root.textContent).toContain('修改成功，该记录不在当前筛选范围内')
    expect(page.root.textContent).toContain('当前查询无记录')
    await filter('OTHER')
    expect(page.root.textContent).toContain('OTHER')
    expect(page.button('编辑').matches(':disabled')).toBe(false)
    page.app.unmount(); await nextTick()
  })

  it('binds row selection and the all/partial checkbox, enabling selected export only with selection', async () => {
    let contents: string | null = null
    const setItem = vi.fn((_key: string, value: string) => { contents = value })
    vi.stubGlobal('localStorage', { getItem: () => contents, setItem })
    const page = mountPage()
    await nextTick()
    await fill(page); await page.click('保存'); await page.click('确认保存')
    await fill(page); await page.click('保存'); await page.click('确认保存')
    const checkboxes = () => walk(page.root).filter(el => el.tag === 'input' && el.type === 'checkbox')
    const change = async (node: Element) => {
      expect(node.matches(':disabled')).toBe(false)
      const handler = node.props.onChange
      if (typeof handler !== 'function') throw new Error('Missing selection change handler')
      handler({ target: node })
      await nextTick()
    }
    expect(checkboxes()).toHaveLength(3)
    await change(checkboxes()[1]!)
    expect(page.root.textContent).toContain('已选 1 条')
    expect(page.button('导出选中记录至 CSV').matches(':disabled')).toBe(false)
    expect(checkboxes()[0]!.props.indeterminate).toBe(true)
    await change(checkboxes()[0]!)
    expect(page.root.textContent).toContain('已选 2 条')
    expect(checkboxes().every(node => node.props.checked === true)).toBe(true)
    expect(checkboxes()[0]!.props.indeterminate).toBe(false)
    await change(checkboxes()[0]!)
    expect(page.root.textContent).toContain('已选 0 条')
    expect(checkboxes().every(node => node.props.checked === false)).toBe(true)
    expect(page.button('导出选中记录至 CSV').matches(':disabled')).toBe(true)
    expect(setItem).toHaveBeenCalledTimes(2)
    page.app.unmount(); await nextTick()
  })

  it('routes both actual CSV buttons through M4 and M5 to a downloadable Blob, independently of filters', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 28, 14, 30, 5))
    const time = '2026-10-26T01:30:00.000Z'
    const first: InspectionRecord = {
      id: 'r1', workOrder: 'ALPHA', partNumber: '\u0085=1', contactResistance: 0,
      insulationResistance: 200, withstandVoltage: 1500, result: 'PASS', createdAt: time, updatedAt: time,
    }
    const second: InspectionRecord = { ...first, id: 'r2', workOrder: 'BETA', partNumber: 'P-002' }
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify([first, second]), setItem })
    const page = mountPage()
    await nextTick()
    const links: { href: string; download: string; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }[] = []
    Object.assign(document, {
      createElement: vi.fn(() => {
        const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
        links.push(link)
        return link
      }),
      body: { appendChild: vi.fn() },
    })
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const header = '\uFEFF工单,料号,接触电阻,绝缘电阻,耐电压,检验结果,创建时间,修改时间'
    const firstRow = `ALPHA,'\u0085=1,0 mΩ,200 MΩ,1500 V,PASS,${time},${time}`
    const secondRow = `BETA,P-002,0 mΩ,200 MΩ,1500 V,PASS,${time},${time}`
    const search = walk(page.root).find(el => el.tag === 'input' && el.type === 'search')!
    async function filter(value: string) {
      search.value = value
      const event = new Event('input')
      Object.defineProperty(event, 'target', { value: search })
      search.listeners.input!(event)
      await page.click('查询')
    }
    await filter('ALPHA')
    expect(page.button('导出选中记录至 CSV').matches(':disabled')).toBe(true)
    const checkbox = walk(page.root).find(el => el.props['aria-label'] === '选择记录 ALPHA')!
    const handler = checkbox.props.onChange
    if (typeof handler !== 'function') throw new Error('Missing selection handler')
    handler({ target: checkbox }); await nextTick()
    await page.click('导出选中记录至 CSV')
    expect(page.root.textContent).toContain('已发起下载，共 1 条记录')
    expect(new Uint8Array(await (createUrl.mock.calls[0]![0] as Blob).arrayBuffer()))
      .toEqual(new TextEncoder().encode(`${header}\r\n${firstRow}`))
    await page.click('导出全部记录至 CSV')
    expect(new Uint8Array(await (createUrl.mock.calls[1]![0] as Blob).arrayBuffer()))
      .toEqual(new TextEncoder().encode(`${header}\r\n${firstRow}\r\n${secondRow}`))
    expect(page.root.textContent).toContain('已发起下载，共 2 条记录')
    await filter('missing')
    expect(page.root.textContent).toContain('当前查询无记录')
    expect(page.button('导出全部记录至 CSV').matches(':disabled')).toBe(false)
    expect(page.button('导出选中记录至 CSV').matches(':disabled')).toBe(true)
    await page.click('导出全部记录至 CSV')
    expect(createUrl).toHaveBeenCalledTimes(3)
    expect(new Uint8Array(await (createUrl.mock.calls[2]![0] as Blob).arrayBuffer()))
      .toEqual(new TextEncoder().encode(`${header}\r\n${firstRow}\r\n${secondRow}`))
    for (const link of links) {
      expect(link.download).toBe('工单信息2026-10-28_14-30-05.csv')
      expect(link.click).toHaveBeenCalledOnce()
    }
    vi.runAllTimers()
    expect(revokeUrl).toHaveBeenCalledTimes(3)
    for (const link of links) expect(link.remove).toHaveBeenCalledOnce()
    expect(setItem).not.toHaveBeenCalled()
    page.app.unmount(); await nextTick()
  })

  it('handles a download initiation failure from the actual export button and permits retry', async () => {
    vi.useFakeTimers()
    let contents: string | null = null
    const setItem = vi.fn((_key: string, value: string) => { contents = value })
    vi.stubGlobal('localStorage', { getItem: () => contents, setItem })
    const page = mountPage()
    await nextTick(); await fill(page); await page.click('保存'); await page.click('确认保存')
    const original = contents
    setItem.mockClear()
    await page.edit('draft-work-order', 'UNSAVED')
    const click = vi.fn().mockImplementationOnce(() => { throw new Error('blocked') })
    const remove = vi.fn()
    Object.assign(document, { createElement: () => ({ href: '', download: '', click, remove }), body: { appendChild: vi.fn() } })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    await page.click('导出全部记录至 CSV')
    expect(page.root.textContent).toContain('CSV 导出失败：无法发起下载')
    expect(page.input('draft-work-order').value).toBe('UNSAVED')
    expect(page.button('导出全部记录至 CSV').matches(':disabled')).toBe(false)
    expect(remove).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledOnce()
    await page.click('导出全部记录至 CSV')
    expect(page.root.textContent).toContain('已发起下载，共 1 条记录')
    expect(contents).toBe(original)
    expect(setItem).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(remove).toHaveBeenCalledTimes(2)
    expect(revoke).toHaveBeenCalledTimes(2)
    page.app.unmount(); await nextTick()
  })
})


describe('error Toast presentation', () => {
  const alerts = (page: ReturnType<typeof mountPage>) => walk(page.root).filter(el => el.props.role === 'alert')

  it('replaces errors, resets the three-second timer, and keeps controls and non-error messages intact', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    const page = mountPage()
    await nextTick()
    const draftInput = page.input('draft-work-order')
    await page.click('保存')
    expect(alerts(page)).toHaveLength(1)
    expect(alerts(page)[0]!.textContent).toContain('请修正以下草稿错误。')
    expect(alerts(page)[0]!.textContent).toContain('工单：必填')
    expect(alerts(page)[0]!.props.class).toBe('error-toast')
    expect(walk(alerts(page)[0]!).some(el => el.tag === 'button')).toBe(false)
    await vi.advanceTimersByTimeAsync(2000)
    await page.click('导出全部记录至 CSV')
    expect(alerts(page)).toHaveLength(1)
    expect(alerts(page)[0]!.textContent).toBe('暂无可导出的记录。')
    expect(page.root.textContent).not.toContain('工单：必填')
    expect(page.input('draft-work-order')).toBe(draftInput)
    expect(draftInput.matches(':disabled')).toBe(false)
    await vi.advanceTimersByTimeAsync(2999)
    expect(alerts(page)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(alerts(page)).toHaveLength(0)
    await fill(page)
    await page.click('保存'); await page.click('确认保存')
    await vi.advanceTimersByTimeAsync(3000)
    expect(page.root.textContent).toContain('保存成功。')
    page.app.unmount(); await nextTick()
  })

  it('restarts the timer for identical validation failures and identical export failures, then clears it on unmount', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    const page = mountPage()
    await nextTick()
    await page.click('保存')
    await vi.advanceTimersByTimeAsync(2000)
    await page.click('保存')
    await vi.advanceTimersByTimeAsync(2999)
    expect(alerts(page)[0]!.textContent).toContain('工单：必填')
    await vi.advanceTimersByTimeAsync(1)
    expect(alerts(page)).toHaveLength(0)
    await page.click('导出全部记录至 CSV')
    await vi.advanceTimersByTimeAsync(2000)
    await page.click('导出全部记录至 CSV')
    await vi.advanceTimersByTimeAsync(2999)
    expect(alerts(page)[0]!.textContent).toBe('暂无可导出的记录。')
    expect(vi.getTimerCount()).toBe(1)
    page.app.unmount(); await nextTick()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the error above an open confirmation dialog without duplicating inline text', async () => {
    vi.useFakeTimers()
    let contents: string | null = null
    vi.stubGlobal('localStorage', { getItem: () => contents, setItem: (_key: string, value: string) => { contents = value } })
    const popover = vi.spyOn(Element.prototype, 'showPopover')
    const page = mountPage()
    await nextTick(); await fill(page)
    await page.click('保存'); await page.click('确认保存'); await page.click('编辑')
    await page.edit('history-edit-part-number', '')
    await page.click('确认修改')
    expect(alerts(page)).toHaveLength(1)
    const errorText = alerts(page)[0]!.textContent
    expect(errorText).toContain('修改失败，原记录及表单已保留：')
    expect(page.root.textContent.split(errorText)).toHaveLength(2)
    expect(popover).toHaveBeenCalled()
    expect(alerts(page)[0]!.props.popover).toBe('manual')
    expect(walk(page.root).some(el => el.tag === 'dialog')).toBe(true)
    await vi.advanceTimersByTimeAsync(3000)
    expect(alerts(page)).toHaveLength(0)
    await page.click('确认修改')
    expect(alerts(page)[0]!.textContent).toBe(errorText)
    expect(page.input('history-edit-part-number').value).toBe('')
    await page.click('取消')
    page.app.unmount(); await nextTick()
  })

  it('moves authentication failures to the Toast and retains the loading and success statuses', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    const fetch = vi.fn().mockResolvedValue({ ok: false })
    vi.stubGlobal('fetch', fetch)
    const page = mountPage()
    await nextTick()
    await page.edit('voice-password', 'bad-password')
    await page.click('登录语音代理'); await nextTick()
    expect(alerts(page)[0]!.textContent).toBe('语音代理操作失败，请检查访问口令和同源代理配置。')
    await vi.advanceTimersByTimeAsync(3000)
    expect(page.root.textContent).not.toContain('语音代理操作失败')
    await page.edit('voice-password', 'bad-password')
    await page.click('登录语音代理'); await nextTick()
    expect(alerts(page)[0]!.textContent).toContain('语音代理操作失败')
    fetch.mockResolvedValue({ ok: true })
    await page.click('退出语音代理'); await nextTick()
    await vi.advanceTimersByTimeAsync(3000)
    expect(page.root.textContent).toContain('已退出语音代理。')
    page.app.unmount(); await nextTick()
  })
})
