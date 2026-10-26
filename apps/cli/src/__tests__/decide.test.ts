import type { ActiveJobCounts } from '@ixa/db'
import { describe, expect, it } from 'vitest'
import { parseVersion, type Version } from '../lib/semver.js'
import { infraAction, infraSettled, signingSecretAction, workspaceAction } from '../setup/decide.js'
import {
  describeActiveJobs,
  devRunningBlocker,
  staleJobsNotice,
  fastForwardBlocker,
  fastForwardOf,
  moveDecision,
  releaseTarget,
  updateBlockers,
} from '../update/decide.js'
import { releaseNotesUrl } from '../update/after-fetch.js'

const v = (text: string): Version => {
  const parsed = parseVersion(text)
  if (parsed === null) throw new Error(text)
  return parsed
}

describe('setup の判定', () => {
  it('署名の鍵：入っていれば済み、空なら埋める、行が無ければ足す', () => {
    expect(signingSecretAction(`STORAGE_SIGNING_SECRET=${'x'.repeat(64)}\n`)).toBe('already')
    expect(signingSecretAction('STORAGE_SIGNING_SECRET=\n')).toBe('fill')
    expect(signingSecretAction('STORAGE_SIGNING_SECRET=   \n')).toBe('fill')
    expect(signingSecretAction('# STORAGE_SIGNING_SECRET=\nA=1\n')).toBe('append')
  })

  it('ワークスペース：空なら用意して書く、合っていれば済み、違えば人に聞く', () => {
    expect(workspaceAction(null, [])).toBe('ensure-and-fill')
    expect(workspaceAction(null, ['01A'])).toBe('ensure-and-fill')
    expect(workspaceAction('01A', ['01A'])).toBe('already')
    expect(workspaceAction('01B', ['01A'])).toBe('mismatch')
  })

  it('Docker：両方動いていれば済み、外でつながれば触らない、無ければ起動、起動中なら待つ', () => {
    const none = { postgres: false, redis: false }
    expect(infraAction('healthy', 'healthy', none)).toBe('already')
    expect(infraAction('missing', 'missing', { postgres: true, redis: true })).toBe('external')
    expect(infraAction('missing', 'healthy', none)).toBe('start')
    expect(infraAction('stopped', 'healthy', none)).toBe('start')
    expect(infraAction('starting', 'healthy', none)).toBe('wait')
  })

  it('待つのを止める時', () => {
    expect(infraSettled('healthy', 'healthy')).toBe('ready')
    expect(infraSettled('starting', 'healthy')).toBe('pending')
    expect(infraSettled('unhealthy', 'healthy')).toBe('broken')
  })
})

const noJobs: ActiveJobCounts = { generation: 0, render: 0, image: 0, music: 0, sfx: 0, upscale: 0, dub: 0, voice: 0, storyboard: 0, review: 0, thumbnail: 0, agent: 0 }

describe('update の止める条件', () => {
  it('きれいな main でジョブも無ければ進める', () => {
    expect(updateBlockers({ dirty: false, branch: 'main', activeJobs: noJobs, force: false })).toEqual([])
  })

  it('未コミットの変更・main 以外・動いているジョブで止める（全部並べる）', () => {
    const blockers = updateBlockers({
      dirty: true,
      branch: 'feature/x',
      activeJobs: { ...noJobs, render: 1, agent: 2 },
      force: false,
    })
    expect(blockers.map((b) => b.id)).toEqual(['update.dirty', 'update.branch', 'update.active-jobs'])
    expect(blockers.every((b) => b.status === 'needs_human')).toBe(true)
    expect(blockers[2]?.message).toContain('書き出し 1 件・AI エージェントの作業 2 件')
  })

  it('--force はジョブの確認だけを外す', () => {
    const blockers = updateBlockers({ dirty: true, branch: 'main', activeJobs: { ...noJobs, music: 1 }, force: true })
    expect(blockers.map((b) => b.id)).toEqual(['update.dirty'])
  })

  it('この clone の dev が動いていれば止める。--while-running（--force とは別の同意）のときだけ進む', () => {
    expect(devRunningBlocker(false, false)).toBeNull()
    expect(devRunningBlocker(true, false)).toMatchObject({ id: 'update.dev-running', status: 'needs_human', fix: { needsHuman: true } })
    expect(devRunningBlocker(true, true)).toBeNull()
  })

  it('数えられない（DB につながらない）ときは止めない', () => {
    expect(updateBlockers({ dirty: false, branch: 'main', activeJobs: null, force: false })).toEqual([])
  })

  it('動いている種類だけを言う', () => {
    expect(describeActiveJobs({ ...noJobs, sfx: 3 })).toBe('効果音 3 件')
    expect(describeActiveJobs({ ...noJobs, storyboard: 1, thumbnail: 2 })).toBe('絵コンテの案 1 件・サムネイル 2 件')
  })

  it('取り残し（24 時間より前から動いたまま）は止めずに知らせる。無ければ何も言わない', () => {
    expect(staleJobsNotice([])).toBeNull()
    const notice = staleJobsNotice([{ kind: 'storyboard', id: '01M4AGD9ACE64Q8036GVQM0YHA', since: '2026-10-07T03:00:00.000Z' }])
    expect(notice?.status).toBe('notice')
    expect(notice?.message).toContain('絵コンテの案 01M4AGD9ACE64Q8036GVQM0YHA（2026-10-07 から）')
  })
})

describe('update の行き先', () => {
  it('いちばん新しいリリースが今より新しければそこへ', () => {
    expect(releaseTarget(['v0.7.2', 'v0.9.0', 'v0.8.0'], v('0.8.0'))).toEqual({ kind: 'newer', ref: 'v0.9.0', version: v('0.9.0') })
  })

  it('今より古いタグしか無ければ最新。同じ版のタグは候補として返す（中身は祖先で決める）', () => {
    expect(releaseTarget(['v0.7.2'], v('0.8.0')).kind).toBe('older')
    expect(releaseTarget(['v0.7.2', 'v0.8.0'], v('0.8.0'))).toEqual({ kind: 'same-version', ref: 'v0.8.0', version: v('0.8.0') })
    expect(releaseTarget([], v('0.8.0')).kind).toBe('none')
  })

  it('取り込むか（版と祖先の両方で決める）', () => {
    expect(moveDecision('newer', 'ff')).toBe('move')
    expect(moveDecision('newer', 'same')).toBe('up-to-date')
    expect(moveDecision('newer', 'ahead')).toBe('blocked')
    // 版は同じでもタグが先にある（版を上げずにタグを打ち直した・main が 0.8.0 のまま後ろにいる）
    expect(moveDecision('same-version', 'ff')).toBe('move')
    expect(moveDecision('same-version', 'same')).toBe('up-to-date')
    expect(moveDecision('same-version', 'ahead')).toBe('up-to-date')
    expect(moveDecision('older', 'ff')).toBe('up-to-date')
  })

  it('fast-forward できるか。main がタグより先・枝分かれなら止めて理由を出す', () => {
    expect(fastForwardOf({ same: false, headBehind: true, headAhead: false })).toBe('ff')
    expect(fastForwardOf({ same: true, headBehind: true, headAhead: true })).toBe('same')
    expect(fastForwardOf({ same: false, headBehind: false, headAhead: true })).toBe('ahead')
    expect(fastForwardOf({ same: false, headBehind: false, headAhead: false })).toBe('diverged')
    expect(fastForwardBlocker('ff', 'v0.9.0')).toBeNull()
    expect(fastForwardBlocker('ahead', 'v0.9.0')?.message).toContain('--main')
    expect(fastForwardBlocker('ahead', 'origin/main', true)?.message).not.toContain('--main で')
    expect(fastForwardBlocker('ahead', 'origin/main', true)?.message).toContain('自分のコミット')
    expect(fastForwardBlocker('diverged', 'v0.9.0')?.status).toBe('needs_human')
  })

  it('変更点の場所', () => {
    expect(releaseNotesUrl('0.8.0', '0.9.0', false)).toBe('https://github.com/kabatin/ixa-video-creator/releases/tag/v0.9.0')
    expect(releaseNotesUrl('0.8.0', '0.9.0', true)).toBe('https://github.com/kabatin/ixa-video-creator/compare/v0.8.0...main')
  })
})
