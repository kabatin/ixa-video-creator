import { canProduceDuration, quantizeDuration, type MediaAssetId, type ReferenceRole } from '@ixa/domain'
import { ModelEconomics, ProviderError, VideoModelCapabilities } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import { STUB_PROVIDER_IDS } from '../stub/descriptor.js'
import { LOCAL_SERVER_MAX_PROMPT_CHARS, selectStartReference } from '../local-server/request.js'
import {
  WAN_FPS,
  WAN_IDENTITY,
  WAN_MAX_DURATION_SEC,
  WAN_MAX_SEED,
  WAN_MIN_DURATION_SEC,
  WAN_MODEL_QUALITIES,
  WAN_POLL_POLICY,
  WAN_PROVIDER_ID,
  WAN_TI2V_5B_DRAFT_MODEL_ID,
  WAN_TI2V_5B_MODEL_ID,
  wanTi2v5bDraftModel,
  wanTi2v5bModel,
  wanVideoModels,
} from '../wan/descriptor.js'
import { buildWanBody } from '../wan/request.js'
import { makeSpec } from './fixtures.js'

const reference = (n: number, role: ReferenceRole) => ({
  mediaAssetId: `asset-${String(n)}` as MediaAssetId,
  role,
  weight: 1,
})

describe('Wan 2.2 TI2V-5B の宣言', () => {
  it.each(wanVideoModels.map((model) => [model.id, model] as const))(
    '%s の宣言はスキーマを通る',
    (_id, model) => {
      expect(() => VideoModelCapabilities.parse(model.capabilities)).not.toThrow()
      expect(() => ModelEconomics.parse(model.economics)).not.toThrow()
    },
  )

  it('段ごとに 2 つ。モデル ID は Provider の id から始まる', () => {
    expect(wanVideoModels.map((model) => model.id)).toEqual([
      'wan/wan2.2-ti2v-5b-draft',
      'wan/wan2.2-ti2v-5b',
    ])
    for (const model of wanVideoModels) {
      expect(model.providerId).toBe(WAN_PROVIDER_ID)
      expect(model.id.startsWith(`${WAN_PROVIDER_ID}/`)).toBe(true)
    }
  })

  it('段は ID の文字列から導かず表から引く', () => {
    expect(WAN_MODEL_QUALITIES[WAN_TI2V_5B_DRAFT_MODEL_ID]).toBe('draft')
    expect(WAN_MODEL_QUALITIES[WAN_TI2V_5B_MODEL_ID]).toBe('standard')
    // 宣言したモデルの全部に段がある（片方だけ解決できる状態を作らない）。
    expect(wanVideoModels.every((model) => WAN_MODEL_QUALITIES[model.id] !== undefined)).toBe(true)
  })

  it('AUTO の候補にしない（明示して選んだときだけ動く）', () => {
    for (const model of wanVideoModels) expect(model.routable).toBe(false)
  })

  it('費用は 0 だがスタブ扱いにしない（本物の Take を作る）', () => {
    for (const model of wanVideoModels) expect(model.economics.costPerSecondUsd).toBe(0)
    expect(STUB_PROVIDER_IDS).not.toContain(WAN_PROVIDER_ID)
  })

  it('画面に出す名前は日本語で、内部のモデル ID とは別物', () => {
    expect(wanTi2v5bDraftModel.label).toBe('Wan 2.2 5B 下書き（ローカル・無料）')
    expect(wanTi2v5bModel.label).toBe('Wan 2.2 5B（ローカル・無料）')
    for (const model of wanVideoModels) expect(model.label).not.toContain(model.id)
  })

  it('問い合わせは 30 秒おき・360 回（手元のサーバなので細かく聞く）', () => {
    expect(WAN_POLL_POLICY).toEqual({ maxIntervalMs: 30_000, maxAttempts: 360 })
  })
})

describe('尺はコマ数ではなく秒の範囲で宣言する（ADR-0040）', () => {
  it('範囲（1〜10 秒）で、刻みを置かない', () => {
    expect(wanTi2v5bModel.capabilities.durations).toEqual({
      mode: 'range',
      min: WAN_MIN_DURATION_SEC,
      max: WAN_MAX_DURATION_SEC,
    })
  })

  it('端数の尺がそのまま通る（楽曲のタイムラインが決めた秒を丸めない）', () => {
    const odd = 3.4583333333333335
    expect(canProduceDuration(odd, wanTi2v5bModel.capabilities.durations)).toBe(true)
    expect(quantizeDuration(odd, wanTi2v5bModel.capabilities.durations)).toBe(odd)
  })

  /**
   * 上限 5 秒は wan-api の契約そのもの（`/v1/capabilities` の `duration_seconds`）。
   * **H3（10.125 秒）より短い**ので、長いカットの扱いが変わる。ここが変わったら README も直す。
   */
  it('上限は 5 秒（wan-api が受ける範囲）', () => {
    expect(WAN_MAX_DURATION_SEC).toBe(5)
    expect(canProduceDuration(5, wanTi2v5bModel.capabilities.durations)).toBe(true)
  })

  it('5〜7.5 秒の Shot は 5 秒で作る（ゆっくり再生で埋める）。7.5 秒を超えたら分けてもらう', () => {
    expect(quantizeDuration(6, wanTi2v5bModel.capabilities.durations)).toBe(WAN_MAX_DURATION_SEC)
    expect(quantizeDuration(7.5, wanTi2v5bModel.capabilities.durations)).toBe(WAN_MAX_DURATION_SEC)
    expect(canProduceDuration(7.6, wanTi2v5bModel.capabilities.durations)).toBe(false)
    expect(canProduceDuration(10, wanTi2v5bModel.capabilities.durations)).toBe(false)
  })

  it('下限より短い Shot は下限で作る（余りは編集で捨てる）', () => {
    expect(quantizeDuration(0.5, wanTi2v5bModel.capabilities.durations)).toBe(WAN_MIN_DURATION_SEC)
  })

  it('fps は 24 だけ', () => {
    expect(wanTi2v5bModel.capabilities.fps).toEqual([WAN_FPS])
  })
})

describe('投入の本文', () => {
  const build = (overrides: Parameters<typeof makeSpec>[0] = {}, durationSec = 3.4583333333333335) =>
    buildWanBody({
      spec: makeSpec({ resolution: { width: 1920, height: 1080 }, ...overrides }),
      quality: 'standard',
      durationSec,
      startImage: null,
    })

  it('契約どおりの形になる（尺は秒・出力は Project の解像度そのもの）', () => {
    expect(build({ seed: 42 })).toEqual({
      prompt: 'takepi が勝利する',
      output: { width: 1920, height: 1080 },
      duration_seconds: 3.4583333333333335,
      quality: 'standard',
      seed: 42,
      start_image: null,
    })
  })

  /**
   * **モデル固有の都合を送らない。** コマ数・ステップ数・スケジューラ・量子化・LoRA・生成解像度は
   * すべて wan-api の責務。ここが漏れ出すと「3 step → 4 step」の変更で ixa を直すことになる。
   */
  it('コマ数・ステップ数・生成解像度・LoRA を送らない', () => {
    const body: Record<string, unknown> = build()
    for (const forbidden of [
      'frames',
      'steps',
      'scheduler',
      'quantization',
      'lora',
      'width',
      'height',
      'model',
      'fps',
      'negative_prompt',
      'duration_sec',
      'end_image',
    ]) {
      expect(Object.keys(body)).not.toContain(forbidden)
    }
  })

  it('秒を丸めない（丸めるとコマ 1 つ分ずれて実測尺と合わなくなる）', () => {
    expect(build({}, 3.4791666666666665).duration_seconds).toBe(3.4791666666666665)
  })

  it('seed が無ければ null で送る（サーバが選び、seed_used で返す）', () => {
    expect(build({ seed: null }).seed).toBeNull()
  })

  it('空のプロンプト・長すぎるプロンプト・負の seed は投げる前に弾く', () => {
    expect(() => build({ prompt: '  ' })).toThrow(ProviderError)
    expect(() => build({ prompt: 'あ'.repeat(LOCAL_SERVER_MAX_PROMPT_CHARS + 1) })).toThrow(/上限/)
    expect(() => build({ prompt: 'あ'.repeat(LOCAL_SERVER_MAX_PROMPT_CHARS) })).not.toThrow()
    expect(() => build({ seed: -1 })).toThrow(ProviderError)
  })

  /** サーバは 0 〜 2³¹−1 だけ受ける。422 を待たずに落とす。 */
  it('大きすぎる seed は投げる前に弾く', () => {
    expect(() => build({ seed: WAN_MAX_SEED })).not.toThrow()
    expect(() => build({ seed: WAN_MAX_SEED + 1 })).toThrow(/seed/)
  })

  it('宣言した範囲の外の尺は、サーバへ送る前に落とす', () => {
    expect(() => build({}, WAN_MAX_DURATION_SEC + 0.1)).toThrow(/作れる長さ/)
    expect(() => build({}, WAN_MIN_DURATION_SEC - 0.1)).toThrow(/作れる長さ/)
  })
})

describe('参照は開始画像 1 枚だけ（ADR-0016）', () => {
  it('明示したキーフレームが前の Shot の最後のコマより優先され、残りは記録に回す', () => {
    const previous = reference(1, 'previous_shot_last_frame')
    const start = reference(2, 'start_frame')
    const selection = selectStartReference([previous, start])
    expect(selection.chosen).toBe(start)
    expect(selection.ignored).toEqual([previous])
  })

  it('最初のフレームが無ければ文章だけから作る（T2V を禁じない）', () => {
    expect(selectStartReference([]).chosen).toBeNull()
    expect(wanTi2v5bModel.capabilities.requiresStartFrame).toBeUndefined()
  })

  it('受けられる role は 2 つ、枠は 2 つまで', () => {
    expect(wanTi2v5bModel.capabilities.referenceImages).toEqual({
      max: 2,
      roles: ['start_frame', 'previous_shot_last_frame'],
    })
  })
})

describe('サーバの名乗り', () => {
  it('失敗の code の頭と画面の文、ワークフロー名を持つ', () => {
    expect(WAN_IDENTITY).toMatchObject({
      providerId: WAN_PROVIDER_ID,
      codePrefix: 'wan',
      workflowId: 'wan2.2-ti2v-5b',
      serverName: 'wan-api',
      urlEnvName: 'WAN_API_URL',
      tokenEnvName: 'WAN_API_TOKEN',
    })
  })

  it('画面に出る文に実装の名前（worker / API）を入れない', () => {
    for (const text of [WAN_IDENTITY.label, WAN_IDENTITY.startHint]) {
      expect(text).not.toMatch(/worker|API\b|HTTP/)
    }
  })
})
