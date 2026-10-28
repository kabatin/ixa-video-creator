import { readFileSync } from 'node:fs'
import { LOCAL_VIDEO_SERVERS } from '@ixa/config'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { SERVER_REPOS, serverEnvOf } from '../ai/servers.js'

/**
 * `tools/ixa-ai/catalog.json` の `servers[*].ixa` と、CLI の `servers.ts`・`LOCAL_VIDEO_SERVERS` が同じことを言っているか（ADR-0064）。
 * 一覧は Python（uv で 1 ファイルで動く）と TypeScript に 2 つあるので、ずれたらここで落とす。
 * `ixaAi` が使う AI の ID（`AiToolId`）かは `apps/api` の同じ名前のテストが見る（CLI は domain に依存しない）。
 */

const Catalog = z.object({
  servers: z.record(
    z.object({
      port: z.number(),
      ixa: z.object({ generatorEnv: z.string(), generator: z.string(), urlEnv: z.string(), tokenEnv: z.string() }),
    }),
  ),
})

const catalog = Catalog.parse(JSON.parse(readFileSync(new URL('../../../../tools/ixa-ai/catalog.json', import.meta.url), 'utf8')))

describe('catalog.json と servers.ts・LOCAL_VIDEO_SERVERS', () => {
  it('サーバーの並びが同じ', () => {
    expect(Object.keys(catalog.servers).sort()).toEqual([...SERVER_REPOS].sort())
  })

  it.each(SERVER_REPOS)('%s の .env の名前と既定の口が同じ', (repo) => {
    const env = serverEnvOf(repo)
    const entry = catalog.servers[repo]
    expect(entry?.ixa).toEqual({ generatorEnv: env.enabledBy, generator: env.id, urlEnv: env.urlEnvName, tokenEnv: env.tokenEnvName })
    expect(new URL(env.defaultUrl).port).toBe(String(entry?.port))
  })

  it('LOCAL_VIDEO_SERVERS のどのサーバーにも catalog.json の行がある', () => {
    const generators = Object.values(catalog.servers).map((s) => s.ixa.generator)
    expect(LOCAL_VIDEO_SERVERS.map((s) => s.id).sort()).toEqual([...generators].sort())
  })
})
