import type { MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { PROJECT_EDIT_ORIGIN_HEADER } from './events/project-edited.js'

/**
 * ブラウザから API を直接叩く経路（署名付き URL の取得など）のための CORS（`createApp` が門より先に置く）。
 *
 * **許可先は設定で明示する。ワイルドカードを使わない。** 開発中は Web の開発サーバだけを許可すれば足りる。
 * 許可先が空なら CORS を有効にしない（null）。
 */
export const corsFor = (origins: readonly string[]): MiddlewareHandler | null =>
  origins.length === 0
    ? null
    : cors({
        origin: [...origins],
        // 画面の Requester が使うメソッドはすべて（PUT を落としていて「使う AI」の保存と最初のフレームが止まっていた）。
        allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
        // 自動化用の鍵（Bearer）を送れるように。
        // 書いた画面の印（`project.edited` の origin）。
        allowHeaders: ['Content-Type', 'Authorization', PROJECT_EDIT_ORIGIN_HEADER],
        // 合言葉で入ったクッキーを、画面（別のポート）からの呼び出しに付けさせる（認証）。
        // これが無いと、画面が `credentials: 'include'` で呼んだ応答をブラウザが捨てる。
        credentials: true,
        maxAge: 600,
      })
