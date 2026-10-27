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
    const sections = ['keywords-title', 'voice-title', 'draft-title', 'history-title']
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

  it('initially gates real history while keeping manual input available', async () => {
    const html = await renderToString(createSSRApp(App))
    expect(html).toContain('浏览器本地历史记录')
    expect(html).toContain('草稿刷新后丢失')
    expect(html).toContain('历史加载中')
    expect(html).not.toContain('<dialog')
    expect(html).toMatch(/id="draft-work-order"[^>]*>/)
    expect(html.match(/<input id="draft-work-order"[^>]*>/)?.[0]).not.toContain('disabled')
    expect(html).toContain('已确认文本')
    expect(html).toContain('临时文本')
    expect(html.match(/<button[^>]*>保存<\/button>/)?.[0]).toContain('disabled')
  })

  it('offers real listening without Mock tools and gates recording/export until ready', async () => {
    const html = await renderToString(createSSRApp(App))
    for (const text of ['Mock 测试工具', '执行模拟命令', '返回模拟解析结果', '模拟核对结果']) {
      expect(html).not.toContain(text)
    }
    for (const text of ['结束录入', '导出选中记录至 CSV', '导出全部记录至 CSV']) {
      const button = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find(value => value.includes(text))
      expect(button).toBeDefined()
      expect(button).toContain('disabled')
    }
    const listen = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find(value => value.includes('开始监听'))
    expect(listen).toBeDefined()
    expect(listen).not.toContain('disabled')
    expect(html).toContain('语音代理访问')
    expect(html).not.toContain('Mock ·')
    expect(html).not.toContain('CSV 导出尚未接入')
    expect(html).toContain('导出全部不受筛选限制')
  })

  it('freezes draft controls while preserving their values', async () => {
    const html = await renderToString(createSSRApp(DraftPanel, { draft: { ...emptyDraft, contactResistance: 0 }, disabled: true }))
    const controls = html.match(/<(?:button|input|select)\b[^>]*>/g) ?? []
    expect(controls).toHaveLength(8)
    expect(controls.every(control => /\sdisabled(?:\s|>|=)/.test(control))).toBe(true)
    expect(html).toMatch(/type="number"[^>]*value="0"/)
  })
})
