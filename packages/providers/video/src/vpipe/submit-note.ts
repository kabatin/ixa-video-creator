import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ReferenceRole } from '@ixa/domain'
import { z } from 'zod'
import { VPIPE_NOTES_DIR, type VpipeWarn } from './output.js'

/**
 * 投入したときにしか分からないことの控え（ADR-0031）。
 *
 * `poll` には仕様が渡ってこない。一方、開始画像の枠は 1 つしかなく、2 枚目以降の参照は
 * 使わずに捨てている。**捨てたことを Take の記録（raw）に残す**ため、投入時に書いて完了時に読む。
 * 選び方そのものは仕様の純関数（`selectStartReference`）なので、控えが消えても
 * `Take.spec` から同じ選択を再現できる。控えは「実際にそうした」ことの記録である。
 *
 * **署名付き URL と画像の中身は入れない**（CLAUDE.md 規約 7）。素材 ID と role だけ。
 */
const NotedReference = z.object({
  role: ReferenceRole,
  mediaAssetId: z.string().min(1),
})

export const VpipeSubmitNote = z.object({
  startImage: NotedReference.extend({ mediaType: z.string().min(1) }).nullable(),
  ignoredReferences: z.array(NotedReference),
})
export type VpipeSubmitNote = z.infer<typeof VpipeSubmitNote>

const notePath = (outputDir: string, jobId: string): string =>
  join(outputDir, VPIPE_NOTES_DIR, `${jobId}.json`)

/**
 * 控えを書く。**投げない。** ここに来た時点でサーバは生成を受け付けている。
 * 控えが書けないことを理由に投入を失敗にすると、サーバで走っている生成が宙に浮く。
 * 書けなかったら記録して false を返し、完了時の raw では「分からない（null）」になる。
 */
export const writeSubmitNote = async (
  outputDir: string,
  jobId: string,
  note: VpipeSubmitNote,
  warn: VpipeWarn,
): Promise<boolean> => {
  try {
    await mkdir(join(outputDir, VPIPE_NOTES_DIR), { recursive: true })
    await writeFile(notePath(outputDir, jobId), JSON.stringify(note), 'utf8')
    return true
  } catch (error) {
    warn(
      { err: error, jobId },
      'vpipe の投入の控えを書けませんでした。Take の記録で、使った開始画像が分からなくなります',
    )
    return false
  }
}

/** 控えを読む。無い・読めない・形が違うときは null（推測で埋めない）。 */
export const readSubmitNote = async (
  outputDir: string,
  jobId: string,
): Promise<VpipeSubmitNote | null> => {
  try {
    const text = await readFile(notePath(outputDir, jobId), 'utf8')
    const parsed = VpipeSubmitNote.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
