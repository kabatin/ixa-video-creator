import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentPanel } from '@/components/environment-panel'

/**
 * 接続先の表示（A 案）。
 *
 * **鍵を入力させない。** API は無認証で全インターフェースに待ち受けているので、
 * 値を通す口を置くと同じ網にいる誰でも課金される鍵を差し替えられる。
 * ここが出すのは「設定されているか」と「貼る場所」まで。
 */

const body = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const aPayload = (overrides: Record<string, unknown> = {}) => ({
  secrets: [
    {
      label: 'fal.ai（映像生成）',
      envName: 'FAL_API_KEY',
      configured: false,
      length: null,
      purpose: '実際の映像生成に使う。',
    },
    {
      label: 'ストレージのアクセスキー',
      envName: 'S3_ACCESS_KEY_ID',
      configured: true,
      length: 20,
      purpose: '生成物の置き場。',
    },
  ],
  settings: [
    {
      label: '絵コンテの下書き',
      envName: 'STORYBOARD_DRAFTER',
      value: 'claude_cli',
      notable: true,
      note: 'Claude を実際に呼ぶ。契約の利用枠を使う。',
    },
  ],
  ...overrides,
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(body(aPayload())))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EnvironmentPanel', () => {
  it('設定済みと未設定を出す', async () => {
    render(<EnvironmentPanel />)
    await waitFor(() => {
      expect(screen.getByText('未設定')).toBeTruthy()
    })
    expect(screen.getByText(/設定済み（20 文字）/)).toBeTruthy()
  })

  /** 値を入力させる口を置かない。置いた瞬間に鍵が HTTP に乗る。 */
  it('鍵を入力する欄を置かない', async () => {
    render(<EnvironmentPanel />)
    await waitFor(() => {
      expect(screen.getByText('未設定')).toBeTruthy()
    })
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0)
  })

  it('未設定があれば、貼る行と再起動が要ることを出す', async () => {
    render(<EnvironmentPanel />)
    await waitFor(() => {
      expect(screen.getByText(/FAL_API_KEY=/)).toBeTruthy()
    })
    expect(screen.getByText(/再起動/)).toBeTruthy()
    // 設定済みのものは貼る行に出さない。
    expect(screen.queryByText(/S3_ACCESS_KEY_ID=$/)).toBeNull()
  })

  it('すべて設定済みなら貼る行を出さない', async () => {
    const all = aPayload({
      secrets: [
        {
          label: 'fal.ai（映像生成）',
          envName: 'FAL_API_KEY',
          configured: true,
          length: 30,
          purpose: '実際の映像生成に使う。',
        },
      ],
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(body(all)))

    render(<EnvironmentPanel />)
    await waitFor(() => {
      expect(screen.getByText(/設定済み（30 文字）/)).toBeTruthy()
    })
    expect(screen.queryByText(/再起動/)).toBeNull()
  })

  it('既定から外れた設定は目立たせる', async () => {
    render(<EnvironmentPanel />)
    await waitFor(() => {
      expect(screen.getByText('claude_cli')).toBeTruthy()
    })
    expect(screen.getByText('claude_cli').className).toContain('warn')
  })

  it('読めなかったら黙らない', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<EnvironmentPanel />)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
  })
})
