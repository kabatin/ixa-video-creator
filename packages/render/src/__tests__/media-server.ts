import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { basename, join } from 'node:path'
import type { AddressInfo } from 'node:net'

/**
 * テスト素材を HTTP で配る使い捨てサーバ。
 *
 * Remotion の `OffthreadVideo` / `Img` はブラウザとレンダラ双方から URL を取りに行く。
 * ローカルの絶対パスを `src` に渡すとバンドルの配信元からの相対 URL として解決され
 * 404 になるため、本番（署名付き URL）と同じ形で HTTP 越しに渡す。
 *
 * Range 要求に応えるのは、動画の取得がレンジ付きで来ることがあるため。
 */
export type MediaServer = {
  readonly urlFor: (filePath: string) => string
  readonly close: () => Promise<void>
}

const parseRange = (header: string | undefined, size: number): { start: number; end: number } | null => {
  if (header === undefined) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return null
  const rawStart = match[1] ?? ''
  const rawEnd = match[2] ?? ''
  if (rawStart === '' && rawEnd === '') return null

  const start = rawStart === '' ? size - Number.parseInt(rawEnd, 10) : Number.parseInt(rawStart, 10)
  const end = rawStart === '' || rawEnd === '' ? size - 1 : Number.parseInt(rawEnd, 10)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null
  return { start, end: Math.min(end, size - 1) }
}

export const startMediaServer = async (rootDir: string): Promise<MediaServer> => {
  const server: Server = createServer((request, response) => {
    const name = basename(decodeURIComponent(request.url ?? '/'))
    const filePath = join(rootDir, name)

    void stat(filePath)
      .then((stats) => {
        const range = parseRange(request.headers.range, stats.size)
        if (range === null) {
          response.writeHead(200, {
            'Content-Length': String(stats.size),
            'Accept-Ranges': 'bytes',
          })
          createReadStream(filePath).pipe(response)
          return
        }
        response.writeHead(206, {
          'Content-Length': String(range.end - range.start + 1),
          'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
        })
        createReadStream(filePath, { start: range.start, end: range.end }).pipe(response)
      })
      .catch((error: unknown) => {
        // 握り潰すと「素材が無い」のか「サーバが壊れた」のか分からなくなる（CLAUDE.md 規約 5）。
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end(`not found: ${name} (${error instanceof Error ? error.message : String(error)})`)
      })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('テスト用メディアサーバのポートを取得できませんでした')
  }
  const { port }: AddressInfo = address

  return {
    urlFor: (filePath) => `http://127.0.0.1:${port}/${encodeURIComponent(basename(filePath))}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      }),
  }
}
