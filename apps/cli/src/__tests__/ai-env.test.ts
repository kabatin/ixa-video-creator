import { describe, expect, it } from 'vitest'
import { connectCodeChanges, validateInstallEnv } from '../ai/contract.js'
import { applyEnvChanges, mergeGeneratorList } from '../ai/env-merge.js'
import { setEnvValue } from '../lib/env-file.js'
import { parseCliArgs } from '../args.js'

const TOKEN = 'T'.repeat(43)
export const connectCode = (servers: readonly { id: string; url: string; token: string }[]): string =>
  Buffer.from(JSON.stringify({ v: 1, servers })).toString('base64url')

describe('mergeGeneratorList（LOCAL_*_GENERATOR を足し合わせる）', () => {
  it('none を外し、重ねず、今の順のまま後ろに足す', () => {
    expect(mergeGeneratorList('none', 'sfx_api')).toBe('sfx_api')
    expect(mergeGeneratorList('vpipe', 'wan,vpipe')).toBe('vpipe,wan')
    expect(mergeGeneratorList(' wan , vpipe ', 'vpipe')).toBe('wan,vpipe')
  })

  it('何も無ければ none（空にしない）', () => {
    expect(mergeGeneratorList('', '')).toBe('none')
    expect(mergeGeneratorList('none', 'none')).toBe('none')
  })
})

describe('setEnvValue', () => {
  it('最初の 1 行だけを替え、無ければ末尾に足す。値の $ はそのまま', () => {
    expect(setEnvValue('A=1\nB=2\nA=3\n', 'A', 'x')).toBe('A=x\nB=2\nA=3\n')
    expect(setEnvValue('A=1', 'B', '$&y')).toBe('A=1\nB=$&y\n')
    expect(setEnvValue('AB=1\n', 'A', '2')).toBe('AB=1\nA=2\n')
  })

  it('export 付き・前に空白のある行も同じ行として替える（行を重ねない）', () => {
    expect(setEnvValue('export A=1\n', 'A', 'x')).toBe('export A=x\n')
    expect(setEnvValue('  A = 1\n', 'A', 'x')).toBe('  A =x\n')
    expect(setEnvValue('# A=1\n', 'A', 'x')).toBe('# A=1\nA=x\n')
  })

  it('改行の入った値は書かない（.env に行を足されないための最後の守り。値は文に入れない）', () => {
    for (const value of ['http://x:8765/\nIXA_EVIL=1', 'a\rB=1']) {
      expect(() => setEnvValue('A=1\n', 'A', value)).toThrow('A の値に改行')
      expect(() => setEnvValue('', 'B', value)).toThrow('B の値に改行')
      try {
        setEnvValue('', 'B', value)
      } catch (error) {
        expect(String(error)).not.toContain('IXA_EVIL')
      }
    }
  })
})

describe('applyEnvChanges', () => {
  const base = 'LOCAL_SFX_GENERATOR=none\nSFX_API_URL=http://127.0.0.1:8769\nSFX_API_TOKEN=\nWHISPER_CPP_MODEL=\n'

  it('一覧を合わせ、既定の URL は値が入っていない扱いで替える', () => {
    const r = applyEnvChanges(base, { LOCAL_SFX_GENERATOR: 'sfx_api', SFX_API_URL: 'http://ai.local:8769', SFX_API_TOKEN: TOKEN }, false)
    expect(r.conflicts).toEqual([])
    expect(r.changed).toEqual(['LOCAL_SFX_GENERATOR', 'SFX_API_URL', 'SFX_API_TOKEN'])
    expect(r.content).toContain('LOCAL_SFX_GENERATOR=sfx_api\n')
    expect(r.content).toContain(`SFX_API_TOKEN=${TOKEN}\n`)
  })

  it('値の入った別の URL は替えず、対の合言葉も替えない（overwrite なら替える）', () => {
    const custom = base.replace('http://127.0.0.1:8769', 'http://old.local:8769')
    const changes = { SFX_API_URL: 'http://ai.local:8769', SFX_API_TOKEN: TOKEN }
    const kept = applyEnvChanges(custom, changes, false)
    expect(kept.conflicts).toEqual(['SFX_API_URL', 'SFX_API_TOKEN'])
    expect(kept.content).toBe(custom)
    expect(applyEnvChanges(custom, changes, true).changed).toEqual(['SFX_API_URL', 'SFX_API_TOKEN'])
  })

  it('export 付き・字下げの行は、その行を替える（同じ名前の行を末尾に重ねない）', () => {
    const r = applyEnvChanges('export LOCAL_SFX_GENERATOR=none\n  SFX_API_URL=http://127.0.0.1:8769\n', { LOCAL_SFX_GENERATOR: 'sfx_api', SFX_API_URL: 'http://ai.local:8769' }, false)
    expect(r.content).toBe('export LOCAL_SFX_GENERATOR=sfx_api\n  SFX_API_URL=http://ai.local:8769\n')
  })

  it('同じ値なら何もしない（何度回しても同じ）', () => {
    const once = applyEnvChanges(base, { LOCAL_SFX_GENERATOR: 'sfx_api', WHISPER_CPP_MODEL: '/m.bin' }, false).content
    const twice = applyEnvChanges(once, { LOCAL_SFX_GENERATOR: 'sfx_api', WHISPER_CPP_MODEL: '/m.bin' }, false)
    expect(twice.changed).toEqual([])
    expect(twice.content).toBe(once)
  })
})

describe('validateInstallEnv（ixa_ai.py の env を絞る）', () => {
  it('知っている名前と値だけを通す', () => {
    const env = { LOCAL_VIDEO_GENERATOR: 'vpipe,wan', VPIPE_API_URL: 'http://127.0.0.1:8765', WHISPER_CPP_MODEL: '/a/b.bin' }
    expect(validateInstallEnv(env)).toEqual(env)
  })

  it('合言葉・知らない値・崩れる値は止める（値は文に入れない）', () => {
    expect(() => validateInstallEnv({ SFX_API_TOKEN: TOKEN })).toThrow('SFX_API_TOKEN は ixa_ai.py が書いてよい名前ではありません')
    expect(() => validateInstallEnv({ LOCAL_IMAGE_GENERATOR: 'klein,dalle' })).toThrow('知らない値')
    expect(() => validateInstallEnv({ VPIPE_API_URL: 'http://a\nB=1' })).toThrow('形が違います')
    expect(() => validateInstallEnv({ VPIPE_API_URL: 'file:///etc' })).toThrow('URL ではありません')
    expect(() => validateInstallEnv({ WHISPER_CPP_MODEL: 'rel.bin' })).toThrow('絶対パス')
    try {
      validateInstallEnv({ SFX_API_TOKEN: TOKEN })
    } catch (error) {
      expect(String(error)).not.toContain(TOKEN)
    }
  })
})

describe('connectCodeChanges（接続コード）', () => {
  it('サーバーごとに一覧・URL・合言葉にする（ixa_ai.py と同じ base64url・= 無し）', () => {
    const code = connectCode([
      { id: 'vpipe-api', url: 'http://ai.local:8765', token: TOKEN },
      { id: 'wan-api', url: 'http://ai.local:8766', token: TOKEN },
    ])
    expect(code).not.toContain('=')
    expect(connectCodeChanges(code)).toEqual({
      LOCAL_VIDEO_GENERATOR: 'vpipe,wan',
      VPIPE_API_URL: 'http://ai.local:8765',
      VPIPE_API_TOKEN: TOKEN,
      WAN_API_URL: 'http://ai.local:8766',
      WAN_API_TOKEN: TOKEN,
    })
  })

  it('読めないコードは止め、文にコードも合言葉も入れない', () => {
    const bad = [
      'not-base64!',
      connectCode([{ id: 'evil-api', url: 'http://ai.local:1', token: TOKEN }]),
      connectCode([{ id: 'sfx-api', url: 'javascript:alert(1)', token: TOKEN }]),
      connectCode([{ id: 'sfx-api', url: 'http://ai.local:8769', token: `${TOKEN} x` }]),
      // new URL() は改行とタブを黙って落とすので、URL として読めても .env に行が増える。
      connectCode([{ id: 'sfx-api', url: 'http://ai.local:8769/\nIXA_EVIL=1', token: TOKEN }]),
      connectCode([{ id: 'sfx-api', url: 'http://ai.local:8769/\tx', token: TOKEN }]),
      Buffer.from(JSON.stringify({ v: 2, servers: [] })).toString('base64url'),
    ]
    for (const code of bad) {
      expect(() => connectCodeChanges(code)).toThrow('接続コードを読めません')
      try {
        connectCodeChanges(code)
      } catch (error) {
        expect(String(error)).not.toContain(TOKEN)
        expect(String(error)).not.toContain(code)
      }
    }
  })
})

describe('parseCliArgs（ai）', () => {
  it('install・connect・status と、そのオプション', () => {
    expect(parseCliArgs(['ai', 'install', '--plan', '--json'])).toMatchObject({ command: 'ai', action: 'install', plan: true })
    expect(parseCliArgs(['ai', 'install', '--models', 'h3,sa3-small', '--accept-licenses', 'h3', '--yes'])).toMatchObject({
      models: 'h3,sa3-small',
      acceptLicenses: 'h3',
      yes: true,
    })
    expect(parseCliArgs(['ai', 'connect', 'abc'])).toMatchObject({ action: 'connect', code: 'abc' })
    expect(parseCliArgs(['ai', 'status']).action).toBe('status')
  })

  it('ai connect は接続コードを省ける（端末で画面に出さずに聞くか、stdin から読む）', () => {
    expect(parseCliArgs(['ai', 'connect'])).toMatchObject({ action: 'connect', code: undefined })
  })

  it('余分な語・知らないコマンドの文に、打った語を写さない（接続コードを ai 抜きで貼ることがある）', () => {
    const SECRET = connectCode([{ id: 'sfx-api', url: 'http://ai.local:8769', token: TOKEN }])
    const cases: readonly (readonly string[])[] = [
      ['connect', SECRET],
      [SECRET],
      ['doctor', SECRET],
      ['ai', 'connect', SECRET, 'extra'],
      ['ai', 'status', SECRET],
      ['infra', 'up', SECRET],
    ]
    for (const argv of cases) {
      expect(() => parseCliArgs(argv)).toThrow()
      try {
        parseCliArgs(argv)
      } catch (error) {
        expect(String(error)).not.toContain(SECRET)
        expect(String(error)).not.toContain(TOKEN)
      }
    }
    expect(() => parseCliArgs(['doctor', SECRET])).toThrow('2 つあります')
  })

  it('形の違うものは止める（接続コードは文に入れない）', () => {
    expect(() => parseCliArgs(['ai'])).toThrow('install・connect・status')
    expect(() => parseCliArgs(['ai', 'status', 'x'])).toThrow('余分')
    expect(() => parseCliArgs(['ai', 'install', '--models', 'h3;rm'])).toThrow('カンマ区切り')
    expect(() => parseCliArgs(['ai', 'install', '--lan'])).toThrow('別の Mac')
    expect(() => parseCliArgs(['ai', 'connect', 'SECRETCODE', 'extra'])).toThrow(/^(?!.*SECRETCODE)/)
  })
})
