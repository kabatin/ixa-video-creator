'use client'

import Link from 'next/link'
import { useAssist } from '@/components/workbench/use-assist'
import {
  BrandCategory,
  type BrandAssetId,
  type CharacterId,
  type CharacterLookId,
  type LocationId,
  type MusicTrackId,
} from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { readyOr, useAssets } from '@/components/workbench/asset-store'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { AutoSaveCheckbox, AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import { MenuButton } from '@/components/workbench/ui/more-menu'
import { useAssetMenu } from '@/components/workbench/use-asset-menu'
import { ObjectHeader } from '@/components/workbench/ui/object-header'
import { Section } from '@/components/workbench/ui/section'
import { characterDetailHref } from '@/lib/character-links'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty } from '@/components/workbench/panels/panel-frame'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { formatDuration } from '@/lib/format-time'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { summarizeAnalysis } from '@/lib/music-upload'
import { parseClockInput } from '@/lib/time-input'

/**
 * 素材のインスペクター（UI-WORKBENCH-2 §5.3）。**旧ページのフォームは使わず、同じ API を新しい部品から呼ぶ。**
 * 保存は確定時の自動保存。消す操作は `⋯` の中。
 */

/** `a, b, c` ⇔ 配列。識別アンカーなどのタグ列を 1 行で直す。 */
const joinTags = (values: readonly string[]): string => values.join(', ')
const splitTags = (text: string): string[] =>
  text
    .split(/[,、\n]/)
    .map((value) => value.trim())
    .filter((value) => value !== '')

const Body = ({ children }: { readonly children: React.ReactNode }) => (
  <div className="workbench-panel-body relative min-h-0 flex-1 overflow-auto">{children}</div>
)

const Frame = ({
  header,
  children,
}: {
  readonly header: React.ReactNode
  readonly children: React.ReactNode
}) => (
  <div className="flex h-full flex-col">
    {header}
    <Body>{children}</Body>
  </div>
)

const Missing = ({ what }: { readonly what: string }) => (
  <PanelEmpty title={`この${what}は見つかりません`} hint="消されたか、まだ読み込めていません。" />
)

// --- キャラクター ---

export const CharacterInspector = ({ id }: { readonly id: CharacterId }) => {
  const assetMenu = useAssetMenu()
  const assistFor = useAssist()
  const workbench = useWorkbench()
  const { characters, looks, actions } = useAssets()
  const character = readyOr(characters).find((item) => item.id === id)
  if (character === undefined) return <Missing what="キャラクター" />
  const save = async (patch: Parameters<typeof actions.updateCharacter>[1]): Promise<void> => {
    await actions.updateCharacter(id, patch)
  }
  return (
    <Frame
      header={
        <ObjectHeader
          kind="キャラクター"
          title={character.displayName}
          menu={
            <MenuButton
              label={`${character.displayName} のその他の操作`}
              items={assetMenu.itemsFor({ kind: 'character', id }, 'inspector') ?? []}
            />
          }
        />
      }
    >
      <Section title="同一性">
        <AutoSaveField
          label="表示名"
          value={character.displayName}
          validate={(next) => (next.trim() === '' ? '表示名を入れてください' : null)}
          onSave={(next) => save({ displayName: next.trim() })}
        />
        <AutoSaveField
          label="名前（英数）"
          value={character.name}
          onSave={(next) => save({ name: next.trim() })}
        />
        <AutoSaveField
          label="説明"
          multiline
          value={character.description}
          onSave={(next) => save({ description: next })}
        />
        <AutoSaveField
          label="識別アンカー"
          value={joinTags(character.identityAnchors)}
          placeholder="細身, 切れ長の鋭い目"
          onSave={(next) => save({ identityAnchors: splitTags(next) })}
          assist={assistFor('identity_anchors', { characterId: id })}
        />
        <p className="text-xs text-muted">
          Look で変わらない特徴だけを入れる。衣装や髪色は Look へ。
        </p>
        {/* 識別画像と Look をまとめて直す画面（キャラクターの一覧は無くなったので、ここから行く。ADR-0034）。 */}
        <Link href={characterDetailHref(id)} className="text-xs text-muted underline hover:text-text">
          識別画像と Look を詳しく編集…
        </Link>
      </Section>
      <Section title={`Look（${String((looks.get(id) ?? []).length)}）`}>
        {(looks.get(id) ?? []).map((look) => (
          <button
            key={look.id}
            type="button"
            onClick={() => {
              workbench.inspect({ kind: 'look', id: look.id, characterId: id })
            }}
            className="flex h-6 w-full items-center gap-2 rounded px-1 text-left text-sm text-text hover:bg-surface-2"
          >
            <span className="flex-1 truncate">{look.name}</span>
            {look.isDefault && <span className="text-xs text-muted">既定</span>}
          </button>
        ))}
        <p className="text-xs text-muted">
          Look を足すのはツリーの「＋ Look を追加」から。画像は中央の素材ビューアへ落とします。
        </p>
      </Section>
    </Frame>
  )
}

// --- Look ---

export const LookInspector = ({
  id,
  characterId,
}: {
  readonly id: CharacterLookId
  readonly characterId: CharacterId
}) => {
  const assetMenu = useAssetMenu()
  const assistFor = useAssist()
  const { looks, actions } = useAssets()
  const look = (looks.get(characterId) ?? []).find((item) => item.id === id)
  if (look === undefined) return <Missing what="Look" />
  const save = async (patch: Parameters<typeof actions.updateLook>[1]): Promise<void> => {
    await actions.updateLook(id, patch)
  }
  return (
    <Frame
      header={
        <ObjectHeader
          kind="Look"
          title={look.name}
          meta={look.key}
          menu={
            <MenuButton
              label={`${look.name} のその他の操作`}
              items={assetMenu.itemsFor({ kind: 'look', id, characterId }, 'inspector') ?? []}
            />
          }
        />
      }
    >
      <Section title="外見">
        <AutoSaveField
          label="名前"
          value={look.name}
          validate={(next) => (next.trim() === '' ? '名前を入れてください' : null)}
          onSave={(next) => save({ name: next.trim() })}
        />
        <AutoSaveField
          label="時代"
          value={look.era ?? ''}
          onSave={(next) => save({ era: next.trim() === '' ? null : next })}
        />
        <AutoSaveField
          label="説明"
          multiline
          value={look.description}
          onSave={(next) => save({ description: next })}
        />
        <AutoSaveField
          label="衣装"
          value={joinTags(look.wardrobeTokens)}
          onSave={(next) => save({ wardrobeTokens: splitTags(next) })}
          assist={assistFor('wardrobe', { lookId: id })}
        />
        <AutoSaveCheckbox
          label="このキャラクターの既定の Look にする"
          checked={look.isDefault}
          disabled={look.isDefault}
          hint="登場人物に足したとき、最初に選ばれる Look です。"
          onSave={(next) => save({ isDefault: next })}
        />
      </Section>
    </Frame>
  )
}

// --- ロケーション ---

export const LocationInspector = ({ id }: { readonly id: LocationId }) => {
  const assetMenu = useAssetMenu()
  const assistFor = useAssist()
  const { locations, actions } = useAssets()
  const location = readyOr(locations).find((item) => item.id === id)
  if (location === undefined) return <Missing what="ロケーション" />
  return (
    <Frame
      header={
        <ObjectHeader
          kind="ロケーション"
          title={location.name}
          meta={`参照 ${String(location.referenceAssetIds.length)} 枚`}
          menu={
            <MenuButton
              label={`${location.name} のその他の操作`}
              items={assetMenu.itemsFor({ kind: 'location', id }, 'inspector') ?? []}
            />
          }
        />
      }
    >
      <Section title="場所">
        <AutoSaveField
          label="名前"
          value={location.name}
          validate={(next) => (next.trim() === '' ? '名前を入れてください' : null)}
          onSave={async (next) => {
            await actions.updateLocation(id, { name: next.trim() })
          }}
        />
        <AutoSaveField
          label="説明"
          multiline
          value={location.description}
          onSave={async (next) => {
            await actions.updateLocation(id, { description: next })
          }}
          assist={assistFor('location_description', { locationId: id })}
        />
        <p className="text-xs text-muted">
          参照画像は中央の素材ビューアへ落とすと足せます。Shot の生成に渡ります。
        </p>
      </Section>
    </Frame>
  )
}

// --- ブランド資産 ---

const CATEGORY_LABELS: Readonly<Record<BrandCategory, string>> = {
  logo: 'ロゴ',
  color: '色',
  font: 'フォント',
  uniform: 'ユニフォーム',
  typography: '文字組み',
  texture: 'テクスチャ',
  other: 'その他',
}

export const BrandAssetInspector = ({ id }: { readonly id: BrandAssetId }) => {
  const assetMenu = useAssetMenu()
  const { brandAssets, actions } = useAssets()
  const asset = readyOr(brandAssets).find((item) => item.id === id)
  if (asset === undefined) return <Missing what="ブランド資産" />
  const save = async (patch: Parameters<typeof actions.updateBrandAsset>[1]): Promise<void> => {
    await actions.updateBrandAsset(id, patch)
  }
  return (
    <Frame
      header={
        <ObjectHeader
          kind="ブランド資産"
          title={asset.name}
          menu={
            <MenuButton
              label={`${asset.name} のその他の操作`}
              items={assetMenu.itemsFor({ kind: 'brand-asset', id }, 'inspector') ?? []}
            />
          }
        />
      }
    >
      <Section title="資産">
        <AutoSaveField
          label="名前"
          value={asset.name}
          validate={(next) => (next.trim() === '' ? '名前を入れてください' : null)}
          onSave={(next) => save({ name: next.trim() })}
        />
        <AutoSaveSelect
          label="種類"
          value={asset.category}
          options={BrandCategory.options.map((value) => ({ value, label: CATEGORY_LABELS[value] }))}
          onSave={(next) => save({ category: BrandCategory.parse(next) })}
        />
        <AutoSaveField
          label="値"
          value={asset.value ?? ''}
          placeholder={asset.category === 'color' ? '#FFD200' : ''}
          validate={(next) =>
            asset.category === 'color' && next.trim() !== '' && !/^#[0-9a-f]{6}$/i.test(next.trim())
              ? '色は #FFD200 の形で入れてください'
              : null
          }
          onSave={(next) => save({ value: next.trim() === '' ? null : next.trim().toUpperCase() })}
        />
        <AutoSaveField
          label="使い方の決まり"
          multiline
          value={asset.usageRule}
          placeholder="ロゴの周りに 1/4 の余白を取る"
          onSave={(next) => save({ usageRule: next })}
        />
        <p className="text-xs text-muted">
          画像（ロゴなど）は中央の素材ビューアへ落とすと入ります。レビューが照合に使います。
        </p>
      </Section>
    </Frame>
  )
}

// --- 楽曲 ---

export const TrackInspector = ({ id }: { readonly id: MusicTrackId }) => {
  const assetMenu = useAssetMenu()
  const { tracks, actions } = useAssets()
  const track = readyOr(tracks).find((item) => item.id === id)
  const api = useMemo(() => createApiClient(), [])
  const [analysis, setAnalysis] = useState<WireMusicAnalysis | null | 'loading'>('loading')
  const [status, setStatus] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0)
  // サーバを読み直したら（解析が終わって画面が取り直された後など）読み直す。開いたときの 1 回だけだと、
  // 解析が終わっても「まだ解析されていません」のままだった。
  const { serverEpoch, analysis: masterAnalysis } = useWorkbench()

  useEffect(() => {
    let cancelled = false
    api
      .getAnalysis(id)
      .then((loaded) => {
        if (!cancelled) setAnalysis(loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setAnalysis(null)
          setStatus(`解析を読めません: ${describeForPerson(cause)}`)
        }
      })
    return () => {
      cancelled = true
    }
  }, [api, id, epoch, serverEpoch])

  if (track === undefined) return <Missing what="楽曲" />
  const summary = analysis === null || analysis === 'loading' ? null : summarizeAnalysis(analysis)
  const run = (label: string, action: () => Promise<void>): void => {
    setStatus(`${label}しています…`)
    action()
      .then(() => {
        setStatus(`${label}しました。`)
      })
      .catch((cause: unknown) => {
        setStatus(`${label}できませんでした: ${describeForPerson(cause)}`)
      })
  }

  return (
    <Frame
      header={
        <ObjectHeader
          kind="楽曲"
          title={track.title}
          badge={track.isMaster ? <span className="text-xs text-accent">マスター</span> : undefined}
          menu={
            <MenuButton
              label={`${track.title} のその他の操作`}
              items={assetMenu.itemsFor({ kind: 'track', id }, 'inspector') ?? []}
            />
          }
        />
      }
    >
      <Section title="楽曲">
        <AutoSaveField
          label="題名"
          value={track.title}
          validate={(next) => (next.trim() === '' ? '題名を入れてください' : null)}
          onSave={async (next) => {
            await actions.updateTrack(id, { title: next.trim() })
          }}
        />
        <AutoSaveField
          label="開始位置"
          value={String(track.offsetSec)}
          validate={(next) =>
            parseClockInput(next) === null ? '0 以上の秒で入れてください' : null
          }
          onSave={async (next) => {
            await actions.updateTrack(id, { offsetSec: parseClockInput(next) ?? track.offsetSec })
          }}
        />
        <AutoSaveField
          label="音量"
          value={`${String(Math.round(track.volume * 100))}%`}
          validate={(next) => {
            const value = Number.parseFloat(next)
            return Number.isFinite(value) && value >= 0 && value <= 200
              ? null
              : '0〜200% で入れてください'
          }}
          onSave={async (next) => {
            await actions.updateTrack(id, { volume: Number.parseFloat(next) / 100 })
          }}
        />
        {track.isMaster ? (
          <p className="text-xs text-muted">この曲が Project の尺・拍・吸着の基準です。</p>
        ) : (
          <Button size="sm" onClick={() => run('マスターに', () => actions.setMasterTrack(id))}>
            この曲をマスターにする
          </Button>
        )}
      </Section>
      <Section
        title="解析"
        action={
          <Button
            size="sm"
            onClick={() =>
              run('再解析を依頼', async () => {
                await actions.analyzeTrack(id)
                setEpoch((current) => current + 1)
              })
            }
          >
            再解析
          </Button>
        }
      >
        {analysis === 'loading' && <p className="text-sm text-muted">読み込んでいます…</p>}
        {analysis === null &&
          (track.isMaster && masterAnalysis === null ? (
            // マスターの曲は、登録した直後から解析が自動で走る（聴きながら切るのパネルが待っている）。
            <p className="text-sm text-muted">解析しています（数十秒）。終わるとここに出ます。</p>
          ) : (
            <p className="text-sm text-muted">まだ解析されていません。「再解析」で始めます。</p>
          ))}
        {summary !== null && analysis !== null && analysis !== 'loading' && (
          <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
            <dt className="text-muted">解析器</dt>
            <dd>{analysis.analyzerVersion}</dd>
            <dt className="text-muted">尺</dt>
            <dd className="tabular-nums">{formatDuration(analysis.durationSec)}</dd>
            <dt className="text-muted">BPM</dt>
            <dd className="tabular-nums">
              {analysis.bpm.toFixed(1)}
              {summary.lowConfidence && (
                <span className="ml-2 text-xs text-warn">
                  信頼度が低い（{analysis.bpmConfidence.toFixed(2)}）
                </span>
              )}
            </dd>
            <dt className="text-muted">拍 / 小節</dt>
            <dd className="tabular-nums">{`${String(analysis.beats.length)} / ${String(analysis.downbeats.length)}`}</dd>
            <dt className="text-muted">ドロップ</dt>
            <dd className="tabular-nums">{String(analysis.drops.length)}</dd>
          </dl>
        )}
      </Section>
      {status !== null && (
        <p role="status" className="px-1 text-xs text-muted">
          {status}
        </p>
      )}
    </Frame>
  )
}
