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

describe('Phase 1 static UI', () => {
  it('renders the required sections in vertical order, with export controls', async () => {
    const html = await renderToString(createSSRApp(App))
    const sections = ['keywords-title', 'voice-title', 'draft-title', 'history-title', 'confirmation-title']
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

  it('labels sample data and disables every business control', async () => {
    const html = await renderToString(createSSRApp(App))
    expect(html).toContain('非本地数据')
    expect(html).toContain('不会读取或写入本地存储')
    expect(html).toContain('非活动弹窗')
    const controls = html.match(/<(?:button|input|select)\b[^>]*>/g) ?? []
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.every((control) => /\sdisabled(?:\s|>|=)/.test(control))).toBe(true)
    expect(html).toContain('已确认文本')
    expect(html).toContain('临时文本')
    expect(html).toContain('datetime="2026-10-26T02:30:00.000Z"')
  })
})
