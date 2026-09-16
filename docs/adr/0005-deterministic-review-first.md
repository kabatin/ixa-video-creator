# ADR-0005: 決定的に測れるものは LLM に判定させない

Status: Accepted
Date: 2026-09-16
Decider: Architect

## Context

spec.md §19 は Identity / Continuity / Brand / Composition / Prompt Adherence / Music の
6 種の Review Agent を求める。全部を vision LLM で回すと、1 Take ごとに数十円かかり、
判定が毎回ブレる。MV 1 本で Take が数百になると無視できない。

## Decision

Review を **決定的チェック層** と **LLM 判定層** に分ける。

| Reviewer | 実装 | 理由 |
|---|---|---|
| technical（尺・解像度・fps・黒フレーム・無音） | ffprobe / ffmpeg 計算 | 完全に決定的 |
| music（ビート・ドロップ整合） | タイムライン計算 | 完全に決定的 |
| brand（色の存在・ロゴ有無） | フレーム抽出 + 色ヒストグラム、必要ならテンプレートマッチ | ほぼ決定的 |
| identity（人物一致） | vision LLM + 参照画像比較 | 判断が必要 |
| continuity（前後整合） | vision LLM（前 Shot の最終フレームと比較） | 判断が必要 |
| composition / prompt_adherence | vision LLM | 判断が必要 |

- 決定的チェックが fail したら **LLM 層を実行しない**（無駄なコストを払わない）。
- LLM 判定は zod スキーマによる structured output を必須とし、自由文を受け取らない。

## Consequences

+ Review コストが大幅に下がり、自動再生成ループを現実的に回せる。
+ 決定的チェックはテスト可能で、CI で回帰を検出できる。
− ブランドチェックの画像処理を自前で書く必要がある。
  → MVP では「iXA Yellow が画面内に一定割合存在するか」程度から始める。
