import { z } from 'zod'
import { addToListValue, isBlank, parseEnvFile, setEnvValue } from '../lib/env-file.js'
import type { StepResult } from '../types.js'
import type { SetupContext } from './steps.js'

/**
 * Gemini の鍵（声・吹き替え・説明から作る声・文字起こし。ADR-0065）。**任意の手順で、止めない。**
 *
 * - 端末で、`--yes` でないときだけ「入れますか」と聞く。鍵は**画面に出さずに**受け取る（`promptSecret`）。
 * - 書くのは `GEMINI_API_KEY`・`AUDIO_API_PROVIDERS`（gemini_api を足す）・`GEMINI_API_BILLING`・
 *   `GEMINI_KEY_LABEL`（空のときだけ既定の名札）。
 * - `--yes`・端末でないときは聞かずに飛ばし、「要る」と知らせる（鍵は人が取って入れる）。
 * - **鍵の値はどの文にも入れない**（結果・進み具合・例外のどれにも）。
 */

const ID = 'env.gemini'
const DOCS = 'INSTALL.md#任意'
export const DEFAULT_GEMINI_KEY_LABEL = 'ixa-video-creator'
const PURPOSE = '声・吹き替え・説明から作る声・文字起こしに使う'

/** 形だけ見る（Google の鍵は英数字と - _）。改行や空白の混じった貼り付けを書かないため。 */
const GeminiKey = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{20,200}$/)

const notAsked = (reason: string): StepResult => ({
  id: ID,
  status: 'notice',
  message: `Gemini の鍵は入っていません（${PURPOSE}）。${reason}`,
  fix: {
    hint: '制作者が Google AI Studio で鍵を作り、端末で pnpm ixa setup を回して入れる（.env の GEMINI_API_KEY に書き、AUDIO_API_PROVIDERS に gemini_api を足してもよい）',
    command: 'pnpm ixa setup',
    needsHuman: true,
  },
  docs: DOCS,
})

const BILLING_QUESTION =
  '無料枠で使いますか（無料枠では、送った原稿や音声が Google の製品の改善に使われ、人が見ることがあります。有料枠の鍵なら n）'

/** 鍵を書いた `.env` の中身（純粋）。名札は空のときだけ埋める。 */
export const withGeminiKey = (content: string, key: string, billing: 'free' | 'paid'): string => {
  const env = parseEnvFile(content)
  const withKey = setEnvValue(content, 'GEMINI_API_KEY', key)
  const withProviders = setEnvValue(withKey, 'AUDIO_API_PROVIDERS', addToListValue(env['AUDIO_API_PROVIDERS'] ?? '', 'gemini_api'))
  const withBilling = setEnvValue(withProviders, 'GEMINI_API_BILLING', billing)
  return isBlank(env, 'GEMINI_KEY_LABEL') ? setEnvValue(withBilling, 'GEMINI_KEY_LABEL', DEFAULT_GEMINI_KEY_LABEL) : withBilling
}

export const geminiStep = async ({ system, repo, yes }: SetupContext): Promise<StepResult> => {
  const content = (await system.readText(repo.env)) ?? ''
  const env = parseEnvFile(content)
  if (!isBlank(env, 'GEMINI_API_KEY')) {
    const enabled = (env['AUDIO_API_PROVIDERS'] ?? '').split(',').some((p) => p.trim() === 'gemini_api')
    return {
      id: ID,
      status: 'already',
      message: enabled
        ? 'Gemini の鍵は入っています（AUDIO_API_PROVIDERS に gemini_api あり）'
        : 'Gemini の鍵は入っていますが、AUDIO_API_PROVIDERS に gemini_api が無いので使いません（使うなら足す）',
    }
  }
  if (yes) return notAsked('--yes では聞きません。')
  if (!system.isTty) return notAsked('端末ではないので聞きませんでした。')
  if (!(await system.confirm(`Gemini の鍵を入れますか（${PURPOSE}。原稿は Google に送られます）`))) {
    return { id: ID, status: 'skipped', message: 'Gemini の鍵は入れませんでした（あとで pnpm ixa setup で入れられます）' }
  }
  const typed = await system.promptSecret('Gemini の API キー（画面には出ません。貼り付けて Enter）: ')
  if (typed === null || typed.trim() === '') {
    return { id: ID, status: 'skipped', message: 'Gemini の鍵は入れませんでした（空でした）' }
  }
  const key = GeminiKey.safeParse(typed)
  if (!key.success) {
    // 打った値は文に入れない（長さも出さない）。
    return {
      id: ID,
      status: 'notice',
      message: 'Gemini の鍵の形が違うので入れませんでした（英数字と - _ だけの 1 行）',
      fix: { hint: 'Google AI Studio で鍵をコピーし直して、もう一度 pnpm ixa setup を回す', command: 'pnpm ixa setup', needsHuman: true },
      docs: DOCS,
    }
  }
  const billing = (await system.confirm(BILLING_QUESTION)) ? 'free' : 'paid'
  await system.writeText(repo.env, withGeminiKey(content, key.data, billing))
  return {
    id: ID,
    status: 'done',
    message: `Gemini の鍵を .env に入れました（AUDIO_API_PROVIDERS に gemini_api、GEMINI_API_BILLING=${billing}）。dev を起動し直すと効きます`,
  }
}
