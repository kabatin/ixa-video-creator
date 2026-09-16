import type { ReviewerType } from '@ixa/domain'
import type { CliRunResult, CliRunner } from '../claude-cli-reviewer.js'
import type { VisionReviewRequest, VisionReviewResult } from '../port.js'

type RequestOverrides = {
  readonly reviewer?: ReviewerType
  readonly subjects?: VisionReviewRequest['subjects']
  readonly references?: VisionReviewRequest['references']
  readonly criteria?: string
}

/** 署名付き URL は都度発行される想定なので、既定値も「いかにも期限付き」の形にしてある。 */
export const makeReviewRequest = (overrides: RequestOverrides = {}): VisionReviewRequest => ({
  reviewer: overrides.reviewer ?? 'identity',
  subjects: overrides.subjects ?? [
    { label: 'frame@1.5s', url: 'https://example.test/frames/a.png?sig=aaa&expires=1' },
  ],
  references: overrides.references ?? [
    { label: 'reference:face_front', url: 'https://example.test/refs/face.png?sig=bbb&expires=1' },
  ],
  criteria: overrides.criteria ?? '主役の顔が参照画像と一致していること',
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
): { runner: CliRunner; calls: { command: string; args: readonly string[]; timeoutMs: number }[] } => {
  const calls: { command: string; args: readonly string[]; timeoutMs: number }[] = []
  const runner: CliRunner = (invocation) => {
    calls.push({
      command: invocation.command,
      args: [...invocation.args],
      timeoutMs: invocation.timeoutMs,
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
