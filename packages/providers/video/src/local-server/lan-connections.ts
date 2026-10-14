import dns from 'node:dns'
import net from 'node:net'

/**
 * 1 宛先あたりの接続の待ち。Node の既定は 250ms。
 *
 * Wi-Fi 越しの vpipe は往復 30〜170ms で、取りこぼしもある（2026-10-14 実測）。
 * 250ms では IPv4 の接続が間に合わず、`.local` が返す IPv6 も届かないので全宛先が ETIMEDOUT になる。
 * 生成は再試行で通っていた（1 本に 20 回）が、「解像度を上げる」の対応確認は 1 回で諦めるため押せなかった。
 */
export const LAN_CONNECT_ATTEMPT_TIMEOUT_MS = 2_000

/**
 * 手元の LAN の向こうにある AI サーバへ、つながりやすくする。**エントリポイント（main.ts）から 1 回だけ呼ぶ。**
 * プロセス全体の既定を変えるので、ライブラリの import では呼ばない（CLAUDE.md 規約 7b）。
 */
export const tolerateSlowLan = (): void => {
  dns.setDefaultResultOrder('ipv4first')
  net.setDefaultAutoSelectFamilyAttemptTimeout(LAN_CONNECT_ATTEMPT_TIMEOUT_MS)
}
