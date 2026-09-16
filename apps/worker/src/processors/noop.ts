import { z } from 'zod'

/**
 * 疎通確認用ジョブの入力スキーマ。
 */
export const NoopJobDataSchema = z.object({
  message: z.string().min(1),
})

export type NoopJobData = z.infer<typeof NoopJobDataSchema>

export type NoopJobResult = {
  readonly echoed: string
  readonly processedAt: string
}

/**
 * 疎通確認用のプロセッサ。入力を zod で検証し、そのままエコーして返す。
 * Phase 0 ではすべてのキューがこのプロセッサを使う。
 * BullMQ の Processor 契約に合わせて Promise を返す（将来 I/O が入っても
 * シグネチャを変えずに済むよう、意図的に async のままにしている）。
 */
// eslint-disable-next-line @typescript-eslint/require-await -- 上記の理由で意図的に async
export const processNoopJob = async (data: NoopJobData): Promise<NoopJobResult> => {
  const validated = NoopJobDataSchema.parse(data)

  return {
    echoed: validated.message,
    processedAt: new Date().toISOString(),
  }
}
