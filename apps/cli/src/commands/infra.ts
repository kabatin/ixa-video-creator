import type { Options } from '../args.js'
import { composeDownArgs, composeSettingsOf, type InfraOwner } from '../lib/compose.js'
import type { RepoPaths } from '../lib/repo.js'
import { formatStep, type Output } from '../printer.js'
import { infraGuard, infraOwner } from '../setup/infra-guard.js'
import { infraStep, readEnv } from '../setup/steps.js'
import type { System } from '../system.js'
import { isStopping, type StepResult } from '../types.js'

/**
 * `pnpm ixa infra up | down`（ADR-0063）。ルートの `pnpm infra:up` / `infra:down` もここを通る。
 * `-p <IXA_COMPOSE_PROJECT>` を必ず渡し、名前・ポート・別の clone の見張りを通す
 * （直に `docker compose` を打つと、2 つ目の clone から 1 つ目の clone のスタックを止めたり作り直したりできた）。
 * 既定のプロジェクトは今までと同じ `infra`（ボリュームもそのまま）。**down に `-v` は付けない。**
 */

/** down してよいか（純粋）。別の clone のものは共有の設定でも止めない（その clone の作業が止まる）。 */
export const infraDownDecision = (owner: InfraOwner): 'down' | 'already' | 'refuse' => {
  if (owner.kind === 'other') return 'refuse'
  return owner.kind === 'mine' ? 'down' : 'already'
}

const noEnv: StepResult = {
  id: 'infra',
  status: 'failed',
  message: '.env がありません',
  fix: { hint: '先に導入を済ませる', command: 'pnpm ixa setup', needsHuman: false },
  docs: 'INSTALL.md#設定',
}

const down = async (system: System, repo: RepoPaths): Promise<StepResult> => {
  const env = await readEnv(system, repo)
  // 共有の設定（IXA_COMPOSE_SHARED）があっても、別の clone のスタックは止めない。
  const guard = await infraGuard(system, { ...env, IXA_COMPOSE_SHARED: '' }, repo, 'infra')
  if (guard !== null) return { ...guard, message: `${guard.message}。止めるならその clone で pnpm infra:down（ここからは止めません）` }
  const decision = infraDownDecision(await infraOwner(system, env, repo))
  if (decision !== 'down') return { id: 'infra', status: 'already', message: 'この clone の postgres・redis は動いていません' }
  const result = await system.run('docker', composeDownArgs(composeSettingsOf(env), repo), { cwd: repo.root, timeoutMs: 120_000 })
  return result.kind === 'completed' && result.exitCode === 0
    ? { id: 'infra', status: 'done', message: 'この clone の postgres・redis を止めました（データは残しています）' }
    : { id: 'infra', status: 'failed', message: 'docker compose down に失敗しました', fix: { hint: 'Docker Desktop が動いているか見る', needsHuman: false } }
}

export const infraCommand = async (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> => {
  const step =
    (await system.readText(repo.env)) === null
      ? noEnv
      : options.action === 'down'
        ? await down(system, repo)
        : await infraStep({ system, repo, yes: options.yes }, await readEnv(system, repo))
  out.line(formatStep(step))
  const ok = !isStopping(step)
  out.result({ command: 'infra', action: options.action, ok, steps: [step] })
  return ok ? 0 : 1
}
