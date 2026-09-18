import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **`apps/web` と `packages/render` の `remotion` は同じ版でなければならない。**
 *
 * 版がずれると pnpm が 2 つ目の `remotion` を入れる。
 * Remotion は React の context で再生位置を配るので、
 * `@remotion/player` の context と `TimelineComposition` が読む context が別物になり、
 * **画面は真っ黒のまま、コンソールにも何も出ない**という直しようのない壊れ方をする。
 * 型検査もテストも通り抜けるので、版の一致をここで固定する。
 */

const readPackageJson = (relative: string): { dependencies: Record<string, string> } =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')) as {
    dependencies: Record<string, string>
  }

describe('remotion の版', () => {
  const web = readPackageJson('../../package.json').dependencies
  const render = readPackageJson('../../../../packages/render/package.json').dependencies

  it('apps/web と packages/render で一致している', () => {
    expect(web.remotion).toBe(render.remotion)
  })

  it('@remotion/player も同じ版を使う', () => {
    expect(web['@remotion/player']).toBe(render.remotion)
  })
})
