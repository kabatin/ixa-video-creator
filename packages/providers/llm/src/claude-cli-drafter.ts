import { MAX_DRAFT_DESCRIPTION_LENGTH, MAX_DRAFT_REASON_LENGTH } from '@ixa/domain'
import { z } from 'zod'
import {
  ClaudeCliEnvelope,
  DEFAULT_CLI_TIMEOUT_MS,
  buildCliArgs,
  execFileCliRunner,
  extractJsonText,
  redactCommand,
  type CliRunResult,
  type CliRunner,
} from './claude-cli-reviewer.js'
import { excerpt } from './errors.js'
import {
  StoryboardDraftRequest,
  StoryboardDraftResponse,
  checkDraftedShotIds,
  type StoryboardDraftCharacter,
  type StoryboardDraftError,
  type StoryboardDraftLook,
  type StoryboardDraftOutcome,
  type StoryboardDrafter,
} from './storyboard-port.js'

/**
 * Claude Code CLI をサブプロセスとして呼ぶ絵コンテ下書き（ADR-0012 / P63-4）。
 *
 * 叩き方は `claude-cli-reviewer.ts` と同じで、**実行の部品はそちらから使い回す**
 * （`execFileCliRunner` / `ClaudeCliEnvelope` / `extractJsonText` / `redactCommand` /
 * `buildCliArgs`）。同じ CLI を 2 通りに叩く理由が無く、写すと片方だけ直る。
 *
 * 違うのは**失敗の返し方だけ**。レビュアは例外を投げるが、こちらは値で返す
 * （`storyboard-port.ts` の方針。run に `status='failed'` を書き残すため）。
 */

export const CLAUDE_CLI_DRAFTER_NAME = 'claude-cli-storyboard-drafter'

/** 依頼の中身が同じなら同じ文になるよう、並びを固定して組み立てる。 */
const shotLines = (request: StoryboardDraftRequest): readonly string[] =>
  request.shots.map(
    (shot) =>
      `- shotId=${shot.id} / code=${shot.code} / ${shot.startSec.toFixed(2)}s から ${shot.durationSec.toFixed(2)}s` +
      ` / いまの説明: ${shot.description.trim() === '' ? '(未記入)' : shot.description}` +
      ` / いまの雰囲気: ${shot.mood ?? '(未設定)'}` +
      (shot.cast.length === 0 ? '' : ` / 登場人物: ${shot.cast.join('、')}`) +
      (shot.location === null ? '' : ` / ロケーション: ${shot.location}`) +
      (shot.lyrics.length === 0 ? '' : ` / 歌詞: ${shot.lyrics.map((line) => `「${line}」`).join('')}`) +
      (shot.narration.length === 0 ? '' : ` / ナレーション: ${shot.narration.map((line) => `「${line}」`).join('')}`),
  )

/** Look 1 件。**文字の無い Look は渡さない**（画像だけで登録したときの既定。名前だけでは何も伝わらない）。 */
const lookText = (look: StoryboardDraftLook): string | null => {
  const detail = [
    look.description.trim(),
    look.wardrobeTokens.length === 0 ? '' : `衣装: ${look.wardrobeTokens.join('、')}`,
  ].filter((part) => part !== '')
  return detail.length === 0 ? null : `Look「${look.name}」（${detail.join('。')}）`
}

/**
 * 登場人物 1 人。書いてあることだけを並べる。
 * **文字の設定が無ければ、外見を書かせない**（画像だけで登録した人物に、設定に無い髪の色や服を書いていた）。
 */
const characterLine = (character: StoryboardDraftCharacter): string => {
  const parts = [
    character.description.trim(),
    character.identityAnchors.length === 0 ? '' : `見た目の要点: ${character.identityAnchors.join('、')}`,
    ...character.looks.map(lookText).filter((text): text is string => text !== null),
  ].filter((part) => part !== '')
  return parts.length === 0
    ? `- ${character.name}: 文字の設定はありません（見た目は画像で決まります。髪・顔・服・色を書かず、名前で指してください）`
    : `- ${character.name}: ${parts.join(' / ')}`
}

const characterLines = (request: StoryboardDraftRequest): readonly string[] =>
  request.characters.length === 0
    ? ['(登録なし)']
    : [
        ...request.characters.map(characterLine),
        '',
        '登場人物の見た目は、生成のときに登録した画像（参照）で決まります。説明では**名前で指し**、動き・表情・構図・場面を書いてください。',
        '髪型・髪の色・顔立ち・服装・色などの外見は、上に書いてあることだけを使ってください。**書いていない外見を足さないでください**（画像と食い違います）。',
        'Shot の行に「登場人物」があれば、その人物を映してください。',
      ]

const locationLines = (request: StoryboardDraftRequest): readonly string[] =>
  request.locations.length === 0
    ? ['(登録なし)']
    : request.locations.map((location) =>
        location.description.trim() === '' ? `- ${location.name}` : `- ${location.name}: ${location.description.trim()}`,
      )

const sectionLines = (request: StoryboardDraftRequest): readonly string[] =>
  request.sections.length === 0
    ? ['(楽曲は未解析)']
    : request.sections.map(
        (section) =>
          `- ${section.label}: ${section.start.toFixed(2)}s〜${section.end.toFixed(2)}s（energy ${section.energy.toFixed(2)}）`,
      )

/**
 * 依頼をプロンプトへ組み立てる。**自由文を返させない**ため出力形式を明示する。
 * テストが固定できるよう公開する。
 */
/** 空欄は「指定なし」と書く。空のまま渡すと、書き忘れか意図的に無いのかが LLM に分からない。 */
const orUnspecified = (text: string): string => (text.trim() === '' ? '(指定なし)' : text.trim())

export const buildDraftPrompt = (request: StoryboardDraftRequest): string =>
  [
    'あなたは映像作品の絵コンテ作家です。既に決まっている Shot の並びに対して、',
    '各 Shot の「説明」と「雰囲気」の案を書いてください。',
    '',
    '**Shot の並び・尺・順番は変更しないでください。** 案を出すのは説明と雰囲気だけです。',
    '',
    '## 作品のコンセプト・あらすじ（脚本）',
    request.script === null || request.script.trim() === '' ? '(まだ書かれていません)' : request.script,
    '',
    '## 作品のルック（画風・光・質感）',
    orUnspecified(request.look),
    '',
    'ルックは生成のときに全 Shot へ自動で足されます。**説明に書き写さないでください**（二重に入ります）。',
    'ルックに合う被写体・場面・構図を説明に書いてください。',
    '',
    '## 避けたいもの',
    orUnspecified(request.avoid),
    '',
    '## 登場人物',
    ...characterLines(request),
    '',
    '## ロケーション',
    ...locationLines(request),
    '',
    '## 歌詞',
    request.lyrics.trim() === '' ? '(歌詞なし)' : request.lyrics.trim(),
    '',
    'Shot の行に「歌詞」があれば、その間に歌われるフレーズです。歌詞の情景や気持ちに合う絵にしてください。',
    '**歌詞の文字を画面に出す指示は書かないでください**（テロップは別に置きます）。',
    '',
    '## 曲の構成',
    ...sectionLines(request),
    '',
    '## Shot 一覧',
    ...shotLines(request),
    '',
    '## 出力',
    '次の JSON だけを出力してください。前後に説明文を付けないでください。',
    '{',
    '  "items": [',
    '    {',
    '      "shotId": 上の一覧にある shotId をそのまま,',
    `      "description": その Shot で何を映すか（${String(MAX_DRAFT_DESCRIPTION_LENGTH)} 文字以内）,`,
    '      "mood": 雰囲気を表す短い語。適切な語が無ければ null,',
    `      "reason": なぜこの絵なのか（${String(MAX_DRAFT_REASON_LENGTH)} 文字以内）`,
    '    }',
    '  ]',
    '}',
    '',
    `**Shot 一覧にある ${String(request.shots.length)} 件すべてに対して、過不足なく 1 件ずつ**返してください。`,
    '一覧に無い shotId を返さないでください。同じ shotId を 2 回返さないでください。',
    'reason を省略しないでください。人はこの理由を読んで採否を決めます。',
  ].join('\n')

const formatIssues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join(' / ')

const parseJson = (text: string): { ok: true; value: unknown } | { ok: false; reason: string } => {
  try {
    const value: unknown = JSON.parse(text)
    return { ok: true, value }
  } catch (error) {
    // 握り潰さない。読めなかった理由を文字列にして呼び出し側へ返す。
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

const ClaudeCliDrafterOptionsSchema = z.object({
  name: z.string().min(1).default(CLAUDE_CLI_DRAFTER_NAME),
  binary: z.string().min(1).default('claude'),
  timeoutMs: z.number().int().positive().default(DEFAULT_CLI_TIMEOUT_MS),
  model: z.string().min(1).nullable().default(null),
  /**
   * 下書きは画像を読まない。文字だけで足りるので**既定では道具を許さない**
   * （レビュアが WebFetch を既定で許すのは画像 URL を読むため）。
   */
  allowedTools: z.array(z.string().min(1)).default([]),
  permissionMode: z.string().min(1).nullable().default(null),
})

export type ClaudeCliStoryboardDrafterOptions = {
  name?: string
  binary?: string
  timeoutMs?: number
  model?: string | null
  allowedTools?: readonly string[]
  permissionMode?: string | null
  /** 実 CLI を叩かずに契約テストを書くための差し込み口。既定は execFile 実装。 */
  runner?: CliRunner
}

export const createClaudeCliStoryboardDrafter = (
  options: ClaudeCliStoryboardDrafterOptions = {},
): StoryboardDrafter => {
  const { runner = execFileCliRunner, ...rest } = options
  const config = ClaudeCliDrafterOptionsSchema.parse(rest)

  /** 失敗に必ず文脈を付ける。**プロンプト本文は伏せたまま**（CLAUDE.md 規約 7 と同じ扱い）。 */
  const failure = (
    code: StoryboardDraftError['code'],
    summary: string,
    command: string,
    costUsd = 0,
  ): StoryboardDraftOutcome => ({
    ok: false,
    /**
     * **CLI が走った後の失敗でも、実際に払った額を連れて来る。**
     * 応答の形が崩れていても課金は起きている。0 と書くと、
     * 費用メーター（P63-2）が「何も使っていない」と読める嘘になる。
     */
    costUsd,
    error: { code, message: `${summary}（adapter=${config.name} / command=${command}）` },
  })

  const runSafely = async (
    command: string,
    args: readonly string[],
  ): Promise<CliRunResult> => {
    try {
      return await runner({ command, args, timeoutMs: config.timeoutMs })
    } catch (error) {
      // 注入された runner が想定外に throw した場合も、値として返す形へ載せ替える。
      const reason = error instanceof Error ? error.message : String(error)
      return { kind: 'spawn_failed', reason }
    }
  }

  const draft = async (request: StoryboardDraftRequest): Promise<StoryboardDraftOutcome> => {
    const parsed = StoryboardDraftRequest.parse(request)
    const prompt = buildDraftPrompt(parsed)
    const args = buildCliArgs({
      prompt,
      model: config.model,
      allowedTools: config.allowedTools,
      permissionMode: config.permissionMode,
    })
    const redacted = redactCommand(config.binary, args, prompt)

    const run = await runSafely(config.binary, args)

    switch (run.kind) {
      case 'not_found':
        return failure('cli_not_found', `CLI ${config.binary} が見つかりません: ${run.reason}`, redacted)
      case 'timeout':
        return failure(
          'cli_timeout',
          `CLI が ${String(run.timeoutMs)}ms 以内に終了しませんでした`,
          redacted,
        )
      case 'spawn_failed':
        return failure('cli_spawn_failed', `CLI を起動できませんでした: ${run.reason}`, redacted)
      case 'completed':
        break
    }

    // exit code を先に見てから出力を解釈する（ADR-0012 の実装上の規約）。
    if (run.exitCode !== 0) {
      return failure(
        'cli_exit_failed',
        `CLI が異常終了しました（exit=${String(run.exitCode)}): ${excerpt(run.stderr)}`,
        redacted,
      )
    }

    const envelopeJson = parseJson(run.stdout)
    if (!envelopeJson.ok) {
      return failure(
        'response_not_json',
        `CLI の応答（envelope）が JSON として読めません: ${excerpt(run.stdout)}`,
        redacted,
      )
    }

    const envelope = ClaudeCliEnvelope.safeParse(envelopeJson.value)
    if (!envelope.success) {
      return failure(
        'response_schema_violation',
        `CLI の応答（envelope）がスキーマに適合しません: ${formatIssues(envelope.error)}`,
        redacted,
      )
    }
    const costUsd = envelope.data.total_cost_usd ?? 0

    if (envelope.data.is_error === true) {
      return failure(
        'cli_exit_failed',
        `CLI が is_error を返しました: ${excerpt(envelope.data.result)}`,
        redacted,
        costUsd,
      )
    }

    const resultText = extractJsonText(envelope.data.result)
    const resultJson = parseJson(resultText)
    if (!resultJson.ok) {
      return failure(
        'response_not_json',
        `CLI の応答（result）が JSON として読めません: ${excerpt(resultText)}`,
        redacted,
        costUsd,
      )
    }

    const result = StoryboardDraftResponse.safeParse(resultJson.value)
    if (!result.success) {
      return failure(
        'response_schema_violation',
        `CLI の応答（result）がスキーマに適合しません: ${formatIssues(result.error)}`,
        redacted,
        costUsd,
      )
    }

    /**
     * **知らない shotId も、足りない shotId も落とす。**
     * 黙って捨てると「27 件頼んだのに 18 件しか出ない」が失敗と区別できなくなる。
     */
    const mismatch = checkDraftedShotIds(
      parsed.shots.map((shot) => shot.id),
      result.data.items.map((item) => item.shotId),
    )
    if (mismatch !== null) return failure(mismatch.code, mismatch.message, redacted, costUsd)

    return { ok: true, items: result.data.items, costUsd }
  }

  return { name: config.name, draft }
}
