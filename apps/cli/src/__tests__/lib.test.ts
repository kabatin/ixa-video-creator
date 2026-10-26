import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../args.js'
import {
  composeProblems,
  composeSettingsOf,
  composeUpCommand,
  containerInfoOf,
  containerStateOf,
  infraOwnerOf,
  loopbackPortOf,
  portMismatches,
  publishersOf,
} from '../lib/compose.js'
import { appendEnvLine, envKeysOf, missingEnvKeys, parseEnvFile, webLocalOverrides } from '../lib/env-file.js'
import { appendCodexSection, claudeAddCommand, codexHasIxa, codexTomlSection, shellQuote } from '../lib/mcp-config.js'
import { compareVersions, latestVersionTag, majorOf, parseVersion } from '../lib/semver.js'

describe('env-file', () => {
  it('名前はコメントの行を数えない', () => {
    expect(envKeysOf('A=1\n# B=2\n  C =3\nexport D=4\n')).toEqual(['A', 'C', 'D'])
  })

  it('.env.example にあって .env に無い名前を、.env.example の順で返す', () => {
    expect(missingEnvKeys('A=\nB=\nC=\n', 'B=1\n')).toEqual(['A', 'C'])
  })

  it('値は Node の --env-file と同じに読む（引用符を外す）', () => {
    expect(parseEnvFile('A="x y"\nB=\n')).toEqual({ A: 'x y', B: '' })
  })

  it('.env.local は .env と違う値の名前だけ', () => {
    expect(webLocalOverrides({ A: '1', B: '2' }, { A: '1', B: '3', C: '4' })).toEqual(['B'])
  })

  it('行を足すときは改行を補う', () => {
    expect(appendEnvLine('A=1', 'B', '2')).toBe('A=1\nB=2\n')
    expect(appendEnvLine('A=1\n', 'B', '2')).toBe('A=1\nB=2\n')
  })
})

describe('semver', () => {
  it('v 付きも読み、比べる', () => {
    const a = parseVersion('v0.10.0')
    const b = parseVersion('0.9.3')
    expect(a !== null && b !== null && compareVersions(a, b) > 0).toBe(true)
    expect(parseVersion('0.9')).toBeNull()
  })

  it('いちばん新しいタグ（文字の順ではなく数の順）', () => {
    expect(latestVersionTag(['v0.9.0', 'v0.10.0', 'v0.8.1', 'nightly'])?.tag).toBe('v0.10.0')
    expect(latestVersionTag(['nightly'])).toBeNull()
  })

  it('先頭の数字', () => {
    expect(majorOf('v22.11.0')).toBe(22)
  })
})

describe('compose', () => {
  it('既定は pnpm infra:up と同じ名前', () => {
    expect(composeSettingsOf({})).toEqual({ project: 'infra', postgresContainer: 'ixa-postgres', redisContainer: 'ixa-redis' })
    expect(composeUpCommand(composeSettingsOf({}))).toBe('pnpm infra:up')
  })

  it('2 つ目の clone は .env の名前', () => {
    expect(composeSettingsOf({ IXA_COMPOSE_PREFIX: 'ixatest', IXA_COMPOSE_PROJECT: 'ixatest' }).postgresContainer).toBe('ixatest-postgres')
    expect(composeProblems({ IXA_COMPOSE_PREFIX: 'ixatest', IXA_COMPOSE_PROJECT: 'ixatest' })).toEqual([])
    expect(composeProblems({})).toEqual([])
  })

  it('書いたのに形が違う名前は黙って既定（=1 つ目の clone）に戻さず、問題として返す', () => {
    const problems = composeProblems({ IXA_COMPOSE_PREFIX: 'a b; rm', IXA_COMPOSE_PROJECT: 'Ixa Test' })
    expect(problems).toHaveLength(2)
    expect(problems.join('\n')).toContain('IXA_COMPOSE_PROJECT')
    expect(problems.join('\n')).toContain('IXA_COMPOSE_PREFIX')
    expect(composeProblems({ POSTGRES_PORT: '5432x' })[0]).toContain('POSTGRES_PORT')
  })

  it('docker inspect の答えを状態に読む', () => {
    expect(containerStateOf({ exitCode: 0, stdout: 'running|healthy|/r/infra\n' })).toBe('healthy')
    expect(containerStateOf({ exitCode: 0, stdout: 'running|starting|/r/infra' })).toBe('starting')
    expect(containerStateOf({ exitCode: 0, stdout: 'exited||' })).toBe('stopped')
    expect(containerStateOf({ exitCode: 1, stdout: '' })).toBe('missing')
  })

  it('POSTGRES_PORT・REDIS_PORT を書いたのに URL のポートが違えば問題として返す', () => {
    const env = {
      POSTGRES_PORT: '55432',
      REDIS_PORT: '56379',
      DATABASE_URL: 'postgresql://ixa:pw@127.0.0.1:5432/ixa',
      REDIS_URL: 'redis://127.0.0.1:56379',
    }
    const problems = portMismatches(env)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('DATABASE_URL')
    expect(problems[0]).not.toContain('pw')
    expect(portMismatches({ ...env, DATABASE_URL: 'postgresql://ixa:pw@127.0.0.1:55432/ixa' })).toEqual([])
    expect(portMismatches({ DATABASE_URL: 'postgresql://x@127.0.0.1:5433/ixa' })).toEqual([])
  })

  it('URL のポート（書いていなければ既定）。この Mac の中を指しているときだけ', () => {
    expect(loopbackPortOf('postgresql://ixa@127.0.0.1:55432/ixa', 5432)).toBe(55432)
    expect(loopbackPortOf('postgresql://ixa@localhost/ixa', 5432)).toBe(5432)
    expect(loopbackPortOf('redis://db.example.com:6379', 6379)).toBeNull()
    expect(loopbackPortOf('not a url', 6379)).toBeNull()
  })

  it('そのポートを公開しているコンテナを読む（compose の場所が無いものは場所 null）', () => {
    expect(publishersOf('ixa-postgres|/Users/me/ixa/infra\nmine|\n')).toEqual([
      { state: 'healthy', composeDir: '/Users/me/ixa/infra' },
      { state: 'healthy', composeDir: null },
    ])
    expect(publishersOf('')).toEqual([])
  })

  it('名前が違っても、同じポートを別の clone の compose が持っていれば別の clone のもの', () => {
    const byPort = publishersOf('ixa-postgres|/Users/me/ixa/infra')
    expect(infraOwnerOf([containerInfoOf(null), ...byPort], '/tmp/clone2')).toEqual({ kind: 'other', dir: '/Users/me/ixa' })
  })

  it('コンテナを起こした clone を見分ける（場所に空白があっても）', () => {
    const info = containerInfoOf({ exitCode: 0, stdout: 'running|healthy|/Users/me/My Repo/infra\n' })
    expect(info.composeDir).toBe('/Users/me/My Repo/infra')
    expect(infraOwnerOf([info], '/Users/me/My Repo')).toEqual({ kind: 'mine' })
    expect(infraOwnerOf([info], '/tmp/clone')).toEqual({ kind: 'other', dir: '/Users/me/My Repo' })
    expect(infraOwnerOf([containerInfoOf(null)], '/tmp/clone')).toEqual({ kind: 'none' })
  })
})

describe('mcp-config', () => {
  const target = {
    tsx: '/Users/me/My Repo/apps/mcp/node_modules/.bin/tsx',
    main: '/Users/me/My Repo/apps/mcp/src/main.ts',
    apiUrl: 'http://127.0.0.1:3001',
    workspaceId: '01WS',
  }

  it('Claude Code の 1 行。空白のあるパスは囲む。鍵は入れない', () => {
    const command = claudeAddCommand(target)
    expect(command).toContain("'/Users/me/My Repo/apps/mcp/src/main.ts'")
    expect(command).toContain('-e IXA_WORKSPACE_ID=01WS')
    expect(command).not.toContain('IXA_API_TOKEN')
  })

  it('Codex の節は鍵を名前だけで渡す', () => {
    const section = codexTomlSection(target)
    expect(section).toContain('env_vars = ["IXA_API_TOKEN"]')
    expect(codexHasIxa(appendCodexSection('[other]\na = 1\n', section))).toBe(true)
    expect(codexHasIxa('[mcp_servers.ixa_old]')).toBe(false)
  })

  it('shellQuote は引用符も壊さない', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
    expect(shellQuote('plain/path.ts')).toBe('plain/path.ts')
  })
})

describe('parseCliArgs', () => {
  it('前に付いた -- を外し、オプションを読む', () => {
    expect(parseCliArgs(['--', 'doctor', '--json'])).toMatchObject({ command: 'doctor', json: true })
    expect(parseCliArgs(['update', '--after-fetch', '--from', '0.8.0'])).toMatchObject({ afterFetch: true, from: '0.8.0' })
  })

  it('知らないコマンド・オプション・形の違う --from は止める', () => {
    expect(() => parseCliArgs(['instal'])).toThrow('知らないコマンド')
    expect(() => parseCliArgs(['doctor', '--jsno'])).toThrow()
    expect(() => parseCliArgs(['update', '--from', 'latest'])).toThrow('0.8.0')
  })

  it('何も無ければ使い方', () => {
    expect(parseCliArgs([]).command).toBe('help')
  })
})
