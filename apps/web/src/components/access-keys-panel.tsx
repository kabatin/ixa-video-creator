'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { accessKeyState, formatWhen } from '@/lib/access-key-display'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { createAuthApi, type WireAccessToken } from '@/lib/auth-api'
import { LOGIN_PATH } from '@/lib/http'
import { createRequester } from '@/lib/requester'

/**
 * アクセス用の鍵（認証。2026-10-09）。Claude・Codex（MCP）に渡す鍵の発行・一覧・取り消し。
 *
 * **発行した鍵は、その場で 1 回だけ見せる。** 表にはハッシュしか残らないので、あとから見る方法は無い。
 * 鍵の発行と取り消しは、合言葉で入った画面からだけできる（自動化用の鍵では作れない）。
 */
export const AccessKeysPanel = () => {
  const api = useMemo(() => createAuthApi(createRequester(resolveApiBaseUrl())), [])
  const [tokens, setTokens] = useState<readonly WireAccessToken[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [issued, setIssued] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const reload = useCallback(() => {
    api
      .listAccessTokens()
      .then(setTokens)
      .catch((cause: unknown) => {
        setError(describeForPerson(cause))
      })
  }, [api])

  useEffect(reload, [reload])

  const issue = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    try {
      const result = await api.issueAccessToken(label)
      setIssued(result.token)
      setLabel('')
      reload()
    } catch (cause: unknown) {
      setError(describeForPerson(cause))
    }
  }

  const revoke = async (id: string): Promise<void> => {
    setConfirming(null)
    try {
      await api.revokeAccessToken(id)
      reload()
    } catch (cause: unknown) {
      setError(describeForPerson(cause))
    }
  }

  const logout = async (): Promise<void> => {
    try {
      await api.logout()
    } finally {
      window.location.assign(LOGIN_PATH)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error !== null && (
        <p role="alert" className="rounded bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}

      <form
        onSubmit={(event) => {
          void issue(event)
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1 text-sm text-text">
          名前（どこで使う鍵か）
          <input
            value={label}
            maxLength={80}
            placeholder="Claude の MCP"
            onChange={(event) => {
              setLabel(event.target.value)
            }}
            className="w-72 rounded-md border border-line bg-bg px-3 py-2 text-text"
          />
        </label>
        <Button type="submit" tone="primary" disabled={label.trim() === ''}>
          鍵を発行する
        </Button>
      </form>

      {issued !== null && (
        <section className="flex flex-col gap-2 rounded-lg border border-ok/40 bg-ok/10 p-4">
          <p className="text-sm font-semibold text-text">発行しました。この鍵は今しか見られません。控えてください。</p>
          <code className="select-all break-all rounded bg-bg p-2 text-sm text-text">{issued}</code>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(issued)
              }}
            >
              写す
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setIssued(null)
              }}
            >
              控えた
            </Button>
          </div>
        </section>
      )}

      <table className="w-full text-left text-sm">
        <thead className="text-muted">
          <tr>
            <th className="py-1">名前</th>
            <th>状態</th>
            <th>作った</th>
            <th>最後に使った</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tokens === null ? (
            <tr>
              <td colSpan={5} className="py-2 text-muted">
                読み込んでいます…
              </td>
            </tr>
          ) : tokens.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-2 text-muted">
                まだ鍵はありません。
              </td>
            </tr>
          ) : (
            tokens.map((token) => (
              <tr key={token.id} className="border-t border-line">
                <td className="py-2 text-text">{token.label}</td>
                <td>{accessKeyState(token)}</td>
                <td>{formatWhen(token.createdAt)}</td>
                <td>{formatWhen(token.lastUsedAt)}</td>
                <td className="text-right">
                  {token.revokedAt === null &&
                    (confirming === token.id ? (
                      <span className="inline-flex gap-2">
                        <Button
                          size="sm"
                          tone="danger"
                          onClick={() => {
                            void revoke(token.id)
                          }}
                        >
                          取り消す（元に戻せない）
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setConfirming(null)
                          }}
                        >
                          やめる
                        </Button>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => {
                          setConfirming(token.id)
                        }}
                      >
                        取り消す…
                      </Button>
                    ))}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div>
        <Button
          onClick={() => {
            void logout()
          }}
        >
          この端末から出る
        </Button>
      </div>
    </div>
  )
}
