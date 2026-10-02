import { describe, expect, it } from 'vitest'
import {
  AI_TOOLS,
  AiSettings,
  aiChoiceProblem,
  aiDefaultsFromEnv,
  recommendAiSettings,
  resolveAiSettings,
  type AiToolId,
  type AiToolStatus,
} from '../ai/ai-tools.js'

/**
 * 使う AI（ADR-0032）。この環境で見つかった AI から、テキスト・画像・動画ごとに 1 つ選ぶ。
 * **選べるかの規則はここ 1 か所**（API の検証と画面の灰色が同じ理由を言う）。
 */

const ready = (version: string | null = null): AiToolStatus => ({ state: 'ready', version })
const missing = (reason = '見つかりません'): AiToolStatus => ({ state: 'missing', reason })

const allMissing = (): Record<AiToolId, AiToolStatus> =>
  Object.fromEntries(
    Object.keys(AI_TOOLS).map((id) => [
      id,
      AI_TOOLS[id as AiToolId].detect.kind === 'builtin' ? ready() : missing(),
    ]),
  ) as Record<AiToolId, AiToolStatus>

describe('aiChoiceProblem', () => {
  it('その用途に使え、見つかっていれば選べる', () => {
    expect(aiChoiceProblem('text', 'claude_cli', ready('2.1.283'))).toBeNull()
    expect(aiChoiceProblem('image', 'codex_cli', ready('0.154.0'))).toBeNull()
  })

  it('お試しは何にでも使え、いつでも選べる', () => {
    expect(aiChoiceProblem('text', 'stub', ready())).toBeNull()
    expect(aiChoiceProblem('image', 'stub', ready())).toBeNull()
    expect(aiChoiceProblem('video', 'stub', ready())).toBeNull()
  })

  it('その用途に使えない AI は、入っていても選べない（理由に用途を言う）', () => {
    expect(aiChoiceProblem('image', 'claude_cli', ready('2.1.283'))).toMatch(
      /Claude Code は画像にはまだ使えません/,
    )
    expect(aiChoiceProblem('text', 'fal', ready())).toMatch(/テキスト/)
  })

  it('見つからない AI は選べない（見つからない理由をそのまま出す）', () => {
    expect(aiChoiceProblem('image', 'codex_cli', missing('codex が入っていません'))).toMatch(
      /codex が入っていません/,
    )
  })
})

describe('recommendAiSettings', () => {
  it('外の AI が何も無ければ、テキストと画像はお試し、動画はアプリに入っている「静止画を動かす」', () => {
    expect(recommendAiSettings(allMissing())).toEqual({
      text: 'stub',
      image: 'stub',
      video: 'local',
    })
  })

  it('動画は、手元の生成サーバ（vpipe）が起動していればそれを勧める', () => {
    expect(recommendAiSettings({ ...allMissing(), vpipe: ready() }).video).toBe('vpipe')
  })

  it('テキストは Claude、画像は Codex、動画は無料の「静止画を動かす」を勧める', () => {
    const statuses = { ...allMissing(), claude_cli: ready(), codex_cli: ready() }

    expect(recommendAiSettings(statuses)).toEqual({
      text: 'claude_cli',
      image: 'codex_cli',
      video: 'local',
    })
  })

  /** お金が掛かるものは、キーがあっても勧めない（選ぶのは人）。 */
  it('fal はキーがあっても勧めない', () => {
    const statuses = { ...allMissing(), fal: ready() }

    expect(recommendAiSettings(statuses).video).not.toBe('fal')
  })

  /** ADR-0032 の 2・4 段目。Gemini CLI は廃止されたので対応しない（制作者 2026-10-02）。 */
  it('テキストは Claude・Codex・Grok で選べ、Gemini は選べない', () => {
    expect(aiChoiceProblem('text', 'codex_cli', ready())).toBeNull()
    expect(aiChoiceProblem('text', 'grok_cli', ready())).toBeNull()
    expect(aiChoiceProblem('text', 'gemini_cli', ready())).not.toBeNull()
  })

  it('Claude が無ければ、テキストは Codex を勧める（Gemini は勧めない）', () => {
    const statuses = { ...allMissing(), codex_cli: ready(), gemini_cli: ready() }
    expect(recommendAiSettings(statuses).text).toBe('codex_cli')
    expect(recommendAiSettings({ ...allMissing(), gemini_cli: ready(), grok_cli: ready() }).text).toBe('grok_cli')
  })

  it('勧めた組み合わせは必ず選べる', () => {
    const statuses: Record<AiToolId, AiToolStatus> = {
      ...allMissing(),
      claude_cli: ready(),
      codex_cli: ready(),
      gemini_cli: ready(),
    }
    const recommended = recommendAiSettings(statuses)

    for (const purpose of ['text', 'image', 'video'] as const) {
      const tool = recommended[purpose]
      expect(aiChoiceProblem(purpose, tool, statuses[tool])).toBeNull()
    }
  })
})

describe('resolveAiSettings', () => {
  const defaults = { text: 'stub', image: 'stub', video: 'stub' } as const

  it('まだ選んでいなければ初期値（環境変数）を使い、そう名乗る', () => {
    expect(resolveAiSettings(null, defaults)).toEqual({ settings: defaults, source: 'default' })
  })

  it('選んであれば選んだものが勝つ', () => {
    const saved = { text: 'claude_cli', image: 'codex_cli', video: 'local' } as const

    expect(resolveAiSettings(saved, defaults)).toEqual({ settings: saved, source: 'saved' })
  })
})

/** まだ画面で選んでいない間は、今までどおり環境変数で決まる（既存の `.env` と CI を壊さない）。 */
describe('aiDefaultsFromEnv', () => {
  const env = { storyboardDrafter: 'stub', imageProvider: 'stub' } as const

  it('何も指定が無ければ全部お試し', () => {
    expect(aiDefaultsFromEnv(env)).toEqual({ text: 'stub', image: 'stub', video: 'stub' })
  })

  it('テキストと画像は、環境変数で選んだ口をそのまま初期値にする', () => {
    expect(
      aiDefaultsFromEnv({ storyboardDrafter: 'claude_cli', imageProvider: 'codex_cli' }),
    ).toEqual({
      text: 'claude_cli',
      image: 'codex_cli',
      video: 'stub',
    })
  })

  /**
   * 動画の AUTO は今まで、VIDEO_PROVIDER=fal でも LOCAL_VIDEO_GENERATOR=vpipe でもお試しを選んでいた
   * （fal は API に登録されず、vpipe は AUTO に出ない）。選ぶ前に、黙ってお金の掛かる口へ変えない。
   */
  it('動画の初期値は、環境変数にかかわらずお試し', () => {
    expect(aiDefaultsFromEnv(env).video).toBe('stub')
  })
})

describe('AiSettings', () => {
  it('知らない AI の名前は受けない', () => {
    expect(AiSettings.safeParse({ text: 'chatgpt', image: 'stub', video: 'stub' }).success).toBe(
      false,
    )
  })

  it('3 つの用途がすべて要る', () => {
    expect(AiSettings.safeParse({ text: 'stub', image: 'stub' }).success).toBe(false)
  })
})
