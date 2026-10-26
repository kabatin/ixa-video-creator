import {
  DbNotFoundError,
  type MediaAssetRepository,
  type ShotRepository,
  type TakeRepository,
  type TimelineClipRepository,
} from '@ixa/db'
import {
  canonicalJson,
  dialogueTelopClips,
  dialogueTelopOf,
  shotPlaybackRate,
  takeAudioPlays,
  type CreateTimelineClipInput,
  type DialogueTelopShot,
  type ProjectId,
  type Shot,
  type TimelineClip,
} from '@ixa/domain'

/**
 * セリフの字幕を、Shot のセリフの行に合わせて作り直す（ADR-0061）。規則は domain の `dialogueTelopClips`。
 * api（セリフ・Take・Take の音・Shot の時刻を変えた）と worker（取り込みで話している区間が分かった）の両方から呼ぶ。
 *
 * - **セリフから作ったテロップだけを差し替える**（手で置いたテロップ・歌詞・ナレーションは触らない）。
 * - **セリフの無い作品は書かない**（読むだけ。セリフの字幕も無ければ差し替えを呼ばない）。
 * - 中身が変わらなければ何もしない（タイムラインを無駄に書き換えない）。
 */

export type DialogueTelopSyncDeps = {
  readonly shots: Pick<ShotRepository, 'findByProject'>
  readonly takes: Pick<TakeRepository, 'findById'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
  readonly timelineClips: Pick<TimelineClipRepository, 'findByProject' | 'replace'>
}

type SyncResult = { readonly changed: boolean; readonly count: number }

/** 比べるための形（ID・作った時刻を除く。作る前の入力は層と不透明度を省けるので、既定で埋める）。 */
const shapeOf = (clip: Pick<CreateTimelineClipInput, 'track' | 'startSec' | 'durationSec' | 'layer' | 'opacity'> & { readonly content: unknown }): string =>
  canonicalJson({ track: clip.track, startSec: clip.startSec, durationSec: clip.durationSec, layer: clip.layer ?? 0, opacity: clip.opacity ?? 1, content: clip.content })

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

const syncOnce = async (deps: DialogueTelopSyncDeps, projectId: ProjectId): Promise<SyncResult> => {
  const [shots, clips] = await Promise.all([deps.shots.findByProject(projectId), deps.timelineClips.findByProject(projectId)])
  const existing = clips.filter(isDialogueTelop)
  const speaking = shots.filter((shot) => shot.dialogue.length > 0)
  if (speaking.length === 0 && existing.length === 0) return { changed: false, count: 0 }
  const timed = await Promise.all(speaking.map((shot) => timingOf(deps, shot)))
  const desired = dialogueTelopClips({ projectId, shots: timed, existing })
  const same =
    existing.length === desired.length &&
    existing.map(shapeOf).sort().join('\n') === desired.map(shapeOf).sort().join('\n')
  if (same) return { changed: false, count: desired.length }
  await deps.timelineClips.replace(
    existing.map((clip) => clip.id),
    desired,
  )
  return { changed: true, count: desired.length }
}

/**
 * 作り直す。api と worker が同じ作品で重なると、先に差し替えた側が相手を消しているので、後の側は消す相手が無い
 * （`DbNotFoundError`）。そのときは読み直して 1 度だけやり直す（ナレーションの字幕と同じ）。
 */
export const syncDialogueTelops = async (deps: DialogueTelopSyncDeps, projectId: ProjectId): Promise<SyncResult> => {
  try {
    return await syncOnce(deps, projectId)
  } catch (error) {
    if (!(error instanceof DbNotFoundError)) throw error
    return syncOnce(deps, projectId)
  }
}
