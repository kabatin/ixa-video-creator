import path from 'node:path'
import { z } from 'zod'
import type { EnvValues } from '../lib/env-file.js'
import { ROOT_PACKAGE_NAME, paths, portsOf } from '../lib/repo.js'
import { readBuildLock, type BuildLock } from '../start/build-lock.js'
import type { System } from '../system.js'
import type { CheckResult } from '../types.js'

/**
 * 動いているものの点検。3000（web）・API・音の解析のポートが ixa の物か空いているか。
 * この clone の ixa（`pnpm ixa start` か `pnpm dev`）が動いていれば API と音の解析の `/health`（どちらも門の外で、鍵は要らない）。
 * `pnpm ixa start` が画面を組み立てている最中（ポートはまだ開いていない）なら、その印も見る（ADR-0068）。
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
  /** `pnpm ixa start` が画面を組み立てている最中なら、その印（持ち主が生きているものだけ）。 */
  readonly building: BuildLock | null
}

const LABEL = { web: '画面（web）', api: 'API', audio: '音の解析' } as const
const DOCS = 'INSTALL.md#動いているもの'

const portCheck = ({ name, port, owner }: PortFacts): CheckResult => {
  const id = `runtime.port-${name}`
  const label = `${LABEL[name]} の ${String(port)}`
  switch (owner.kind) {
    case 'free':
      return { id, group: 'runtime', level: 'ok', message: `${label} は空いています（ixa は動いていません）` }
    case 'this-repo':
      return { id, group: 'runtime', level: 'ok', message: `${label} はこの clone の ixa が使っています` }
    case 'other-ixa':
      return {
        id,
        group: 'runtime',
        level: 'warn',
        message: `${label} は別の場所の ixa（${owner.root}）が使っています。この clone の ixa は同時に起動できません`,
        fix: { hint: '別の場所の ixa を止めるか、どちらを使うか制作者に確かめる', needsHuman: true },
        docs: DOCS,
      }
    case 'other':
      return {
        id,
        group: 'runtime',
        level: 'fail',
        message: `${label} を ixa 以外のもの（pid ${String(owner.pid)}）が使っています。ixa が起動できません`,
        fix: { hint: '何が使っているか確かめ、止めてよいか制作者に聞く', command: `lsof -nP -iTCP:${String(port)} -sTCP:LISTEN`, needsHuman: true },
        docs: DOCS,
      }
  }
}

const healthCheck = (id: string, label: string, healthy: boolean | null): CheckResult => {
  if (healthy === null) return { id, group: 'runtime', level: 'skip', message: `${label}: この clone の ixa が動いていないので見ません` }
  return healthy
    ? { id, group: 'runtime', level: 'ok', message: `${label} は応答しています` }
    : {
        id,
        group: 'runtime',
        level: 'fail',
        message: `${label} は待ち受けているが /health に答えません`,
        fix: { hint: 'ixa を起動し直す（起動した端末で Ctrl+C で止め、出ていたエラーを見てから。開発なら pnpm dev）', command: 'pnpm ixa start', needsHuman: false },
        docs: DOCS,
      }
}

/** 知らせるだけ（組み立ては失敗ではない。終われば start がそのまま起こす）。 */
const buildCheck = (building: BuildLock | null): CheckResult =>
  building === null
    ? { id: 'runtime.web-build', group: 'runtime', level: 'ok', message: '画面の組み立て（pnpm ixa start）は走っていません' }
    : {
        id: 'runtime.web-build',
        group: 'runtime',
        level: 'ok',
        message: `pnpm ixa start が画面を組み立てている最中です（pid ${String(building.pid)}、${building.startedAt} から）。終わると起動します`,
        docs: 'INSTALL.md#起動する',
      }

/** 判定（純粋）。 */
export const judgeRuntime = (facts: RuntimeFacts): readonly CheckResult[] => [
  ...facts.ports.map(portCheck),
  healthCheck('runtime.api-health', 'API', facts.apiHealthy),
  healthCheck('runtime.audio-health', '音の解析', facts.audioHealthy),
  buildCheck(facts.building),
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
  const [theirs, mine] = await Promise.all([system.realpath(ixaRoot), system.realpath(root)])
  return theirs === mine ? { kind: 'this-repo' } : { kind: 'other-ixa', root: ixaRoot }
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
  const lock = await readBuildLock(system, paths(root))
  return {
    ports: facts,
    building: lock.kind === 'held' ? lock.lock : null,
    apiHealthy: mine('api') ? await healthy(system, `http://127.0.0.1:${String(ports.api)}/health`, ApiHealth) : null,
    audioHealthy: mine('audio') ? await healthy(system, `http://127.0.0.1:${String(ports.audio)}/health`, AudioHealth) : null,
  }
}

/**
 * この clone の ixa（pnpm ixa start か pnpm dev）が動いているか。**どれか 1 つでも**（update が止める・「起動し直して」と言うため）。
 * 画面を組み立てている最中も動いているに数える（組み立ての下で git を動かさない）。
 * start が「もう動いている」と言うのは全部が動いているときだけで、そちらは commands/start.ts が見る。
 */
export const devIsRunning = (facts: RuntimeFacts): boolean =>
  facts.building !== null || facts.ports.some((p) => p.owner.kind === 'this-repo')
