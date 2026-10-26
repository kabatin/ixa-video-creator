import type { ActiveJobCounts, ActiveJobKind, StaleJob } from '@ixa/db'
import { compareVersions, formatVersion, latestVersionTag, parseVersion, type Version } from '../lib/semver.js'
import type { StepResult } from '../types.js'

/**
 * update の判定（純粋、ADR-0063）。止める条件・行き先・fast-forward できるか。
 */

const JOB_LABEL: Readonly<Record<ActiveJobKind, string>> = {
  generation: '動画の生成',
  render: '書き出し',
  image: '絵',
  music: '音楽',
  sfx: '効果音',
  upscale: 'アップスケール',
  dub: '声の差し替え',
  voice: '声',
  storyboard: '絵コンテの案',
  review: 'レビュー',
  thumbnail: 'サムネイル',
  agent: 'AI エージェントの作業',
}

/** 取り残し（24 時間より前から動いたまま）。数えないが、黙って無視もしない。 */
export const staleJobsNotice = (stale: readonly StaleJob[]): StepResult | null =>
  stale.length === 0
    ? null
    : {
        id: 'update.stale-jobs',
        status: 'notice',
        message: `24 時間より前から「動いている」のままの行は数えていません（取り残しとみなす）: ${stale
          .map((s) => `${JOB_LABEL[s.kind]} ${s.id}（${s.since.slice(0, 10)} から）`)
          .join('・')}`,
        fix: { hint: '本当に動いていないか画面で確かめる。消すかどうかは制作者が決める', needsHuman: true },
        docs: 'INSTALL.md#更新',
      }

export const describeActiveJobs = (counts: ActiveJobCounts): string =>
  (Object.keys(JOB_LABEL) as ActiveJobKind[])
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${JOB_LABEL[kind]} ${String(counts[kind])} 件`)
    .join('・')

export const totalActiveJobs = (counts: ActiveJobCounts): number =>
  Object.values(counts).reduce((sum, n) => sum + n, 0)

export type GuardFacts = {
  /** 追跡しているファイルに未コミットの変更があるか（新しいファイルは数えない）。 */
  readonly dirty: boolean
  readonly branch: string
  /** 数えられなければ null（DB につながらない＝動いているジョブも無い）。 */
  readonly activeJobs: ActiveJobCounts | null
  readonly force: boolean
}

/** 止める理由（空なら進めてよい）。 */
export const updateBlockers = (facts: GuardFacts): readonly StepResult[] => [
  ...(facts.dirty
    ? [
        {
          id: 'update.dirty',
          status: 'needs_human' as const,
          message: '作業ツリーに未コミットの変更があります（update は main を追っている clone 用）',
          fix: {
            hint: '自分の変更なら退避してから（git stash push -m before-ixa-update）。消してよいかは制作者に聞く',
            needsHuman: true,
          },
          docs: 'INSTALL.md#更新',
        },
      ]
    : []),
  ...(facts.branch !== 'main'
    ? [
        {
          id: 'update.branch',
          status: 'needs_human' as const,
          message: `main ではなく ${facts.branch === '' ? '（ブランチ無し）' : facts.branch} にいます`,
          fix: { hint: 'main に戻ってから（自分のブランチなら制作者に確かめる）', command: 'git switch main', needsHuman: true },
          docs: 'INSTALL.md#更新',
        },
      ]
    : []),
  ...(facts.activeJobs !== null && totalActiveJobs(facts.activeJobs) > 0 && !facts.force
    ? [
        {
          id: 'update.active-jobs',
          status: 'needs_human' as const,
          message: `動いているジョブがあります（${describeActiveJobs(facts.activeJobs)}）。更新すると途中で止まります`,
          fix: {
            hint: '終わるのを待つか、画面で止めてから。構わなければ --force（制作者に確かめる）',
            command: 'pnpm ixa update --force',
            needsHuman: true,
          },
          docs: 'INSTALL.md#更新',
        },
      ]
    : []),
]

/**
 * この clone の dev が動いているまま取り込むと、tsx watch と next dev が途中の版を読み込み直し、
 * DB の更新の前に新しいコードが古い DB に当たる。止めてからにする。
 * 動かしたまま進めるのは `--while-running`（ジョブの `--force` とは別の同意）。
 */
export const devRunningBlocker = (devRunning: boolean, whileRunning: boolean): StepResult | null =>
  devRunning && !whileRunning
    ? {
        id: 'update.dev-running',
        status: 'needs_human',
        message: 'この clone の dev（pnpm dev）が動いています。動いたまま更新すると、途中の版を読み込み直して落ちることがあります',
        fix: {
          hint: 'dev を止めてから（Ctrl+C）。動かしたまま進めてよければ --while-running（制作者に確かめる）',
          command: 'pnpm ixa update --while-running',
          needsHuman: true,
        },
        docs: 'INSTALL.md#更新',
      }
    : null

export type Target =
  | { readonly kind: 'none' }
  | { readonly kind: 'up-to-date'; readonly version: Version }
  | { readonly kind: 'newer'; readonly ref: string; readonly version: Version }

/** 最新のリリースのタグ。今より新しくなければ「最新」。 */
export const releaseTarget = (tags: readonly string[], current: Version): Target => {
  const latest = latestVersionTag(tags)
  if (latest === null) return { kind: 'none' }
  return compareVersions(latest.version, current) > 0
    ? { kind: 'newer', ref: latest.tag, version: latest.version }
    : { kind: 'up-to-date', version: current }
}

/** HEAD と行き先の関係。 */
export type Ancestry = { readonly same: boolean; readonly headBehind: boolean; readonly headAhead: boolean }

export type FastForward = 'ff' | 'same' | 'ahead' | 'diverged'

export const fastForwardOf = (a: Ancestry): FastForward => {
  if (a.same) return 'same'
  if (a.headBehind) return 'ff'
  return a.headAhead ? 'ahead' : 'diverged'
}

export const fastForwardBlocker = (ff: FastForward, ref: string): StepResult | null => {
  if (ff === 'ff' || ff === 'same') return null
  return {
    id: 'update.fast-forward',
    status: 'needs_human',
    message:
      ff === 'ahead'
        ? `今の main は ${ref} より先に進んでいます（リリースより新しい）。--main で main の先頭を追うか、そのまま使ってください`
        : `今の main に ${ref} に無いコミットがあり、fast-forward できません`,
    fix: { hint: '自分のコミットを積んでいるなら、どう取り込むか制作者に確かめる', needsHuman: true },
    docs: 'INSTALL.md#更新',
  }
}

export const describeMove = (from: Version, to: Version): string => `${formatVersion(from)} → ${formatVersion(to)}`

export const parseVersionOrThrow = (text: string, where: string): Version => {
  const version = parseVersion(text)
  if (version === null) throw new Error(`${where} の版（${text}）を読めません`)
  return version
}
