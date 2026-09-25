import { describe, expect, it } from 'vitest'
import { fillEmptyEnvValue } from '../env-file.js'

/**
 * seed が作った Workspace の ID を `.env` の**空欄にだけ**書き込む。
 *
 * まっさらな clone で README どおりに進めると、seed は ID を 1 行出すだけで、
 * それをどこに書けばよいか分からなかった。書かないと一覧が「設定が不足しています」になる。
 * **人が入れた値は決して上書きしない。**
 */
describe('fillEmptyEnvValue', () => {
  it('空の行に値を入れる', () => {
    expect(fillEmptyEnvValue('A=1\nNEXT_PUBLIC_WORKSPACE_ID=\nB=2\n', 'NEXT_PUBLIC_WORKSPACE_ID', 'W1')).toBe(
      'A=1\nNEXT_PUBLIC_WORKSPACE_ID=W1\nB=2\n',
    )
  })

  it('値が入っていれば触らない（null を返す）', () => {
    expect(fillEmptyEnvValue('NEXT_PUBLIC_WORKSPACE_ID=W0\n', 'NEXT_PUBLIC_WORKSPACE_ID', 'W1')).toBeNull()
  })

  it('行が無ければ触らない（勝手に足さない）', () => {
    expect(fillEmptyEnvValue('A=1\n', 'NEXT_PUBLIC_WORKSPACE_ID', 'W1')).toBeNull()
  })

  it('コメントアウトされた行は空欄とみなさない', () => {
    expect(fillEmptyEnvValue('# NEXT_PUBLIC_WORKSPACE_ID=\n', 'NEXT_PUBLIC_WORKSPACE_ID', 'W1')).toBeNull()
  })

  it('名前が前方一致するだけの別の行には入れない', () => {
    expect(
      fillEmptyEnvValue('NEXT_PUBLIC_WORKSPACE_ID_OLD=\n', 'NEXT_PUBLIC_WORKSPACE_ID', 'W1'),
    ).toBeNull()
  })
})
