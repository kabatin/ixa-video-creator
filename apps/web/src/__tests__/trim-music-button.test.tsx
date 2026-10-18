import { EditBatchId as EditBatchIdSchema, MusicTrackId as MusicTrackIdSchema, newId, type MusicTrack, type ProjectId } from '@ixa/domain'
import { TIMELINE_ISSUE_CODES } from '@ixa/timeline'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TimelineIssuePanel } from '@/components/timeline-issue-panel'
import { TrimMusicButton } from '@/components/trim-music-button'
import { buildEditHistoryView, buildUndoResultView } from '@/lib/edit-history'
import type { WireEditBatch } from '@/lib/edit-history-api'
import type { MusicTrimApi } from '@/lib/music-trim-api'
import type { TimelineIssueView } from '@/lib/timeline-issues'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

/**
 * 尻の黒画面の警告から曲を最後の Shot で切る（制作者 2026-10-19「カットの合計尺より音楽が長いと最後に黒画面が出来てしまう」）。
 */

const projectId = '01J00000000000000000000000' as ProjectId
const tail: TimelineIssueView = {
  severity: 'warning',
  code: TIMELINE_ISSUE_CODES.shotGapTail,
  message: '最後の Shot TT-07 から曲の終わりまでの 5.620s が黒画面になる',
}
const gap: TimelineIssueView = { severity: 'warning', code: TIMELINE_ISSUE_CODES.shotGap, message: '隙間' }

describe('尻の黒画面の警告に「曲を最後の Shot で切る」を添える', () => {
  it('尻の黒画面の警告にだけ出す（ほかの指摘には出さない）', () => {
    const { rerender } = render(<TimelineIssuePanel issues={[tail, gap]} projectId={projectId} />)
    expect(screen.getAllByRole('button', { name: '曲を最後の Shot で切る' })).toHaveLength(1)

    rerender(<TimelineIssuePanel issues={[gap]} projectId={projectId} />)
    expect(screen.queryByRole('button', { name: '曲を最後の Shot で切る' })).toBeNull()
  })

  it('押すと切って、取り消せることを伝え、読み直しの合図を出す', async () => {
    const trimMusicToShots = vi.fn<MusicTrimApi['trimMusicToShots']>().mockResolvedValue({
      track: { id: newId(MusicTrackIdSchema) } as MusicTrack,
      editBatchId: newId(EditBatchIdSchema),
    })
    const onTrimmed = vi.fn()
    render(<TrimMusicButton projectId={projectId} api={{ trimMusicToShots }} onTrimmed={onTrimmed} />)

    fireEvent.click(screen.getByRole('button', { name: '曲を最後の Shot で切る' }))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/「元に戻す」で戻せます/)
    })
    expect(trimMusicToShots).toHaveBeenCalledWith(projectId)
    expect(onTrimmed).toHaveBeenCalledTimes(1)
  })

  it('切れなければ理由を出し、読み直しの合図は出さない', async () => {
    const trimMusicToShots = vi.fn<MusicTrimApi['trimMusicToShots']>().mockRejectedValue(new Error('鳴らしている曲がありません'))
    const onTrimmed = vi.fn()
    render(<TrimMusicButton projectId={projectId} api={{ trimMusicToShots }} onTrimmed={onTrimmed} />)

    fireEvent.click(screen.getByRole('button', { name: '曲を最後の Shot で切る' }))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/切れませんでした/)
    })
    expect(onTrimmed).not.toHaveBeenCalled()
  })
})

describe('曲を切った記録の履歴', () => {
  const batch: WireEditBatch = {
    id: newId(EditBatchIdSchema),
    kind: 'music_trim',
    summary: '曲「宣伝の曲」を最後の Shot の終わりで切りました',
    shotCount: 0,
    clipCount: 0,
    lineCount: 0,
    musicCount: 1,
    undoneAt: null,
    createdAt: '2026-10-19T01:00:00.000Z',
    canUndo: true,
  }

  it('種類と曲の数で言う', () => {
    const [row] = buildEditHistoryView([batch]).rows
    expect(row?.kindLabel).toBe('曲を最後の Shot で切る')
    expect(row?.shotCountLabel).toBe('1 曲')
  })

  it('戻した結果も曲の数で言い、戻せなかった理由を残す', () => {
    const musicTrackId = newId(MusicTrackIdSchema)
    const base = { batch, restored: [], failed: [], restoredClips: [], failedClips: [] }
    expect(buildUndoResultView({ ...base, restoredMusicTracks: [musicTrackId], failedMusicTracks: [] }).summary).toBe('曲 1 件を元に戻しました')

    const failed = buildUndoResultView({ ...base, restoredMusicTracks: [], failedMusicTracks: [{ musicTrackId, reason: '楽曲が見つかりません' }] })
    expect(failed.summary).toBe('曲 0 件を元に戻し、1 件は戻せませんでした')
    expect(failed.failedClips.map((entry) => entry.reason)).toEqual(['楽曲が見つかりません'])
  })
})
