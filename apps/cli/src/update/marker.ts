import path from 'node:path'
import { z } from 'zod'
import type { RepoPaths } from '../lib/repo.js'
import type { System } from '../system.js'
import type { CheckResult, StepResult } from '../types.js'

/**
 * 更新の途中の印（ADR-0063）。1 段目が fast-forward した直後に置き、2 段目の手順（uv sync・DB の更新）が
 * 止まらずに済んだら消す。**途中で落ちてもコードの版は新しくなっているので、版の比べ合わせでは「最新です」に見える。**
 * 印があれば update と doctor は `pnpm -s ixa update --resume` を勧める。
 * 置き場は直下の `.ixa-update-pending.json`（.gitignore 済み。追跡しているファイルではないので「未コミットの変更」にならない）。
 */

const Marker = z.object({
  from: z.string().regex(/^\d+\.\d+\.\d+$/),
  to: z.string().regex(/^\d+\.\d+\.\d+$/),
  ref: z.string().min(1),
  main: z.boolean(),
  at: z.string(),
})
export type Marker = z.infer<typeof Marker>

export const RESUME_COMMAND = 'pnpm -s ixa update --resume'

export const markerPath = (repo: RepoPaths): string => path.join(repo.root, '.ixa-update-pending.json')

export const parseMarker = (content: string): Marker | null => {
  try {
    const parsed = Marker.safeParse(JSON.parse(content))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const readMarker = async (system: System, repo: RepoPaths): Promise<Marker | null> => {
  const content = await system.readText(markerPath(repo))
  return content === null ? null : parseMarker(content)
}

export const writeMarker = (system: System, repo: RepoPaths, marker: Marker): Promise<void> =>
  system.writeText(markerPath(repo), `${JSON.stringify(marker, null, 2)}\n`)

export const removeMarker = (system: System, repo: RepoPaths): Promise<void> => system.remove(markerPath(repo))

/** update（1 段目）で印を見つけたとき（純粋）。 */
export const pendingUpdateStep = (marker: Marker): StepResult => ({
  id: 'update.pending',
  status: 'failed',
  message: `前の更新（${marker.from} → ${marker.to}）が途中で止まっています。コードは新しい版ですが、依存か DB の更新が済んでいないかもしれません`,
  fix: { hint: '続きを回す（pnpm install・uv sync・DB の更新・doctor）', command: RESUME_COMMAND, needsHuman: false },
  docs: 'INSTALL.md#更新',
})

/** doctor の項目（純粋）。 */
export const pendingCheck = (marker: Marker | null): CheckResult =>
  marker === null
    ? { id: 'tools.update-pending', group: 'tools', level: 'ok', message: '途中で止まった更新はありません' }
    : {
        id: 'tools.update-pending',
        group: 'tools',
        level: 'fail',
        message: `更新（${marker.from} → ${marker.to}）が途中で止まっています`,
        fix: { hint: '続きを回す', command: RESUME_COMMAND, needsHuman: false },
        docs: 'INSTALL.md#更新',
      }
