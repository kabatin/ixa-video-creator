import { describe, expect, it } from 'vitest'
import {
  ASSET_FOLDER_NAME,
  startFrameExportFileName,
  takeExportFileName,
} from '../asset/asset-export-name.js'

/**
 * 素材を手元のフォルダから開けるようにするときの名前（ADR-0041）。
 * **フォルダの外を指せないこと**と、Finder で中身が分かることを押さえる。
 */

describe('takeExportFileName', () => {
  it('Shot のコードと Take の番号で名前にする', () => {
    expect(
      takeExportFileName({ shotCode: 'CUT-01', takeIndex: 2, selected: false, extension: 'mp4' }),
    ).toBe('CUT-01 Take 2.mp4')
  })

  /** 本編に入っている方が Finder で分かるようにする。 */
  it('採用されている Take には印を付ける', () => {
    expect(
      takeExportFileName({ shotCode: 'CUT-01', takeIndex: 3, selected: true, extension: 'mp4' }),
    ).toBe('CUT-01 Take 3 採用.mp4')
  })

  it.each([
    { name: '区切り', shotCode: 'CUT/01', expected: 'CUT_01 Take 1.mp4' },
    { name: '親へ戻る', shotCode: '..', expected: 'Shot Take 1.mp4' },
    { name: 'Finder が / に見せる記号', shotCode: 'CUT:01', expected: 'CUT_01 Take 1.mp4' },
    { name: '空', shotCode: '', expected: 'Shot Take 1.mp4' },
    { name: '前後の空白と点', shotCode: '  .CUT-01. ', expected: 'CUT-01 Take 1.mp4' },
  ])('$name を含む Shot のコードでもフォルダの外を指さない（$shotCode）', ({ shotCode, expected }) => {
    expect(takeExportFileName({ shotCode, takeIndex: 1, selected: false, extension: 'mp4' })).toBe(
      expected,
    )
  })

  it.each([
    { name: '区切り入り', extension: 'mp4/../x', expected: 'bin' },
    { name: '空', extension: '', expected: 'bin' },
    { name: '点付き', extension: '.mp4', expected: 'bin' },
    { name: '大文字', extension: 'MP4', expected: 'mp4' },
  ])('拡張子は英数字だけ受ける（$name）', ({ extension, expected }) => {
    expect(takeExportFileName({ shotCode: 'CUT-01', takeIndex: 1, selected: false, extension })).toBe(
      `CUT-01 Take 1.${expected}`,
    )
  })

  it('番号は整数で書く', () => {
    expect(
      takeExportFileName({ shotCode: 'CUT-01', takeIndex: 2.7, selected: false, extension: 'mp4' }),
    ).toBe('CUT-01 Take 2.mp4')
  })
})

describe('startFrameExportFileName', () => {
  it('画面と同じ言葉で名前にする', () => {
    expect(startFrameExportFileName('CUT-02', 'png')).toBe('CUT-02 最初のフレーム.png')
  })

  it('Shot のコードが危ない形でもフォルダの外を指さない', () => {
    // `/` は `_` にし、頭の点は落とす（`..` のまま残さない）。
    expect(startFrameExportFileName('../secret', 'png')).toBe('_secret 最初のフレーム.png')
  })
})

describe('ASSET_FOLDER_NAME', () => {
  it('画面の言葉と同じ', () => {
    expect(ASSET_FOLDER_NAME).toBe('素材')
  })
})
