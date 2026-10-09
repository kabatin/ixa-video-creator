'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { createAuthApi } from '@/lib/auth-api'
import { safeNextPath } from '@/lib/login-next'
import { createRequester } from '@/lib/requester'

/**
 * 合言葉を入れる（認証。2026-10-09）。入れたら、来た場所へ戻る。
 *
 * **戻るときは画面ごと読み直す**（`location.assign`）。サーバ側で描く画面がクッキー付きで
 * 描き直されないと、入ったのに中身が空のままになる。
 */
export const LoginForm = ({ next }: { readonly next: string | null }) => {
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createAuthApi(createRequester(resolveApiBaseUrl())).login(passphrase)
      window.location.assign(safeNextPath(next))
    } catch (cause: unknown) {
      setError(describeForPerson(cause))
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void submit(event)
      }}
      className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-line bg-surface p-6 shadow-sm"
    >
      <h1 className="text-lg font-semibold text-text">ixa video creator</h1>
      <label className="flex flex-col gap-1 text-sm text-text">
        合言葉
        <input
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={passphrase}
          onChange={(event) => {
            setPassphrase(event.target.value)
          }}
          className="rounded-md border border-line bg-bg px-3 py-2 text-text"
        />
      </label>
      {error !== null && (
        <p role="alert" className="rounded bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" tone="primary" disabled={busy || passphrase === ''}>
        {busy ? '確かめています…' : '入る'}
      </Button>
    </form>
  )
}
