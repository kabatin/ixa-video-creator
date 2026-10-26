import path from 'node:path'
import { z } from 'zod'
import type { EnvValues } from '../lib/env-file.js'
import { ROOT_PACKAGE_NAME, portsOf } from '../lib/repo.js'
import type { System } from '../system.js'
import type { CheckResult } from '../types.js'

/**
 * 動いているものの点検。3000（web）・API・音の解析のポートが ixa の物か空いているか。
 * dev が動いていれば API と音の解析の `/health`（どちらも門の外で、鍵は要らない）。
 */

export type PortOwner =
  | { readonly kind: 'free' }
  | { readonly kind: 'this-repo' }
  | { readonly kind: 'other-ixa'; readonly root: string }
  | { readonly kind: 'other'; readonly pid: number }

export type PortFacts = { readonly name: 'web' | 'api' | 'audio'; readonly port: number; readonly owner: PortOwner }

export type RuntimeFacts = {
  readonly ports: readonly PortFacts[]
  /** `/health` が ok を返したか。見なかったら null。 */
  readonly apiHealthy: boolean | null
  readonly audioHealthy: boolean | null
}

const LABEL = { web: '画面（web）', api: 'API', audio: '音の解析' } as const
const DOCS = 'INSTALL.md#動いているもの'

const portCheck = ({ name, port, owner }: PortFacts): CheckResult => {
  const id = `runtime.port-${name}`
  const label = `${LABEL[name]} の ${String(port)}`
  switch (owner.kind) {
    case 'free':
      return { id, group: 'runtime', level: 'ok', message: `${label} は空いています（dev は動いていません）` }
    case 'this-repo':
      return { id, group: 'runtime', level: 'ok', message: `${label} はこの clone の dev が使っています` }
    case 'other-ixa':
      return {
        id,
        group: 'runtime',
        level: 'warn',
        message: `${label} は別の場所の ixa（${owner.root}）が使っています。この clone の dev は同時に起動できません`,
        fix: { hint: '別の場所の dev を止めるか、どちらを使うか制作者に確かめる', needsHuman: true },
        docs: DOCS,
      }
    case 'other':
      return {
        id,
        group: 'runtime',
        level: 'fail',
        message: `${label} を ixa 以外のもの（pid ${String(owner.pid)}）が使っています。dev が起動できません`,
        fix: { hint: '何が使っているか確かめ、止めてよいか制作者に聞く', command: `lsof -nP -iTCP:${String(port)} -sTCP:LISTEN`, needsHuman: true },
        docs: DOCS,
      }
  }
}

const healthCheck = (id: string, label: string, healthy: boolean | null): CheckResult => {
  if (healthy === null) return { id, group: 'runtime', level: 'skip', message: `${label}: この clone の dev が動いていないので見ません` }
  return healthy
    ? { id, group: 'runtime', level: 'ok', message: `${label} は応答しています` }
    : {
        id,
        group: 'runtime',
        level: 'fail',
        message: `${label} は待ち受けているが /health に答えません`,
        fix: { hint: 'dev を起動し直す（pnpm dev の画面のエラーを見る）', command: 'pnpm dev', needsHuman: false },
        docs: DOCS,
      }
}

/** 判定（純粋）。 */
export const judgeRuntime = (facts: RuntimeFacts): readonly CheckResult[] => [
  ...facts.ports.map(portCheck),
  healthCheck('runtime.api-health', 'API', facts.apiHealthy),
  healthCheck('runtime.audio-health', '音の解析', facts.audioHealthy),
]

const RootPackageName = z.object({ name: z.string() })

const jsonOrNull = (content: string): unknown => {
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

/** その場所を含む ixa の直下（`package.json` の name が ixa-video-creator）。無ければ null。 */
export const ixaRootOf = async (system: System, dir: string, depth = 4): Promise<string | null> => {
  const content = await system.readText(path.join(dir, 'package.json'))
  const parsed = content === null ? null : RootPackageName.safeParse(jsonOrNull(content))
  if (parsed?.success === true && parsed.data.name === ROOT_PACKAGE_NAME) return dir
  const parent = path.dirname(dir)
  return depth <= 0 || parent === dir ? null : ixaRootOf(system, parent, depth - 1)
}

const ownerOf = async (system: System, port: number, root: string): Promise<PortOwner> => {
  const listener = await system.listener(port)
  if (listener === null) return { kind: 'free' }
  const ixaRoot = listener.cwd === null ? null : await ixaRootOf(system, listener.cwd)
  if (ixaRoot === null) return { kind: 'other', pid: listener.pid }
  return path.resolve(ixaRoot) === path.resolve(root) ? { kind: 'this-repo' } : { kind: 'other-ixa', root: ixaRoot }
}

const ApiHealth = z.object({ success: z.literal(true), data: z.object({ status: z.literal('ok') }) })
const AudioHealth = z.object({ status: z.literal('ok') })

const healthy = async (system: System, url: string, schema: z.ZodTypeAny): Promise<boolean> => {
  const response = await system.httpGet(url, 3000)
  if (!response.ok || response.status !== 200) return false
  try {
    return schema.safeParse(JSON.parse(response.body)).success
  } catch {
    return false
  }
}

export const gatherRuntime = async (system: System, env: EnvValues, root: string): Promise<RuntimeFacts> => {
  const ports = portsOf(env)
  const facts = await Promise.all(
    (['web', 'api', 'audio'] as const).map(async (name) => ({
      name,
      port: ports[name],
      owner: await ownerOf(system, ports[name], root),
    })),
  )
  const mine = (name: PortFacts['name']) => facts.find((f) => f.name === name)?.owner.kind === 'this-repo'
  return {
    ports: facts,
    apiHealthy: mine('api') ? await healthy(system, `http://127.0.0.1:${String(ports.api)}/health`, ApiHealth) : null,
    audioHealthy: mine('audio') ? await healthy(system, `http://127.0.0.1:${String(ports.audio)}/health`, AudioHealth) : null,
  }
}

/** この clone の dev が動いているか（update の後に「起動し直して」と言うため）。 */
export const devIsRunning = (facts: RuntimeFacts): boolean => facts.ports.some((p) => p.owner.kind === 'this-repo')
