import { describe, expect, it } from 'vitest'
import { PUBLISHER_FORMAT } from '../lib/compose.js'
import { paths } from '../lib/repo.js'
import { infraGuard } from '../setup/infra-guard.js'
import { migrateStep, seedStep } from '../setup/steps.js'
import { done, fakeSystem } from './fake-system.js'

const repo = paths('/tmp/clone2')
const env = {
  IXA_COMPOSE_PROJECT: 'ixa2',
  IXA_COMPOSE_PREFIX: 'ixa2',
  DATABASE_URL: 'postgresql://ixa:pw@127.0.0.1:5432/ixa',
  REDIS_URL: 'redis://127.0.0.1:6379',
}
const publishers = (port: number) => `docker ps --filter publish=${String(port)} --format ${PUBLISHER_FORMAT}`

describe('infraGuard（この clone の DB か）', () => {
  it('名前を替えても、URL のポートを 1 つ目の clone のコンテナが持っていれば止める', async () => {
    const system = fakeSystem({ [publishers(5432)]: done('ixa-postgres|/Users/me/ixa-video-creator/infra\n') })
    const guard = await infraGuard(system, env, repo, 'db.migrate')
    expect(guard).toMatchObject({ id: 'db.migrate', status: 'needs_human', fix: { needsHuman: true } })
    expect(guard?.message).toContain('/Users/me/ixa-video-creator')
    expect(guard?.message).not.toContain('pw')
  })

  it('共有すると決めてあれば通す', async () => {
    const system = fakeSystem({ [publishers(5432)]: done('ixa-postgres|/Users/me/ixa-video-creator/infra\n') })
    expect(await infraGuard(system, { ...env, IXA_COMPOSE_SHARED: 'true' }, repo, 'infra')).toBeNull()
  })

  it('ポートの持ち主がこの clone（シンボリックリンク越しでも）なら通す', async () => {
    const system = fakeSystem(
      { [publishers(5432)]: done('ixa2-postgres|/private/tmp/clone2/infra\n') },
      { realpath: (p) => Promise.resolve(p.replace(/^\/private/, '')) },
    )
    expect(await infraGuard(system, env, repo, 'infra')).toBeNull()
  })

  it('DB の更新・初期データ（update の 2 段目も通る手順）は、別の clone の DB なら DB に触る前に止まる', async () => {
    const touched: string[] = []
    const system = fakeSystem(
      { [publishers(5432)]: done('ixa-postgres|/Users/me/ixa-video-creator/infra\n') },
      {
        withDb: () => {
          touched.push('db')
          return Promise.reject(new Error('触ってはいけない'))
        },
      },
    )
    const ctx = { system, repo, yes: true }
    expect((await migrateStep(ctx, env)).status).toBe('needs_human')
    expect((await seedStep(ctx, env)).status).toBe('needs_human')
    expect(touched).toEqual([])
  })

  it('POSTGRES_PORT を書いたのに URL のポートが違えば、Docker を見る前に止める', async () => {
    const guard = await infraGuard(fakeSystem(), { ...env, POSTGRES_PORT: '55432' }, repo, 'infra')
    expect(guard?.message).toContain('POSTGRES_PORT と DATABASE_URL')
  })
})
