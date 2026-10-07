import {
  MAX_DRAFT_DESCRIPTION_LENGTH,
  MAX_DRAFT_REASON_LENGTH,
  type MusicSection,
  type StoryboardDraftCamera,
} from '@ixa/domain'
import {
  StoryboardDraftRequest,
  checkDraftedShotIds,
  type StoryboardDraftOutcome,
  type StoryboardDraftShot,
  type StoryboardDrafter,
  type StoryboardDraftedItem,
} from './storyboard-port.js'

/**
 * 決定的なスタブ絵コンテ下書き（`stub-reviewer.ts` と同じ位置付け）。
 *
 * 一時的なモックではなく、**恒久的に維持する一級の実装**として扱う。目的は
 * 「下書き → 保存 → 人が採否を決める」という配線が正しいかを、課金も CLI も無しで
 * CI から確かめられるようにすることであって、案の面白さではない。
 *
 * ## 決定性
 * 乱数も時刻も使わない。結果は **Shot の code / order / 尺 / いまの説明**と、
 * その Shot が乗っている音楽セクションのラベルだけから決まる。
 */

export const STUB_STORYBOARD_DRAFTER_NAME = 'stub-storyboard-drafter'

/** FNV-1a 32bit。暗号用途ではなく、案を入力から決定的に導くためだけに使う。 */
const fnv1a32 = (value: string): number => {
  const OFFSET_BASIS = 0x811c9dc5
  const PRIME = 0x01000193
  let hash = OFFSET_BASIS
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(i), PRIME)
  }
  return hash >>> 0
}

/** Shot 1 件を 1 本の文字列へ正規化する。テストが期待値を計算できるよう公開する。 */
export const canonicalizeDraftShot = (
  shot: StoryboardDraftShot,
  sectionLabel: string | null,
): string =>
  [
    `code=${shot.code}`,
    `order=${String(shot.order)}`,
    `duration=${shot.durationSec.toFixed(3)}`,
    `description=${shot.description}`,
    `section=${sectionLabel ?? '(none)'}`,
  ].join('\n')

/** 案の骨格。セクションのラベルではなく**ダイジェスト**で選ぶので、同じ曲でも絵が散る。 */
const SHOT_IDEAS: readonly string[] = Object.freeze([
  '被写体を画面中央に据え、背景を浅い被写界深度で流す',
  '手前の人物越しに主役を捉え、奥行きで視線を誘導する',
  '低い位置から見上げ、空の抜けで開放感を出す',
  '横移動で被写体を追い、背景の流れで速度を見せる',
  '静止した引きの画で、人の配置だけで構図を作る',
  '手元や足元の寄りから始め、全体を見せない',
  '逆光でシルエットを立て、輪郭だけを残す',
  '俯瞰で全体の位置関係を一度に見せる',
])

/** 雰囲気の語。`mood` は null も正当な値なので、**一部は意図的に null を返す**。 */
const MOODS: readonly (string | null)[] = Object.freeze([
  '静かな緊張',
  '高揚',
  '哀愁',
  null,
  '疾走感',
  '厳粛',
])

/**
 * カメラの案（ADR-0043）。**一部は意図的に「提案なし」（null）**。
 * 提案が無い経路（カメラを触らずに採用する）も配線として通しておく。
 */
const CAMERAS: readonly (StoryboardDraftCamera | null)[] = Object.freeze([
  { size: 'medium', movement: 'static' },
  { size: 'wide', movement: 'pull_out', movementIntensity: 'subtle' },
  { size: 'closeup', angle: 'low', movement: 'tilt', movementIntensity: 'moderate' },
  null,
  { size: 'medium_wide', movement: 'tracking', movementIntensity: 'moderate' },
  { size: 'medium', angleH: 'front', movement: 'push_in', movementIntensity: 'subtle' },
])

/** その秒数を含むセクション。無ければ null（「無い」と「不明」を混ぜない）。 */
export const sectionAt = (
  sections: readonly MusicSection[],
  atSec: number,
): MusicSection | null =>
  sections.find((section) => atSec >= section.start && atSec < section.end) ?? null

/** 上限を必ず守る。超えたら切る（案が長すぎるだけで run 全体を失敗させない）。 */
const clamp = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`

const pick = <T>(values: readonly T[], digest: number): T =>
  values[digest % values.length] as T

/** 案 1 件を作る純関数。Provider を組まずに期待値を確かめられるよう公開する。 */
export const stubDraftItem = (
  shot: StoryboardDraftShot,
  sections: readonly MusicSection[],
): StoryboardDraftedItem => {
  const section = sectionAt(sections, shot.startSec)
  const sectionLabel = section === null ? null : section.label
  const digest = fnv1a32(canonicalizeDraftShot(shot, sectionLabel))
  const idea = pick(SHOT_IDEAS, digest)
  const mood = pick(MOODS, digest >>> 8)

  const sectionPhrase = sectionLabel === null ? '曲の構成は未解析' : `${sectionLabel} の位置`
  const currentPhrase =
    shot.description.trim() === '' ? 'いまの説明は空' : `いまの説明「${shot.description}」`

  return {
    shotId: shot.id,
    description: clamp(`[stub] ${shot.code}: ${idea}。`, MAX_DRAFT_DESCRIPTION_LENGTH),
    mood,
    // **理由は必ず埋める。** 空の理由は「理由が無い」と同じで、採否の判断に使えない。
    reason: clamp(
      `${sectionPhrase}・尺 ${shot.durationSec.toFixed(2)} 秒。${currentPhrase}。この尺なら動きを 1 つに絞れる。`,
      MAX_DRAFT_REASON_LENGTH,
    ),
    camera: pick(CAMERAS, digest >>> 16),
  }
}

export type StubStoryboardDrafterOptions = {
  name?: string
}

/**
 * 決定的なスタブ下書き。`costUsd` は常に 0。実際に払っていないため推測値を入れない。
 */
export const createStubStoryboardDrafter = (
  options: StubStoryboardDrafterOptions = {},
): StoryboardDrafter => {
  const name = options.name ?? STUB_STORYBOARD_DRAFTER_NAME

  const draftSync = (request: StoryboardDraftRequest): StoryboardDraftOutcome => {
    // API 境界と同じく入力は必ず検証する（CLAUDE.md 規約 4）。
    const parsed = StoryboardDraftRequest.parse(request)
    const items = parsed.shots.map((shot) => stubDraftItem(shot, parsed.sections))

    /**
     * スタブは Shot 1 件につき 1 件を作るので理屈の上では必ず通る。
     * それでも通す。**同じ検査を実装ごとに省くと、省いた実装だけが素通りする**
     * （lessons: 飛ばした検査は痕跡を残す）。
     */
    const mismatch = checkDraftedShotIds(
      parsed.shots.map((shot) => shot.id),
      items.map((item) => item.shotId),
    )
    if (mismatch !== null) return { ok: false, costUsd: 0, error: mismatch }

    return { ok: true, items, costUsd: 0 }
  }

  return {
    name,
    // interface が Promise を返す以上、検証失敗も同期 throw ではなく reject で返す。
    draft: (request) => Promise.resolve().then(() => draftSync(request)),
  }
}
