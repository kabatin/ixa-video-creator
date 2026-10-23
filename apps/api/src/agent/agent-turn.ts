import type { AgentSessionRepository } from '@ixa/db'
import {
  countsAsEdit,
  parseStreamJsonLine,
  summaryLineFrom,
  type AgentMessageBody,
  type AgentSession,
  type AgentSessionStatus,
} from '@ixa/domain'
import type { CliStreamExit, CliStreamHandle, CliStreamRunner } from '@ixa/provider-llm'
import type { Logger } from '../logger.js'
import type { AgentApprovals } from './agent-approvals.js'
import type { AgentHub } from './agent-hub.js'

/**
 * 1 回のやりとり（ADR-0058）。CLI を起こし、流れてくる行を会話の行にして DB に足し、画面へ配る。
 * 終わったら、費用・直した数・要約を記録し、状態を決める（済み／失敗／中断）。
 */

export type TurnDeps = {
  readonly sessions: AgentSessionRepository
  readonly hub: AgentHub
  readonly approvals: AgentApprovals
  readonly runner: CliStreamRunner
  readonly now: () => Date
  readonly logger: Logger
}

export type TurnSpec = {
  readonly session: AgentSession
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly prompt: string
  readonly env: Readonly<Record<string, string>>
  /** やりとりが止まらないときに止めるまでの時間（鍵の期限に合わせる）。 */
  readonly maxDurationMs: number
}

export type RunningTurn = {
  readonly handle: CliStreamHandle
  /** 止めた（制作者・API の終了）。終わり方を「中断」にする。 */
  readonly markStopped: () => void
  /** 後片付けまで済んだら解決する。 */
  readonly finished: Promise<void>
}

/** 失敗の理由として会話に残す stderr の長さ。 */
const FAILURE_TEXT_MAX = 500

type TurnTally = {
  readonly costUsd: number
  readonly edits: number
  readonly lastText: string | null
  readonly ended: { readonly isError: boolean } | null
}

const describeExit = (exit: CliStreamExit): string => {
  if (exit.kind === 'not_found') return 'Claude CLI が見つかりません。この Mac に Claude Code を入れてください。'
  if (exit.kind === 'spawn_failed') return `Claude CLI を起こせませんでした: ${exit.reason}`.slice(0, FAILURE_TEXT_MAX)
  const tail = exit.stderrTail.trim().slice(-FAILURE_TEXT_MAX)
  return `Claude CLI が途中で終わりました（終了コード ${String(exit.exitCode)}）${tail === '' ? '' : `: ${tail}`}`
}

const finalStatus = (stopped: boolean, tally: TurnTally): AgentSessionStatus => {
  if (stopped) return 'interrupted'
  return tally.ended !== null && !tally.ended.isError ? 'idle' : 'error'
}

/** 確認待ちのまま終わったら、いったん作業中に戻してから終わりの状態にする（確認待ち → 済み、は決めた遷移に無い）。 */
const transitionFinal = async (
  sessions: AgentSessionRepository,
  sessionId: AgentSession['id'],
  status: AgentSessionStatus,
  at: Date,
): Promise<AgentSession | null> => {
  const direct = await sessions.transition(sessionId, status, at)
  if (direct !== null) return direct
  const current = await sessions.findById(sessionId)
  if (current?.status !== 'awaiting_approval') return null
  await sessions.transition(sessionId, 'running', at)
  return sessions.transition(sessionId, status, at)
}

export const startTurn = (deps: TurnDeps, spec: TurnSpec, cleanup: () => Promise<void>): RunningTurn => {
  const sessionId = spec.session.id
  const state = { stopped: false, chain: Promise.resolve(), cliSessionId: spec.session.cliSessionId }
  let tally: TurnTally = { costUsd: 0, edits: 0, lastText: null, ended: null }

  const append = (bodies: readonly AgentMessageBody[]): void => {
    if (bodies.length === 0) return
    state.chain = state.chain
      .then(async () => {
        const messages = await deps.sessions.appendMessages(sessionId, bodies)
        messages.forEach((message) => deps.hub.publish(sessionId, { type: 'message', message }))
      })
      .catch((error: unknown) => {
        deps.logger.error({ err: error, agentSessionId: sessionId }, '会話の行を保存できませんでした')
      })
  }

  const noteBody = (body: AgentMessageBody): void => {
    if (body.kind === 'assistant_text' && body.text.trim() !== '') tally = { ...tally, lastText: body.text }
    if (body.kind === 'turn_end') tally = { ...tally, costUsd: tally.costUsd + body.costUsd, ended: { isError: body.isError } }
    if (body.kind === 'tool_result' && !body.isError) {
      const risk = deps.approvals.riskOf(sessionId, body.toolUseId)
      if (risk !== null && countsAsEdit(risk)) {
        tally = { ...tally, edits: tally.edits + 1 }
        deps.hub.publish(sessionId, { type: 'edited' })
      }
    }
  }

  const onLine = (line: string): void => {
    const parsed = parseStreamJsonLine(line)
    if (parsed.cliSessionId !== null && parsed.cliSessionId !== state.cliSessionId) {
      const cliSessionId = parsed.cliSessionId
      state.cliSessionId = cliSessionId
      state.chain = state.chain
        .then(() => deps.sessions.setCliSessionId(sessionId, cliSessionId))
        .catch((error: unknown) => {
          deps.logger.error({ err: error, agentSessionId: sessionId }, 'CLI の会話 ID を保存できませんでした')
        })
    }
    parsed.bodies.forEach(noteBody)
    append(parsed.bodies)
  }

  const handle = deps.runner(
    { command: spec.command, args: spec.args, cwd: spec.cwd, stdin: spec.prompt, env: spec.env },
    onLine,
  )
  const watchdog = setTimeout(() => {
    deps.logger.warn({ agentSessionId: sessionId }, 'やりとりが長すぎるので止めます')
    state.stopped = true
    handle.stop()
  }, spec.maxDurationMs)
  watchdog.unref()

  const finish = async (exit: CliStreamExit): Promise<void> => {
    clearTimeout(watchdog)
    deps.approvals.denyAll(sessionId, 'やりとりが終わりました。')
    const status = finalStatus(state.stopped, tally)
    if (status === 'interrupted') append([{ kind: 'system', event: 'interrupted', text: '止めました。続きから話せます。', raw: null }])
    if (status === 'error') append([{ kind: 'system', event: 'failed', text: describeExit(exit), raw: null }])
    await state.chain
    const at = deps.now()
    await deps.sessions.recordTurn(sessionId, {
      addCostUsd: tally.costUsd,
      addEditCount: tally.edits,
      lastSummary: tally.lastText === null ? null : summaryLineFrom(tally.lastText),
      at,
    })
    const updated = await transitionFinal(deps.sessions, sessionId, status, at)
    if (updated === null) deps.logger.warn({ agentSessionId: sessionId, status }, '会話の状態を進められませんでした')
    const latest = updated ?? (await deps.sessions.findById(sessionId))
    if (latest !== null) deps.hub.publish(sessionId, { type: 'session', session: latest })
  }

  const finished = handle.exited
    .then(finish)
    .catch((error: unknown) => {
      deps.logger.error({ err: error, agentSessionId: sessionId }, 'やりとりの後片付けに失敗しました')
    })
    .finally(async () => {
      deps.approvals.forget(sessionId)
      await cleanup().catch((error: unknown) => {
        deps.logger.error({ err: error, agentSessionId: sessionId }, 'やりとりの鍵と設定ファイルを片付けられませんでした')
      })
    })

  return {
    handle,
    markStopped: () => {
      state.stopped = true
    },
    finished,
  }
}
