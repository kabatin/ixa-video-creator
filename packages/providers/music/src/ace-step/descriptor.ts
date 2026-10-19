import { ModelId, ProviderId } from '@ixa/domain'
import type { MusicModelDescriptor } from '@ixa/provider-core'
import type { LocalServerIdentity } from '@ixa/provider-video'

/**
 * 手元の生成サーバ ace-step-api 経由の **ACE-Step 1.5**（ADR-0048）。
 *
 * 契約の正は ace-step-api の `docs/api.md` と `GET /v1/capabilities`。
 * やりとりの作法は klein-api・vpipe-api と同じ v1 のジョブ式で、出来上がりは WAV（ステレオ）。
 * モデルのファイル・step・CFG はサーバが決める（ixa は曲調・歌詞・長さ・数だけを送る）。
 * 重みとコードは MIT ライセンス。
 *
 * 実測（対象の Mac。2026-10-17）: 60 秒の曲で初回 58〜93 秒（モデルの読み込み込み）、2 回目からは 33〜34 秒。
 * 出力は PCM16・48kHz・ステレオで、長さは頼んだとおり。**同じ seed でも同じ曲にはならない**（再現は約束しない）。
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

/**
 * 同じ ace-step-api の **MiniMax-Music3**（ADR-0048 追記。ace-step-api 6681bcf）。本文は ace-step-1.5 とまったく同じ。
 *
 * - 出力は PCM16・44.1kHz・ステレオ。**長さは上限**で、曲が早く終わることがある（62 秒を頼んで 22.9 秒の例）。
 *   実際の長さは出来上がりの `duration_sec`（取り込みでも測り直す）。
 * - 曲 1 秒あたり約 9 秒（60 秒の曲で約 10 分。`typical_seconds.60s_track` 580）。進み具合は 0.95 で止まったまま
 *   見積もりを超えることがある。メモリを 24GB 使う。
 * - 実際に歌なしで作ったかは結果の `details.generation.instrumental`（記録に残す）。
 * - MiniMax-Music3 Community License。製品の画面に「MiniMax-Music3」を目立つように出す（「使う AI」の名前と説明）。
 */
export const MINIMAX_MUSIC3_WORKFLOW_ID = 'minimax-music3'

export const MINIMAX_MUSIC3_MODEL_ID: ModelId = ModelId.parse(`ace_step/${MINIMAX_MUSIC3_WORKFLOW_ID}`)

export const minimaxMusic3Model: MusicModelDescriptor = Object.freeze({
  id: MINIMAX_MUSIC3_MODEL_ID,
  providerId: ACE_STEP_PROVIDER_ID,
  label: 'MiniMax-Music3（手元）',
  durationSec: Object.freeze({ min: 10, max: 240 }),
  maxCount: 4,
  // 240 秒の曲を 4 つ（曲 1 秒あたり約 9 秒、見積もり超えもある）でも収まるよう、1 秒あたり 10 秒 × 4 曲に余裕を足す。
  maxWaitSec: 3 * 60 * 60,
})

/** ace-step-api が出すモデル。worker はモデルごとに口を並べ、投入はモデルの workflow に送る。 */
export const ACE_STEP_MUSIC_MODELS: readonly MusicModelDescriptor[] = Object.freeze([aceStepMusicModel, minimaxMusic3Model])

const WORKFLOWS: ReadonlyMap<string, string> = new Map([
  [ACE_STEP_MUSIC_MODEL_ID, ACE_STEP_WORKFLOW_ID],
  [MINIMAX_MUSIC3_MODEL_ID, MINIMAX_MUSIC3_WORKFLOW_ID],
])

/** モデルの workflow。知らないモデルは null。 */
export const aceStepWorkflowOf = (modelId: string): string | null => WORKFLOWS.get(modelId) ?? null
