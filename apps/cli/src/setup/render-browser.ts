import { remotionBrowserState } from '../checks/render.js'
import type { StepResult } from '../types.js'
import type { SetupContext } from './steps.js'

/**
 * 書き出しの headless Chrome を先に取ってくる（約 100 MB。ADR-0065）。無くても初回の書き出しで取ってくるので、
 * **取れなくても止めない**（知らせるだけ）。音の解析の依存（uv sync）と同じく、聞かずに取ってくる。
 */
export const remotionBrowserStep = async ({ system, repo }: SetupContext): Promise<StepResult> => {
  const id = 'render.browser'
  const state = await remotionBrowserState(system, repo)
  if (state === 'ready') return { id, status: 'already', message: '書き出しの headless Chrome はあります' }
  system.progress('書き出しの headless Chrome を取ってきています（約 100 MB）…')
  const fetched = await system.run(repo.cliTsx, [repo.remotionBrowserScript, 'fetch', repo.workerDir], {
    cwd: repo.root,
    inherit: 'to-stderr',
    timeoutMs: 600_000,
  })
  if (fetched.kind === 'completed' && fetched.exitCode === 0 && (await remotionBrowserState(system, repo)) === 'ready') {
    return { id, status: 'done', message: '書き出しの headless Chrome を取ってきました' }
  }
  return {
    id,
    status: 'notice',
    message: '書き出しの headless Chrome を取ってこられませんでした。初めての書き出しのときにもう一度取りに行きます',
    fix: { hint: 'ネットにつながっているかを見て、もう一度回す', command: 'pnpm ixa setup', needsHuman: false },
    docs: 'INSTALL.md#任意',
  }
}
