import { ModelId, ProviderId } from '@ixa/domain'
import type { MusicModelDescriptor } from '@ixa/provider-core'
import type { LocalServerIdentity } from '@ixa/provider-video'

/**
 * 手元の生成サーバ ace-step-api 経由の **ACE-Step 1.5**（ADR-0048）。
 *
 * 契約の正は ace-step-api の `docs/api.md` と `GET /v1/capabilities`。
 * やりとりの作法は klein-api・vpipe-api と同じ v1 のジョブ式で、出来上がりは WAV（ステレオ）。
 * モデルのファイル・step・CFG はサーバが決める（ixa は曲調・歌詞・長さ・数だけを送る）。
 */
export const ACE_STEP_PROVIDER_ID: ProviderId = ProviderId.parse('ace_step')

export const ACE_STEP_MUSIC_MODEL_ID: ModelId = ModelId.parse('ace_step/ace-step-1.5')

/** ace-step-api 側のワークフロー名。 */
export const ACE_STEP_WORKFLOW_ID = 'ace-step-1.5'

/** ace-step-api の既定の待ち受け（vpipe-api 8765・wan-api 8766・klein-api 8767 の次）。 */
export const ACE_STEP_DEFAULT_BASE_URL = 'http://127.0.0.1:8768'

export const ACE_STEP_IDENTITY: LocalServerIdentity = Object.freeze({
  providerId: ACE_STEP_PROVIDER_ID,
  label: 'ローカルの曲の生成（ACE-Step）',
  codePrefix: 'ace_step',
  workflowId: ACE_STEP_WORKFLOW_ID,
  serverName: 'ace-step-api',
  startHint: '起動していません（ace-step-api を起動してください）',
  urlEnvName: 'ACE_STEP_API_URL',
  tokenEnvName: 'ACE_STEP_API_TOKEN',
})

/** 作れる長さと数。ace-step-api の契約（`duration_sec` 10〜240・`count` 1〜4）と同じ。 */
export const aceStepMusicModel: MusicModelDescriptor = Object.freeze({
  id: ACE_STEP_MUSIC_MODEL_ID,
  providerId: ACE_STEP_PROVIDER_ID,
  label: 'ACE-Step 1.5（手元）',
  durationSec: Object.freeze({ min: 10, max: 240 }),
  maxCount: 4,
})
