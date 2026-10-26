import {
  CharacterId,
  MediaAsset,
  MediaAssetId,
  ProjectId,
  WorkspaceId,
  dialogueTelopOf,
  newId,
  type DialogueLine,
  type MediaProbe,
  type Shot,
  type TimelineClip,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { syncDialogueTelops } from '../dialogue-telops.js'
import {
  aShot,
  aTake,
  createInMemoryMediaAssetRepository,
  createInMemoryProjectClipLock,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
  createInMemoryTimelineClipRepository,
} from '../testing.js'

/**
 * セリフの字幕を、Shot の行に合わせて作り直す（ADR-0061）。セリフから作ったテロップだけを差し替え、
 * 手で置いたテロップ・歌詞・ナレーションは触らない。中身が変わらなければ書き換えない。
 */

const PROJECT = newId(ProjectId)
const SPEAKER = newId(CharacterId)
const line = (text: string, translation: string | null = null): DialogueLine => ({ speakerId: SPEAKER, text, offscreen: false, translation })

const asset = (probe: MediaProbe | null): MediaAsset =>
  MediaAsset.parse({
    id: newId(MediaAssetId),
    workspaceId: newId(WorkspaceId),
    projectId: PROJECT,
    kind: 'video',
    storageKey: 'media/ws/a/original.mp4',
    mimeType: 'video/mp4',
    bytes: 1,
    checksumSha256: 'a'.repeat(64),
    probe,
    proxyKey: null,
    thumbnailKey: null,
    origin: { type: 'upload', uploadedBy: 'test' },
    createdAt: new Date(0),
  })

const probeWith = (patch: Partial<MediaProbe>): MediaProbe => ({
  durationSec: 6,
  width: 320,
  height: 240,
  fps: 24,
  hasAudio: true,
  codec: 'h264',
  ...patch,
})

/** セリフのある Shot（必要なら採用 Take と素材つき）。 */
const setup = (input: { readonly shot?: Partial<Shot>; readonly probe?: MediaProbe | null; readonly clips?: readonly TimelineClip[] } = {}) => {
  const baseShot = aShot(PROJECT, { startSec: 10, durationSec: 6, dialogue: [line('あいう'), line('かきくけこさ')], ...input.shot })
  const media = input.probe === undefined ? null : asset(input.probe)
  const take = media === null ? null : aTake(baseShot, 'a'.repeat(64), { mediaAssetId: media.id })
  const shot = take === null ? baseShot : { ...baseShot, selectedTakeId: take.id }
  const timelineClips = createInMemoryTimelineClipRepository(input.clips ?? [])
  const deps = {
    shots: createInMemoryShotRepository([shot]),
    takes: createInMemoryTakeRepository(take === null ? [] : [take]),
    mediaAssets: createInMemoryMediaAssetRepository(media === null ? [] : [media]),
    lock: createInMemoryProjectClipLock(timelineClips),
    timelineClips,
  }
  return { deps, shot }
}

const dialogueClips = (clips: readonly TimelineClip[]) =>
  clips
    .filter((clip) => clip.content.type === 'text' && dialogueTelopOf(clip.content.params) !== null)
    .sort((a, b) => a.startSec - b.startSec)

const spans = (clips: readonly TimelineClip[]) => dialogueClips(clips).map((clip) => [clip.startSec, clip.durationSec])

describe('syncDialogueTelops', () => {
  it('Take が無い（音が無い）Shot は、尺を文字数で割り振る', async () => {
    const { deps } = setup()
    expect(await syncDialogueTelops(deps, PROJECT)).toEqual({ changed: true, count: 2 })
    expect(spans(deps.timelineClips.snapshot())).toEqual([
      [10, 2],
      [12, 4],
    ])
  })

  it('音を鳴らす Take で、話している区間が行の数と合えば、区間を当てる', async () => {
    const probe = probeWith({ speechSegments: [{ startSec: 0.4, endSec: 1.4 }, { startSec: 2, endSec: 5 }] })
    const { deps } = setup({ probe })
    await syncDialogueTelops(deps, PROJECT)
    expect(spans(deps.timelineClips.snapshot())).toEqual([
      [10.4, 1],
      [12, 3],
    ])
  })

  it('区間の数が合わなければ割り振りに戻る', async () => {
    const { deps } = setup({ probe: probeWith({ speechSegments: [{ startSec: 0.4, endSec: 5 }] }) })
    await syncDialogueTelops(deps, PROJECT)
    expect(spans(deps.timelineClips.snapshot())).toEqual([
      [10, 2],
      [12, 4],
    ])
  })

  it('音を鳴らさない Shot（消音）では区間を使わない（鳴らない声に合わせない）', async () => {
    const probe = probeWith({ speechSegments: [{ startSec: 0.4, endSec: 1.4 }, { startSec: 2, endSec: 5 }] })
    const { deps } = setup({ probe, shot: { takeAudioMuted: true } })
    await syncDialogueTelops(deps, PROJECT)
    expect(spans(deps.timelineClips.snapshot())).toEqual([
      [10, 2],
      [12, 4],
    ])
  })

  it('音のトラックが無い Take・測っていない Take も割り振り', async () => {
    const segments = [{ startSec: 0.4, endSec: 1.4 }, { startSec: 2, endSec: 5 }]
    for (const probe of [probeWith({ hasAudio: false, speechSegments: segments }), probeWith({}), null]) {
      const { deps } = setup({ probe })
      await syncDialogueTelops(deps, PROJECT)
      expect(spans(deps.timelineClips.snapshot())).toEqual([
        [10, 2],
        [12, 4],
      ])
    }
  })

  it('中身が変わらなければ書き換えない（2 回目は何もしない）', async () => {
    const { deps } = setup()
    await syncDialogueTelops(deps, PROJECT)
    const ids = deps.timelineClips.snapshot().map((clip) => clip.id)
    expect(await syncDialogueTelops(deps, PROJECT)).toEqual({ changed: false, count: 2 })
    expect(deps.timelineClips.snapshot().map((clip) => clip.id)).toEqual(ids)
  })

  it('手で動かした時刻は、区間が分かった後の同期でも保つ', async () => {
    const { deps, shot } = setup()
    await syncDialogueTelops(deps, PROJECT)
    const [first] = dialogueClips(deps.timelineClips.snapshot())
    if (first === undefined) throw new Error('字幕があるはず')
    await deps.timelineClips.update(first.id, { startSec: 10.7, durationSec: 0.9 })
    await deps.shots.update(shot.id, { dialogue: [line('あいう', 'Ah'), line('かきくけこさ')] })
    await syncDialogueTelops(deps, PROJECT)
    const after = dialogueClips(deps.timelineClips.snapshot())
    expect(after.map((clip) => [clip.startSec, clip.durationSec])).toEqual([
      [10.7, 0.9],
      [12, 4],
    ])
    expect(after[0]?.content).toMatchObject({ params: { translation: 'Ah' } })
  })

  it('セリフの無い作品は何も書かない（MV のテロップは触らない）', async () => {
    const manual = createInMemoryTimelineClipRepository()
    const lyric = await manual.create({
      projectId: PROJECT,
      track: 'TEXT',
      startSec: 1,
      durationSec: 2,
      layer: 1,
      content: { type: 'text', templateKey: 'plain', params: { text: '歌詞', lyricLine: 0 } },
    })
    const { deps } = setup({ shot: { dialogue: [] }, clips: manual.snapshot() })
    let writes = 0
    const count = <T>(run: () => Promise<T>): Promise<T> => {
      writes += 1
      return run()
    }
    const watched = {
      ...deps,
      lock: ((projectId, fn) =>
        deps.lock(projectId, (clips) =>
          fn({
            ...clips,
            create: (input) => count(() => clips.create(input)),
            update: (id, patch) => count(() => clips.update(id, patch)),
            softDelete: (id) => count(() => clips.softDelete(id)),
            restore: (id) => count(() => clips.restore(id)),
          }),
        )) as typeof deps.lock,
    }
    expect(await syncDialogueTelops(watched, PROJECT)).toEqual({ changed: false, count: 0 })
    expect(writes).toBe(0)
    expect(deps.timelineClips.snapshot()).toEqual([lyric])
  })

  it('セリフを消したら、その字幕も消す（ほかのテロップは残す）', async () => {
    const { deps, shot } = setup()
    await syncDialogueTelops(deps, PROJECT)
    await deps.shots.update(shot.id, { dialogue: [] })
    expect(await syncDialogueTelops(deps, PROJECT)).toEqual({ changed: true, count: 0 })
    expect(dialogueClips(deps.timelineClips.snapshot())).toEqual([])
  })

  it('同じ作品の作り直しが並んでも、字幕は行ごとに 1 枚（MCP は Shot を並べて直す）', async () => {
    const { deps } = setup()
    await Promise.all([1, 2, 3, 4].map(() => syncDialogueTelops(deps, PROJECT)))
    expect(spans(deps.timelineClips.snapshot())).toEqual([
      [10, 2],
      [12, 4],
    ])
  })

  it('前に重なって作られた字幕は、1 枚を残して消す', async () => {
    const { deps } = setup()
    await syncDialogueTelops(deps, PROJECT)
    const [first] = dialogueClips(deps.timelineClips.snapshot())
    if (first === undefined) throw new Error('字幕があるはず')
    await deps.timelineClips.create({
      projectId: first.projectId,
      track: first.track,
      startSec: first.startSec,
      durationSec: first.durationSec,
      layer: first.layer,
      opacity: first.opacity,
      content: first.content,
    })
    await syncDialogueTelops(deps, PROJECT)
    expect(dialogueClips(deps.timelineClips.snapshot())).toHaveLength(2)
    expect(dialogueClips(deps.timelineClips.snapshot()).map((clip) => clip.id)).toContain(first.id)
  })

  it('直すときは同じ ID のまま（取り消しの記録とインスペクターの選択が切れない）', async () => {
    const { deps, shot } = setup()
    await syncDialogueTelops(deps, PROJECT)
    const before = dialogueClips(deps.timelineClips.snapshot()).map((clip) => clip.id)
    await deps.shots.update(shot.id, { dialogue: [line('あいう', 'Ah'), line('かきくけこさ'), line('たち')] })
    await syncDialogueTelops(deps, PROJECT)
    const after = dialogueClips(deps.timelineClips.snapshot())
    expect(after.slice(0, 2).map((clip) => clip.id)).toEqual(before)
    expect(after).toHaveLength(3)
    expect(after[0]?.content).toMatchObject({ params: { translation: 'Ah' } })
  })

  it('Shot を消して取り消すと、消した字幕を同じ ID で戻す（見た目と手で直した時刻が残る）', async () => {
    const { deps, shot } = setup()
    await syncDialogueTelops(deps, PROJECT)
    const [first] = dialogueClips(deps.timelineClips.snapshot())
    if (first === undefined || first.content.type !== 'text') throw new Error('字幕があるはず')
    await deps.timelineClips.update(first.id, {
      startSec: 10.7,
      durationSec: 0.9,
      content: { ...first.content, params: { ...first.content.params, style: { color: '#FFD100' } } },
    })
    await deps.shots.softDelete(shot.id)
    await syncDialogueTelops(deps, PROJECT)
    expect(dialogueClips(deps.timelineClips.snapshot())).toEqual([])
    await deps.shots.restore(shot.id)
    await syncDialogueTelops(deps, PROJECT)
    const [back] = dialogueClips(deps.timelineClips.snapshot())
    expect(back?.id).toBe(first.id)
    expect(back).toMatchObject({ startSec: 10.7, durationSec: 0.9, content: { params: { style: { color: '#FFD100' } } } })
    expect(dialogueClips(deps.timelineClips.snapshot())).toHaveLength(2)
  })

  it('セリフの字が変わっていれば、消した字幕は戻さず新しく作る', async () => {
    const { deps, shot } = setup()
    await syncDialogueTelops(deps, PROJECT)
    const [first] = dialogueClips(deps.timelineClips.snapshot())
    await deps.shots.update(shot.id, { dialogue: [] })
    await syncDialogueTelops(deps, PROJECT)
    await deps.shots.update(shot.id, { dialogue: [line('べつのセリフ'), line('かきくけこさ')] })
    await syncDialogueTelops(deps, PROJECT)
    const ids = dialogueClips(deps.timelineClips.snapshot()).map((clip) => clip.id)
    expect(ids).not.toContain(first?.id)
    expect(ids).toHaveLength(2)
  })
})
