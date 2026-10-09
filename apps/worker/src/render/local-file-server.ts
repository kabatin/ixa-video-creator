import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

/**
 * 書き出しの間だけ立てる、手元のファイルを配る口（ADR-0045）。
 *
 * **なぜ要るか**: Remotion の `OffthreadVideo` はコマを Node 側で抜くが、その取り寄せ
 * （`@remotion/renderer` の `assets/read-file.js`）は `http://` と `https://` しか受けない。
 * `file://` を渡すと「Can only download URLs starting with http:// or https://」で落ちる。
 *
 * - **127.0.0.1 にしか開かない。** 外から届かない
 * - **登録したファイルしか返さない。** パスは推測できない番号（UUID）で、
 *   要求のパスをファイル名として解釈しない（`../` で外へ出られない）
 * - 書き出しが終わったら必ず `close()` する
 */

export type LocalFileServer = {
  /** 登録したファイルの URL。 */
  readonly urlOf: (token: string) => string
  readonly close: () => Promise<void>
}

/**
 * ファイルに推測できない番号を振る。`tokenOf` は呼び出し側の鍵 → 番号、`table` は口が引く番号 → パス。
 */
export const registerFiles = <K>(
  files: ReadonlyMap<K, string>,
): { readonly tokenOf: ReadonlyMap<K, string>; readonly table: ReadonlyMap<string, string> } => {
  const entries = [...files].map(([key, path]) => ({ key, path, token: randomUUID() }))
  return {
    tokenOf: new Map(entries.map((entry) => [entry.key, entry.token])),
    table: new Map(entries.map((entry) => [entry.token, entry.path])),
  }
}

const handler =
  (table: ReadonlyMap<string, string>) =>
  (req: IncomingMessage, res: ServerResponse) => {
    const path = table.get((req.url ?? '').replace(/^\//, '').split('?')[0] ?? '')
    if ((req.method !== 'GET' && req.method !== 'HEAD') || path === undefined) {
      res.writeHead(404).end()
      return
    }
    stat(path)
      .then((info) => {
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(info.size) })
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        createReadStream(path)
          .on('error', () => res.destroy())
          .pipe(res)
      })
      .catch(() => {
        res.writeHead(404).end()
      })
  }

export const startLocalFileServer = async (
  table: ReadonlyMap<string, string>,
): Promise<LocalFileServer> => {
  const server: Server = createServer(handler(table))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('書き出し用のファイルの口を開けませんでした（番号が取れない）')
  }
  const { port } = address
  return {
    urlOf: (token) => `http://127.0.0.1:${String(port)}/${token}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => {
          resolve()
        })
      }),
  }
}
