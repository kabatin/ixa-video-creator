/**
 * Shot 一覧の行で「いま作っているもの」を出す（制作者 2026-10-03「Shot 一覧もぐるぐる表示したほうがいいが、
 * 画像と動画で見た目は切り替えたほうがよさそう」）。
 *
 * - 絵（絵コンテの画像）: 琥珀色の回る印と「絵を作っています」
 * - 動画（Take）: 青い回る印と「動画」と経過（「作成中 2:31 / 約 4 分」）
 *
 * 両方が同時に動くこともあるので、それぞれを出す。採用 Take がある Shot でも絵を作っている間は出す。
 */

const Spinner = () => (
  <span
    aria-hidden="true"
    className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
  />
)

const Badge = ({ kind, text }: { readonly kind: 'image' | 'video'; readonly text: string }) => (
  <span
    role="status"
    data-kind={kind}
    className={`mt-0.5 flex items-center gap-1 whitespace-nowrap text-xs tabular-nums ${kind === 'image' ? 'text-warn' : 'text-info'}`}
  >
    <Spinner />
    {text}
  </span>
)

export const ShotActivityBadges = ({
  drawing,
  video,
}: {
  /** 絵コンテの画像を作っているか。 */
  readonly drawing: boolean
  /** 動画を作っているときの経過（`describeActiveGeneration(...).short`）。作っていなければ null。 */
  readonly video: string | null
}) => (
  <>
    {drawing && <Badge kind="image" text="絵を作っています" />}
    {video !== null && <Badge kind="video" text={`動画 ${video}`} />}
  </>
)
