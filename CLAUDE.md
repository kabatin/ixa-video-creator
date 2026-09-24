# CLAUDE.md — ixa-video-creator

AI ネイティブ映像制作プラットフォーム。最初の制作物は **iXA CUP MUSIC VIDEO**（約1分56秒）。

実装エージェントは **`AGENTS.md` を先に読むこと**。

---

## 設計の中心

**Shot First.** Storyboard / Generation / Take / Review / Timeline はすべて Shot に接続する。
ドメインモデルの唯一の正は `docs/DOMAIN.md`。

## レイヤールール

```
apps/*        ← IO / HTTP / UI / Queue 配線
packages/*    ← ロジック
  domain/     ← 純粋。IO 禁止。他の packages に依存しない
  db/         ← domain に依存してよい
  providers/  ← domain の型のみに依存。外部 SDK はここで閉じる
  その他       ← domain に依存してよい
```

**依存の向きは常に `apps → packages → domain`。逆流禁止。**

## 絶対規約

1. **Immutability** — オブジェクトを破壊的変更しない。常に新しい値を返す。
2. **Take は追記のみ** — 生成結果を上書きしない。
3. **時間は秒（float）** — ミリ秒・フレームを DB / Domain に持ち込まない。
4. **入力は zod で検証** — API 境界・Provider レスポンス・環境変数すべて。
5. **エラーは握り潰さない** — catch したら必ず文脈を付けて再送出かログ。
6. **シークレットは env のみ** — ハードコード禁止。`packages/config` の zod スキーマ経由で読む。
7. **署名付き URL を DB に保存しない** — 期限切れ URL は事故のもと。都度発行する。
7b. **副作用はエントリポイントだけ** — ライブラリモジュール（`packages/*` と
    `apps/*/src` の `main.ts` 以外）は import しただけで何も起こしてはいけない。
    DB 接続・サーバ起動・キュー購読はすべて関数の中に閉じる。
    ただし **`main.ts` は例外**で、末尾で `main()` を呼んでよい。起動しないエントリポイントは無意味なため。
8. **ファイルは小さく** — 200〜400 行が標準、800 行が上限。
9. **`console.log` 禁止** — logger を使う。
10. **`any` 禁止** — 型が合わないなら BLOCKED で報告する。

## コマンド

```bash
pnpm install
pnpm dev            # web + api + worker を並列起動
pnpm typecheck
pnpm lint
pnpm test
pnpm db:generate    # drizzle マイグレーション生成
pnpm db:migrate
```

## 命名

| 対象 | 規則 | 例 |
|---|---|---|
| ファイル | kebab-case | `shot-generation-spec.ts` |
| 型 / クラス | PascalCase | `ShotGenerationSpec` |
| 関数 / 変数 | camelCase | `resolveShotReferences` |
| DB テーブル | snake_case 複数形 | `character_looks` |
| 定数 | SCREAMING_SNAKE | `MAX_REFERENCE_IMAGES` |
| ID | ULID + branded type | `ShotId` |

### 画面の言葉

| 規則 | 内容 |
|---|---|
| 英語のまま | **Shot / Take / Look の 3 語だけ。** `docs/DOMAIN.md` のドメイン語で、訳すと DB の列名・API・画面が食い違う |
| 日本語にする | それ以外すべて（キャラクター・ロケーション・ブランド資産・楽曲・シーケンス・トランジション） |
| 画面に出さない | px・生の秒・内部 ID・HTTP の URL やレスポンス本文・`worker` や `API` のような実装の名前 |
| 時間の書式 | `apps/web/src/lib/format-time.ts` が唯一の正。位置は `0:03.75`、尺は `3.75s`、長い尺だけ併記 |
| 同じ語を 2 つの意味で使わない | 「素材」＝素材全体。1 件を見るパネルは「素材ビューア」。Shot の状態「下書き」と区別して AI の案は「絵コンテの案」 |
| パネル名とメニュー項目名 | 必ず一致させる（`menu-panel-names.test.ts` が検査する） |

## テスト

- ドメインロジック（タイミング計算・ビートスナップ・参照解決・ルーター）は**必ず**ユニットテスト。
- Provider アダプタはモックレスポンスで契約テスト。実 API を CI で叩かない。
- 重要フロー（Vertical Slice）のみ E2E。
- 目標カバレッジ 80%。ただし UI のスナップショットでカバレッジを水増ししない。
