import { ImageGenerationJobId, ProjectId, ThumbnailId, type ProjectEvent } from '@ixa/domain'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentExportMessage } from '@/components/thumbnail/thumbnail-exports'
import { useKeyArtJobs } from '@/components/thumbnail/use-key-art-jobs'
import {
  EXPORT_TIMEOUT_MS,
  LIST_REFRESH_AFTER_TIMEOUT_MS,
  STILL_WAITING_MESSAGE,
  useThumbnailExport,
} from '@/components/thumbnail/use-thumbnail-export'
import { imageJobFailureNotice } from '@/lib/image-job-notice'
import { WireKeyArtJob, WireThumbnail, type ThumbnailApi } from '@/lib/thumbnail-api'
import { PROJECT_ID } from './fixtures'

/**
 * サムネイルの書き出しとキーアートの追いかけ（ADR-0051）。
 * 諦めたら押せるように戻ること、閉じたら追わないこと、同じ絵を 2 度頼まないことを確かめる。
 */

const projectId = ProjectId.parse(PROJECT_ID)
const THUMBNAIL_ID = ThumbnailId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC1')
const JOB_ID = ImageGenerationJobId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC2')

const queued = WireThumbnail.parse({
  id: THUMBNAIL_ID,
  projectId: PROJECT_ID,
  spec: { background: { kind: 'timeline_frame', atSec: 1 }, title: 'iXA CUP' },
  status: 'queued',
  outputAssetId: null,
  fileName: 'iXA CUP サムネ 2026-10-17 10.00.00 k3m9qz.jpg',
  error: null,
  createdAt: '2026-10-17T01:00:00.000Z',
  finishedAt: null,
})

const runningKeyArt = WireKeyArtJob.parse({
  id: JOB_ID,
  status: 'running',
  instruction: null,
  mediaAssetId: null,
  error: null,
  queuedAt: '2026-10-17T01:00:00.000Z',
  finishedAt: null,
})

const apiFake = (overrides: Partial<ThumbnailApi> = {}): ThumbnailApi => ({
  startThumbnail: vi.fn<ThumbnailApi['startThumbnail']>(() => Promise.resolve(THUMBNAIL_ID)),
  getThumbnail: vi.fn<ThumbnailApi['getThumbnail']>(() => Promise.resolve(queued)),
  listThumbnails: vi.fn<ThumbnailApi['listThumbnails']>(() => Promise.resolve([])),
  generateKeyArt: vi.fn<ThumbnailApi['generateKeyArt']>(() => Promise.resolve([JOB_ID])),
  listKeyArt: vi.fn<ThumbnailApi['listKeyArt']>(() => Promise.resolve([runningKeyArt])),
  ...overrides,
})

const flush = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useThumbnailExport', () => {
  it('待ったまま時間切れになったら押せるように戻し、まだ待っていると言い、あとで一覧を読み直す', async () => {
    const api = apiFake()
    const { result } = renderHook(() => useThumbnailExport(projectId, api))
    await flush()
    act(() => result.current.start(queued.spec))
    await flush()
    expect(result.current.busy).toBe(true)

    await advance(EXPORT_TIMEOUT_MS + 2_000)
    expect(result.current.busy).toBe(false)
    expect(result.current.note).toBe(STILL_WAITING_MESSAGE)

    const listCalls = vi.mocked(api.listThumbnails).mock.calls.length
    await advance(LIST_REFRESH_AFTER_TIMEOUT_MS)
    expect(vi.mocked(api.listThumbnails).mock.calls.length).toBe(listCalls + 1)
  })

  it('頼んだ直後に閉じたら、返事が来ても追いかけを始めない', async () => {
    const api = apiFake()
    const { result, unmount } = renderHook(() => useThumbnailExport(projectId, api))
    await flush()
    act(() => result.current.start(queued.spec))
    unmount()
    await flush()
    const calls = vi.mocked(api.getThumbnail).mock.calls.length
    await advance(30_000)
    expect(vi.mocked(api.getThumbnail).mock.calls.length).toBe(calls)
  })
})

describe('useKeyArtJobs', () => {
  it('同じ描画のうちに 2 度押しても 1 度しか頼まない', async () => {
    const api = apiFake()
    const { result } = renderHook(() => useKeyArtJobs(projectId, api))
    await flush()
    await act(async () => {
      await Promise.all([
        result.current.generate({ count: 2, instruction: '' }),
        result.current.generate({ count: 2, instruction: '' }),
      ])
    })
    expect(api.generateKeyArt).toHaveBeenCalledTimes(1)
  })

  it('描いている間は頼めず、描き終われば頼める', async () => {
    const listKeyArt = vi.fn<ThumbnailApi['listKeyArt']>(() => Promise.resolve([runningKeyArt]))
    const api = apiFake({ listKeyArt })
    const { result } = renderHook(() => useKeyArtJobs(projectId, api))
    await flush()
    await act(async () => {
      await result.current.generate({ count: 1, instruction: '' })
    })
    expect(result.current.canGenerate).toBe(false)
    await advance(4_000)
    expect(result.current.drawing).toBe(1)
    expect(result.current.canGenerate).toBe(false)

    listKeyArt.mockImplementation(() =>
      Promise.resolve([{ ...runningKeyArt, status: 'succeeded', mediaAssetId: runningKeyArt.id as never }]),
    )
    await advance(4_000)
    expect(result.current.canGenerate).toBe(true)
  })

  it('閉じたら追いかけを止める', async () => {
    const api = apiFake()
    const { result, unmount } = renderHook(() => useKeyArtJobs(projectId, api))
    await flush()
    await act(async () => {
      await result.current.generate({ count: 1, instruction: '' })
    })
    unmount()
    const calls = vi.mocked(api.listKeyArt).mock.calls.length
    await advance(30_000)
    expect(vi.mocked(api.listKeyArt).mock.calls.length).toBe(calls)
  })
})

describe('imageJobFailureNotice', () => {
  const event = (patch: Partial<Extract<ProjectEvent, { type: 'image_job.status' }>>) => ({
    type: 'image_job.status' as const,
    projectId,
    at: '2026-10-17T01:00:00.000Z',
    shotId: null,
    characterId: null,
    jobId: JOB_ID,
    status: 'failed' as const,
    error: '絵が返ってきませんでした。',
    ...patch,
  })

  it('Shot もキャラクターも無い失敗はサムネイルの背景の絵と言う', () => {
    expect(imageJobFailureNotice(event({}))).toBe('サムネイルの背景の絵を作れませんでした: 絵が返ってきませんでした。')
  })

  it('Shot なら絵コンテの画像、キャラクターならキャラクターシート。失敗でなければ知らせない', () => {
    expect(imageJobFailureNotice(event({ shotId: '01ARZ3NDEKTSV4RRFFQ69G5FC3' as never }))).toMatch(/^絵コンテの画像/)
    expect(imageJobFailureNotice(event({ characterId: '01ARZ3NDEKTSV4RRFFQ69G5FC4' as never }))).toMatch(
      /^キャラクターシート/,
    )
    expect(imageJobFailureNotice(event({ status: 'running' }))).toBeNull()
  })
})

describe('currentExportMessage', () => {
  it('失敗したら残された理由だけを出す（前置きを重ねない）', () => {
    expect(currentExportMessage({ status: 'failed', error: 'サムネイルを描けませんでした。' })).toBe(
      'サムネイルを描けませんでした。',
    )
    expect(currentExportMessage({ status: 'failed', error: null })).toBe('書き出せませんでした')
    expect(currentExportMessage({ status: 'queued', error: null })).toBe('順番を待っています…')
  })
})
