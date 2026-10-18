import { z } from 'zod'
import {
  EditBatchId,
  MediaAssetId,
  MusicTrackId,
  NarrationLineId,
  ProjectId,
  ShotId,
  TakeId,
  TimelineClipId,
  VoiceProfileId,
} from '../common/ids.js'
import { MusicTrack } from '../music/music.js'
import { Project } from '../project/project.js'
import { EditBatchAssetEdit } from './edit-batch-asset-edit.js'
import { EditBatchClipEdit } from './edit-batch-clip-edit.js'
import { EditBatchTransitionEdit } from './edit-batch-transition-edit.js'

export * from './edit-batch-asset-edit.js'
export * from './edit-batch-clip-edit.js'
export * from './edit-batch-transition-edit.js'
import { ShotCharacter, ShotStatus, UpdateShotPatch } from './shot.js'

/**
 * 一括で変えた記録と、その取り消し（横断 ROADMAP: Undo と履歴）。
 *
 * **一度に大量の行が変わる操作だけを対象にする。** 粗編集の適用（最大 49 件）・
 * 絵コンテ下書きの採用（27 件）・Shot の一括変更は、押した瞬間に全部変わる。
 * 個々のキー入力まで戻せる必要は無く、「さっきの一括を取り消したい」が
 * 戻せれば怖さは消える。
 *
 * **記録は追記のみ。** 中身は書き換えず、取り消したかどうかだけが後から動く
 * （Take・絵コンテの案と同じ考え方・ADR-0003）。
 */

/**
 * `text_style` はテロップの見た目のまとめ変更（2026-10-02）。Shot ではなくテロップを記録する（`clipEntries`）。
 * `music_trim` は曲を最後の Shot で切る（2026-10-19）。楽曲を記録する（`musicEntries`）。
 * `clip_edit` はクリップ 1 件ずつの作る・直す・消す（2026-10-19）。クリップの丸ごとの控えを記録する（`clipEdits`）。
 * `shot_edit` は Shot 1 件の直し・採用 Take の決定と外し（2026-10-19）。一括と同じ形（`entries`）で記録する。
 * `narration_edit` はナレーションの行 1 件の位置の変更（2026-10-19）。`lineEntries` で記録する。
 * `transition_edit` はトランジションの置く・消す・差し替え（2026-10-19）。`transitionEdits` で記録する。
 * `music_edit` は楽曲の欄の直しとマスターの切り替え（2026-10-19）。`musicEntries` で記録する。
 * `project_edit` は作品の欄の直し（方針・歌詞・歌詞の時刻など。2026-10-19）。`projectEntry` で記録する。
 * `asset_edit` は素材（キャラクター・ロケーション・ブランド資産・声）の作る・直す・消す（2026-10-19）。`assetEdits` で記録する。
 */
export const EditBatchKind = z.enum([
  'rough_cut',
  'draft_adopt',
  'bulk_update',
  'text_style',
  'narration_arrange',
  'music_trim',
  'clip_edit',
  'shot_edit',
  'narration_edit',
  'transition_edit',
  'music_edit',
  'project_edit',
  'asset_edit',
])
export type EditBatchKind = z.infer<typeof EditBatchKind>

/**
 * Shot 1 件ぶんの「変える前」。
 *
 * **変えた欄だけを持つ。** 全欄を持つと、取り消しが「その後に人が直した欄」まで
 * 巻き戻してしまう。変えた欄だけを戻せば、無関係な編集は残る。
 */
/**
 * Shot の作成・削除（`shot_edit`。2026-10-19）。**Shot は論理削除なので ID だけを持つ**（中身は DB に残り、戻すと同じ ID・同じ中身）。
 * 作った Shot は戻すと論理削除し、消した Shot は戻すと論理削除を外す。分割は「元の尺の直し + 後半の作成」、
 * 結合は「残す Shot の尺の直し + ほかの削除」で 1 つの記録にする。
 */
export const EditBatchShotEdit = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), shotId: ShotId }),
  z.object({ op: z.literal('delete'), shotId: ShotId }),
])
export type EditBatchShotEdit = z.infer<typeof EditBatchShotEdit>

/**
 * 記録に書ける欄。**`lockedAt` は書けない。**
 *
 * 2 つの理由がある。
 * 1. ロックは人が「ここは触らない」と決める行為で、一括編集の一部ではない。
 *    一括を取り消したときにロックまで戻すと、人の判断を機械が覆す
 * 2. `lockedAt` は `Date` で、`entries` は jsonb。書けてしまうと保存では通り、
 *    **読み出しの `parse` で落ちる**。いまは誰も書いていないが、契約上は書けた
 *
 * 型で禁じておけば、次に書こうとした人はコンパイルで気付く。
 */
export const EditBatchPatch = UpdateShotPatch.omit({ lockedAt: true })
export type EditBatchPatch = z.infer<typeof EditBatchPatch>

export const EditBatchEntry = z.object({
  shotId: ShotId,
  /** 変えた欄の、変える前の値。欄を 1 つも変えていなければ空。 */
  patch: EditBatchPatch,
  /**
   * 採用 Take を変えたときだけ持つ。
   *
   * **「触っていない」は欄が無いことで表す。`null` は「採用していなかった」。**
   * 両方を `null` にすると、採用を外したのか触っていないのかが区別できなくなる
   * （lessons L-021）。
   */
  selectedTakeId: TakeId.nullable().optional(),
  /**
   * 状態を変えたときだけ持つ。**欄が無いのは「触っていない」。**
   *
   * 一括採用（`bulk/select-take`）は採用 Take と状態の両方を動かす。
   * 状態を戻さないと、採用だけ戻って状態が新しいまま残り、
   * **取り消したのに中途半端**になる。片方だけ戻すくらいなら、
   * 戻せる範囲を型で正直に表して両方戻す。
   */
  status: ShotStatus.optional(),
  /**
   * 登場人物を変えたときだけ持つ（2026-10-19）。**丸ごと**の控え（登場人物は「誰が・どの衣装で・何番目に」の組で 1 つの欄）。
   * **欄が無いのは「触っていない」、空配列は「誰もいなかった」。**
   */
  cast: z.array(ShotCharacter.omit({ shotId: true })).optional(),
  /** 手で付けた開始フレームを変えたときだけ持つ（2026-10-19）。**`null` は「付けていなかった」、欄が無いのは「触っていない」。** */
  startFrame: MediaAssetId.nullable().optional(),
})
export type EditBatchEntry = z.infer<typeof EditBatchEntry>

/**
 * テロップ 1 件ぶんの「変える前」（制作者 2026-10-02「テロップをまとめて、サイズやスタイルや位置を変えられるようにしたい」）。
 * まとめて変えるのは見た目（`params.style`）とどのスタイルからか（`params.styleId`）だけなので、その 2 つを持つ。
 * **見た目は書いてあったそのまま**を持つ（読めない見た目も、そのまま戻す。読み替えない）。
 */
export const EditBatchClipEntry = z.object({
  clipId: TimelineClipId,
  style: z.unknown(),
  styleId: z.string().nullable(),
})
export type EditBatchClipEntry = z.infer<typeof EditBatchClipEntry>

/**
 * ナレーションの行 1 件ぶんの「変える前」（ADR-0038）。まとめて並べると置いた行の位置が全部変わるので、位置を持つ。
 * **`startSec: null` は「置いていなかった」**（触っていない行は記録に入れない）。
 * `telop` はテロップを出すか（ナレーションのテロップを手で消すと、その行は「テロップなし」になる）。
 * **どちらも欄が無いのは「触っていない」。**
 */
export const EditBatchLineEntry = z.object({
  lineId: NarrationLineId,
  startSec: z.number().nullable().optional(),
  telop: z.boolean().optional(),
  /** 話す声（声を消すと、その声で話す行は「声が未定」になる。戻すときに行も戻す）。`null` は「未定だった」。 */
  voiceProfileId: VoiceProfileId.nullable().optional(),
})
export type EditBatchLineEntry = z.infer<typeof EditBatchLineEntry>

/**
 * 楽曲 1 曲ぶんの「変える前」。**変えた欄だけを持つ**（欄が無いのは「触っていない」）。
 * 曲を最後の Shot で切る（`music_trim`）は曲の終わりとフェードアウト、欄の直し（`music_edit`）は直した欄を持つ。
 * **`endSec: null` は「自然な終わりだった」**。
 * `master: true` は「戻すとこの曲をマスターにする」（マスターを切り替える前のマスター）。
 */
const track = MusicTrack.shape
/**
 * 値の規則は**楽曲そのもの（`MusicTrack`）から取る**（書き写さない）。控えるのは楽曲に入っていた値なので、
 * 直す口の規則（空の題を断る・前後の空白を落とす）で読むと、空の題の楽曲を改名できず、空白も戻らない。
 * 既定値は外す（欄が無いのを「既定値だった」と読み替えない）。
 */
export const EditBatchMusicEntry = z.object({
  musicTrackId: MusicTrackId,
  title: track.title.optional(),
  offsetSec: track.offsetSec.removeDefault().optional(),
  volume: track.volume.removeDefault().optional(),
  fadeInSec: track.fadeInSec,
  fadeOutSec: track.fadeOutSec,
  endSec: track.endSec,
  master: z.literal(true).optional(),
})
export type EditBatchMusicEntry = z.infer<typeof EditBatchMusicEntry>

const project = Project.shape
/**
 * 作品 1 件ぶんの「変える前」（2026-10-19）。**変えた欄だけを持つ**（欄が無いのは触っていない）。
 * 値の規則は作品そのもの（`Project`）から取り、既定値は外す（欄が無いのを「既定値だった」と読み替えない）。
 * **知らない欄は受け付けない**（ID・ワークスペースは直す欄ではない）。
 */
export const EditBatchProjectEntry = z.object({
  patch: z
    .object({
      name: project.name.optional(),
      fps: project.fps.optional(),
      resolution: project.resolution.optional(),
      aspectRatio: project.aspectRatio.optional(),
      durationSec: project.durationSec.optional(),
      budgetUsd: project.budgetUsd.optional(),
      styleGuide: project.styleGuide.removeDefault().optional(),
      avoid: project.avoid.removeDefault().optional(),
      styleReferenceAssetIds: project.styleReferenceAssetIds.removeDefault().optional(),
      lyrics: project.lyrics.removeDefault().optional(),
      lyricCues: project.lyricCues.removeDefault().optional(),
      instrumental: project.instrumental.removeDefault().optional(),
      status: project.status.optional(),
    })
    .strict(),
})
export type EditBatchProjectEntry = z.infer<typeof EditBatchProjectEntry>

export const MAX_EDIT_BATCH_SUMMARY_LENGTH = 200

export const EditBatch = z.object({
  id: EditBatchId,
  projectId: ProjectId,
  kind: EditBatchKind,
  /** 人が読む見出し。「粗編集を 49 件適用しました」など。履歴に並べる。 */
  summary: z.string().trim().min(1).max(MAX_EDIT_BATCH_SUMMARY_LENGTH),
  entries: z.array(EditBatchEntry),
  /** テロップの記録。これまでの記録（Shot だけ）は空として読む。 */
  clipEntries: z.array(EditBatchClipEntry).default([]),
  /** ナレーションの行の記録（ADR-0038）。これまでの記録は空として読む。 */
  lineEntries: z.array(EditBatchLineEntry).default([]),
  /** 楽曲の記録（曲を切る）。これまでの記録は空として読む。 */
  musicEntries: z.array(EditBatchMusicEntry).default([]),
  /** クリップ 1 件ずつの作る・直す・消す。これまでの記録は空として読む。 */
  clipEdits: z.array(EditBatchClipEdit).default([]),
  /** トランジションの置く・消す。これまでの記録は空として読む。 */
  transitionEdits: z.array(EditBatchTransitionEdit).default([]),
  /** Shot の作成・削除。これまでの記録は空として読む。 */
  shotEdits: z.array(EditBatchShotEdit).default([]),
  /** 作品の欄の直し。**`null` は「作品を触っていない」**（これまでの記録も `null` として読む）。 */
  projectEntry: EditBatchProjectEntry.nullable().default(null),
  /** 素材の作る・直す・消す。これまでの記録は空として読む。 */
  assetEdits: z.array(EditBatchAssetEdit).default([]),
  /** 取り消した時刻。**`null` は「まだ取り消していない」**（「取り消せない」ではない）。 */
  undoneAt: z.date().nullable(),
  createdAt: z.date(),
})
export type EditBatch = z.infer<typeof EditBatch>

export const CreateEditBatchInput = EditBatch.omit({
  id: true,
  undoneAt: true,
  createdAt: true,
})
export type CreateEditBatchInput = z.input<typeof CreateEditBatchInput>

/** 記録のうち作成後に変えてよい列。**`undoneAt` だけ。** */
export const EDIT_BATCH_MUTABLE_FIELDS = Object.freeze(['undoneAt'] as const)

export const isUndone = (batch: EditBatch): boolean => batch.undoneAt !== null

/**
 * 取り消せるか。
 *
 * **一度取り消した記録は二度取り消さない。** もう一度当てると、その後に人が
 * 直した内容を古い値で塗り潰す。戻したものをやり直したいなら、新しく操作する。
 */
export const canUndo = (batch: EditBatch): boolean =>
  !isUndone(batch) &&
  (batch.entries.length > 0 ||
    batch.clipEntries.length > 0 ||
    batch.lineEntries.length > 0 ||
    batch.musicEntries.length > 0 ||
    batch.clipEdits.length > 0 ||
    batch.transitionEdits.length > 0 ||
    batch.shotEdits.length > 0 ||
    (batch.projectEntry !== null && Object.keys(batch.projectEntry.patch).length > 0) ||
    batch.assetEdits.length > 0)

/**
 * 1 件ぶんの取り消しで、採用 Take を戻す必要があるか。
 *
 * 欄が無い（`undefined`）なら触っていないので戻さない。
 * `null` は「採用していなかった」なので、採用を外す方向に戻す。
 */
export const undoTouchesSelectedTake = (entry: EditBatchEntry): boolean =>
  'selectedTakeId' in entry && entry.selectedTakeId !== undefined

/** 状態を戻す必要があるか。欄が無ければ触っていないので戻さない。 */
export const undoTouchesStatus = (entry: EditBatchEntry): boolean => entry.status !== undefined

/** 欄を 1 つも変えていない記録は残さない。数だけ増えて履歴が読めなくなる。 */
export const hasChanges = (entry: EditBatchEntry): boolean =>
  Object.keys(entry.patch).length > 0 ||
  undoTouchesSelectedTake(entry) ||
  undoTouchesStatus(entry) ||
  entry.cast !== undefined ||
  entry.startFrame !== undefined
