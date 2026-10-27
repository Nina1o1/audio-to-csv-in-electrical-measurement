import { reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useManualWorkflow } from '../../src/app/useManualWorkflow'
import { createDraftManager } from '../../src/modules/m3-draft-manager'
import { createTextParser } from '../../src/modules/m2-text-parser'
import { createRecordManager } from '../../src/modules/m4-record-manager'
import type { InspectionFields } from '../../src/shared/data-models'
import { mockSpeech } from '../helpers/mock-speech'

const full: InspectionFields = {
  workOrder: 'A2301', partNumber: 'C-045', contactResistance: 12,
  insulationResistance: 500, withstandVoltage: 1500, result: 'PASS',
}
const fullText = '工单A2301，料号C-045，接触电阻0.012欧姆，绝缘电阻500兆欧，耐电压1500伏通过，合格'
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
const cleanup: (() => void)[] = []
function setup() {
  let contents: string | null = null
  const storage = { getItem: vi.fn(() => contents), setItem: vi.fn((_key: string, value: string) => { contents = value }) }
  vi.stubGlobal('localStorage', storage)
  const speech = mockSpeech()
  const draft = createDraftManager(), parser = createTextParser(), records = createRecordManager()
  const parse = vi.spyOn(parser, 'parse'), apply = vi.spyOn(draft, 'applyParseResult')
  const ui = reactive(useManualWorkflow({ speechRecognition: speech.module, textParser: parser, draftManager: draft, createRecords: () => records }))
  ui.initialize()
  cleanup.push(ui.dispose)
  async function listen() { const start = ui.toggleListening(); speech.ready(); await start }
  async function begin() { speech.command('START_INPUT'); await flush() }
  async function finish(text: string) { speech.complete(text); speech.ready(); await flush() }
  async function command(value: Parameters<typeof speech.command>[0]) { speech.command(value); await flush() }
  return { ui, speech, draft, records, storage, parse, apply, listen, begin, finish, command }
}
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Checkpoint B: App voice coordination', () => {
  it('passes the final segment to M2 and its sparse result to M3 after notification, sharing the manual draft', async () => {
    const { ui, speech, parse, apply, listen, begin, finish } = setup()
    await listen(); ui.updateField('partNumber', 'MANUAL'); await begin()
    speech.update('接触电阻0.012欧姆', '耐压…')
    expect(ui.confirmedText).toBe('接触电阻0.012欧姆'); expect(ui.interimText).toBe('耐压…')
    expect(parse).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled()
    await finish('接触电阻0.012欧姆')
    expect(parse).toHaveBeenCalledExactlyOnceWith({ text: '接触电阻0.012欧姆' })
    expect(apply).toHaveBeenCalledExactlyOnceWith({ contactResistance: 12 })
    expect(ui.draft).toMatchObject({ partNumber: 'MANUAL', contactResistance: 12 })
    expect(ui.textComplete).toBe(true); expect(ui.interimText).toBe('')
  })
  it('accumulates partial fields and corrects values across recordings and manual edits', async () => {
    const { ui, listen, begin, finish } = setup()
    await listen(); await begin(); await finish('接触电阻12毫欧')
    ui.updateField('partNumber', 'MANUAL')
    await begin(); await finish('绝缘电阻500兆欧')
    await begin(); await finish('接触电阻改成15毫欧')
    expect(ui.draft).toMatchObject({ partNumber: 'MANUAL', contactResistance: 15, insulationResistance: 500 })
  })
  it.each(['', ' \n '])('ignores blank final text %j without parsing or updating', async text => {
    const { ui, parse, apply, listen, begin, finish } = setup()
    ui.updateField('workOrder', 'KEEP'); await listen(); await begin(); await finish(text)
    expect(parse).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled(); expect(ui.draft.workOrder).toBe('KEEP')
  })
  it('keeps the draft when no valid fields are recognized', async () => {
    const { ui, parse, apply, listen, begin, finish } = setup()
    ui.updateField('workOrder', 'KEEP'); await listen(); await begin(); await finish('今天检查完成')
    expect(parse).toHaveBeenCalledOnce(); expect(apply).not.toHaveBeenCalled(); expect(ui.draft.workOrder).toBe('KEEP')
  })
  it('consumes a completion once in the active context, without deduplicating equal text in later recordings', async () => {
    const { speech, parse, apply, listen, begin, finish } = setup()
    await listen(); await begin()
    speech.complete('接触电阻12'); speech.complete('接触电阻12'); speech.ready(); await flush()
    speech.complete('接触电阻12'); await flush()
    expect(parse).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledOnce()
    await begin(); await finish('接触电阻12')
    expect(parse).toHaveBeenCalledTimes(2)
  })
  it.each(['stop-first', 'complete-first'] as const)('handles %s without double stopping or parsing', async order => {
    const { speech, parse, listen, begin } = setup()
    await listen(); await begin()
    if (order === 'stop-first') { speech.command('STOP_INPUT'); speech.command('STOP_INPUT'); await flush() }
    speech.complete('耐压500伏')
    if (order === 'complete-first') speech.command('STOP_INPUT')
    speech.ready(); await flush()
    expect(speech.module.stopRecording).toHaveBeenCalledTimes(order === 'stop-first' ? 1 : 0)
    expect(parse).toHaveBeenCalledOnce()
  })
  it('uses M3 validation and the existing confirmed M4 save, rejecting repeated voice confirmations', async () => {
    const { ui, records, storage, listen, begin, finish, command } = setup()
    await listen(); await command('SAVE'); expect(ui.errors).toHaveLength(6); expect(storage.setItem).not.toHaveBeenCalled()
    await begin(); await finish(fullText); expect(ui.draft).toEqual(full)
    await command('SAVE'); expect(ui.draftState).toBe('CONFIRMING_SAVE'); expect(storage.setItem).not.toHaveBeenCalled()
    await command('MODIFY'); expect(ui.editable).toBe(true)
    await command('SAVE'); await command('CONFIRM_SAVE'); await command('CONFIRM_SAVE')
    expect(records.getAll()).toHaveLength(1); expect(storage.setItem).toHaveBeenCalledOnce()
    expect(ui.confirmedText).toBe(''); expect(ui.textComplete).toBe(false)
  })
  it('keeps the failed save draft and pending identity for a voice retry', async () => {
    const { ui, storage, records, listen, begin, finish, command } = setup()
    await listen(); await begin(); await finish(fullText)
    storage.setItem.mockImplementationOnce(() => { throw new Error('quota') })
    await command('SAVE'); await command('CONFIRM_SAVE')
    const pending = { ...ui.pending }
    expect(ui.draft).toEqual(full); expect(ui.draftState).toBe('IDLE'); expect(records.getAll()).toEqual([])
    await command('SAVE'); await command('CONFIRM_SAVE')
    expect(records.getAll()).toEqual([pending])
  })
  it('routes DELETE / KEEP / CONFIRM_DELETE only to the draft and clears text only on confirmation', async () => {
    const { ui, storage, listen, begin, finish, command } = setup()
    await listen(); await begin(); await finish('接触电阻12')
    await command('DELETE'); expect(ui.draft.contactResistance).toBe(12)
    await command('MODIFY'); expect(ui.draftState).toBe('CONFIRMING_DELETE')
    await command('KEEP'); expect(ui.draft.contactResistance).toBe(12); expect(ui.confirmedText).toBe('接触电阻12')
    await command('DELETE'); await command('CONFIRM_DELETE'); await command('CONFIRM_DELETE')
    expect(ui.draft.contactResistance).toBeNull(); expect(ui.confirmedText).toBe(''); expect(storage.setItem).not.toHaveBeenCalled()
  })
  it.each(['save', 'delete'] as const)('waits for the final merge before a button %s request', async action => {
    const { ui, speech, listen, begin, draft } = setup()
    await listen(); await begin()
    const request = vi.spyOn(draft, action === 'save' ? 'requestSave' : 'requestDelete')
    if (action === 'save') ui.requestSave(); else ui.requestDelete()
    ui.requestDelete(); ui.requestSave()
    expect(speech.module.stopRecording).toHaveBeenCalledOnce(); expect(request).not.toHaveBeenCalled()
    speech.complete(fullText)
    expect(ui.editable).toBe(false)
    speech.ready(); await flush()
    expect(ui.draft).toEqual(full)
    expect(ui.draftState).toBe(action === 'save' ? 'CONFIRMING_SAVE' : 'CONFIRMING_DELETE')
    expect(request).toHaveBeenCalledOnce()
  })
  it('blocks new recording while processing and during confirmation, preserving editable recording fields', async () => {
    const { ui, speech, listen, begin, finish, command } = setup()
    await listen(); await begin(); ui.updateField('partNumber', 'MANUAL')
    expect(ui.draft.partNumber).toBe('MANUAL')
    speech.complete('接触电阻12'); speech.command('START_INPUT'); speech.ready(); await flush()
    // The command was received during RECORDING, so it cannot start another input.
    expect(speech.module.startRecording).toHaveBeenCalledOnce()
    await command('DELETE'); await command('START_INPUT'); expect(speech.module.startRecording).toHaveBeenCalledOnce()
    await command('KEEP'); await begin(); await finish('接触电阻15')
    expect(ui.draft.contactResistance).toBe(15)
  })
  it('does not treat ordinary transcript business words as commands', async () => {
    const { ui, storage, speech, listen, begin, finish } = setup()
    await listen(); await begin(); speech.update('今天保存和删除，接触电阻12')
    speech.command('SAVE'); speech.command('DELETE'); await flush()
    expect(ui.draftState).toBe('IDLE')
    await finish('今天保存和删除，接触电阻12')
    expect(ui.draft.contactResistance).toBe(12); expect(ui.draftState).toBe('IDLE'); expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('shows startup errors once without changing the draft, and can retry', async () => {
    const { ui, speech, listen } = setup()
    ui.updateField('workOrder', 'KEEP')
    const starting = ui.toggleListening(); expect(ui.starting).toBe(true); expect(ui.microphone).toBe('IDLE')
    speech.fault(); await starting
    expect(ui.speechError).toBe('语音错误：麦克风权限被拒绝'); expect(ui.starting).toBe(false)
    expect(ui.draft.workOrder).toBe('KEEP'); await listen(); expect(ui.microphone).toBe('LISTENING')
  })
  it('cancels startup without letting an old finally clear a new request', async () => {
    const { ui, speech } = setup()
    const old = ui.toggleListening(); await ui.toggleListening()
    const fresh = ui.toggleListening(); await old
    expect(ui.starting).toBe(true); expect(ui.speechError).toBe('')
    speech.ready(); await fresh; expect(ui.starting).toBe(false)
  })
  it('applies confirmed interruption text once and retains the M1 error', async () => {
    const { ui, speech, listen, begin, parse } = setup()
    await listen(); await begin(); speech.update('接触电阻12', '耐压…')
    speech.complete('接触电阻12'); speech.fault('识别中断'); await flush()
    expect(ui.draft.contactResistance).toBe(12); expect(ui.draft.withstandVoltage).toBeNull()
    expect(ui.speechError).toContain('识别中断'); expect(ui.microphone).toBe('IDLE'); expect(parse).toHaveBeenCalledOnce()
  })
  it('preserves the draft on parser failure and cancels a deferred save', async () => {
    const { ui, speech, parse, listen, begin, command } = setup()
    await listen(); await begin(); ui.updateField('workOrder', 'KEEP'); ui.requestSave()
    parse.mockImplementationOnce(() => { throw new Error('parse failed') })
    speech.complete(fullText); speech.ready(); await flush()
    expect(ui.draft.workOrder).toBe('KEEP'); expect(ui.draftState).toBe('IDLE'); expect(ui.speechError).toContain('parse failed')
    await command('START_INPUT'); expect(ui.microphone).toBe('RECORDING')
  })
  it('invalidates queued results and commands on deletion, logout and disposal', async () => {
    const { ui, speech, parse, listen, begin, command } = setup()
    await listen(); await begin(); speech.complete('接触电阻12')
    ui.dispose(); ui.dispose(); await flush()
    expect(parse).not.toHaveBeenCalled(); expect(speech.listenerCount()).toBe(0)
    speech.complete(fullText); speech.update('late'); await command('SAVE')
    expect(ui.draft.workOrder).toBeNull(); expect(ui.confirmedText).not.toBe('late')
    expect(speech.module.stopListening).toHaveBeenCalledOnce()
  })
  it('rejects completion with no active recording or after the draft has been deleted', async () => {
    const { ui, speech, parse, listen, begin, finish, command } = setup()
    speech.complete(fullText); await flush(); expect(parse).not.toHaveBeenCalled()
    await listen(); await begin(); await finish('接触电阻12')
    await command('DELETE'); await command('CONFIRM_DELETE')
    speech.complete(fullText); await flush()
    expect(parse).toHaveBeenCalledOnce(); expect(ui.draft.workOrder).toBeNull()
  })
  it('rejects an unexpected completion during confirmation instead of overwriting the draft', async () => {
    const { ui, draft, speech, parse, listen, begin } = setup()
    await listen(); await begin(); draft.requestDelete()
    speech.complete(fullText); speech.ready(); await flush()
    expect(parse).not.toHaveBeenCalled(); expect(ui.speechError).toContain('未应用')
    expect(ui.draft.workOrder).toBeNull(); expect(ui.draftState).toBe('CONFIRMING_DELETE')
  })
})

describe('existing same-origin voice access', () => {
  it('logs in without storing credentials, reports HTTP failure and supports logout', async () => {
    const { ui, speech, storage } = setup()
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetch)
    await ui.loginVoice('test-access-password'); expect(ui.authMessage).toContain('操作失败')
    await ui.loginVoice('test-access-password'); expect(ui.authMessage).toContain('登录成功')
    expect(fetch).toHaveBeenLastCalledWith('/api/m1/login', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ password: 'test-access-password' }), signal: expect.any(AbortSignal),
    }))
    await ui.logoutVoice()
    expect(fetch).toHaveBeenLastCalledWith('/api/m1/logout', expect.objectContaining({ body: undefined }))
    expect(ui.authMessage).toContain('已退出'); expect(speech.module.stopListening).toHaveBeenCalledTimes(3)
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('ignores a queued final on logout, aborts pending access on disposal and ignores late HTTP results', async () => {
    const { ui, speech, parse, listen, begin } = setup()
    let resolve!: (value: { ok: boolean }) => void
    const fetch = vi.fn(() => new Promise<{ ok: boolean }>(done => { resolve = done }))
    vi.stubGlobal('fetch', fetch)
    await listen(); await begin(); speech.complete(fullText)
    const logout = ui.logoutVoice(); await flush(); expect(parse).not.toHaveBeenCalled()
    await ui.loginVoice('ignored'); expect(fetch).toHaveBeenCalledOnce()
    const initial = ui.authMessage
    ui.dispose(); expect(fetch.mock.calls[0]).toBeDefined()
    resolve({ ok: true }); await logout
    expect(ui.authMessage).toBe(initial)
  })
  it('reports network failure while keeping manual input available', async () => {
    const { ui } = setup()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    await ui.loginVoice('test')
    expect(ui.authMessage).toContain('无法连接'); expect(ui.authenticating).toBe(false)
    ui.updateField('workOrder', 'MANUAL'); expect(ui.draft.workOrder).toBe('MANUAL')
  })
})
