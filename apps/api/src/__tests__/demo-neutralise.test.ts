import {
  NarrationLineId,
  NarrationTake,
  NarrationTakeId,
  TakeId,
  VoiceJobId,
  newId,
  type ProviderParams,
} from '@ixa/domain'
import { aShot, aTake } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { neutraliseForPublic } from '../demo-project/neutralise.js'
import type { DemoSource } from '../demo-project/source-wire.js'
import { aProject } from './fixtures.js'

/**
 * 公開する目録から、作る人の機械と持ち主の情報を外す（ADR-0067「公開する目録に入れないもの」）。
 * **中身（歌詞・方針・指示文・使った AI・種）は残す。** 見本は人に見せるために作るので。
 */

const project = aProject({ name: '作る人の作業名', budgetUsd: 500, lyrics: '夜の街を走る', styleGuide: '水彩' })
const shot = aShot(project.id)
const take = (providerParams: ProviderParams) =>
  aTake(shot, 'a'.repeat(64), { providerParams, costUsd: 1.25, generationTimeSec: 42, seedUsed: 7, regenerationReason: '顔が崩れた' })

const narrationTake = NarrationTake.parse({
  id: newId(NarrationTakeId),
  lineId: newId(NarrationLineId),
  index: 1,
  source: { type: 'generated', voiceJobId: newId(VoiceJobId), tool: 'macos_say', model: null, voiceName: 'Kyoko' },
  mediaAssetId: '01JAAAAAAAAAAAAAAAAAAAAAAA',
  inSec: 0,
  outSec: 1,
  spokenText: '走れ。',
  displayText: '走れ。',
  specHash: null,
  charTimes: null,
  loudnessLufs: null,
  peaks: null,
  costUsd: 0.01,
  createdAt: new Date(),
})

const sourceWith = (providerParams: ProviderParams): DemoSource => ({
  project,
  concept: null,
  tracks: [],
  characters: [],
  locations: [],
  brandAssets: [],
  textStyles: [],
  clips: [],
  sequences: [],
  shots: [{ shot, cast: [], frames: [], takes: [take(providerParams)], hiddenTakeIds: new Set() }],
  transitions: [],
  voices: [],
  narrationLines: [],
  narrationTakes: [narrationTake],
  characterAssets: [],
})

const firstTake = (source: DemoSource) => source.shots[0]!.takes[0]!

describe('neutraliseForPublic', () => {
  it('作品の名前は目録の題、予算は無し。中身は残す', () => {
    const out = neutraliseForPublic(sourceWith({ kind: 'http', request: {} }), { title: '見本の作品' })
    expect(out.project).toMatchObject({ name: '見本の作品', budgetUsd: null, lyrics: '夜の街を走る', styleGuide: '水彩' })
  })

  it('Take: 送った記録（http）は空、費用は 0。生成にかかった時間・種・作り直しの理由・使った AI は残す', () => {
    const out = firstTake(neutraliseForPublic(sourceWith({ kind: 'http', request: { url: 'http://127.0.0.1:8787/x', seed: 7 } }), { title: 't' }))
    expect(out.providerParams).toEqual({ kind: 'http', request: {} })
    expect(out.costUsd).toBe(0)
    expect(out).toMatchObject({ generationTimeSec: 42, seedUsed: 7, regenerationReason: '顔が崩れた', providerId: 'test', modelId: 'test/model-a' })
  })

  it('Take: CLI の記録は道・コマンド・版・出力の要約を空にする（終了コードは残す）', () => {
    const cli: ProviderParams = { kind: 'cli', command: 'codex exec --model x', cwd: '/Users/creator/ixa', cliVersion: '1.2.3', exitCode: 0, stdoutDigest: 'f'.repeat(64) }
    expect(firstTake(neutraliseForPublic(sourceWith(cli), { title: 't' })).providerParams).toEqual({
      kind: 'cli',
      command: '',
      cwd: '',
      cliVersion: '',
      exitCode: 0,
      stdoutDigest: '',
    })
  })

  it('Take: 持ち込んだ動画はファイル名を外す（どのモデルかは残す）', () => {
    const imported: ProviderParams = { kind: 'import', sourceModel: 'H3', fileName: 'Desktop の書き出し.mp4' }
    expect(firstTake(neutraliseForPublic(sourceWith(imported), { title: 't' })).providerParams).toEqual({ kind: 'import', sourceModel: 'H3', fileName: null })
  })

  it('Take: 声の差し替えの記録は中身なのでそのまま', () => {
    const dub: ProviderParams = { kind: 'dub', sourceTakeId: newId(TakeId), voiceTool: 'gemini_api', model: 'gemini-tts', integratedLufs: -16, lines: [] }
    expect(firstTake(neutraliseForPublic(sourceWith(dub), { title: 't' })).providerParams).toEqual(dub)
  })

  it('声の Take: 費用は 0、出自はジョブを指さない「写したもの」にする（入れる側は写したものとして書くので変わらない）', () => {
    const [out] = neutraliseForPublic(sourceWith({ kind: 'http', request: {} }), { title: 't' }).narrationTakes
    expect(out?.costUsd).toBe(0)
    expect(out?.source).toEqual({ type: 'copied', fromTakeId: narrationTake.id })
    expect(JSON.stringify(out)).not.toContain(narrationTake.source.type === 'generated' ? narrationTake.source.voiceJobId : '-')
  })

  it('元は変えない', () => {
    const source = sourceWith({ kind: 'http', request: { a: 1 } })
    neutraliseForPublic(source, { title: 't' })
    expect(source.project.name).toBe('作る人の作業名')
    expect(firstTake(source).providerParams).toEqual({ kind: 'http', request: { a: 1 } })
  })
})
