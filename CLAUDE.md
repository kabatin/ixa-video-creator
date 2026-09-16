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

## テスト

- ドメインロジック（タイミング計算・ビートスナップ・参照解決・ルーター）は**必ず**ユニットテスト。
- Provider アダプタはモックレスポンスで契約テスト。実 API を CI で叩かない。
- 重要フロー（Vertical Slice）のみ E2E。
- 目標カバレッジ 80%。ただし UI のスナップショットでカバレッジを水増ししない。
