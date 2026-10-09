import { LoginForm } from '@/components/login-form'

export const dynamic = 'force-dynamic'

type LoginPageProps = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** 入り口（認証。2026-10-09）。見出しやメニューは出さない（入るまで何もできないので）。 */
const LoginPage = async ({ searchParams }: LoginPageProps) => {
  const raw = (await searchParams).next
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <LoginForm next={typeof raw === 'string' ? raw : null} />
    </main>
  )
}

export default LoginPage
