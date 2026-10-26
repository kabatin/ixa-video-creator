import type { LockedProjectClips, MediaAssetRepository, ProjectClipLock, ShotRepository, TakeRepository } from '@ixa/db'
import {
  dialogueTelopClips,
  dialogueTelopOf,
  dubRecordOf,
  isEmptyDialogueTelopPlan,
  planDialogueTelopSync,
  shotPlaybackRate,
  takeAudioPlays,
  type CreateTimelineClipInput,
  type DialogueTelopPlan,
  type DialogueTelopShot,
  type ProjectId,
  type Shot,
  type SpeechSegment,
  type TimelineClip,
} from '@ixa/domain'

/**
 * セリフの字幕を、Shot のセリフの行に合わせて作り直す（ADR-0061）。規則は domain の `dialogueTelopClips`。
 * api（セリフ・Take・Take の音・Shot の時刻を変えた）と worker（取り込みで話している区間が分かった）の両方から呼ぶ。
 *
 * - **同じ作品の作り直しは 1 本ずつ**（`lock`。本物は `pg_advisory_xact_lock`）。鍵を取ってから今の字幕を読み直して書く。
 *   並んだ作り直しが、読んだ時点で字幕が無い全員で足して重ねる・読んだ後に人が直した時刻を古い値で潰す、を防ぐ。
 * - **差分で書く**（`planDialogueTelopSync`）。残る行はその場で直し、ID を変えない。中身が同じなら書かない。
 * - **セリフから作ったテロップだけ**を触る（手で置いたテロップ・歌詞・ナレーションは触らない）。
 * - **セリフの無い作品は書かない**（セリフの字幕が残っていなければ、鍵の中で読むだけ）。
 */

export type DialogueTelopSyncDeps = {
  readonly shots: Pick<ShotRepository, 'findByProject'>
  readonly takes: Pick<TakeRepository, 'findById'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
  readonly lock: ProjectClipLock
}

type SyncResult = { readonly changed: boolean; readonly count: number }

const isDialogueTelop = (clip: TimelineClip): boolean =>
  clip.content.type === 'text' && dialogueTelopOf(clip.content.params) !== null

/**
 * 声を差し替えた Take（ADR-0062）の、行ごとの置いた時刻（Take の頭からの秒）。行の順に並べる。
 * 置いた時刻は無音の検出より正確なので、これを話している区間の代わりにする。区間が空の行は数を合わせないよう残す。
 */
const placedSpeech = (record: NonNullable<ReturnType<typeof dubRecordOf>>): readonly SpeechSegment[] =>
  [...record.lines]
    .sort((a, b) => a.lineIndex - b.lineIndex)
    .map((line) => ({ startSec: line.placedStartSec, endSec: Math.max(line.placedEndSec, line.placedStartSec + 0.001) }))

/** 時刻を決めるのに要る、採用 Take の速さと話している区間。Take が無い・素材が読めなければ「音なし・速さ 1」。 */
const timingOf = async (deps: DialogueTelopSyncDeps, shot: Shot): Promise<DialogueTelopShot> => {
  const take = shot.selectedTakeId === null ? null : await deps.takes.findById(shot.selectedTakeId)
  const asset = take === null ? null : await deps.mediaAssets.findById(take.mediaAssetId)
  const probe = asset?.probe ?? null
  const dub = take === null ? null : dubRecordOf(take)
  // 差し替えた Take には必ず音がある（測る前でも、記録の時刻を使う）。
  const hasAudio = probe?.hasAudio === true || (dub !== null && probe === null)
  // 鳴らす Take の声にだけ合わせる（消音した Shot の声は観客に聞こえないので、区間に合わせても意味が無い）。
  const plays = takeAudioPlays(shot, hasAudio)
  const speech = dub !== null ? placedSpeech(dub) : (probe?.speechSegments ?? null)
  return {
    shot,
    playbackRate: take === null ? 1 : shotPlaybackRate(shot, probe?.durationSec ?? null),
    speech: plays ? speech : null,
  }
}

const markKey = (clip: Pick<CreateTimelineClipInput, 'content'>): string | null => {
  const mark = clip.content.type === 'text' ? dialogueTelopOf(clip.content.params) : null
  return mark === null ? null : `${mark.shotId}#${String(mark.lineIndex)}`
}

const textOf = (clip: Pick<CreateTimelineClipInput, 'content'>): unknown =>
  clip.content.type === 'text' ? clip.content.params?.['text'] : undefined

/**
 * 戻してよい、消した字幕（Shot を消して取り消した・セリフを消して取り消した）。**同じ行で、字が同じ**ものだけ、
 * 行ごとに新しく消したほうを 1 枚。作り直しで消した字幕は取り消しの記録に入らないので、ここで戻して
 * 見た目と手で直した時刻を残す。字が変わった行は戻さない（別のセリフに昔の時刻を当てない）。
 */
const restorableTelops = async (
  clips: LockedProjectClips,
  projectId: ProjectId,
  live: readonly TimelineClip[],
  desired: readonly Pick<CreateTimelineClipInput, 'content'>[],
): Promise<readonly TimelineClip[]> => {
  const liveKeys = new Set(live.flatMap((clip) => markKey(clip) ?? []))
  const missing = new Map(
    desired.flatMap((clip) => {
      const key = markKey(clip)
      return key === null || liveKeys.has(key) ? [] : [[key, textOf(clip)] as const]
    }),
  )
  if (missing.size === 0) return []
  const deleted = await clips.findDeletedByProject(projectId)
  return [...missing].flatMap(([key, text]) => {
    const found = deleted.find((clip) => markKey(clip) === key && textOf(clip) === text)
    return found === undefined ? [] : [found]
  })
}

const apply = async (clips: LockedProjectClips, plan: DialogueTelopPlan): Promise<void> => {
  for (const id of plan.deletes) await clips.softDelete(id)
  for (const { id, patch } of plan.updates) await clips.update(id, patch)
  for (const { id, patch } of plan.restores) {
    await clips.restore(id)
    if (patch !== null) await clips.update(id, patch)
  }
  for (const input of plan.creates) await clips.create(input)
}

export const syncDialogueTelops = async (deps: DialogueTelopSyncDeps, projectId: ProjectId): Promise<SyncResult> => {
  // Shot も鍵の中で読む（先に読むと、後から来た作り直しが新しい行で書いた後に、古い行で書き戻してしまう）。
  return deps.lock(projectId, async (clips) => {
    const speaking = (await deps.shots.findByProject(projectId)).filter((shot) => shot.dialogue.length > 0)
    const timed = await Promise.all(speaking.map((shot) => timingOf(deps, shot)))
    const live = (await clips.findByProject(projectId)).filter(isDialogueTelop)
    if (timed.length === 0 && live.length === 0) return { changed: false, count: 0 }
    const first = dialogueTelopClips({ projectId, shots: timed, existing: live })
    const restorable = await restorableTelops(clips, projectId, live, first)
    const desired = restorable.length === 0 ? first : dialogueTelopClips({ projectId, shots: timed, existing: [...live, ...restorable] })
    const plan = planDialogueTelopSync({ live, restorable, desired })
    if (isEmptyDialogueTelopPlan(plan)) return { changed: false, count: desired.length }
    await apply(clips, plan)
    return { changed: true, count: desired.length }
  })
}
