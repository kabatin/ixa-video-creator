import { describe, expect, it, vi } from 'vitest'
import { browserStateOf, gatherRender, judgeRender } from '../checks/render.js'
import { parseEnvFile } from '../lib/env-file.js'
import { paths } from '../lib/repo.js'
import { DEFAULT_GEMINI_KEY_LABEL, geminiStep, withGeminiKey } from '../setup/gemini.js'
import { mcpStep } from '../setup/mcp-step.js'
import { remotionBrowserStep } from '../setup/render-browser.js'
import type { RunResult, System } from '../system.js'
import { done, fakeSystem } from './fake-system.js'

/** Gemini の鍵・書き出しの前提・MCP の登録（ADR-0065）。どれも setup を止めない。 */

const repo = paths('/r')
const KEY = 'AIzaSyD-fake_key_0123456789abcdefghijk'

const withEnv = (initial: string, answers: Readonly<Record<string, RunResult>> = {}, overrides: Partial<System> = {}) => {
  const files = new Map<string, string>([[repo.env, initial]])
  const progress: string[] = []
  const system = fakeSystem(answers, {
    readText: (file) => Promise.resolve(files.get(file) ?? null),
    writeText: (file, content) => {
      files.set(file, content)
      return Promise.resolve()
    },
    progress: (line) => progress.push(line),
    ...overrides,
  })
  return { system, env: () => files.get(repo.env) ?? '', progress }
}

describe('geminiStep', () => {
  it('--yes では聞かずに飛ばし、「要る」を知らせる（止めない・鍵を聞かない）', async () => {
    const promptSecret = vi.fn(() => Promise.resolve(KEY))
    const { system, env } = withEnv('GEMINI_API_KEY=\n', {}, { isTty: true, promptSecret })
    const result = await geminiStep({ system, repo, yes: true })
    expect(result).toMatchObject({ status: 'notice', fix: { needsHuman: true } })
    expect(promptSecret).not.toHaveBeenCalled()
    expect(env()).toBe('GEMINI_API_KEY=\n')
  })

  it('端末でなければ聞かない', async () => {
    const { system } = withEnv('', {}, { isTty: false, confirm: () => Promise.resolve(true) })
    expect(await geminiStep({ system, repo, yes: false })).toMatchObject({ status: 'notice', fix: { needsHuman: true } })
  })

  it('入れると答えたら鍵を画面に出さずに受け取り、一覧に足して書く。鍵はどの文にも出さない', async () => {
    const answers = [true, true]
    const { system, env, progress } = withEnv(
      'AUDIO_API_PROVIDERS=elevenlabs\nGEMINI_API_KEY=\nGEMINI_API_BILLING=free\nGEMINI_KEY_LABEL=\n',
      {},
      { isTty: true, confirm: () => Promise.resolve(answers.shift() ?? false), promptSecret: () => Promise.resolve(` ${KEY} `) },
    )
    const result = await geminiStep({ system, repo, yes: false })
    expect(result.status).toBe('done')
    expect(parseEnvFile(env())).toMatchObject({
      GEMINI_API_KEY: KEY,
      AUDIO_API_PROVIDERS: 'elevenlabs,gemini_api',
      GEMINI_API_BILLING: 'free',
      GEMINI_KEY_LABEL: DEFAULT_GEMINI_KEY_LABEL,
    })
    expect(JSON.stringify(result)).not.toContain(KEY)
    expect(progress.join('\n')).not.toContain(KEY)
  })

  it('有料枠と答えたら paid。名札が入っていれば書き換えない', () => {
    const next = parseEnvFile(withGeminiKey('GEMINI_KEY_LABEL=key2-2026-10-14\n', KEY, 'paid'))
    expect(next).toMatchObject({ GEMINI_API_BILLING: 'paid', GEMINI_KEY_LABEL: 'key2-2026-10-14', AUDIO_API_PROVIDERS: 'gemini_api' })
  })

  it('形の違う鍵（空白の混じった貼り付け）は書かず、打った値を文に出さない', async () => {
    const bad = 'AIza secret with spaces 1234567890'
    const { system, env } = withEnv('GEMINI_API_KEY=\n', {}, {
      isTty: true,
      confirm: () => Promise.resolve(true),
      promptSecret: () => Promise.resolve(bad),
    })
    const result = await geminiStep({ system, repo, yes: false })
    expect(result.status).toBe('notice')
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(env()).toBe('GEMINI_API_KEY=\n')
  })

  it('取りやめ（Ctrl-C）・空は飛ばす。鍵があれば何もしない', async () => {
    const cancel = withEnv('', {}, { isTty: true, confirm: () => Promise.resolve(true), promptSecret: () => Promise.resolve(null) })
    expect((await geminiStep({ system: cancel.system, repo, yes: false })).status).toBe('skipped')
    const already = withEnv(`GEMINI_API_KEY=${KEY}\nAUDIO_API_PROVIDERS=gemini_api\n`)
    const result = await geminiStep({ system: already.system, repo, yes: false })
    expect(result).toMatchObject({ status: 'already' })
    expect(JSON.stringify(result)).not.toContain(KEY)
  })
})

const STATUS = `${repo.cliTsx} ${repo.remotionBrowserScript} status ${repo.workerDir}`
const FETCH = `${repo.cliTsx} ${repo.remotionBrowserScript} fetch ${repo.workerDir}`
const exit = (code: number): RunResult => ({ kind: 'completed', exitCode: code, stdout: '', stderr: '' })

describe('書き出しの前提（doctor）', () => {
  it('headless Chrome は終了コードで見る（0 ある・3 無い・ほかは分からない）', () => {
    expect(browserStateOf(exit(0))).toBe('ready')
    expect(browserStateOf(exit(3))).toBe('missing')
    expect(browserStateOf(exit(1))).toBe('unknown')
    expect(browserStateOf({ kind: 'not_found' })).toBe('unknown')
  })

  it('無ければ ! で先に取ってくる 1 行を出す。フォントが欠けていれば名前を言う（✗ にはしない）', () => {
    const results = judgeRender({ browser: 'missing', missingFonts: ['ヒラギノ明朝'] })
    expect(results).toEqual([
      expect.objectContaining({ id: 'tools.remotion-browser', level: 'warn', fix: expect.objectContaining({ command: 'pnpm ixa setup' }) as unknown }),
      expect.objectContaining({ id: 'tools.japanese-font', level: 'warn', message: expect.stringContaining('ヒラギノ明朝') as unknown }),
    ])
    expect(results.some((r) => r.level === 'fail')).toBe(false)
  })

  it('Mac ならヒラギノのファイルを見る。Mac でなければ見ない', async () => {
    const seen: string[] = []
    const mac = fakeSystem({ [STATUS]: exit(0) }, { exists: (p) => (seen.push(p), Promise.resolve(!p.includes('丸ゴ'))) })
    expect(await gatherRender(mac, repo)).toEqual({ browser: 'ready', missingFonts: ['ヒラギノ丸ゴ'] })
    expect(seen).toContain('/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc')
    const linux = fakeSystem({ [STATUS]: exit(3) }, { platform: 'linux' })
    expect(await gatherRender(linux, repo)).toEqual({ browser: 'missing', missingFonts: null })
  })
})

describe('remotionBrowserStep', () => {
  it('あれば取ってこない', async () => {
    const run = vi.fn((command: string, args: readonly string[]) => Promise.resolve([command, ...args].join(' ') === STATUS ? exit(0) : exit(1)))
    const result = await remotionBrowserStep({ system: fakeSystem({}, { run }), repo, yes: false })
    expect(result.status).toBe('already')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('無ければ worker のディレクトリで取ってくる', async () => {
    const states = [exit(3), exit(0)]
    const run = vi.fn((command: string, args: readonly string[]) =>
      Promise.resolve([command, ...args].join(' ') === FETCH ? exit(0) : (states.shift() ?? exit(1))),
    )
    expect((await remotionBrowserStep({ system: fakeSystem({}, { run }), repo, yes: true })).status).toBe('done')
    expect(run.mock.calls.map(([c, a]) => [c, ...a].join(' '))).toContain(FETCH)
  })

  it('取ってこられなくても止めない（初回の書き出しでまた取りに行く）', async () => {
    const result = await remotionBrowserStep({ system: fakeSystem({ [STATUS]: exit(3), [FETCH]: exit(1) }), repo, yes: true })
    expect(result.status).toBe('notice')
  })
})

describe('mcpStep', () => {
  const WS = 'NEXT_PUBLIC_WORKSPACE_ID=01ARZ3NDEKTSV4RRFFQ69G5FAV\n'
  const notRegistered: RunResult = { kind: 'completed', exitCode: 1, stdout: '', stderr: 'No MCP server found' }

  it('--yes では書かずに、登録の 1 行を返す（人が決める）', async () => {
    const run = vi.fn((_command: string, args: readonly string[]) => Promise.resolve(args.includes('get') ? notRegistered : done('')))
    const { system } = withEnv(WS, {}, { run, isTty: true, confirm: () => Promise.resolve(true) })
    const [result] = await mcpStep({ system, repo, yes: true })
    expect(result).toMatchObject({ status: 'notice', fix: { command: 'pnpm ixa mcp --claude --write', needsHuman: true } })
    expect(run.mock.calls.some(([, a]) => a.includes('add'))).toBe(false)
  })

  it('端末で「はい」なら登録し、アクセス用の鍵の発行場所を知らせる（止めない）', async () => {
    const run = vi.fn((_command: string, args: readonly string[]) => Promise.resolve(args.includes('get') ? notRegistered : done('')))
    const { system } = withEnv(WS, {}, { run, isTty: true, confirm: () => Promise.resolve(true) })
    const results = await mcpStep({ system, repo, yes: false })
    expect(results.map((r) => r.status)).toEqual(['done', 'notice'])
    expect(results[1]?.message).toMatch(/access-keys/)
    expect(run.mock.calls.some(([, a]) => a[0] === 'mcp' && a[1] === 'add')).toBe(true)
  })

  it('登録に失敗しても止めない。登録済み・Claude が無いときは聞かない', async () => {
    const failing = vi.fn((_c: string, args: readonly string[]) => Promise.resolve(args.includes('get') ? notRegistered : exit(1)))
    const fail = withEnv(WS, {}, { run: failing, isTty: true, confirm: () => Promise.resolve(true) })
    expect((await mcpStep({ system: fail.system, repo, yes: false }))[0]?.status).toBe('notice')
    const confirm = vi.fn(() => Promise.resolve(true))
    const registered = withEnv(WS, { 'claude mcp get ixa': done('ixa: ...') }, { isTty: true, confirm })
    expect((await mcpStep({ system: registered.system, repo, yes: false }))[0]?.status).toBe('already')
    const missing = withEnv(WS, {}, { isTty: true, confirm })
    expect((await mcpStep({ system: missing.system, repo, yes: false }))[0]?.status).toBe('skipped')
    expect(confirm).not.toHaveBeenCalled()
  })
})
