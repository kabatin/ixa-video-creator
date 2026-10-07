import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { InvalidStorageKeyError, assertValidStorageKey, isInsideRoot, resolveStoragePath } from '../storage-path.js'

const ROOT = '/tmp/ixa-storage-root'

describe('resolveStoragePath', () => {
  it('正しい key を根の下の絶対パスにする', () => {
    const resolved = resolveStoragePath(ROOT, 'media/01ABC/01DEF/original.mp4')

    expect(resolved).toBe(path.join(ROOT, 'media/01ABC/01DEF/original.mp4'))
  })

  it('根が相対パスなら受けない', () => {
    expect(() => resolveStoragePath('relative/root', 'a/b.mp4')).toThrow('絶対パス')
  })

  /**
   * **柵が素通りしないことを、違反を作って確かめる。**
   * ここは URL から来た key を受ける門なので、落ちないなら門が無いのと同じ。
   */
  it.each([
    { name: '親へ戻る', key: '../secret.mp4' },
    { name: '途中で親へ戻る', key: 'media/../../secret.mp4' },
    { name: '親だけ', key: '..' },
    { name: '絶対パス', key: '/etc/passwd' },
    { name: '空', key: '' },
    { name: '空の区切り', key: 'media//original.mp4' },
    { name: '末尾の区切り', key: 'media/01ABC/' },
    { name: '隠しファイル', key: 'media/.DS_Store' },
    { name: '逆向きの区切り', key: 'media\\..\\secret.mp4' },
    { name: '制御文字', key: 'media/orig\0.mp4' },
    { name: '空白入り', key: 'media/my file.mp4' },
    { name: '長すぎる区切り', key: `media/${'a'.repeat(256)}.mp4` },
    { name: '長すぎる key', key: `media/${'a/'.repeat(600)}x.mp4` },
  ])('$name の key は受けない（$key）', ({ key }) => {
    expect(() => resolveStoragePath(ROOT, key)).toThrow(InvalidStorageKeyError)
    expect(() => assertValidStorageKey(key)).toThrow(InvalidStorageKeyError)
  })

  it('受けなかった key はエラーの文には入れない（そのままログや画面へ出さない）', () => {
    try {
      resolveStoragePath(ROOT, '../etc/passwd')
      expect.unreachable('throw するはず')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStorageKeyError)
      expect((error as InvalidStorageKeyError).message).not.toContain('passwd')
      expect((error as InvalidStorageKeyError).key).toBe('../etc/passwd')
    }
  })
})

describe('isInsideRoot（2 重の柵。単体で確かめる）', () => {
  it('根の下は中', () => {
    expect(isInsideRoot('/a/b', '/a/b/c/d.mp4')).toBe(true)
  })

  it('根そのものは中ではない', () => {
    expect(isInsideRoot('/a/b', '/a/b')).toBe(false)
  })

  it('根の外は中ではない', () => {
    expect(isInsideRoot('/a/b', '/a/c/d.mp4')).toBe(false)
  })

  /** 名前の先頭が同じだけのフォルダを「中」と見ないこと。文字列の前方一致だけでは間違える。 */
  it('名前の先頭が同じ別のフォルダは中ではない', () => {
    expect(isInsideRoot('/a/b', '/a/bc/d.mp4')).toBe(false)
  })

  it('上へ戻る形は正規化してから見る', () => {
    expect(isInsideRoot('/a/b', '/a/b/../c.mp4')).toBe(false)
  })
})
