import { expect, it } from 'vitest'
import { ObjectNotFoundError, type ObjectStorage } from '../port.js'

/**
 * `ObjectStorage` の実装が守るべき約束。**memory と fs の両方を同じ試験にかける**。
 *
 * 片方だけを試験していると、差し替えたときに初めて違いが出る（ADR-0041 の切り替えは
 * この約束の上に乗っている）。`describe` の中から呼ぶ。
 *
 * contentType は実装によって出どころが違う（memory は put で渡したもの、fs は拡張子）。
 * **拡張子と一致する contentType を使う**ことで、同じ試験で両方を確かめられる。
 */
export const itObeysObjectStorageContract = (createStorage: () => Promise<ObjectStorage>): void => {
  const KEY = 'media/01ABC/01DEF/original.txt'
  const TEXT_PLAIN = 'text/plain'
  const body = (text: string): Uint8Array => new TextEncoder().encode(text)

  it('put したものを get で取り戻せる', async () => {
    const storage = await createStorage()
    await storage.put(KEY, body('hello'), { contentType: TEXT_PLAIN })

    expect(await storage.get(KEY)).toEqual(body('hello'))
  })

  it('head は大きさ・型・更新時刻を返す', async () => {
    const storage = await createStorage()
    await storage.put(KEY, body('hello world'), { contentType: TEXT_PLAIN })

    const head = await storage.head(KEY)

    expect(head?.key).toBe(KEY)
    expect(head?.bytes).toBe(11)
    expect(head?.contentType).toBe(TEXT_PLAIN)
    expect(head?.lastModified).toBeInstanceOf(Date)
  })

  it('exists は put の前が false、後が true', async () => {
    const storage = await createStorage()

    expect(await storage.exists(KEY)).toBe(false)
    await storage.put(KEY, body('x'), { contentType: TEXT_PLAIN })
    expect(await storage.exists(KEY)).toBe(true)
  })

  it('同じ key に put し直すと後のものが読める', async () => {
    const storage = await createStorage()
    await storage.put(KEY, body('first'), { contentType: TEXT_PLAIN })
    await storage.put(KEY, body('second'), { contentType: TEXT_PLAIN })

    expect(await storage.get(KEY)).toEqual(body('second'))
  })

  it('delete したものは get できない', async () => {
    const storage = await createStorage()
    await storage.put(KEY, body('x'), { contentType: TEXT_PLAIN })

    await storage.delete(KEY)

    expect(await storage.exists(KEY)).toBe(false)
    await expect(storage.get(KEY)).rejects.toThrow(ObjectNotFoundError)
  })

  it('無いものを delete しても失敗しない', async () => {
    const storage = await createStorage()
    await expect(storage.delete(KEY)).resolves.toBeUndefined()
  })

  it('無いものの head は null（throw しない）', async () => {
    const storage = await createStorage()
    expect(await storage.head(KEY)).toBeNull()
  })

  it('無いものの get は ObjectNotFoundError', async () => {
    const storage = await createStorage()
    await expect(storage.get(KEY)).rejects.toThrow(ObjectNotFoundError)
  })
}
