import { describe, expect, it } from 'vitest'
import { ShotId } from '../common/ids.js'
import {
  RENDER_PRESET_LABELS,
  renderExportFileName,
  renderExportFolderName,
} from '../render/render-export-name.js'

/**
 * 書き出した動画を手元のフォルダに置くときの名前（ADR-0036。制作者 2026-10-03「書き出し画面で生成された動画が
 * あるフォルダを開く導線が欲しい」）。Finder で見て中身が分かり、フォルダの外へ出ない名前にする。
 */

const CREATED_AT = new Date('2026-10-02T13:52:31.400Z')

describe('renderExportFolderName', () => {
  it('プロジェクト名をそのまま使う', () => {
    expect(renderExportFolderName('ぼくははると')).toBe('ぼくははると')
  })

  it('Finder で使えない文字と制御文字は _ にする', () => {
    expect(renderExportFolderName('MV: 1/2\\3\u0000')).toBe('MV_ 1_2_3_')
  })

  it('両端の空白と点を落とす。`..` だけの名前はフォルダの外を指せない', () => {
    expect(renderExportFolderName('  .hidden.  ')).toBe('hidden')
    expect(renderExportFolderName('..')).toBe('プロジェクト')
    expect(renderExportFolderName('../../etc')).toBe('_.._etc')
  })

  /** `v2.app` のような名前だと、Finder はフォルダをアプリの束として扱い、`open` はアプリを起動しようとする。 */
  it('拡張子に見える終わりは . を _ にする（Finder にアプリや書類の束と見なされない）', () => {
    expect(renderExportFolderName('v2.app')).toBe('v2_app')
    expect(renderExportFolderName('Demo.key')).toBe('Demo_key')
    expect(renderExportFolderName('ぼくははると')).toBe('ぼくははると')
  })

  it('空なら「プロジェクト」。長すぎる名前は 80 字で切る', () => {
    expect(renderExportFolderName('   ')).toBe('プロジェクト')
    expect(renderExportFolderName('あ'.repeat(200))).toHaveLength(80)
  })
})

describe('renderExportFileName', () => {
  const base = {
    projectName: 'ぼくははると',
    createdAt: CREATED_AT,
    preset: 'preview_720p' as const,
    timeZone: 'Asia/Tokyo',
  }

  it('全体は「名前 日時 画質.mp4」。日時は指定した地域の時刻', () => {
    expect(renderExportFileName({ ...base, scope: { type: 'full' } })).toBe(
      'ぼくははると 2026-10-02 22.52.31 プレビュー（720p）.mp4',
    )
  })

  it('時差が違えば日時も変わる（世界協定時）', () => {
    expect(renderExportFileName({ ...base, timeZone: 'UTC', scope: { type: 'full' } })).toBe(
      'ぼくははると 2026-10-02 13.52.31 プレビュー（720p）.mp4',
    )
  })

  it('一部だけなら範囲を分と秒で添える（Finder で使えない : を使わない）', () => {
    expect(renderExportFileName({ ...base, scope: { type: 'range', start: 0, end: 51.17 } })).toBe(
      'ぼくははると 2026-10-02 22.52.31 プレビュー（720p） 0分00秒〜0分51秒.mp4',
    )
    expect(renderExportFileName({ ...base, scope: { type: 'range', start: 65.5, end: 250.92 } })).toMatch(
      / 1分05秒〜4分10秒\.mp4$/,
    )
  })

  it('Shot 1 本だけなら「Shot 1 本」と添える', () => {
    const scope = { type: 'shot' as const, shotId: ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV') }
    expect(renderExportFileName({ ...base, scope })).toMatch(/ Shot 1 本\.mp4$/)
  })

  it('プロジェクト名の使えない文字はファイル名でも _ にする', () => {
    expect(renderExportFileName({ ...base, projectName: 'a/b', scope: { type: 'full' } })).not.toContain('/')
  })

  it('画質の名前は 1 箇所（画面と同じ）', () => {
    expect(RENDER_PRESET_LABELS.master_4k).toBe('マスター（4K）')
    expect(renderExportFileName({ ...base, preset: 'social_vertical', scope: { type: 'full' } })).toContain(
      RENDER_PRESET_LABELS.social_vertical,
    )
  })
})
