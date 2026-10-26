import { describe, expect, it } from 'vitest'
import { judgeDb, type DbFacts } from '../checks/db.js'
import { judgeEnv } from '../checks/env.js'
import { composeSettingsOf } from '../lib/compose.js'

const SECRET = 'a'.repeat(64)
const okEnv = [
  'DATABASE_URL=postgresql://ixa:pw@127.0.0.1:5432/ixa',
  'REDIS_URL=redis://127.0.0.1:6379',
  `STORAGE_SIGNING_SECRET=${SECRET}`,
  'NEXT_PUBLIC_API_URL=http://127.0.0.1:3001',
  'NEXT_PUBLIC_WORKSPACE_ID=01WS',
].join('\n')
const example = `${okEnv}\n# IXA_COMPOSE_PREFIX=ixa\nGEMINI_KEY_LABEL=\n`

const byId = <T extends { readonly id: string }>(results: readonly T[], id: string) => results.find((r) => r.id === id)

describe('judgeEnv（設定の判定）', () => {
  it('.env が無ければ ✗ で setup を勧める', () => {
    const [file] = judgeEnv({ envContent: null, exampleContent: example, webLocalContent: null })
    expect(file).toMatchObject({ id: 'env.file', level: 'fail', fix: { command: 'pnpm ixa setup' } })
  })

  it('.env.example にあって .env に無い項目を名前で出す（コメントの行は数えない）', () => {
    const newKeys = byId(judgeEnv({ envContent: okEnv, exampleContent: example, webLocalContent: null }), 'env.new-keys')
    expect(newKeys?.level).toBe('warn')
    expect(newKeys?.message).toContain('GEMINI_KEY_LABEL')
    expect(newKeys?.message).not.toContain('IXA_COMPOSE_PREFIX')
  })

  it('署名の鍵が空なら ✗、直し方は setup（値は文に出さない）', () => {
    const env = okEnv.replace(`STORAGE_SIGNING_SECRET=${SECRET}`, 'STORAGE_SIGNING_SECRET=')
    const valid = byId(judgeEnv({ envContent: env, exampleContent: example, webLocalContent: null }), 'env.valid')
    expect(valid).toMatchObject({ level: 'fail', fix: { command: 'pnpm ixa setup', needsHuman: false } })
  })

  it('課金の鍵の食い違いは人に聞く（needsHuman）。どの文にも値は出ない', () => {
    const env = `${okEnv}\nAUDIO_API_PROVIDERS=gemini_api\nVPIPE_API_TOKEN=short`
    const results = judgeEnv({ envContent: env, exampleContent: example, webLocalContent: null })
    expect(byId(results, 'env.valid')?.fix?.needsHuman).toBe(true)
    expect(JSON.stringify(results)).not.toContain(SECRET)
    expect(JSON.stringify(results)).not.toContain(':pw@')
  })

  it('apps/web/.env.local が違う値で上書きしていれば名前を出す', () => {
    const webLocal = 'NEXT_PUBLIC_WORKSPACE_ID=01OTHER\nNEXT_PUBLIC_API_URL=http://127.0.0.1:3001\n'
    const web = byId(judgeEnv({ envContent: okEnv, exampleContent: example, webLocalContent: webLocal }), 'env.web-local')
    expect(web?.level).toBe('warn')
    expect(web?.message).toContain('NEXT_PUBLIC_WORKSPACE_ID')
    expect(web?.message).not.toContain('NEXT_PUBLIC_API_URL')
  })
})

const healthy: DbFacts = {
  compose: composeSettingsOf({}),
  postgresContainer: 'healthy',
  redisContainer: 'healthy',
  owner: { kind: 'mine' },
  shared: false,
  postgres: true,
  redis: true,
  pending: [],
  workspaceIds: ['01WS'],
  envWorkspaceId: '01WS',
}

describe('judgeDb（DB の判定）', () => {
  it('全部揃えば ✓ だけ', () => {
    expect(judgeDb(healthy).every((r) => r.level === 'ok')).toBe(true)
  })

  it('まだの DB の更新があれば ✗ で本数を出す', () => {
    const m = byId(judgeDb({ ...healthy, pending: ['0057_a', '0058_b'] }), 'db.migrations')
    expect(m).toMatchObject({ level: 'fail', fix: { command: 'pnpm ixa setup' } })
    expect(m?.message).toContain('2 本')
  })

  it('コンテナが無くてつながらなければ ✗ で起動の 1 行（2 つ目の clone はその名前で）', () => {
    const facts: DbFacts = {
      ...healthy,
      compose: composeSettingsOf({ IXA_COMPOSE_PROJECT: 'ixatest', IXA_COMPOSE_PREFIX: 'ixatest' }),
      postgresContainer: 'missing',
      postgres: 'つながりません',
      pending: null,
      workspaceIds: null,
    }
    const container = byId(judgeDb(facts), 'db.postgres-container')
    expect(container?.level).toBe('fail')
    expect(container?.fix?.command).toContain('-p ixatest')
    expect(byId(judgeDb(facts), 'db.migrations')?.level).toBe('skip')
  })

  it('コンテナが無くてもつながれば（Docker の外）✓', () => {
    expect(byId(judgeDb({ ...healthy, postgresContainer: 'missing' }), 'db.postgres-container')?.level).toBe('ok')
  })

  it('別の clone のコンテナなら !（DB を共有している）。共有すると決めてあれば ✓', () => {
    const other = { kind: 'other', dir: '/Users/me/ixa-video-creator' } as const
    expect(byId(judgeDb({ ...healthy, owner: other }), 'db.infra-owner')).toMatchObject({ level: 'warn', fix: { needsHuman: true } })
    expect(byId(judgeDb({ ...healthy, owner: other, shared: true }), 'db.infra-owner')?.level).toBe('ok')
  })

  it('.env の ID が空なら setup、DB に無い ID なら人に聞く（書き換えない）', () => {
    expect(byId(judgeDb({ ...healthy, envWorkspaceId: null }), 'db.workspace')?.fix?.command).toBe('pnpm ixa setup')
    expect(byId(judgeDb({ ...healthy, envWorkspaceId: '01ELSE' }), 'db.workspace')?.fix?.needsHuman).toBe(true)
  })
})
