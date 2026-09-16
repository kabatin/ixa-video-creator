import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * 描画テストの後始末。
 * **テスト間で DOM を持ち越さない。** 持ち越すと、前のテストが残した要素を
 * 掴んでしまい「通っているのに何も確かめていない」状態になる。
 */
afterEach(() => {
  cleanup()
})
