import { access, copyFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { CODEX_OUTPUT_FILE } from './instruction.js'

/**
 * Codex が作った画像を探す（ADR-0029 の実測）。
 *
 * 画像はまず `$CODEX_HOME/generated_images/<thread_id>/exec-*.png` にでき、指示すれば
 * 作業ディレクトリへ `frame.png` として写される。写し忘れても thread_id から拾えるよう、
 * `--json` の最初の出来事 `thread.started` を読む。
 */

const ThreadStarted = z.object({ type: z.literal('thread.started'), thread_id: z.string().min(1) })

/** `--json` の出力（1 行 1 出来事）から thread_id を読む。読めなければ null。 */
export const threadIdOf = (stdout: string): string | null => {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const parsed = ThreadStarted.safeParse(JSON.parse(trimmed))
      if (parsed.success) return parsed.data.thread_id
    } catch {
      // JSON でない行（警告など）は読み飛ばす。thread_id が無ければ最後に null を返す。
    }
  }
  return null
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

const generatedDir = (codexHome: string, threadId: string): string =>
  join(codexHome, 'generated_images', threadId)

/** その回にできた PNG のうち、いちばん新しいもの。無ければ null。 */
const newestPng = async (dir: string): Promise<string | null> => {
  if (!(await exists(dir))) return null
  const names = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.png'))
  const withTimes = await Promise.all(
    names.map(async (name) => ({ path: join(dir, name), mtimeMs: (await stat(join(dir, name))).mtimeMs })),
  )
  return withTimes.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path ?? null
}

/**
 * 作業ディレクトリの `frame.png` を返す。無ければ CODEX_HOME のその回の絵を写して返す。
 * どちらにも無ければ null。
 */
export const locateCodexImage = async (input: {
  readonly workDir: string
  readonly codexHome: string
  readonly threadId: string | null
}): Promise<string | null> => {
  const target = join(input.workDir, CODEX_OUTPUT_FILE)
  if (await exists(target)) return target
  if (input.threadId === null) return null
  const generated = await newestPng(generatedDir(input.codexHome, input.threadId))
  if (generated === null) return null
  await copyFile(generated, target)
  return target
}

/**
 * CODEX_HOME に残ったその回の絵を消す（ADR-0012 の実装規約: 置いたままにしない）。
 * 消すのは**その回の thread_id のディレクトリだけ**。失敗しても生成は成功しているので、
 * 理由を返して記録に残す（握り潰さない）。
 */
export const removeCodexGenerated = async (codexHome: string, threadId: string | null): Promise<string | null> => {
  if (threadId === null) return null
  try {
    await rm(generatedDir(codexHome, threadId), { recursive: true, force: true })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
