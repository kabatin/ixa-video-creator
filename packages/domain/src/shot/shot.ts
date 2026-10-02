import { z } from 'zod'
import {
  CharacterId, CharacterLookId, LocationId, ProjectId, SequenceId, ShotId, TakeId,
  TransitionId,
} from '../common/ids.js'
import { Seconds } from '../common/time.js'
import { ShotCamera } from './camera.js'
import { ShotSourceType } from './source-type.js'

export const ShotStatus = z.enum([
  'draft',      // 記述のみ
  'ready',      // 生成可能（必要な参照が揃っている）
  'generating',
  'review',     // Take はあるが、まだ採用していない（画面: 採用待ち）
  'approved',   // Take を採用した（画面: 採用済み）。採用が決定で、別の承認は無い（ADR-0023）
  'blocked',    // 人間の判断待ち
])
export type ShotStatus = z.infer<typeof ShotStatus>

/** ADR-0019 / ADR-0020: 前の Shot の絵を使うのは、制作者が明示した場合だけ。 */
export const ShotContinuityMode = z.enum(['independent', 'previous_shot'])
export type ShotContinuityMode = z.infer<typeof ShotContinuityMode>

/**
 * 本システムの最重要ドメイン。
 * Shot がマスタータイムライン VIDEO1 上の位置を所有する（ADR-0002）。
 * 生成尺と編集尺は別物（ADR-0011）。durationSec は編集尺。
 */
/**
 * Take の長さが Shot の尺と違うときの扱い（ADR-0026）。
 * - `trim`（既定）: 速度は変えない。長ければ切り、短ければ最後のコマで止まる
 * - `fit`: 速度を変えて Take 全体を Shot の尺に収める（0.5〜2.5 倍）
 */
export const ShotTiming = z.enum(['trim', 'fit'])
export type ShotTiming = z.infer<typeof ShotTiming>

/**
 * `fit` の速度の幅。元の MV（手作業の Remotion）と同じ 0.5〜2.5 倍。これより遅いと滲み、速いと落ち着かない。
 * 再生（`@ixa/timeline`）と、最長より長い Shot をどこまで作れるか（`generation/duration.ts`）が同じ値を読む。
 */
export const MIN_PLAYBACK_RATE = 0.5
export const MAX_PLAYBACK_RATE = 2.5

export const Shot = z.object({
  id: ShotId,
  projectId: ProjectId,
  sequenceId: SequenceId.nullable(),
  order: z.number().int(),
  code: z.string().min(1),

  // タイミング
  startSec: Seconds,
  durationSec: Seconds.refine((d) => d > 0, '編集尺は 0 より大きいこと'),
  sourceInSec: Seconds.default(0),
  timing: ShotTiming.default('trim'),

  // 演出
  description: z.string().default(''),
  dialogue: z.string().nullable(),
  camera: ShotCamera,
  mood: z.string().nullable(),

  /** 前 Shot との画の接続。独立したカットが既定（ADR-0020）。 */
  continuityMode: ShotContinuityMode,

  /** ひと続きのカットなので場所は 1 つだけ持つ。中間表は作らない（ADR-0015）。 */
  locationId: LocationId.nullable(),

  sourceType: ShotSourceType,

  selectedTakeId: TakeId.nullable(),
  status: ShotStatus,
  lockedAt: z.date().nullable(),

  createdAt: z.date(),
  updatedAt: z.date(),
})
export type Shot = z.infer<typeof Shot>

export const ShotCharacter = z.object({
  shotId: ShotId,
  characterId: CharacterId,
  /** 必須。実行時解決に頼らず、解決済みの値を保存する。 */
  lookId: CharacterLookId,
  prominence: z.enum(['primary', 'secondary', 'background']),
  order: z.number().int().nonnegative(),
})
export type ShotCharacter = z.infer<typeof ShotCharacter>

export const TransitionType = z.enum([
  'cut', 'dissolve', 'dip_to_black', 'dip_to_white', 'wipe', 'whip_pan', 'glitch',
])
export type TransitionType = z.infer<typeof TransitionType>

/**
 * その種別を**実際に絵として出せるか**。
 *
 * ここに置くのは、画面・検証・レンダラの 3 箇所が同じ答えを見る必要があるため。
 * 分けて持つと必ずズレて、**画面で選べるのに絵に出ない**種別が生まれる
 * （実際に wipe がそうなっていた。選択肢に並ぶのに出力はただのカットだった）。
 *
 * `degraded_to_cut` はモーショングラフィックス機構の上に載せるべきもので、
 * 中途半端な近似を入れると後で捨てることになるため、あえて実装していない。
 */
export const TRANSITION_SUPPORT: Readonly<
  Record<z.infer<typeof TransitionType>, 'implemented' | 'degraded_to_cut'>
> = Object.freeze({
  cut: 'implemented',
  dissolve: 'implemented',
  dip_to_black: 'implemented',
  dip_to_white: 'implemented',
  wipe: 'degraded_to_cut',
  whip_pan: 'degraded_to_cut',
  glitch: 'degraded_to_cut',
})

/** 絵に出ない種別か。画面はこれを見て注意を出す。 */
export const isDegradedTransition = (type: z.infer<typeof TransitionType>): boolean =>
  TRANSITION_SUPPORT[type] === 'degraded_to_cut'

export const Transition = z.object({
  id: TransitionId,
  projectId: ProjectId,
  fromShotId: ShotId,
  toShotId: ShotId,
  type: TransitionType,
  durationSec: Seconds.default(0),
})
export type Transition = z.infer<typeof Transition>

/**
 * Shot 作成時の入力。リポジトリの契約はドメインが定義する（ADR-0007）。
 * selectedTakeId は生成前なので常に null、lockedAt も未ロックで始まる。
 */
export const CreateShotInput = Shot.omit({
  id: true, createdAt: true, updatedAt: true, selectedTakeId: true, lockedAt: true,
}).extend({
  sourceInSec: Seconds.default(0),
  continuityMode: ShotContinuityMode.default('independent'),
  status: ShotStatus.default('draft'),
  // 場所は後から決められる。作成時の必須項目にしない（ADR-0015）。
  locationId: LocationId.nullable().default(null),
})
export type CreateShotInput = z.input<typeof CreateShotInput>

/**
 * 更新可能な列。
 * selectedTakeId と status は専用メソッド（selectTake / updateStatus）で更新するため含めない。
 * 不変条件を伴う更新を、汎用の patch で素通りさせないため。
 */
export const UpdateShotPatch = Shot.pick({
  sequenceId: true, order: true, code: true,
  startSec: true, durationSec: true, sourceInSec: true,
  description: true, dialogue: true, camera: true, mood: true,
  continuityMode: true, timing: true,
  locationId: true, sourceType: true, lockedAt: true,
}).partial()
export type UpdateShotPatch = z.input<typeof UpdateShotPatch>

export const CreateTransitionInput = Transition.omit({ id: true })
export type CreateTransitionInput = z.input<typeof CreateTransitionInput>

export const shotEndSec = (shot: Pick<Shot, 'startSec' | 'durationSec'>): Seconds =>
  shot.startSec + shot.durationSec

/** Shot の時間は互いに重ならない（重なりは Transition が表現する）。 */
export const findOverlappingShots = (
  shots: readonly Pick<Shot, 'id' | 'startSec' | 'durationSec'>[],
): Array<[ShotId, ShotId]> => {
  const sorted = [...shots].sort((a, b) => a.startSec - b.startSec)
  const conflicts: Array<[ShotId, ShotId]> = []
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const current = sorted[i]
    const next = sorted[i + 1]
    if (current && next && shotEndSec(current) > next.startSec) {
      conflicts.push([current.id, next.id])
    }
  }
  return conflicts
}

/** order は 1000 刻みで採番する。挿入時の再採番を避けるため（ARCHITECTURE.md §19）。 */
export const ORDER_STEP = 1000

export const orderBetween = (before: number | null, after: number | null): number => {
  if (before === null && after === null) return ORDER_STEP
  if (before === null) return (after as number) - ORDER_STEP
  if (after === null) return before + ORDER_STEP
  return Math.floor((before + after) / 2)
}
