'use client'

import { useEffect, useMemo, useState } from 'react'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import {
  createEnvironmentApi,
  type WireEnvironment,
  type WireSecretStatus,
} from '@/lib/environment-api'
import { createRequester } from '@/lib/requester'

/**
 * この環境が何につながっていて、何にお金が掛かるか。
 *
 * **鍵をここで入力させない。** API は無認証で全インターフェースに待ち受けているので、
 * 値を運ぶ口を置くと同じ網にいる誰でも課金される鍵を差し替えられる。
 * 鍵は `.env` に置き、ここには「設定されているか」と**貼る場所**だけを出す（規約 6）。
 *
 * これが無いと、画面からは実 Provider が繋がっているか分からなかった。
 * つまり**課金経路が開いているかが見えなかった**。
 */

type Load =
  | { readonly state: 'loading' }
  | { readonly state: 'error'; readonly message: string }
  | { readonly state: 'ready'; readonly value: WireEnvironment }

const secretLine = (secret: WireSecretStatus): string =>
  secret.configured ? `設定済み（${String(secret.length ?? 0)} 文字）` : '未設定'

export const EnvironmentPanel = () => {
  const api = useMemo(() => createEnvironmentApi(createRequester(resolveApiBaseUrl())), [])
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getEnvironment()
      .then((value) => {
        if (!cancelled) setLoad({ state: 'ready', value })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoad({ state: 'error', message: describeForPerson(cause) })
      })
    return () => {
      cancelled = true
    }
  }, [api])

  if (load.state === 'loading') {
    return <p className="text-sm text-muted">接続先を読み込んでいます…</p>
  }
  if (load.state === 'error') {
    return (
      <p role="alert" className="text-sm text-danger">
        {`接続先を読めませんでした: ${load.message}`}
      </p>
    )
  }

  const { secrets, settings } = load.value
  const missing = secrets.filter((secret) => !secret.configured)

  return (
    <section aria-label="接続先と実行の設定" className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold text-muted">鍵</h3>
        <p className="mt-1 text-xs text-muted">
          鍵はこの画面から設定できません。値は `.env` に置きます。
          この API は認証が無く同じネットワークから届くため、鍵を通す口を作っていません。
        </p>
        <dl className="mt-2 divide-y divide-line border-y border-line">
          {secrets.map((secret) => (
            <div key={secret.envName} className="flex items-baseline gap-3 py-1.5">
              <dt className="min-w-0 flex-1">
                <span className="text-sm text-text">{secret.label}</span>
                <span className="ml-2 font-mono text-xs text-muted">{secret.envName}</span>
                <p className="text-xs text-muted">{secret.purpose}</p>
              </dt>
              <dd
                className={`shrink-0 text-sm tabular-nums ${
                  secret.configured ? 'text-ok' : 'text-muted'
                }`}
              >
                {secretLine(secret)}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {missing.length > 0 && (
        <div className="rounded border border-line bg-surface-2 p-2">
          <p className="text-xs text-muted">
            未設定のものは、リポジトリ直下の `.env` に次の行を足してから
            <strong className="text-text"> dev サーバを再起動</strong>してください
            （`--env-file` は起動時にしか読まれません）。
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-bg p-2 font-mono text-xs text-text">
            {missing.map((secret) => `${secret.envName}=`).join('\n')}
          </pre>
          <button
            type="button"
            onClick={() => {
              const text = missing.map((secret) => `${secret.envName}=`).join('\n')
              void navigator.clipboard
                ?.writeText(text)
                .then(() => {
                  setCopied('コピーしました')
                })
                .catch(() => {
                  // クリップボードは許可されないことがある。手で選べるよう本文は出したまま。
                  setCopied('コピーできませんでした。上の行を選んでコピーしてください')
                })
            }}
            className="mt-2 h-6 rounded px-2 text-xs text-muted ring-1 ring-line-strong hover:text-text"
          >
            行をコピー
          </button>
          {copied !== null && (
            <span role="status" className="ml-2 text-xs text-muted">
              {copied}
            </span>
          )}
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold text-muted">実行の設定</h3>
        <dl className="mt-2 divide-y divide-line border-y border-line">
          {settings.map((setting) => (
            <div key={setting.envName} className="flex items-baseline gap-3 py-1.5">
              <dt className="min-w-0 flex-1">
                <span className="text-sm text-text">{setting.label}</span>
                <span className="ml-2 font-mono text-xs text-muted">{setting.envName}</span>
                <p className="text-xs text-muted">{setting.note}</p>
              </dt>
              <dd
                className={`shrink-0 font-mono text-sm ${
                  setting.notable ? 'text-warn' : 'text-muted'
                }`}
              >
                {setting.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
