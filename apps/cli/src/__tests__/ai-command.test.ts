import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../args.js'
import { aiConnectCommand, aiStatusCommand } from '../commands/ai.js'
import { aiInstallCommand, aiScriptOf, componentStep, installArgs, resultFileOf } from '../commands/ai-install.js'
import { paths } from '../lib/repo.js'
import type { Output } from '../printer.js'
import type { RunOptions } from '../system.js'
import { connectCode } from './ai-env.test.js'
import { done, fakeSystem } from './fake-system.js'

const TOKEN = 'Q'.repeat(43)
const EXAMPLE = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8')
const repo = paths('/repo')
const RESULT_FILE = resultFileOf('/Users/me')
const ROOT_PACKAGE = JSON.stringify({ name: 'ixa-video-creator', version: '0.8.1', packageManager: 'pnpm@9.15.4' })

/** 表示と答えを貯める偽の Output（stdout に出るものはこれで全部）。 */
const captured = (json: boolean) => {
  const lines: string[] = []
  const results: unknown[] = []
  const out: Output = { json, line: (t) => lines.push(t), result: (p) => results.push(p) }
  return { out, lines, results, all: () => [...lines, ...results.map((r) => JSON.stringify(r))].join('\n') }
}

const fileSystem = (files: Record<string, string>, extra: Parameters<typeof fakeSystem>[1] = {}) => {
  const written: Record<string, string> = {}
  const removed: string[] = []
  const system = fakeSystem(
    {},
    {
      readText: (p) => Promise.resolve(written[p] ?? files[p] ?? (p === repo.rootPackage ? ROOT_PACKAGE : null)),
      writeText: (p, c) => Promise.resolve(void (written[p] = c)),
      remove: (p) => Promise.resolve(void removed.push(p)),
      exists: (p) => Promise.resolve(p in files),
      ...extra,
    },
  )
  return { system, written, removed }
}

describe('ai connect', () => {
  const code = connectCode([{ id: 'sfx-api', url: 'http://ai-mac.local:8769', token: TOKEN }])

  it('.env に URL・合言葉・一覧を書き、合言葉と接続コードは表示にも JSON にも出さない', async () => {
    const { system, written } = fileSystem({ [repo.env]: EXAMPLE })
    for (const json of [false, true]) {
      const c = captured(json)
      const exit = await aiConnectCommand(system, repo, c.out, parseCliArgs(['ai', 'connect', code, '--yes']))
      expect(exit).toBe(0)
      expect(c.all()).not.toContain(TOKEN)
      expect(c.all()).not.toContain(code)
    }
    const env = written[repo.env] ?? ''
    expect(env).toContain('LOCAL_SFX_GENERATOR=sfx_api\n')
    expect(env).toContain('SFX_API_URL=http://ai-mac.local:8769\n')
    expect(env).toContain(`SFX_API_TOKEN=${TOKEN}\n`)
  })

  it('値の入った別の接続先は --overwrite-env か「はい」が無ければ替えず、何も書かない（--yes では替えない）', async () => {
    const custom = EXAMPLE.replace('SFX_API_URL=http://127.0.0.1:8769', 'SFX_API_URL=http://old.local:8769')
    for (const argv of [['ai', 'connect', code], ['ai', 'connect', code, '--yes']]) {
      const { system, written } = fileSystem({ [repo.env]: custom })
      const c = captured(true)
      const exit = await aiConnectCommand(system, repo, c.out, parseCliArgs(argv))
      expect(exit).toBe(1)
      expect(written[repo.env]).toBeUndefined()
      expect(c.all()).toContain('SFX_API_URL')
      expect(c.results[0]).toMatchObject({ steps: [{ id: 'ai.env.kept', status: 'needs_human', fix: { needsHuman: true } }] })
      expect(JSON.stringify(c.results[0])).toContain('--overwrite-env')
    }
    const forced = fileSystem({ [repo.env]: custom })
    await aiConnectCommand(forced.system, repo, captured(true).out, parseCliArgs(['ai', 'connect', code, '--overwrite-env']))
    expect(forced.written[repo.env]).toContain('SFX_API_URL=http://ai-mac.local:8769\n')
    const asked = fileSystem({ [repo.env]: custom }, { confirm: () => Promise.resolve(true) })
    await aiConnectCommand(asked.system, repo, captured(true).out, parseCliArgs(['ai', 'connect', code]))
    expect(asked.written[repo.env]).toContain('SFX_API_URL=http://ai-mac.local:8769\n')
  })

  it('接続コードを省くと、端末では画面に出さずに聞き、端末でなければ stdin から読む', async () => {
    const asked: string[] = []
    const viaPrompt = fileSystem({ [repo.env]: EXAMPLE }, { promptSecret: (q) => Promise.resolve(void asked.push(q)).then(() => code) })
    const c = captured(true)
    expect(await aiConnectCommand(viaPrompt.system, repo, c.out, parseCliArgs(['ai', 'connect']))).toBe(0)
    expect(asked).toHaveLength(1)
    expect(viaPrompt.written[repo.env]).toContain(`SFX_API_TOKEN=${TOKEN}\n`)
    expect(c.all()).not.toContain(code)
    const viaStdin = fileSystem({ [repo.env]: EXAMPLE }, { readStdin: () => Promise.resolve(`${code}\n`) })
    expect(await aiConnectCommand(viaStdin.system, repo, captured(true).out, parseCliArgs(['ai', 'connect']))).toBe(0)
    expect(viaStdin.written[repo.env]).toContain(`SFX_API_TOKEN=${TOKEN}\n`)
  })

  it('接続コードを受け取れなければ何も書かずに人に頼む', async () => {
    const { system, written } = fileSystem({ [repo.env]: EXAMPLE })
    const c = captured(true)
    expect(await aiConnectCommand(system, repo, c.out, parseCliArgs(['ai', 'connect']))).toBe(1)
    expect(written[repo.env]).toBeUndefined()
    expect(c.results[0]).toMatchObject({ ok: false, steps: [{ id: 'ai.connect.code', status: 'needs_human', fix: { needsHuman: true } }] })
  })

  it('短い合言葉は configProblems が止め、.env を書かない', async () => {
    const short = connectCode([{ id: 'sfx-api', url: 'http://ai-mac.local:8769', token: 'short' }])
    const { system, written } = fileSystem({ [repo.env]: EXAMPLE })
    const c = captured(true)
    expect(await aiConnectCommand(system, repo, c.out, parseCliArgs(['ai', 'connect', short, '--yes']))).toBe(1)
    expect(written[repo.env]).toBeUndefined()
    expect(c.all()).toContain('SFX_API_TOKEN の形が違います')
  })
})

describe('ai install', () => {
  it('引数をそのまま ixa_ai.py に渡す（--overwrite-env は ixa の .env のことなので渡さない）', () => {
    const options = parseCliArgs(['ai', 'install', '--models', 'h3', '--accept-licenses', 'h3', '--yes', '--overwrite-env'])
    expect(installArgs('/s.py', '/r.json', options)).toEqual([
      'run', '/s.py', 'install', '--result-file', '/r.json', '--models', 'h3', '--accept-licenses', 'h3', '--yes',
    ])
  })

  it('知らない状態は失敗にする（黙って合格にしない）', () => {
    expect(componentStep({ id: 'h3', status: 'installed' }).status).toBe('done')
    expect(componentStep({ id: 'h3', status: 'unsupported', message: 'x' }).status).toBe('failed')
  })

  it('--plan --json は一覧を返すだけで .env を書かない', async () => {
    const plan = JSON.stringify({ ok: true, action: 'plan', items: [{ id: 'h3' }] })
    const calls: string[] = []
    const { system, written } = fileSystem(
      { [repo.env]: EXAMPLE },
      {
        run: (cmd, args) => {
          calls.push([cmd, ...args].join(' '))
          return Promise.resolve(done(`noise\n${plan}\n`))
        },
      },
    )
    const c = captured(true)
    expect(await aiInstallCommand(system, repo, c.out, parseCliArgs(['ai', 'install', '--plan', '--json']))).toBe(0)
    expect(calls).toEqual([`uv run ${aiScriptOf(repo)} plan --json`])
    expect(c.results[0]).toMatchObject({ command: 'ai', action: 'plan', ok: true, plan: { items: [{ id: 'h3' }] } })
    expect(written).toEqual({})
  })

  it('ixa_ai.py の答えを .env に合わせて書き、答えのファイルを消す', async () => {
    const answer = {
      ok: true,
      action: 'install',
      servers: [{ server: 'sfx-api', url: 'http://127.0.0.1:8769', tokenSet: false, components: [{ id: 'sa3-small', status: 'installed' }] }],
      local: [],
      env: { LOCAL_SFX_GENERATOR: 'sfx_api', SFX_API_URL: 'http://127.0.0.1:8769' },
    }
    const runs: { args: readonly string[]; options?: RunOptions }[] = []
    const files = { [repo.env]: EXAMPLE, [RESULT_FILE]: JSON.stringify(answer) }
    const { system, written, removed } = fileSystem(files, {
      run: (cmd, args, options) => {
        if (cmd === 'uv') runs.push({ args, options })
        return Promise.resolve(done(''))
      },
    })
    const c = captured(true)
    const options = parseCliArgs(['ai', 'install', '--models', 'sa3-small', '--accept-licenses', 'sa3-small', '--yes', '--json'])
    await aiInstallCommand(system, repo, c.out, options)
    expect(runs[0]?.options?.inherit).toBe('to-stderr')
    expect(written[repo.env]).toContain('LOCAL_SFX_GENERATOR=sfx_api\n')
    expect(removed).toContain(RESULT_FILE)
    expect(c.results[0]).toMatchObject({ command: 'ai', action: 'install', steps: [
        { id: 'ai.sa3-small', status: 'done' },
        { id: 'ai.env', status: 'done', message: '.env に書きました: LOCAL_SFX_GENERATOR' },
      ],
    })
  })

  it('--yes でも、値の入った別の URL（別の Mac の sfx-api など）は替えない。--overwrite-env なら替える', async () => {
    const answer = {
      ok: true,
      action: 'install',
      servers: [{ server: 'sfx-api', url: 'http://127.0.0.1:8769', tokenSet: false, components: [{ id: 'sa3-small', status: 'installed' }] }],
      local: [],
      env: { LOCAL_SFX_GENERATOR: 'sfx_api', SFX_API_URL: 'http://127.0.0.1:8769' },
    }
    const remote = EXAMPLE.replace('SFX_API_URL=http://127.0.0.1:8769', 'SFX_API_URL=http://ai-mac.local:8769')
    const base = ['ai', 'install', '--models', 'sa3-small', '--accept-licenses', 'sa3-small', '--yes', '--json']
    const runWith = async (argv: readonly string[]) => {
      const fs = fileSystem({ [repo.env]: remote, [RESULT_FILE]: JSON.stringify(answer) }, { run: () => Promise.resolve(done('')) })
      const c = captured(true)
      const exit = await aiInstallCommand(fs.system, repo, c.out, parseCliArgs(argv))
      return { exit, written: fs.written, c }
    }
    const kept = await runWith(base)
    expect(kept.exit).toBe(1)
    expect(kept.written[repo.env]).toBeUndefined()
    expect(kept.c.results[0]).toMatchObject({ steps: [{ id: 'ai.sa3-small' }, { id: 'ai.env.kept', status: 'needs_human' }] })
    expect(JSON.stringify(kept.c.results[0])).toContain('--overwrite-env')
    const forced = await runWith([...base, '--overwrite-env'])
    expect(forced.written[repo.env]).toContain('SFX_API_URL=http://127.0.0.1:8769\n')
  })

  it('答えの形が違えば、どこが違うかを添えて止める（値は出さない）', async () => {
    const fix = { hint: '許可する', command: null, needsHuman: true }
    const answer = {
      ok: false,
      action: 'install',
      servers: [{ server: 'klein-api', url: 'http://127.0.0.1:8767', tokenSet: true, components: [{ id: 'klein-4b', status: 'needs_human', fix }] }],
      local: [],
      env: {},
    }
    const { system } = fileSystem({ [repo.env]: EXAMPLE, [RESULT_FILE]: JSON.stringify(answer) }, { run: () => Promise.resolve(done('')) })
    const run = aiInstallCommand(system, repo, captured(true).out, parseCliArgs(['ai', 'install', '--models', 'klein-4b']))
    await expect(run).rejects.toThrow('servers.0.components.0.fix.command')
  })

  it('.env が無ければ何も入れずに止める', async () => {
    const calls: string[] = []
    const { system } = fileSystem({}, { run: (cmd) => Promise.resolve(void calls.push(cmd)).then(() => done('')) })
    const c = captured(true)
    expect(await aiInstallCommand(system, repo, c.out, parseCliArgs(['ai', 'install', '--models', 'h3']))).toBe(1)
    expect(calls.filter((cmd) => cmd === 'uv')).toEqual([])
  })
})

describe('ai status', () => {
  it('手元の AI の点検だけを出す', async () => {
    const { system } = fileSystem({ [repo.env]: EXAMPLE })
    const c = captured(true)
    expect(await aiStatusCommand(system, repo, c.out)).toBe(0)
    expect(c.results[0]).toMatchObject({ command: 'ai', action: 'status', results: [{ id: 'local-ai', level: 'ok' }] })
  })
})
