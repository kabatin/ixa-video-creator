import { TimelineClip, TimelineClipId, MediaAssetId } from '@ixa/domain'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioClipInspector } from '@/components/workbench/inspector/audio-clip-inspector'
import { aProject, renderInWorkbench } from './workbench-fixture'

/**
 * 効果音のインスペクター。音量・フェードは中身（content）ごと送るので、**尺も一緒に送る。**
 * API は中身だけの更新を「トリムの長さを比べる相手が無い」として 422 で弾く（2026-10-24、制作者の報告）。
 */

const CLIP_ID = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC0')
const media = {
  type: 'media' as const,
  mediaAssetId: MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC1'),
  inSec: 0,
  outSec: 1.5,
  volume: 0.5,
}
const clip = (content: TimelineClip['content'] = media) =>
  TimelineClip.parse({ id: CLIP_ID, projectId: aProject.id, track: 'SFX', startSec: 2, durationSec: 1.5, layer: 0, content, opacity: 1, createdAt: new Date() })

const fake = vi.hoisted(() => ({ listClips: vi.fn(), updateClip: vi.fn(), deleteClip: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => fake }))

beforeEach(() => {
  for (const fn of Object.values(fake)) fn.mockReset()
  fake.listClips.mockResolvedValue([clip()])
  fake.updateClip.mockImplementation((_id: string, patch: { content?: TimelineClip['content'] }) => Promise.resolve(clip(patch.content)))
})

describe('AudioClipInspector', () => {
  it('音量を変えると、中身と一緒に今の尺も送る', async () => {
    renderInWorkbench(<AudioClipInspector id={CLIP_ID} />)
    const field = await screen.findByLabelText('音量')
    await userEvent.clear(field)
    await userEvent.type(field, '80{Enter}')
    await waitFor(() => {
      expect(fake.updateClip).toHaveBeenCalledWith(CLIP_ID, { content: { ...media, volume: 0.8 }, durationSec: 1.5 })
    })
  })
})
