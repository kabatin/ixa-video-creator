import { readFileSync } from 'node:fs'
import { AI_TOOLS, AiToolId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

/**
 * `tools/ixa-ai/catalog.json` の `ixaAi` が、使う AI の ID（`AiToolId`）で、その AI が同じサーバーで見つかるか（ADR-0064）。
 * `servers[*].ixa` と CLI の対応は `apps/cli` の同じ名前のテストが見る。
 */

const Catalog = z.object({
  servers: z.record(z.object({ ixa: z.object({ generator: z.string() }) })),
  items: z.array(z.object({ id: z.string(), server: z.string().nullable(), ixaAi: z.array(z.string()) })),
})

const catalog = Catalog.parse(JSON.parse(readFileSync(new URL('../../../../tools/ixa-ai/catalog.json', import.meta.url), 'utf8')))

describe('catalog.json の ixaAi', () => {
  it.each(catalog.items.flatMap((item) => item.ixaAi.map((id) => [item.id, id, item.server] as const)))(
    '%s → %s は AiToolId で、そのサーバーで見つける',
    (_item, id, server) => {
      const tool = AiToolId.parse(id)
      const detect = AI_TOOLS[tool].detect
      if (server === null) {
        expect(detect.kind).not.toBe('local_server')
        return
      }
      expect(detect).toMatchObject({ kind: 'local_server', server: catalog.servers[server]?.ixa.generator })
    },
  )
})
