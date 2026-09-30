import {
  MAX_DRAFT_DESCRIPTION_LENGTH,
  MAX_DRAFT_REASON_LENGTH,
  ShotId as ShotIdSchema,
  newId,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import type { CliRunner } from '../claude-cli-reviewer.js'
import {
  CLAUDE_CLI_DRAFTER_NAME,
  buildDraftPrompt,
  createClaudeCliStoryboardDrafter,
} from '../claude-cli-drafter.js'
import {
  aDraftRequest,
  aDraftShot,
  aDraftedItem,
  completedWith,
  envelope,
  itemWithoutReason,
} from './draft-fixtures.js'

/**
 * **実 CLI を CI で叩かない**（ADR-0004 / ADR-0012）。
 * サブプロセス実行はポートとして注入し、モック応答で契約を固定する。
 *
 * レビュアと違い、**失敗は例外ではなく値**で返る。呼び出し側は必ず
 * `storyboard_draft_runs` に `status='failed'` と理由を書き残すため。
 */

const drafterWith = (runner: CliRunner) => createClaudeCliStoryboardDrafter({ runner })

const okRunner = (resultText: string, extra?: Readonly<Record<string, unknown>>): CliRunner =>
  () => Promise.resolve(completedWith(envelope(resultText, extra)))

const shot = aDraftShot({ code: 'CHORUS-01', startSec: 8 })
const request = aDraftRequest({ shots: [shot] })
const validResponse = JSON.stringify({ items: [aDraftedItem(shot.id)] })

describe('Claude CLI 下書きの正常系', () => {
  it('二重 JSON を解いて案と実測コストを返す', async () => {
    const outcome = await drafterWith(okRunner(validResponse)).draft(request)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.items).toEqual([aDraftedItem(shot.id)])
    expect(outcome.costUsd).toBe(0.0456)
  })

  it('```json フェンスで包まれていても解ける', async () => {
    const fenced = '```json\n' + validResponse + '\n```'
    const outcome = await drafterWith(okRunner(fenced)).draft(request)

    expect(outcome.ok).toBe(true)
  })

  it('total_cost_usd が無ければ 0 を返す（推測値を入れない）', async () => {
    const runner: CliRunner = () =>
      Promise.resolve(completedWith(JSON.stringify({ result: validResponse })))
    const outcome = await drafterWith(runner).draft(request)

    expect(outcome.ok && outcome.costUsd).toBe(0)
  })

  it('既定の名前を持つ（どの口で作った案かを run に残すため）', () => {
    expect(createClaudeCliStoryboardDrafter().name).toBe(CLAUDE_CLI_DRAFTER_NAME)
  })

  it('画像を読まないので既定では道具を許さない', async () => {
    const seen: string[][] = []
    const runner: CliRunner = (invocation) => {
      seen.push([...invocation.args])
      return Promise.resolve(completedWith(envelope(validResponse)))
    }
    await drafterWith(runner).draft(request)

    expect(seen[0]).not.toContain('--allowedTools')
  })
})

describe('Claude CLI 下書きが組み立てるプロンプト', () => {
  const prompt = buildDraftPrompt(request)

  it('shotId を並べる（LLM が対応付けられるように）', () => {
    expect(prompt).toContain(shot.id)
  })

  it('件数を明示する（何件返すべきかを曖昧にしない）', () => {
    expect(prompt).toContain('1 件すべてに対して')
  })

  it('reason を省略させない', () => {
    expect(prompt).toContain('reason を省略しないでください')
  })

  /**
   * **上限はドメインの定数から出す。** プロンプトに数字を書き写すと、
   * 上限を変えたときにここだけ古い数字が残り、LLM が弾かれる長さの案を作り続ける。
   */
  it('長さの上限をドメインの定数から出す（数字を書き写さない）', () => {
    /**
     * **項目ごとに行として突き合わせる。** 2 つの上限は今どちらも同じ値なので、
     * 数字だけを探すと片方の行だけで両方の期待が満たされ、
     * もう片方がズレていても素通りする（実際に素通りした）。
     */
    expect(prompt).toContain(
      `"description": その Shot で何を映すか（${String(MAX_DRAFT_DESCRIPTION_LENGTH)} 文字以内）`,
    )
    expect(prompt).toContain(
      `"reason": なぜこの絵なのか（${String(MAX_DRAFT_REASON_LENGTH)} 文字以内）`,
    )
  })

  it('脚本が無ければ「まだ書かれていません」と書く（空文字を渡さない）', () => {
    expect(buildDraftPrompt(aDraftRequest({ script: null }))).toContain('まだ書かれていません')
  })

  it('解析が無ければ「未解析」と書く', () => {
    expect(buildDraftPrompt(aDraftRequest({ sections: [] }))).toContain('未解析')
  })

  /**
   * 作品の方針（ADR-0030）。脚本はコンセプト・あらすじとして読み、ルックと避けたいものも渡す。
   * **ルックは生成時に全 Shot へ自動で足されるので、説明に書き写させない**（二重に入る）。
   */
  it('作品のルックと避けたいものを渡し、ルックを説明に書き写さないよう言う', () => {
    const prompt = buildDraftPrompt(aDraftRequest({ look: '35mm フィルム、夜の雨', avoid: '文字、アニメ調' }))
    expect(prompt).toContain('コンセプト・あらすじ')
    expect(prompt).toContain('35mm フィルム、夜の雨')
    expect(prompt).toContain('文字、アニメ調')
    expect(prompt).toMatch(/書き写さない/)
  })

  it('ルックや避けたいものが空なら「指定なし」と書く（空欄を渡さない）', () => {
    const prompt = buildDraftPrompt(aDraftRequest())
    expect(prompt.match(/指定なし/g)).toHaveLength(2)
  })
})

describe('Claude CLI 下書きの異常系', () => {
  const failsWith = async (runner: CliRunner) => {
    const outcome = await drafterWith(runner).draft(request)
    expect(outcome.ok).toBe(false)
    return outcome.ok ? null : outcome.error
  }

  it('CLI が見つからなければ cli_not_found', async () => {
    const error = await failsWith(() =>
      Promise.resolve({ kind: 'not_found', reason: 'ENOENT' }),
    )
    expect(error?.code).toBe('cli_not_found')
  })

  it('制限時間内に終わらなければ cli_timeout', async () => {
    const error = await failsWith(() => Promise.resolve({ kind: 'timeout', timeoutMs: 1000 }))
    expect(error?.code).toBe('cli_timeout')
    expect(error?.message).toContain('1000ms')
  })

  it('起動できなければ cli_spawn_failed', async () => {
    const error = await failsWith(() =>
      Promise.resolve({ kind: 'spawn_failed', reason: 'EACCES' }),
    )
    expect(error?.code).toBe('cli_spawn_failed')
  })

  it('runner が想定外に throw しても値で返す（例外を漏らさない）', async () => {
    const error = await failsWith(() => Promise.reject(new Error('壊れた runner')))
    expect(error?.code).toBe('cli_spawn_failed')
    expect(error?.message).toContain('壊れた runner')
  })

  it('異常終了は出力を解釈する前に cli_exit_failed', async () => {
    const error = await failsWith(() =>
      Promise.resolve({ kind: 'completed', exitCode: 1, stdout: validResponse, stderr: 'boom' }),
    )
    expect(error?.code).toBe('cli_exit_failed')
    expect(error?.message).toContain('boom')
  })

  it('外枠が JSON でなければ response_not_json', async () => {
    const error = await failsWith(() => Promise.resolve(completedWith('not json at all')))
    expect(error?.code).toBe('response_not_json')
  })

  it('外枠に result が無ければ response_schema_violation', async () => {
    const error = await failsWith(() =>
      Promise.resolve(completedWith(JSON.stringify({ total_cost_usd: 1 }))),
    )
    expect(error?.code).toBe('response_schema_violation')
  })

  it('is_error が立っていれば中身を見ずに cli_exit_failed', async () => {
    const error = await failsWith(okRunner('レート制限に達しました', { is_error: true }))
    expect(error?.code).toBe('cli_exit_failed')
    expect(error?.message).toContain('レート制限')
  })

  /**
   * **CLI が走った後の失敗でも、払った額を連れて来る。**
   * 0 と書くと費用メーター（P63-2）が「何も使っていない」と読める嘘になる。
   */
  it('応答が壊れていても実測コストを返す', async () => {
    const outcome = await drafterWith(okRunner('not json')).draft(request)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.costUsd).toBe(0.0456)
  })

  it('CLI を起動できなかったときだけコストは 0', async () => {
    const outcome = await drafterWith(() =>
      Promise.resolve({ kind: 'not_found', reason: 'ENOENT' }),
    ).draft(request)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.costUsd).toBe(0)
  })

  it('本文が JSON でなければ response_not_json', async () => {
    const error = await failsWith(okRunner('案を書きました。よろしくお願いします。'))
    expect(error?.code).toBe('response_not_json')
  })

  it('reason の無い案は response_schema_violation（自由文をそのまま信じない）', async () => {
    const error = await failsWith(
      okRunner(JSON.stringify({ items: [itemWithoutReason(shot.id)] })),
    )

    expect(error?.code).toBe('response_schema_violation')
    expect(error?.message).toContain('reason')
  })

  it('description が上限を超える案も落とす', async () => {
    const tooLong = aDraftedItem(shot.id, { description: 'あ'.repeat(401) })
    const error = await failsWith(okRunner(JSON.stringify({ items: [tooLong] })))

    expect(error?.code).toBe('response_schema_violation')
  })

  it('配列を裸で返されたら落とす（items で包ませる）', async () => {
    const error = await failsWith(okRunner(JSON.stringify([aDraftedItem(shot.id)])))
    expect(error?.code).toBe('response_schema_violation')
  })

  /** **ここが本題。** 落とした案を黙って捨てると、失敗が成功に化ける。 */
  it('知らない shotId が混ざれば unknown_shot_id で run ごと落とす', async () => {
    const stranger = newId(ShotIdSchema)
    const error = await failsWith(
      okRunner(JSON.stringify({ items: [aDraftedItem(shot.id), aDraftedItem(stranger)] })),
    )

    expect(error?.code).toBe('unknown_shot_id')
    expect(error?.message).toContain(stranger)
  })

  it('案が足りなければ missing_shot_id で落とす（27 件頼んで 18 件を成功にしない）', async () => {
    const second = aDraftShot({ code: 'CHORUS-02', startSec: 10 })
    const outcome = await drafterWith(okRunner(JSON.stringify({ items: [aDraftedItem(shot.id)] }))).draft(
      aDraftRequest({ shots: [shot, second] }),
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.code).toBe('missing_shot_id')
    expect(outcome.error.message).toContain('2 件のうち 1 件')
  })

  it('同じ shotId が 2 回返れば duplicate_shot_id で落とす', async () => {
    const error = await failsWith(
      okRunner(JSON.stringify({ items: [aDraftedItem(shot.id), aDraftedItem(shot.id)] })),
    )
    expect(error?.code).toBe('duplicate_shot_id')
  })

  it('失敗の文にプロンプト本文をそのまま載せない（伏字にする）', async () => {
    const error = await failsWith(() => Promise.resolve(completedWith('not json')))

    expect(error?.message).toContain('<prompt:')
    expect(error?.message).not.toContain('あなたは映像作品の絵コンテ作家です')
  })
})
