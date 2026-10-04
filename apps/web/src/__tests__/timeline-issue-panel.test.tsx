import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TimelineIssuePanel } from '@/components/timeline-issue-panel'
import type { TimelineIssueView } from '@/lib/timeline-issues'

/**
 * タイムラインの検査結果の見出し。警告だけ（書き出せる）なのに赤い枠で「指摘があります」と出ていて、
 * 書き出せるのかが分からなかった（制作者 2026-10-03「書き出し画面は UI/UX が雑な印象」）。画面に HTTP の番号も出していた。
 */

const issue = (severity: 'error' | 'warning'): TimelineIssueView => ({ severity, code: 'take_not_selected', message: '指摘' })

describe('TimelineIssuePanel の見出し', () => {
  it('警告だけなら黄色で「書き出せます」', () => {
    render(<TimelineIssuePanel issues={[issue('warning')]} />)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toMatch(/警告があります（書き出せます）/)
    expect(heading.className).toContain('text-warn')
  })

  it('書き出せない指摘があれば赤で、HTTP の番号を出さずに理由を言う', () => {
    render(<TimelineIssuePanel issues={[issue('error'), issue('warning')]} />)
    expect(screen.getByRole('heading', { level: 2 }).className).toContain('text-danger')
    expect(screen.getByText(/残っている間は書き出せません/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/422/)
  })
})
