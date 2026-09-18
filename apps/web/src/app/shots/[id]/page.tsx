import { redirectLegacyShot } from '@/lib/legacy-redirect'

/** 旧 Shot 詳細。中身はワークベンチに吸収した（UI-WORKBENCH §3.2）。その Shot を選んで開く。 */
const LegacyShotPage = ({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}) => redirectLegacyShot(params, searchParams)

export default LegacyShotPage
