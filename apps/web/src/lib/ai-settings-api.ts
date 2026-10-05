import { AiSettings, AiToolId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 使う AI（ADR-0032）。この環境で見つかった AI と、用途（テキスト・画像・動画・声・文字起こし）ごとの選択。
 * 選べるかの規則は API（domain の `aiChoiceProblem`）が決め、ここは理由をそのまま受け取る。
 */

const WireAiToolStatus = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ready'), version: z.string().nullable() }),
  z.object({ state: z.literal('missing'), reason: z.string() }),
])

const WireAiTool = z.object({
  id: AiToolId,
  label: z.string(),
  status: WireAiToolStatus,
  problems: z.object({
    text: z.string().nullable(),
    image: z.string().nullable(),
    video: z.string().nullable(),
    voice: z.string().nullable(),
    transcribe: z.string().nullable(),
  }),
  /** 使う前に知っておくこと（無料枠の扱い・料金・商用の可否）。 */
  notice: z.string().nullable(),
})
export type WireAiTool = z.infer<typeof WireAiTool>

const WireAiTools = z.object({ tools: z.array(WireAiTool), recommended: AiSettings })
export type WireAiTools = z.infer<typeof WireAiTools>

const WireAiSettingsState = z.object({ settings: AiSettings, source: z.enum(['saved', 'default']) })
export type WireAiSettingsState = z.infer<typeof WireAiSettingsState>

export type AiSettingsApi = {
  /** この環境で見つかった AI。CLI を叩くので数秒かかる。 */
  listAiTools: () => Promise<WireAiTools>
  /** いまの選択。まだ選んでいなければ `source: 'default'`（環境変数の初期値）。 */
  getAiSettings: () => Promise<WireAiSettingsState>
  /** 選ぶ。その用途に使えない AI なら 422（用途ごとの理由つき）。 */
  saveAiSettings: (settings: AiSettings) => Promise<WireAiSettingsState>
}

export const createAiSettingsApi = (requester: Requester): AiSettingsApi => ({
  listAiTools: () => requester.get('/ai/tools', WireAiTools),
  getAiSettings: () => requester.get('/ai/settings', WireAiSettingsState),
  saveAiSettings: (settings) => requester.put('/ai/settings', settings, WireAiSettingsState),
})
