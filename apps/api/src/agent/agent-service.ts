import { z } from 'zod'
import {
  AgentSessionBusyError,
  type AccessTokenRepository,
  type AgentSessionRepository,
  type ProjectRepository,
  type ShotRepository,
} from '@ixa/db'
import {
  AGENT_SESSION_UNTITLED,
  IXA_MCP_TOOL_PREFIX,
  AgentModel,
  approvalNeeded,
  capJson,
  isAgentSessionBusy,
  newId,
  sessionTitleFrom,
  type AgentApprovalAnswer,
  type AgentApprovalDecision,
  type AgentMessageBody,
  type AgentSession,
  type AgentSessionId,
  type AiToolId,
  type ProjectId,
  type SendAgentMessageInput,
  type ToolRisk,
  type UpdateAgentSessionInput,
} from '@ixa/domain'
import {
  agentCliEnv,
  buildAgentCliArgs,
  buildAgentMcpConfig,
  type CliStreamRunner,
} from '@ixa/provider-llm'
import { hashToken } from '../auth/token.js'
import type { Logger } from '../logger.js'
import {
  APPROVAL_TIMED_OUT_MESSAGE,
  createAgentApprovals,
  isApprovalExpired,
} from './agent-approvals.js'
import {
  removeCliPid,
  sweepAgentWorkDirs,
  writeCliPid,
  type AgentProcesses,
} from './agent-orphans.js'
import type { AgentHub } from './agent-hub.js'
import { buildAgentPrompt } from './agent-prompt.js'
import { startTurn, type RunningTurn } from './agent-turn.js'
import {
  AGENT_KEY_LABEL_PREFIX,
  TURN_KEY_TTL_MS,
  issueTurnKey,
  removeMcpConfigFile,
  sessionWorkDir,
  writeMcpConfigFile,
} from './agent-turn-setup.js'

/**
 * AI エージェントの会話（ADR-0058）。画面の口（routes/agent-*.ts）と MCP の確認の口が呼ぶ。
 *
 * - 同じ作品で同時に動くのは 1 つの会話だけ（編集のぶつかりを避ける）
 * - テキストの AI が Claude（claude_cli）でなければ始めない（確認の仕組みが Claude CLI のもの）
 * - 確認の要否は domain の `approvalNeeded`（確認なしの旗を含む）。答えは画面から（クッキー）だけ
 */

export type AgentServiceDeps = {
  readonly sessions: AgentSessionRepository
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly shots: Pick<ShotRepository, 'findById'>
  readonly tokens: Pick<AccessTokenRepository, 'create' | 'revoke' | 'listAutomation'>
  readonly hub: AgentHub
  readonly runner: CliStreamRunner
  /** いま選んでいるテキストの AI。 */
  readonly textTool: () => Promise<AiToolId>
  readonly defaultModel: string
  readonly cli: {
    readonly command: string
    /** ixa の MCP を起こすコマンド（`apps/mcp` の tsx と main.ts）。 */
    readonly mcpCommand: string
    readonly mcpArgs: readonly string[]
    /** MCP が呼ぶ API。 */
    readonly apiUrl: string
    /** 会話の作業場所の親（`~/.ixa/agent-sessions`）。 */
    readonly sessionsRoot: string
    /** CLI に渡してよい env の元（`process.env`）。`agentCliEnv` が要るものだけに絞る。 */
    readonly baseEnv: Readonly<Record<string, string | undefined>>
  }
  /** 残った CLI を確かめて止める口（起動時の後片付け）。 */
  readonly processes: AgentProcesses
  readonly now: () => Date
  readonly logger: Logger
}

export const NOT_CLAUDE_MESSAGE =
  'AI エージェントは、使う AI のテキストが Claude のときだけ使えます。「使う AI」でテキストを Claude にしてください'
export const OTHER_TASK_BUSY_MESSAGE =
  'この作品では別のタスクが作業中です。終わるか止めてから話してください'
export const THIS_TASK_BUSY_MESSAGE = 'このタスクはまだ作業中です。止めてから話し直してください'

export type AgentFailure = {
  readonly ok: false
  readonly code: 'not_found' | 'conflict' | 'unavailable' | 'forbidden'
  readonly message: string
}
export type AgentResult<T> = { readonly ok: true; readonly value: T } | AgentFailure

const fail = (code: AgentFailure['code'], message: string): AgentFailure => ({
  ok: false,
  code,
  message,
})
const okValue = <T>(value: T): AgentResult<T> => ({ ok: true, value })

export type ApprovalRequest = {
  readonly toolName: string
  readonly toolUseId: string | null
  readonly risk: ToolRisk
  readonly input: unknown
}
export type ApprovalState = {
  readonly requestId: string
  readonly decision: AgentApprovalDecision | null
  readonly message: string | null
}

const RequestId = z.string().ulid()

/** 確認なしに切り替えるツール（CLI の名前）。 */
const WAIVE_TOOL = `${IXA_MCP_TOOL_PREFIX}waive_confirmations`

/**
 * 会話の作品と違う `projectId` を触る操作は、印にかかわらず削除と同じ扱いにする（別の作品を黙って触らせない）。
 */
const effectiveRisk = (risk: ToolRisk, input: unknown, projectId: string): ToolRisk => {
  const target =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)['projectId']
      : undefined
  return typeof target === 'string' && target !== projectId ? 'destructive' : risk
}

type ActiveTurn = { readonly turn: RunningTurn; readonly tokenHash: string }

export const createAgentService = (deps: AgentServiceDeps) => {
  const approvals = createAgentApprovals()
  let active: ReadonlyMap<AgentSessionId, ActiveTurn> = new Map()
  /** 答えている途中の確認（同時に 2 回答えても、1 回だけ効かせる）。 */
  let answering: ReadonlySet<string> = new Set()
  const model = AgentModel.parse(deps.defaultModel)

  const publishSession = (session: AgentSession): void =>
    deps.hub.publish(session.id, { type: 'session', session })
  const appendAndPublish = async (
    sessionId: AgentSessionId,
    bodies: readonly AgentMessageBody[],
  ): Promise<void> => {
    const messages = await deps.sessions.appendMessages(sessionId, bodies)
    messages.forEach((message) => deps.hub.publish(sessionId, { type: 'message', message }))
  }

  /** 画面から来た鍵がこの会話のいまのやりとりのものか（MCP の確認の口は、そのやりとりの鍵だけを受ける）。 */
  const isTurnToken = (sessionId: AgentSessionId, bearer: string | null): boolean => {
    const turn = active.get(sessionId)
    return turn !== undefined && bearer !== null && hashToken(bearer) === turn.tokenHash
  }

  const turnContext = async (session: AgentSession, input: SendAgentMessageInput) => {
    const project = await deps.projects.findById(session.projectId)
    if (project === null) return null
    const shotId = input.context?.shotId ?? null
    const shot = shotId === null ? null : await deps.shots.findById(shotId)
    const usableShot = shot !== null && shot.projectId === session.projectId ? shot : null
    return {
      project,
      prompt: {
        projectId: project.id,
        projectName: project.name,
        shot: usableShot === null ? null : { id: usableShot.id, label: usableShot.code },
        playheadSec: input.context?.playheadSec ?? null,
      },
    }
  }

  /** 答えの無いまま期限が来た確認を、やめる扱いにして会話に残す。 */
  const expire = async (sessionId: AgentSessionId, requestId: string): Promise<void> => {
    if (!approvals.decide(requestId, 'deny', APPROVAL_TIMED_OUT_MESSAGE)) return
    await appendAndPublish(sessionId, [
      { kind: 'approval_decision', requestId, decision: 'deny', waiveAfter: false, by: 'timeout' },
    ])
    if (approvals.openCount(sessionId) === 0) {
      const resumed = await deps.sessions.transition(sessionId, 'running', deps.now())
      if (resumed !== null) publishSession(resumed)
    }
  }

  const launch = async (
    session: AgentSession,
    input: SendAgentMessageInput,
  ): Promise<AgentResult<AgentSession>> => {
    const context = await turnContext(session, input)
    if (context === null) return fail('not_found', '作品が見つかりません')
    const now = deps.now()
    const titled =
      session.title === AGENT_SESSION_UNTITLED
        ? await deps.sessions.update(session.id, { title: sessionTitleFrom(input.text) })
        : session
    await appendAndPublish(session.id, [
      {
        kind: 'user',
        text: input.text,
        context: {
          shotLabel: context.prompt.shot?.label ?? null,
          playheadSec: context.prompt.playheadSec,
        },
      },
    ])
    const key = await issueTurnKey(deps.tokens, titled.title, now)
    const workDir = sessionWorkDir(deps.cli.sessionsRoot, session.id)
    const written: { configPath: string | null } = { configPath: null }
    // 鍵を発行したあとで失敗したら、鍵を取り消し、置いた設定ファイルを消す（残すと期限まで使える鍵が残る）。
    const turn = await (async () => {
      const configPath = await writeMcpConfigFile(
        workDir,
        newId(RequestId),
        buildAgentMcpConfig({
          command: deps.cli.mcpCommand,
          args: deps.cli.mcpArgs,
          env: {
            ...agentCliEnv(deps.cli.baseEnv),
            IXA_API_URL: deps.cli.apiUrl,
            IXA_API_TOKEN: key.token,
            IXA_WORKSPACE_ID: context.project.workspaceId,
            IXA_AGENT_SESSION_ID: session.id,
            LOG_LEVEL: 'warn',
          },
        }),
      )
      written.configPath = configPath
      const cleanup = async (): Promise<void> => {
        active = new Map([...active].filter(([id]) => id !== session.id))
        await Promise.all([
          removeMcpConfigFile(configPath),
          removeCliPid(workDir),
          deps.tokens.revoke(key.record.id, deps.now()),
        ])
      }
      return startTurn(
        {
          sessions: deps.sessions,
          hub: deps.hub,
          approvals,
          runner: deps.runner,
          now: deps.now,
          logger: deps.logger,
        },
        {
          session: titled,
          command: deps.cli.command,
          args: buildAgentCliArgs({
            model: titled.model,
            mcpConfigPath: configPath,
            resumeCliSessionId: titled.cliSessionId,
          }),
          cwd: workDir,
          prompt: buildAgentPrompt(context.prompt, input.text),
          env: agentCliEnv(deps.cli.baseEnv),
          maxDurationMs: TURN_KEY_TTL_MS,
        },
        cleanup,
      )
    })().catch(async (error: unknown) => {
      const configPath = written.configPath
      await Promise.all([
        configPath === null ? Promise.resolve() : removeMcpConfigFile(configPath),
        deps.tokens.revoke(key.record.id, deps.now()),
      ]).catch((cleanupError: unknown) => {
        deps.logger.error(
          { err: cleanupError, agentSessionId: session.id },
          'やりとりの鍵を片付けられませんでした',
        )
      })
      throw error
    })
    active = new Map([...active, [session.id, { turn, tokenHash: key.tokenHash }]])
    const pid = turn.handle.pid
    if (pid !== null) {
      // API が落ちたときに起動時に止められるよう、番号を作業場所に残す。書けなくてもやりとりは続ける。
      writeCliPid(workDir, pid).catch((error: unknown) => {
        deps.logger.warn({ err: error, agentSessionId: session.id }, 'CLI の番号を書けませんでした')
      })
    }
    return okValue(titled)
  }

  return {
    approvals,

    create: async (
      projectId: ProjectId,
      requestedModel: string | undefined,
    ): Promise<AgentResult<AgentSession>> => {
      if ((await deps.projects.findById(projectId)) === null)
        return fail('not_found', '作品が見つかりません')
      const session = await deps.sessions.create({
        projectId,
        title: AGENT_SESSION_UNTITLED,
        model: requestedModel ?? model,
      })
      return okValue(session)
    },

    send: async (
      sessionId: AgentSessionId,
      input: SendAgentMessageInput,
    ): Promise<AgentResult<AgentSession>> => {
      const session = await deps.sessions.findById(sessionId)
      if (session === null) return fail('not_found', '会話が見つかりません')
      if ((await deps.textTool()) !== 'claude_cli') return fail('unavailable', NOT_CLAUDE_MESSAGE)
      if (isAgentSessionBusy(session.status)) return fail('conflict', THIS_TASK_BUSY_MESSAGE)
      const other = await deps.sessions.findBusyInProject(session.projectId)
      if (other !== null) return fail('conflict', OTHER_TASK_BUSY_MESSAGE)
      try {
        const running = await deps.sessions.transition(sessionId, 'running', deps.now())
        if (running === null) return fail('conflict', THIS_TASK_BUSY_MESSAGE)
        publishSession(running)
        return await launch(running, input).catch(async (error: unknown) => {
          deps.logger.error(
            { err: error, agentSessionId: sessionId },
            'やりとりを始められませんでした',
          )
          await appendAndPublish(sessionId, [
            {
              kind: 'system',
              event: 'failed',
              text: 'やりとりを始められませんでした。',
              raw: null,
            },
          ])
          const failed = await deps.sessions.transition(sessionId, 'error', deps.now())
          if (failed !== null) publishSession(failed)
          throw error
        })
      } catch (error) {
        if (error instanceof AgentSessionBusyError) return fail('conflict', OTHER_TASK_BUSY_MESSAGE)
        throw error
      }
    },

    stop: async (sessionId: AgentSessionId): Promise<AgentResult<null>> => {
      const turn = active.get(sessionId)
      if (turn === undefined) {
        // 動いているやりとりが無いのに作業中のまま残った会話（後片付けの失敗など）は、ここで中断にする。
        const session = await deps.sessions.findById(sessionId)
        if (session === null) return fail('not_found', '会話が見つかりません')
        if (!isAgentSessionBusy(session.status))
          return fail('conflict', 'このタスクは作業中ではありません')
        const interrupted = await deps.sessions.transition(sessionId, 'interrupted', deps.now())
        await appendAndPublish(sessionId, [
          {
            kind: 'system',
            event: 'interrupted',
            text: '止めました。続きから話せます。',
            raw: null,
          },
        ])
        if (interrupted !== null) publishSession(interrupted)
        return okValue(null)
      }
      turn.turn.markStopped()
      approvals.denyAll(sessionId, '制作者が止めました。')
      turn.turn.handle.stop()
      return okValue(null)
    },

    update: async (
      sessionId: AgentSessionId,
      patch: UpdateAgentSessionInput,
    ): Promise<AgentResult<AgentSession>> => {
      const before = await deps.sessions.findById(sessionId)
      if (before === null) return fail('not_found', '会話が見つかりません')
      const after = await deps.sessions.update(sessionId, patch)
      if (
        patch.confirmationsWaived !== undefined &&
        patch.confirmationsWaived !== before.confirmationsWaived
      ) {
        await appendAndPublish(sessionId, [
          patch.confirmationsWaived
            ? {
                kind: 'system',
                event: 'confirmations_waived',
                text: 'このタスクでは確認を出さずに進めます。',
                raw: null,
              }
            : {
                kind: 'system',
                event: 'confirmations_restored',
                text: '確認を出すように戻しました。',
                raw: null,
              },
        ])
      }
      publishSession(after)
      return okValue(after)
    },

    /** MCP の approve から。そのやりとりの鍵でだけ受ける。確認が要らなければすぐ許す。 */
    requestApproval: async (
      sessionId: AgentSessionId,
      bearer: string | null,
      request: ApprovalRequest,
    ): Promise<AgentResult<ApprovalState>> => {
      if (!isTurnToken(sessionId, bearer))
        return fail('forbidden', 'この会話のやりとりの鍵ではありません')
      const session = await deps.sessions.findById(sessionId)
      if (session === null) return fail('not_found', '会話が見つかりません')
      const risk = effectiveRisk(request.risk, request.input, session.projectId)
      if (request.toolUseId !== null) approvals.noteRisk(sessionId, request.toolUseId, risk)
      const requestId = newId(RequestId)
      if (!approvalNeeded(risk, session))
        return okValue({ requestId, decision: 'allow', message: null })
      // 状態を先に進めてから待ちを開ける（画面が確認待ちと知る前に答えられる隙を作らない）。
      const waiting = await deps.sessions.transition(sessionId, 'awaiting_approval', deps.now())
      if (waiting !== null) publishSession(waiting)
      approvals.open(sessionId, requestId, request.toolName, deps.now())
      await appendAndPublish(sessionId, [
        {
          kind: 'approval_request',
          requestId,
          toolUseId: request.toolUseId,
          toolName: request.toolName,
          risk,
          input: capJson(request.input),
        },
      ])
      return okValue({ requestId, decision: null, message: null })
    },

    approvalState: async (
      sessionId: AgentSessionId,
      bearer: string | null,
      requestId: string,
    ): Promise<AgentResult<ApprovalState>> => {
      if (!isTurnToken(sessionId, bearer))
        return fail('forbidden', 'この会話のやりとりの鍵ではありません')
      const pending = approvals.find(requestId)
      if (pending === null || pending.sessionId !== sessionId)
        return fail('not_found', '確認が見つかりません')
      if (isApprovalExpired(pending, deps.now())) await expire(sessionId, requestId)
      const latest = approvals.find(requestId) ?? pending
      return okValue({ requestId, decision: latest.decision, message: latest.message })
    },

    /** 画面の確認のカードから（実行／やめる／以後確認しない）。 */
    answerApproval: async (
      sessionId: AgentSessionId,
      requestId: string,
      answer: AgentApprovalAnswer,
    ): Promise<AgentResult<null>> => {
      const pending = approvals.find(requestId)
      if (pending === null || pending.sessionId !== sessionId)
        return fail('not_found', '確認が見つかりません')
      if (isApprovalExpired(pending, deps.now())) {
        await expire(sessionId, requestId)
        return fail('conflict', '確認の期限が過ぎました。実行していません')
      }
      if (pending.decision !== null || answering.has(requestId))
        return fail('conflict', 'この確認にはもう答えています')
      answering = new Set([...answering, requestId])
      try {
        await appendAndPublish(sessionId, [
          {
            kind: 'approval_decision',
            requestId,
            decision: answer.decision,
            waiveAfter: answer.waiveAfter,
          },
        ])
        // 確認なしへの切り替え（waive_confirmations）は、画面の「実行」を受けてここで旗を立てる（MCP からは立てられない）。
        if (answer.waiveAfter || (answer.decision === 'allow' && pending.toolName === WAIVE_TOOL)) {
          const waived = await deps.sessions.update(sessionId, { confirmationsWaived: true })
          await appendAndPublish(sessionId, [
            {
              kind: 'system',
              event: 'confirmations_waived',
              text: 'このタスクでは確認を出さずに進めます。',
              raw: null,
            },
          ])
          publishSession(waived)
        }
        // 状態を先に進めてから待ちを解く（CLI が続きを始めた時には作業中になっているように）。
        if (approvals.openCount(sessionId) === 1) {
          const resumed = await deps.sessions.transition(sessionId, 'running', deps.now())
          if (resumed !== null) publishSession(resumed)
        }
        approvals.decide(requestId, answer.decision, null)
      } finally {
        answering = new Set([...answering].filter((id) => id !== requestId))
      }
      return okValue(null)
    },

    /**
     * API の起動時。作業中のまま残った会話を中断にし、取り消し忘れの鍵を取り消す。
     * 取り消すのは起動より前に作った鍵だけ（起動のあとに始まったやりとりの鍵を巻き込まない）。
     */
    recoverAfterRestart: async (startedAt: Date): Promise<void> => {
      const now = deps.now()
      const swept = await sweepAgentWorkDirs(deps.cli.sessionsRoot, deps.processes)
      if (swept.killed > 0 || swept.removedConfigs > 0) {
        deps.logger.info(swept, '残った AI エージェントの CLI と設定ファイルを片付けました')
      }
      const interrupted = await deps.sessions.interruptAllBusy(now)
      await Promise.all(
        interrupted.map((session) =>
          deps.sessions.appendMessages(session.id, [
            {
              kind: 'system',
              event: 'interrupted',
              text: 'API を起動し直したため、途中で止まりました。続きから話せます。',
              raw: null,
            },
          ]),
        ),
      )
      const leftovers = (await deps.tokens.listAutomation()).filter(
        (token) =>
          token.revokedAt === null &&
          token.label.startsWith(AGENT_KEY_LABEL_PREFIX) &&
          token.createdAt.getTime() < startedAt.getTime(),
      )
      await Promise.all(leftovers.map((token) => deps.tokens.revoke(token.id, now)))
      if (interrupted.length > 0 || leftovers.length > 0) {
        deps.logger.info(
          { sessions: interrupted.length, keys: leftovers.length },
          '途中で止まった AI エージェントの会話を片付けました',
        )
      }
    },

    /** API を止めるとき。動いているやりとりを止め、後片付けを待つ。 */
    shutdown: async (): Promise<void> => {
      const turns = [...active.values()]
      turns.forEach(({ turn }) => {
        turn.markStopped()
        turn.handle.stop()
      })
      await Promise.all(turns.map(({ turn }) => turn.finished))
    },
  }
}

export type AgentService = ReturnType<typeof createAgentService>
