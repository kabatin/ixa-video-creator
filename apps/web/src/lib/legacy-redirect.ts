import { ProjectId, ShotId } from '@ixa/domain'
import { notFound, redirect } from 'next/navigation'
import { legacySectionHref, legacyShotHref, type LegacySection } from '@/lib/workbench-url'

/**
 * 旧 URL からワークベンチへ送る（UI-WORKBENCH §7.1 / ADR-0021 D2）。
 *
 * `next.config` の `redirects` ではなくページ側で送るのは、**ID を検証するため**。
 * ULID でない ID をそのままワークベンチへ渡さず、ここで 404 にする。
 * 引き継ぎ文書やブックマークにある旧 URL を壊さないために残している。
 */
export const redirectLegacySection = async (
  params: Promise<{ readonly id: string }>,
  section: LegacySection,
): Promise<never> => {
  const { id } = await params
  const projectId = ProjectId.safeParse(id)
  if (!projectId.success) notFound()
  redirect(legacySectionHref(projectId.data, section))
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** `/shots/[id]?projectId=` → その Shot を選んだワークベンチ。 */
export const redirectLegacyShot = async (
  params: Promise<{ readonly id: string }>,
  searchParams: SearchParams,
): Promise<never> => {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const raw = query['projectId']
  const shotId = ShotId.safeParse(id)
  const projectId = ProjectId.safeParse(Array.isArray(raw) ? raw[0] : raw)
  if (!shotId.success || !projectId.success) notFound()
  redirect(legacyShotHref(projectId.data, shotId.data))
}
