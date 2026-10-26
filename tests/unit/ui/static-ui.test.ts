import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import App from '../../../src/App.vue'
import DraftPanel from '../../../src/components/DraftPanel.vue'
import type { DraftFields } from '../../../src/shared/data-models'

const emptyDraft: DraftFields = {
  workOrder: null, partNumber: null, contactResistance: null,
  insulationResistance: null, withstandVoltage: null, result: null,
}

describe('UI layout regression', () => {
  it('renders the required sections in vertical order, with export controls', async () => {
    const html = await renderToString(createSSRApp(App))
    const sections = ['keywords-title', 'voice-title', 'draft-title', 'history-title', 'mock-title']
    const positions = sections.map((id) => html.indexOf(`id="${id}"`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(html).toContain('导出选中记录至 CSV')
    expect(html).toContain('导出全部记录至 CSV')
  })

  it('renders six empty fields and fixed unit text without defaulting to zero or PASS', async () => {
    const html = await renderToString(createSSRApp(DraftPanel, { draft: emptyDraft }))
    expect(html.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>/g)).toHaveLength(6)
    expect(html.match(/type="number"[^>]*value=""/g)).toHaveLength(3)
    expect(html).toMatch(/<option value="" selected>未选择<\/option>/)
    expect(html).not.toMatch(/<option value="(?:PASS|FAIL)" selected/)
    expect(html.match(/<th scope="col"/g)).toHaveLength(3)
    for (const displayUnit of ['mΩ', 'MΩ', 'V']) {
      expect(html).toContain(`>${displayUnit}</td>`)
    }
  })

  it('labels Mock data and initially gates history while keeping manual input available', async () => {
    const html = await renderToString(createSSRApp(App))
    expect(html).toContain('非本地数据')
    expect(html).toContain('不会读取或写入本地存储')
    expect(html).toContain('Mock：加载中')
    expect(html).not.toContain('<dialog')
    expect(html).toMatch(/id="draft-work-order"[^>]*>/)
    expect(html.match(/<input id="draft-work-order"[^>]*>/)?.[0]).not.toContain('disabled')
    expect(html).toContain('已确认文本')
    expect(html).toContain('临时文本')
    expect(html).toContain('Mock 测试工具')
  })

  it('keeps Mock tools collapsed by default, retaining scenarios without obsolete result buttons', async () => {
    const html = await renderToString(createSSRApp(App))
    const tools = html.match(/<details class="panel mock-panel"[^>]*>[\s\S]*?<\/details>/)?.[0]
    expect(tools).toBeDefined()
    expect(tools?.match(/^<details[^>]*>/)?.[0]).not.toMatch(/\sopen(?:\s|>|=)/)
    expect(tools).toContain('<summary id="mock-title">Mock 测试工具</summary>')
    for (const text of ['开始输入', '执行模拟命令', '发送预设实时文本', '返回模拟解析结果', '预设启动失败', '预设解析失败', '明确失败', '结果不确定', '模拟核对结果', '核对保存结果（Mock）']) {
      expect(tools).toContain(text)
    }
    for (const text of ['返回模拟启动结果', '返回模拟保存结果', '取消模拟启动']) {
      expect(html).not.toContain(text)
    }
  })

  it('freezes draft controls while preserving their values', async () => {
    const html = await renderToString(createSSRApp(DraftPanel, { draft: { ...emptyDraft, contactResistance: 0 }, disabled: true }))
    const controls = html.match(/<(?:button|input|select)\b[^>]*>/g) ?? []
    expect(controls).toHaveLength(8)
    expect(controls.every(control => /\sdisabled(?:\s|>|=)/.test(control))).toBe(true)
    expect(html).toMatch(/type="number"[^>]*value="0"/)
  })
})
