import type { WorkspaceId } from '@ixa/domain'
import { z } from 'zod'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { WireProject } from '@/lib/api-schemas'
import { createRequester, type Requester } from '@/lib/requester'

/**
 * 同梱の見本の作品の口（ADR-0067）。`GET /projects/demo`（入れられるか・入っている作品）と `POST /projects/demo`（入れる）。
 * サーバ側の画面から状態を読むときは `demo-status-server.ts` の `getDemoStatus` を使う（クッキーを渡す）。
 */

/** 入れられるか。`totalBytes` は初めて入れるときに取りに行く大きさ。`project` はこの作業場所に入っている見本。 */
export const WireDemoStatus = z.object({
  available: z.boolean(),
  title: z.string().nullable(),
  totalBytes: z.number().int().nonnegative().nullable(),
  project: WireProject.nullable(),
})
export type WireDemoStatus = z.infer<typeof WireDemoStatus>

export const WireDemoInstalled = z.object({ project: WireProject, created: z.boolean() })
export type WireDemoInstalled = z.infer<typeof WireDemoInstalled>

export type DemoApi = {
  readonly getStatus: (workspaceId: WorkspaceId) => Promise<WireDemoStatus>
  /** 入れる（入っていれば、それを返す）。失敗は `ApiError`（画面へは `describeError` で出す）。 */
  readonly install: (workspaceId: WorkspaceId) => Promise<WireDemoInstalled>
}

export const DEMO_PATH = '/projects/demo'

export const createDemoApi = (requester: Requester = createRequester(resolveApiBaseUrl())): DemoApi => ({
  getStatus: (workspaceId) => requester.get(`${DEMO_PATH}?${new URLSearchParams({ workspaceId }).toString()}`, WireDemoStatus),
  install: (workspaceId) => requester.post(DEMO_PATH, { workspaceId }, WireDemoInstalled),
})
