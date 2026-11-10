import type { WorkspaceId } from '@ixa/domain'
import { cookies } from 'next/headers'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { createDemoApi, type WireDemoStatus } from '@/lib/demo-api'
import { createRequester } from '@/lib/requester'
import { SESSION_COOKIE } from '@/lib/server-api-client'

/**
 * 見本の状態を Next のサーバ側で読む（ADR-0067。一覧の「見本を開く」を出すかを決める）。**サーバ側の画面だけが import する。**
 * 来た要求の合言葉のクッキーだけを API へ渡す（`server-api-client.ts` と同じ）。失敗は投げる（呼ぶ側が畳む）。
 */
export const getDemoStatus = async (workspaceId: WorkspaceId): Promise<WireDemoStatus> => {
  const session = (await cookies()).get(SESSION_COOKIE)?.value
  const requester = createRequester(
    resolveApiBaseUrl(),
    session === undefined ? { editOrigin: null } : { cookie: `${SESSION_COOKIE}=${session}`, editOrigin: null },
  )
  return createDemoApi(requester).getStatus(workspaceId)
}
