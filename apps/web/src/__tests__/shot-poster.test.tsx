import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { POSTER_LOAD_FAILED_TEXT, ShotPoster } from '@/components/shot-poster'
import { NOT_FETCHED_REASON } from '@/lib/shot-posters'

/**
 * サムネイル 1 枚（P60-3）。ここで守りたいのは 2 つ。
 *
 * 1. **理由を黙って落とさない。** 絵が無いときは読み上げでも理由が分かる（L-015）
 * 2. **期限切れの URL を壊れた画像のまま置かない。** `onError` で文へ切り替わる
 */

describe('絵があるとき', () => {
  it('img を出し、遅延読み込みにする', () => {
    render(
      <ShotPoster
        url="https://example.invalid/thumb.jpg?sig=x"
        reason={null}
        alt="CUT-01 のサムネイル"
        size="row"
      />,
    )

    const img = screen.getByAltText('CUT-01 のサムネイル')
    expect(img).toHaveAttribute('src', 'https://example.invalid/thumb.jpg?sig=x')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('読み込みに失敗したら「読み込めません」へ切り替える', () => {
    render(
      <ShotPoster
        url="https://example.invalid/expired.jpg?sig=old"
        reason={null}
        alt="CUT-01 のサムネイル"
        size="row"
      />,
    )

    fireEvent.error(screen.getByAltText('CUT-01 のサムネイル'))

    // 壊れた画像アイコンではなく、なぜ出ないかが読める文を出す。
    expect(screen.queryByAltText('CUT-01 のサムネイル')).toBeNull()
    expect(screen.getByText(POSTER_LOAD_FAILED_TEXT)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: `CUT-01 のサムネイル: ${POSTER_LOAD_FAILED_TEXT}` })).toBeInTheDocument()
  })
})

describe('絵が無いとき', () => {
  it('理由を aria-label と title に出す', () => {
    render(
      <ShotPoster url={null} reason="Take が選ばれていません" alt="CUT-02 のサムネイル" size="row" />,
    )

    const frame = screen.getByRole('img', {
      name: 'CUT-02 のサムネイル: Take が選ばれていません',
    })
    expect(frame).toHaveAttribute('title', 'Take が選ばれていません')
    expect(screen.getByText('Take が選ばれていません')).toBeInTheDocument()
  })

  it('まだ引いていない状態は「読み込み中」と言い、「無い」と言わない', () => {
    render(
      <ShotPoster url={null} reason={NOT_FETCHED_REASON} alt="CUT-04 のサムネイル" size="row" />,
    )

    expect(
      screen.getByRole('img', { name: 'CUT-04 のサムネイル: サムネイルを読み込み中' }),
    ).toBeInTheDocument()
  })

  it('チップでも理由は読み上げに残す（枠が小さくて字が置けなくても落とさない）', () => {
    render(<ShotPoster url={null} reason="メディアが見つかりません" alt="CUT-05 のサムネイル" size="chip" />)

    expect(
      screen.getByRole('img', { name: 'CUT-05 のサムネイル: メディアが見つかりません' }),
    ).toBeInTheDocument()
  })
})

/**
 * 作っている最中（制作者 2026-10-02「画像生成中のところはサムネのところに生成中なのが分かるようにローディングマーク」）。
 * Shot 一覧のチップは字が置けず、作っている最中も空の灰色の枠にしか見えなかった。
 */
describe('作っている最中', () => {
  it.each(['chip', 'row', 'card'] as const)('%s でも回る印を出し、読み上げには理由を残す', (size) => {
    render(
      <ShotPoster url={null} reason="絵コンテの画像を作っています" alt="CUT-06 のサムネイル" size={size} pending />,
    )

    const frame = screen.getByRole('img', { name: 'CUT-06 のサムネイル: 絵コンテの画像を作っています' })
    expect(frame).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('poster-spinner')).toBeInTheDocument()
  })

  it('作っていなければ印を出さない', () => {
    render(<ShotPoster url={null} reason="まだ Take がありません" alt="CUT-07 のサムネイル" size="chip" />)

    expect(screen.getByRole('img', { name: 'CUT-07 のサムネイル: まだ Take がありません' })).not.toHaveAttribute('aria-busy')
    expect(screen.queryByTestId('poster-spinner')).toBeNull()
  })

  it('絵が出ていれば、作っていても絵を出す（前の絵の上に印を重ねない）', () => {
    render(
      <ShotPoster url="https://example.invalid/thumb.jpg?sig=x" reason={null} alt="CUT-08 のサムネイル" size="chip" pending />,
    )

    expect(screen.getByAltText('CUT-08 のサムネイル')).toBeInTheDocument()
    expect(screen.queryByTestId('poster-spinner')).toBeNull()
  })
})
