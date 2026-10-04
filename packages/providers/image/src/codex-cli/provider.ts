import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import {
  CapabilityViolationError,
  execFileCliRunner,
  ProviderError,
  redactCommand,
  validateImageRequest,
  type CliRunner,
  type CliRunResult,
  type ImageGenerationRequest,
  type ImageJobStatus,
  type ImageProvider,
  type ProviderJobHandle,
} from '@ixa/provider-core'
import { z } from 'zod'
import { CODEX_CLI_PROVIDER_ID, codexCliImageModel, codexCliImageModels, codexFrameFor } from './descriptor.js'
import { buildCodexImageInstruction } from './instruction.js'
import { locateCodexImage, removeCodexGenerated, threadIdOf } from './locate.js'

/**
 * Codex CLI の画像アダプタ（ADR-0012 / ADR-0029）。
 *
 * `codex exec` を生成ごとの作業ディレクトリで走らせ、画像生成ツールで 1 枚作らせる。
 * 呼び方は実測（ADR-0029）で決めた:
 * - **指示は stdin で渡す。** `-i` は複数の値を取るので、後ろに置いた指示を画像として食う
 * - 参照画像は `-i <手元のファイル>`。URL は渡せない（呼び出し側が手元へ落とす）
 * - `--ephemeral`（会話の記録を残さない）・`--sandbox workspace-write`（作業ディレクトリへ保存させる）
 * - 終了コードを先に見てから出力を読む。画像は作業ディレクトリ → CODEX_HOME の順に探す
 *
 * **1 回あたりの実費は取れない**（契約の利用枠を使う）。費用は 0 で記録する。
 */

/** 1 枚 70 秒前後（実測）。混んでいるときの余裕を見て 5 分。 */
export const CODEX_CLI_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export const CodexCliImageProviderOptions = z.object({
  /** `codex` 実行ファイル。PATH 上の名前でも絶対パスでもよい。 */
  binary: z.string().min(1).default('codex'),
  /** 生成ごとに隔離する作業ディレクトリを作る親ディレクトリ。 */
  workingDirRoot: z.string().min(1),
  /** ハングした CLI がキューを詰まらせるため必ず設定する。 */
  timeoutMs: z.number().int().positive().default(CODEX_CLI_DEFAULT_TIMEOUT_MS),
  /** 画像がいったんできる場所の親（`$CODEX_HOME`）。既定は環境変数、無ければ `~/.codex`。 */
  codexHome: z.string().min(1).optional(),
})
export type CodexCliImageProviderOptions = {
  binary?: string
  workingDirRoot: string
  timeoutMs?: number
  codexHome?: string
  /** 実 CLI を叩かずに契約テストを書くための差し込み口。既定は execFile 実装。 */
  runner?: CliRunner
}

type CodexJob = { readonly status: ImageJobStatus; readonly cancelled: boolean }

const RUNNING: ImageJobStatus = { state: 'running', progress: null }

const CANCELLED: ImageJobStatus = {
  state: 'failed',
  error: { code: 'cancelled', message: '絵を作るのをやめました。', retryable: false },
}

/** 利用者に見せる文。内部の参照（UUID）や実装の言葉を入れない（stub と同じ方針）。 */
const UNKNOWN_JOB_MESSAGE =
  'この絵の生成の記録が見つかりませんでした。結果は残っていないので、もう一度作ってください。'

const failed = (code: string, message: string, retryable: boolean): ImageJobStatus => ({
  state: 'failed',
  error: { code, message, retryable },
})

/** stderr の最後の 1 行（長すぎれば切る）。CLI が理由を最後に書くため。 */
const lastLine = (text: string): string =>
  (text.trim().split('\n').at(-1) ?? '').trim().slice(0, 200)

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isLocalFile = (path: string): boolean => isAbsolute(path) && !/^[a-z]+:\/\//i.test(path)

export const createCodexCliImageProvider = (options: CodexCliImageProviderOptions): ImageProvider => {
  const { runner = execFileCliRunner, ...rest } = options
  const { binary, workingDirRoot, timeoutMs, codexHome: configuredHome } = CodexCliImageProviderOptions.parse(rest)
  const codexHome = configuredHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')
  const jobs = new Map<string, CodexJob>()

  /** 再現用に CLI の版を残す。1 度だけ訊く（読めなければ null）。 */
  let version: Promise<string | null> | null = null
  const cliVersion = (): Promise<string | null> => {
    version ??= runner({ command: binary, args: ['--version'], timeoutMs: 10_000 }).then((result) =>
      result.kind === 'completed' && result.exitCode === 0 ? result.stdout.trim() || null : null,
    )
    return version
  }

  const settle = async (ref: string, workDir: string, redacted: string, result: CliRunResult): Promise<ImageJobStatus> => {
    if (result.kind === 'not_found') {
      return failed('cli_not_found', 'Codex CLI（codex）が見つかりません。インストールとログインを確かめてください。', false)
    }
    if (result.kind === 'timeout') {
      return failed('cli_timeout', `Codex CLI が ${String(Math.round(result.timeoutMs / 60_000))} 分で終わりませんでした。`, true)
    }
    if (result.kind === 'spawn_failed') {
      return failed('cli_spawn_failed', `Codex CLI を起動できませんでした: ${result.reason}`, false)
    }
    if (result.exitCode !== 0) {
      const reason = lastLine(result.stderr)
      return failed(
        'cli_exit_failed',
        `Codex CLI が終了コード ${String(result.exitCode)} で終わりました${reason === '' ? '。' : `: ${reason}`}`,
        true,
      )
    }
    const threadId = threadIdOf(result.stdout)
    const image = await locateCodexImage({ workDir, codexHome, threadId })
    const cleanupError = await removeCodexGenerated(codexHome, threadId)
    if (image === null) {
      return failed('no_image', 'Codex CLI が絵を返しませんでした。もう一度作ってください。', true)
    }
    return {
      state: 'succeeded',
      outputs: [{ type: 'local', path: image }],
      seedUsed: null,
      costUsd: 0,
      raw: {
        kind: 'cli',
        command: redacted,
        cliVersion: await cliVersion(),
        exitCode: result.exitCode,
        threadId,
        jobRef: ref,
        ...(cleanupError === null ? {} : { cleanupError }),
      },
    }
  }

  const submit = async (request: ImageGenerationRequest): Promise<ProviderJobHandle> => {
    const violations = [
      ...validateImageRequest(request, codexCliImageModel),
      ...(request.count === 1 ? [] : [`1 回に作れるのは 1 枚だけ（要求: ${String(request.count)} 枚）`]),
    ]
    if (violations.length > 0) throw new CapabilityViolationError(codexCliImageModel.id, violations)

    const referencePaths = await Promise.all(request.references.map((reference) => request.resolveReference(reference.mediaAssetId)))
    const remote = referencePaths.find((path) => !isLocalFile(path))
    if (remote !== undefined) {
      // URL は伏せる（署名付き URL を記録やログへ出さない。CLAUDE.md 規約 7）。
      throw new ProviderError('Codex CLI には手元のファイルしか参照画像として渡せません。', CODEX_CLI_PROVIDER_ID, false)
    }

    const ref = randomUUID()
    const workDir = join(workingDirRoot, ref)
    await mkdir(workDir, { recursive: true })

    const instruction = buildCodexImageInstruction({
      prompt: request.prompt,
      frame: codexFrameFor(request.aspectRatio),
      referenceRoles: request.references.map((reference) => reference.role),
      ...(request.composition === undefined ? {} : { composition: request.composition }),
    })
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox',
      'workspace-write',
      '-C',
      workDir,
      '--json',
      ...referencePaths.flatMap((path) => ['-i', path]),
    ]
    const redacted = `${redactCommand(binary, args, '')} <stdin:${String(instruction.length)}chars>`

    jobs.set(ref, { status: RUNNING, cancelled: false })
    void runner({ command: binary, args, timeoutMs, cwd: workDir, stdin: instruction })
      .then((result) => settle(ref, workDir, redacted, result))
      .catch((error: unknown) =>
        failed('cli_unexpected', `絵を取り込めませんでした: ${error instanceof Error ? error.message : String(error)}`, true),
      )
      .then((status) => {
        const job = jobs.get(ref)
        if (job !== undefined && !job.cancelled) jobs.set(ref, { ...job, status })
      })

    return { providerId: CODEX_CLI_PROVIDER_ID, modelId: codexCliImageModel.id, ref, submittedAt: new Date() }
  }

  const poll = (handle: ProviderJobHandle): Promise<ImageJobStatus> => {
    const job = jobs.get(handle.ref)
    if (job === undefined) {
      return Promise.reject(
        new ProviderError(UNKNOWN_JOB_MESSAGE, CODEX_CLI_PROVIDER_ID, true, {
          cause: new Error(`ジョブ参照 ${handle.ref} の記録が見つかりません`),
        }),
      )
    }
    return Promise.resolve(job.status)
  }

  /**
   * やめる。**動いている CLI は止めず、結果を捨てる**（時間切れで必ず終わる）。
   * 画像の生成を途中で止める口は今は無い（ADR-0029 の対象外）。
   */
  const cancel = (handle: ProviderJobHandle): Promise<void> => {
    const job = jobs.get(handle.ref)
    if (job !== undefined) jobs.set(handle.ref, { status: CANCELLED, cancelled: true })
    return Promise.resolve()
  }

  /** 取り込み終えたら、その回の作業ディレクトリ（frame.png ごと）を消し、記録も忘れる。 */
  const release = async (handle: ProviderJobHandle): Promise<void> => {
    jobs.delete(handle.ref)
    // 消すのは自分が切った UUID のディレクトリだけ（`../` などで外を消さない）。
    if (!UUID_PATTERN.test(handle.ref)) return
    await rm(join(workingDirRoot, handle.ref), { recursive: true, force: true })
  }

  return { id: CODEX_CLI_PROVIDER_ID, models: codexCliImageModels, submit, poll, cancel, release }
}
