import { registerRoot } from 'remotion'
import { RemotionRoot } from './compositions/Root.js'

/**
 * **Remotion バンドラのエントリポイント**。
 *
 * CLAUDE.md 規約 7b（ライブラリモジュールは import しただけで何も起こさない）の例外。
 * `registerRoot` を import 時に呼ぶことは Remotion の仕様であり、
 * apps 配下の main.ts と同じ「起動しなければ意味が無いエントリポイント」にあたる。
 * **このファイルを他のモジュールから import しないこと。** `bundle()` だけが参照する。
 */
registerRoot(RemotionRoot)
