import { redirectLegacySection } from '@/lib/legacy-redirect'

/** 旧 URL。ワークベンチへ送るだけ（UI-WORKBENCH §7.1）。 */
const LegacyPage = ({ params }: { readonly params: Promise<{ readonly id: string }> }) =>
  redirectLegacySection(params, 'storyboard')

export default LegacyPage
