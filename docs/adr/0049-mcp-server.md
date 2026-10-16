# ADR-0049: AI エージェント向けの MCP サーバ（apps/mcp）

Status: Accepted
Date: 2026-10-17
Decider: Claude（Architect）

## 背景

ADR-0046 で自動化用の鍵（Bearer）を用意した。次は Claude Code・Codex のようなエージェントが、
人の画面を通さずに 1 本の動画を最後まで作れるようにしたい。API は 100 を超える細かい口があり、
エージェントにそのまま見せると手順の組み立てと応答の大きさで文脈を食い潰す。
生成は手元の GPU で 1 本数分〜数十分かかり、MCP の 1 回の呼び出しをその間止めておくこともできない。

## 決めたこと

- **`apps/mcp` に stdio の MCP サーバを置く。** `@modelcontextprotocol/sdk` の McpServer と
  StdioServerTransport。ixa の API を HTTP で呼ぶだけの薄いクライアントで、DB・キュー・Provider には触れない
- **鍵は自動化用の鍵を `Authorization: Bearer` で。** env（`IXA_API_TOKEN`）からだけ読み、zod で検証する。
  ログ・例外の文・ツールの結果に鍵と署名付き URL を出さない。署名付き URL（素材の出し入れ）には鍵を送らない
- **ツールは制作の段ごとの粗い 21 本。** 状態 → 作品 → 曲 → Shot 割り → 人物・場所 → 最初のコマ → 動画 →
  採用・解像度上げ → 書き出し。一括の口がある操作はそれを使い、失敗は理由つきでそのまま返す。
  応答は短い JSON（曲の解析は拍の要約とフレーズ頭に畳み、数千の数を渡さない）
- **`view` は画像を返す。** 最初のコマ・Take の頭／中／終わり・書き出しを幅 ~768px の JPEG にして
  MCP の image content で返す。エージェントが出来を自分の目で見て、描き直し・作り直し・採用を決められるように
- **待つのはポーリング。** `wait` は間隔を 2 秒から 15 秒まで広げながら問い合わせ、`maxWaitSec`（既定 480 秒）で
  必ず返す。終わっていなければ `timedOut: true` と途中経過を返し、エージェントにもう一度呼ばせる
- 尺の規則（vpipe の 17n+5 コマ）は写さず、`/models` の尺と domain の `quantizeDuration` で判定する
- 曲を作る API（ADR-0048 の `/projects/{id}/music/generate`・`/music-jobs/{id}`）の呼び出しと応答の形は
  `tools/music-generation.ts` 1 つに閉じ、上限は domain の定数を読む

## 今回の外

- **stdio だけ。** HTTP（Streamable HTTP）で外へ出すのは、鍵の扱いと LAN の平文（ADR-0046）を決めてから
- 自動化用の鍵の「できることの範囲」は付けない（ADR-0046 のまま。全部できる）
- SSE（`/projects/{id}/events`）での待ちは使わない。ポーリングで足りる
- 解像度上げのジョブには状態を引く口が無いので、出来た Take が増えたかで判定する。失敗は見分けられず時間切れになる
