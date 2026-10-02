import type { ReviewerType } from '@ixa/domain'
import type { CliRunResult, CliRunner } from '../claude-cli-reviewer.js'
import type { VisionReviewRequest, VisionReviewResult } from '../port.js'

type RequestOverrides = {
  readonly reviewer?: ReviewerType
  readonly subjects?: VisionReviewRequest['subjects']
  readonly references?: VisionReviewRequest['references']
  readonly criteria?: string
  readonly imageDir?: string
}

/** 画像は手元に落としたファイル（2026-10-02）。URL は渡さない。 */
export const IMAGE_DIR = '/tmp/ixa-review-work/vision-abc'

export const makeReviewRequest = (overrides: RequestOverrides = {}): VisionReviewRequest => ({
  reviewer: overrides.reviewer ?? 'identity',
  subjects: overrides.subjects ?? [{ label: 'frame@1.5s', path: `${IMAGE_DIR}/frame-0.jpg` }],
  references: overrides.references ?? [
    { label: 'reference:face_front', path: `${IMAGE_DIR}/reference-0.png` },
  ],
  criteria: overrides.criteria ?? '主役の顔が参照画像と一致していること',
  imageDir: overrides.imageDir ?? IMAGE_DIR,
})

export const validResult: VisionReviewResult = {
  severity: 'fail',
  score: 0.31,
  message: '主役の輪郭が参照画像と一致していない。',
  frameSec: 1.5,
  suggestedPromptDelta: '参照画像の顔に合わせ、輪郭と髪型を一致させる',
}

/** `claude -p --output-format json` の外枠を組み立てる。 */
export const envelope = (
  resultText: string,
  extra: Readonly<Record<string, unknown>> = {},
): string => JSON.stringify({ result: resultText, total_cost_usd: 0.0123, ...extra })

/** 常に同じ結果を返す runner。呼び出し引数を記録して検証できるようにする。 */
export const recordingRunner = (
  outcome: CliRunResult,
): {
  runner: CliRunner
  calls: { command: string; args: readonly string[]; timeoutMs: number; cwd?: string }[]
} => {
  const calls: { command: string; args: readonly string[]; timeoutMs: number; cwd?: string }[] = []
  const runner: CliRunner = (invocation) => {
    calls.push({
      command: invocation.command,
      args: [...invocation.args],
      timeoutMs: invocation.timeoutMs,
      ...(invocation.cwd === undefined ? {} : { cwd: invocation.cwd }),
    })
    return Promise.resolve(outcome)
  }
  return { runner, calls }
}

export const completedWith = (stdout: string, stderr = ''): CliRunResult => ({
  kind: 'completed',
  exitCode: 0,
  stdout,
  stderr,
})
