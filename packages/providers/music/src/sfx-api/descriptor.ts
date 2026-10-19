import { ModelId, ProviderId, SFX_COUNT_MAX, SFX_DURATION_MAX_SEC, SFX_DURATION_MIN_SEC } from '@ixa/domain'
import type { SfxModelDescriptor } from '@ixa/provider-core'
import type { LocalServerIdentity } from '@ixa/provider-video'

/**
 * 手元の生成サーバ sfx-api 経由の効果音（ADR-0052）。1 台で 3 つの workflow を出す:
 *
 * - `stable-audio-3-medium-sfx`（メイン）: Stable Audio 3 Medium SFX。44.1kHz・2ch。
 *   「TrackType: SFX, 」の前置きはサーバが付ける（ixa は説明をそのまま送る）。
 * - `stable-audio-3-sfx`（速い控え）: Stability AI 公式の MLX 版 Stable Audio 3 Small SFX。44.1kHz。
 *   どちらも Stability AI Community License（年商 100 万ドル未満は商用可）。
 * - `moss-sfx-v2`（遅い控え）: MOSS-SoundEffect v2.0（Apache 2.0・PyTorch mps）。48kHz。
 *
 * やりとりの作法は ace-step-api と同じ v1 のジョブ式で、出来上がりは WAV。
 *
 * 実測（新しい Mac・M5。サーバ側の報告）: Medium は温まっていれば 1 本 約 1.1 秒（1〜2 秒の音）〜
 * 1.7 秒（10 秒の音）、読み込み 約 0.7〜1.2 秒、メモリ最大 11GB（2026-10-19）。Small は 1 本 0.37 秒（2 秒の音）〜
 * 0.53 秒（10 秒の音）、冷えていれば 3.2 秒・約 4GB（2026-10-18）。MOSS は MPS で動くが遅く、2 秒の音に
 * 273 秒かかった。**MOSS は数分〜数十分かかる前提で待つ。**
 * サーバは i 本目に seed + 2i を使い、`seed_used` が正（その種を本数 1 で送ると同じ音。Stable Audio はビット一致）。
 * 音量はピークが -1 dBFS を超えたものだけ下げる（リミッタはかけない）。
 * step や CFG はサーバが決める（ixa は説明・長さ・数・種だけを送る）。
 */
export const SFX_API_PROVIDER_ID: ProviderId = ProviderId.parse('sfx_api')

export const STABLE_AUDIO_MEDIUM_SFX_WORKFLOW_ID = 'stable-audio-3-medium-sfx'
export const STABLE_AUDIO_SFX_WORKFLOW_ID = 'stable-audio-3-sfx'
export const MOSS_SFX_WORKFLOW_ID = 'moss-sfx-v2'

export const STABLE_AUDIO_MEDIUM_SFX_MODEL_ID: ModelId = ModelId.parse(`sfx_api/${STABLE_AUDIO_MEDIUM_SFX_WORKFLOW_ID}`)
export const STABLE_AUDIO_SFX_MODEL_ID: ModelId = ModelId.parse(`sfx_api/${STABLE_AUDIO_SFX_WORKFLOW_ID}`)
export const MOSS_SFX_MODEL_ID: ModelId = ModelId.parse(`sfx_api/${MOSS_SFX_WORKFLOW_ID}`)

/** sfx-api の既定の待ち受け（ace-step-api 8768 の次）。 */
export const SFX_API_DEFAULT_BASE_URL = 'http://127.0.0.1:8769'

export const SFX_API_IDENTITY: LocalServerIdentity = Object.freeze({
  providerId: SFX_API_PROVIDER_ID,
  label: 'ローカルの効果音の生成',
  codePrefix: 'sfx_api',
  // 投入の URL はモデルごとの workflow で組む。ここはメインの名前（記録と案内用）。
  workflowId: STABLE_AUDIO_MEDIUM_SFX_WORKFLOW_ID,
  serverName: 'sfx-api',
  startHint: '起動していません（sfx-api を起動してください）',
  urlEnvName: 'SFX_API_URL',
  tokenEnvName: 'SFX_API_TOKEN',
})

const durationSec = Object.freeze({ min: SFX_DURATION_MIN_SEC, max: SFX_DURATION_MAX_SEC })

export const stableAudioMediumSfxModel: SfxModelDescriptor = Object.freeze({
  id: STABLE_AUDIO_MEDIUM_SFX_MODEL_ID,
  providerId: SFX_API_PROVIDER_ID,
  label: 'Stable Audio 3 Medium（手元）',
  workflowId: STABLE_AUDIO_MEDIUM_SFX_WORKFLOW_ID,
  durationSec,
  maxCount: SFX_COUNT_MAX,
  sampleRate: 44_100,
  // 1 本 2 秒弱。読み込みと 4 本ぶんを見込んでも 5 分で十分。
  maxWaitSec: 5 * 60,
})

export const stableAudioSfxModel: SfxModelDescriptor = Object.freeze({
  id: STABLE_AUDIO_SFX_MODEL_ID,
  providerId: SFX_API_PROVIDER_ID,
  label: 'Stable Audio 3 Small（手元）',
  workflowId: STABLE_AUDIO_SFX_WORKFLOW_ID,
  durationSec,
  maxCount: SFX_COUNT_MAX,
  sampleRate: 44_100,
  // 1 本 1 秒未満。冷えた読み込みと 4 本ぶんを見込んでも 5 分で十分。
  maxWaitSec: 5 * 60,
})

export const mossSfxModel: SfxModelDescriptor = Object.freeze({
  id: MOSS_SFX_MODEL_ID,
  providerId: SFX_API_PROVIDER_ID,
  label: 'MOSS SFX v2（手元）',
  workflowId: MOSS_SFX_WORKFLOW_ID,
  durationSec,
  maxCount: SFX_COUNT_MAX,
  sampleRate: 48_000,
  // 2 秒の音で 273 秒の実測。10 秒の音を 4 本頼むと 1 時間を超えうるので長く取る。
  maxWaitSec: 90 * 60,
})

export const SFX_API_MODELS: readonly SfxModelDescriptor[] = Object.freeze([
  stableAudioMediumSfxModel,
  stableAudioSfxModel,
  mossSfxModel,
])
