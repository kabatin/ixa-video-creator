import type { MusicTrack, Project } from '@ixa/domain'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { StoryboardEmpty } from '@/components/workbench/panels/storyboard-empty'
import { WorkflowProvider } from '@/components/workbench/workflow-context'
import { aProject, renderInWorkbench } from './workbench-fixture'

/**
 * Shot が 0 件のストーリーボード（制作者 2026-10-03「楽曲を登録するとストーリーボードに「Shot はまだありません」と
 * 「聴きながら切る」「Shot を 1 件だけ作る」があり、Shot を作ってしまいそう」「このタイミングでやるのは、コンセプト・
 * あらすじの入力、歌詞の入力、ルックの設定」）。次にやる 1 つを主ボタンにし、Shot の前の段を並べて見せる。
 */

const track = { id: 'track-1', title: 'iXA CUP' } as unknown as MusicTrack
const LYRICS = '一行目\n二行目'

describe('StoryboardEmpty', () => {
  it('作品の方針が途中なら、主ボタンは「作品の方針を書く」。押すと作品の方針を開く', async () => {
    const { value } = renderInWorkbench(<StoryboardEmpty />, {
      track,
      concept: '',
      project: { ...aProject, lyrics: '', styleGuide: '' },
    })

    const primary = screen.getByRole('button', { name: '作品の方針を書く' })
    await userEvent.click(primary)
    expect(value.inspect).toHaveBeenCalledWith({ kind: 'project', id: value.projectId })
    expect(value.focusPanel).toHaveBeenCalledWith('inspector')
    // Shot を先に作る道は控えめに残す。
    expect(screen.getByRole('button', { name: 'Shot を 1 件だけ作る' })).toBeTruthy()
  })

  it('Shot の前の段を、済んだ印つきで並べる', () => {
    renderInWorkbench(<StoryboardEmpty />, {
      track,
      concept: '夜明け',
      project: { ...aProject, lyrics: LYRICS, lyricCues: [], styleGuide: '水彩' },
    })

    const steps = screen.getByRole('list', { name: 'Shot を作るまで' })
    expect(steps.textContent).toMatch(/楽曲.*✓/)
    expect(steps.textContent).toMatch(/作品の方針.*✓/)
    expect(steps.textContent).toContain('歌詞の時刻')
    expect(steps.textContent).toContain('区切って Shot')
    expect(screen.getByRole('button', { name: '歌詞の時刻を合わせる' })).toBeTruthy()
  })

  it('Shot の前の段が済んでいれば、主ボタンは「区切って Shot にする」で、区切るモードを開く', async () => {
    const { value } = renderInWorkbench(
      <WorkflowProvider lyricTelopCount={2} rendered={false}>
        <StoryboardEmpty />
      </WorkflowProvider>,
      { track, concept: '夜明け', project: { ...aProject, lyrics: LYRICS, lyricCues: [1, 2], styleGuide: '水彩' } },
    )

    await userEvent.click(screen.getByRole('button', { name: '区切って Shot にする' }))
    expect(value.openCutter).toHaveBeenCalledWith('cut')
  })

  it('楽曲が無ければ、楽曲の登録を出す', () => {
    renderInWorkbench(<StoryboardEmpty />, { track: null, musicLoaded: true })
    expect(screen.getByText('楽曲が登録されていません')).toBeTruthy()
  })
})

/**
 * 曲の無い人の入口。楽曲を登録・曲を作る…・曲なしで始める（ナレーションから）の 3 つを出し、
 * 主ボタン（塗り）は作品の種類の始め方に合わせる。素材置き場は主ボタンを置かない。
 */
describe('StoryboardEmpty の曲が無いときの入口', () => {
  const ENTRANCES = ['楽曲を登録', '曲を作る…', '曲なしで始める（ナレーションから）'] as const
  const isPrimary = (name: string): boolean => screen.getByRole('button', { name }).className.includes('bg-accent')
  const showWithout = (kind: Project['kind'], narration: { lines: number; ready: number } | null = { lines: 0, ready: 0 }) =>
    renderInWorkbench(
      <WorkflowProvider lyricTelopCount={0} narration={narration} rendered={false}>
        <StoryboardEmpty />
      </WorkflowProvider>,
      { track: null, musicLoaded: true, project: { ...aProject, kind } },
    )

  it('曲から始める種類は「楽曲を登録」が主ボタンで、ほかの 2 つは控えめ', () => {
    showWithout('mv')
    expect(ENTRANCES.map(isPrimary)).toEqual([true, false, false])
    expect(screen.getByText(/曲を登録して解析すると/)).toBeTruthy()
  })

  it('ナレーションから始める種類は「曲なしで始める」が主ボタン。押すとナレーションを前に出す', async () => {
    const { value } = showWithout('kamishibai')
    expect(ENTRANCES.map(isPrimary)).toEqual([false, false, true])
    expect(screen.getByText(/ナレーションの原稿を書いて声にすると/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '曲なしで始める（ナレーションから）' }))
    expect(value.focusPanel).toHaveBeenCalledWith('narration')
  })

  it('素材置き場は主ボタンを置かない', () => {
    showWithout('library')
    expect(ENTRANCES.map(isPrimary)).toEqual([false, false, false])
  })

  it('「曲を作る…」は曲を作る画面を開く', async () => {
    const { value } = showWithout('mv')
    await userEvent.click(screen.getByRole('button', { name: '曲を作る…' }))
    expect(value.openDialog).toHaveBeenCalledWith('make-music')
  })

  it('置いたナレーションがあれば、その切れ目で Shot にする道を主ボタンにし、聴きながら切るを開く', async () => {
    const { value } = showWithout('mv', { lines: 3, ready: 2 })
    expect(screen.getByText(/置いたナレーションの切れ目で Shot にできます/)).toBeTruthy()
    expect(screen.queryByText(/曲を登録して解析すると/)).toBeNull()
    expect(isPrimary('ナレーションの切れ目で Shot にする')).toBe(true)
    expect(ENTRANCES.map(isPrimary)).toEqual([false, false, false])
    await userEvent.click(screen.getByRole('button', { name: 'ナレーションの切れ目で Shot にする' }))
    expect(value.openCutter).toHaveBeenCalledWith('cut')
  })
})
