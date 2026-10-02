import { ASSIST_FIELDS } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  buildAssistPrompt,
  createStubAssistant,
  createTextCliAssistant,
  type AssistRequest,
} from '../assist.js'
import type { TextCli, TextCliOutcome } from '../text-cli.js'

/**
 * 入力を AI が手伝う（ADR-0032 の 3 段目）。案を出すだけで、使うかは人が決める。
 * 空の欄は材料から考え、書いてあれば意図を残して整える。
 */

const request = (overrides: Partial<AssistRequest> = {}): AssistRequest => ({
  field: 'shot_description',
  current: '',
  instruction: null,
  context: [
    { label: 'コンセプト・あらすじ', text: '夜明けの屋上で二人が出会う' },
    { label: 'この Shot で歌われる歌詞', text: '「夜明けの屋上で」' },
    { label: '空の材料', text: '   ' },
  ],
  ...overrides,
})

const cliReturning = (outcome: TextCliOutcome): TextCli & { prompts: string[] } => {
  const prompts: string[] = []
  return {
    tool: 'codex',
    prompts,
    complete: (prompt) => {
      prompts.push(prompt)
      return Promise.resolve(outcome)
    },
  }
}

describe('buildAssistPrompt', () => {
  it('欄の名前・使われ方・上限と、材料を並べる（空の材料は書かない）', () => {
    const prompt = buildAssistPrompt(request())
    const spec = ASSIST_FIELDS.shot_description

    expect(prompt).toContain(spec.label)
    expect(prompt).toContain(spec.purpose)
    expect(prompt).toContain(`${String(spec.maxLength)} 文字以内`)
    expect(prompt).toContain('- コンセプト・あらすじ: 夜明けの屋上で二人が出会う')
    expect(prompt).not.toContain('空の材料')
    expect(prompt).toContain('"text"')
  })

  it('空の欄は考えさせ、書いてあれば意図を残して整えさせる', () => {
    expect(buildAssistPrompt(request())).toContain('考えて')
    const refine = buildAssistPrompt(request({ current: '屋上で振り返る' }))
    expect(refine).toContain('整えて')
    expect(refine).toContain('屋上で振り返る')
    expect(refine).toContain('意図')
  })

  it('注文があれば添え、読点区切りの欄はその書き方を言う', () => {
    expect(buildAssistPrompt(request({ instruction: 'もっと静かに' }))).toContain('もっと静かに')
    expect(buildAssistPrompt(request({ field: 'wardrobe' }))).toContain('読点')
  })
})

describe('createTextCliAssistant', () => {
  it('返事の JSON から欄に入れる文を取り出す（フェンス付きでも）', async () => {
    const cli = cliReturning({ ok: true, text: '```json\n{"text":"  青い外光の屋上  "}\n```', costUsd: 0.01 })

    const outcome = await createTextCliAssistant(cli).suggest(request())

    expect(outcome).toEqual({ ok: true, text: '青い外光の屋上', costUsd: 0.01 })
    expect(cli.prompts).toHaveLength(1)
  })

  it('形が違う・空の返事は案にしない（理由を返す）', async () => {
    const notJson = await createTextCliAssistant(cliReturning({ ok: true, text: 'はい、こちらです', costUsd: 0 })).suggest(request())
    const empty = await createTextCliAssistant(cliReturning({ ok: true, text: '{"text":"  "}', costUsd: 0 })).suggest(request())

    expect(notJson).toMatchObject({ ok: false, error: { code: 'response_not_json' } })
    expect(empty).toMatchObject({ ok: false, error: { code: 'response_schema_violation' } })
  })

  it('CLI の失敗はそのまま理由として返す（サインインしていない など）', async () => {
    const outcome = await createTextCliAssistant(
      cliReturning({ ok: false, code: 'cli_not_signed_in', message: 'Grok にサインインしていません', costUsd: 0 }),
    ).suggest(request())

    expect(outcome).toMatchObject({ ok: false, error: { code: 'cli_not_signed_in', message: 'Grok にサインインしていません' } })
  })
})

describe('createStubAssistant', () => {
  it('お試しと分かる案を返す（入力から決まる）', async () => {
    const stub = createStubAssistant()
    const first = await stub.suggest(request())
    const second = await stub.suggest(request())

    expect(first).toEqual(second)
    expect(first.ok ? first.text : '').toContain('お試し')
  })
})
