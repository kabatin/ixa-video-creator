import { ShotId as ShotIdSchema, newId, type MusicSection, type ShotId } from '@ixa/domain'
import type { CliRunResult } from '../claude-cli-reviewer.js'
import type {
  StoryboardDraftRequest,
  StoryboardDraftShot,
  StoryboardDraftedItem,
} from '../storyboard-port.js'

/** 絵コンテ下書きのテスト用データ（P63-4）。実 CLI は叩かない。 */

export const SECTIONS: readonly MusicSection[] = Object.freeze([
  { start: 0, end: 8, label: 'intro', energy: 0.3 },
  { start: 8, end: 24, label: 'chorus', energy: 0.9 },
])

export const aDraftShot = (overrides: Partial<StoryboardDraftShot> = {}): StoryboardDraftShot => ({
  id: overrides.id ?? newId(ShotIdSchema),
  code: overrides.code ?? 'INTRO-01',
  order: overrides.order ?? 1000,
  startSec: overrides.startSec ?? 0,
  durationSec: overrides.durationSec ?? 2,
  description: overrides.description ?? '',
  mood: overrides.mood === undefined ? null : overrides.mood,
  lyrics: overrides.lyrics ?? [],
  cast: overrides.cast ?? [],
  location: overrides.location === undefined ? null : overrides.location,
})

export const aDraftRequest = (
  overrides: Partial<StoryboardDraftRequest> = {},
): StoryboardDraftRequest => ({
  // null は「脚本が無い」という正当な値。undefined（未指定）と混ぜない。
  script: overrides.script === undefined ? '# 台本\n\niXA CUP の決勝。' : overrides.script,
  sections: overrides.sections ?? [...SECTIONS],
  shots: overrides.shots ?? [aDraftShot()],
  look: overrides.look ?? '',
  avoid: overrides.avoid ?? '',
  lyrics: overrides.lyrics ?? '',
  characters: overrides.characters ?? [],
  locations: overrides.locations ?? [],
})

export const aDraftedItem = (
  shotId: ShotId,
  overrides: Partial<Omit<StoryboardDraftedItem, 'shotId'>> = {},
): StoryboardDraftedItem => ({
  shotId,
  description: overrides.description ?? '決勝卓を引きで捉える',
  mood: overrides.mood === undefined ? '静かな緊張' : overrides.mood,
  reason: overrides.reason ?? 'intro の静けさを保ったまま場所を示すため',
})

/** `claude -p --output-format json` の外枠。 */
export const envelope = (
  resultText: string,
  extra: Readonly<Record<string, unknown>> = {},
): string => JSON.stringify({ result: resultText, total_cost_usd: 0.0456, ...extra })

export const completedWith = (stdout: string, stderr = ''): CliRunResult => ({
  kind: 'completed',
  exitCode: 0,
  stdout,
  stderr,
})

/** `reason` の抜けた案。**分割代入で捨てるとリンタに未使用と怒られる**ので明示的に作る。 */
export const itemWithoutReason = (shotId: ShotId): Record<string, unknown> => {
  const { description, mood } = aDraftedItem(shotId)
  return { shotId, description, mood }
}
