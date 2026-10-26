import type { LockedProjectClips, MediaAssetRepository, ProjectClipLock, ShotRepository, TakeRepository } from '@ixa/db'
import {
  dialogueTelopClips,
  dialogueTelopOf,
  isEmptyDialogueTelopPlan,
  planDialogueTelopSync,
  shotPlaybackRate,
  takeAudioPlays,
  type DialogueTelopPlan,
  type DialogueTelopShot,
  type ProjectId,
  type Shot,
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

/** 時刻を決めるのに要る、採用 Take の速さと話している区間。Take が無い・素材が読めなければ「音なし・速さ 1」。 */
const timingOf = async (deps: DialogueTelopSyncDeps, shot: Shot): Promise<DialogueTelopShot> => {
  const take = shot.selectedTakeId === null ? null : await deps.takes.findById(shot.selectedTakeId)
  const asset = take === null ? null : await deps.mediaAssets.findById(take.mediaAssetId)
  const probe = asset?.probe ?? null
  // 鳴らす Take の声にだけ合わせる（消音した Shot の声は観客に聞こえないので、区間に合わせても意味が無い）。
  const plays = takeAudioPlays(shot, probe?.hasAudio === true)
  return {
    shot,
    playbackRate: take === null ? 1 : shotPlaybackRate(shot, probe?.durationSec ?? null),
    speech: plays ? (probe?.speechSegments ?? null) : null,
  }
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
    const desired = dialogueTelopClips({ projectId, shots: timed, existing: live })
    const plan = planDialogueTelopSync({ live, desired })
    if (isEmptyDialogueTelopPlan(plan)) return { changed: false, count: desired.length }
    await apply(clips, plan)
    return { changed: true, count: desired.length }
  })
}
