'use client'

import { LocationId, ShotCamera, type Shot } from '@ixa/domain'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ReviewPanel } from '@/components/review-panel'
import { ShotStatusBadge } from '@/components/shot-status-badge'
import { useAssets } from '@/components/workbench/asset-store'
import { FootageImportForm } from '@/components/workbench/inspector/footage-import-form'
import { ShotCastSection } from '@/components/workbench/inspector/shot-cast-section'
import { ShotGenerateSection } from '@/components/workbench/inspector/shot-generate-section'
import { StartFrameField } from '@/components/workbench/inspector/start-frame-field'
import { TakeTimingField } from '@/components/workbench/inspector/take-timing-field'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { AutoSaveCheckbox, AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import { MenuButton } from '@/components/workbench/ui/more-menu'
import { useShotMenu } from '@/components/workbench/use-shot-menu'
import { ObjectHeader } from '@/components/workbench/ui/object-header'
import { CollapsibleSection, Section } from '@/components/workbench/ui/section'
import { ShotStoryboardSection } from '@/components/workbench/inspector/shot-storyboard-section'
import { useShotTakes } from '@/components/workbench/use-shot-takes'
import { useWorkbench, type InspectorTab } from '@/components/workbench/workbench-context'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import {
  ANGLE_HORIZONTAL_OPTIONS,
  ANGLE_VERTICAL_OPTIONS,
  CAMERA_MOVEMENT_OPTIONS,
  MOVEMENT_INTENSITY_OPTIONS,
  NONE_VALUE,
  SHOT_SIZE_OPTIONS,
} from '@/lib/camera-options'
import { formatClock, formatDuration, formatSpan } from '@/lib/format-time'
import { isGeneratingStatus } from '@/lib/shot-display'
import { parseClockInput, parseDurationInput } from '@/lib/time-input'

/** 上の欄が読み込まれて背が伸びる間、頼まれた区切りへ送り直す時間。 */
const FOLLOW_SCROLL_MS = 2_000

/**
 * Shot のインスペクター（UI-WORKBENCH-2 §5.2）。**1 本のスクロール**（タブをやめた。生成とレビューが隠れて見つからなかった）。
 * 欄は確定で自動保存する。取り消せない削除は `⋯` の中。
 */
export const ShotInspector = ({
  shot,
  isFirst,
}: {
  readonly shot: Shot
  readonly isFirst: boolean
}) => {
  const workbench = useWorkbench()
  const shotMenu = useShotMenu()
  const save = async (patch: Parameters<typeof workbench.saveShot>[1]): Promise<void> => {
    await workbench.saveShot(shot.id, patch)
  }
  const generating = isGeneratingStatus(shot.status)
  /** 最初のフレームが付いているか（ADR-0025）。生成欄が押せるかの判定に渡す。 */
  const [hasStartFrame, setHasStartFrame] = useState(false)
  const sections = useRef<Partial<Record<InspectorTab, HTMLDivElement | null>>>({})

  /**
   * メニュー「生成」や「Take を作る」から来たら、その区切りまで送る（同じタブをもう一度頼まれても送り直す）。
   * 上の欄（案・絵・登場人物）は遅れて読み込まれて背が伸びるので、少しの間は伸びるたびに送り直す
   * （「Take を作る」を一番上に置いていた頃の理由。並びを作業の順に戻したので、ここで追いかける）。
   */
  const body = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const target = sections.current[workbench.inspectorTab]
    target?.scrollIntoView({ block: 'start' })
    const scroller = body.current
    const content = scroller?.firstElementChild
    // 一番上（絵コンテ）は伸びても位置が変わらないので追わない。
    if (workbench.inspectorTab === 'settings' || typeof ResizeObserver === 'undefined') return undefined
    if (target === null || target === undefined || scroller === null || content === null || content === undefined) {
      return undefined
    }
    const observer = new ResizeObserver(() => {
      target.scrollIntoView({ block: 'start' })
    })
    observer.observe(content)
    // **利用者が自分で動かしたら追わない**（欄が読み込まれて伸びるたびに引き戻されていた。レビューで見つけた）。
    const stop = (): void => {
      observer.disconnect()
    }
    const userMoves = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const
    userMoves.forEach((type) => {
      scroller.addEventListener(type, stop, { once: true, passive: true })
    })
    const timer = window.setTimeout(stop, FOLLOW_SCROLL_MS)
    return () => {
      window.clearTimeout(timer)
      userMoves.forEach((type) => {
        scroller.removeEventListener(type, stop)
      })
      observer.disconnect()
    }
  }, [workbench.inspectorTab, workbench.inspectorRequest, shot.id])

  return (
    <div className="flex h-full flex-col">
      <ObjectHeader
        kind="Shot"
        title={shot.code}
        meta={formatSpan(shot.startSec, shot.durationSec)}
        badge={<ShotStatusBadge status={shot.status} />}
        menu={
          // 右クリック（長押し）と同じ中身（2026-09-30）。再生位置で決まる行があるので押した瞬間に作る。
          <MenuButton
            label={`${shot.code} のその他の操作`}
            items={() => shotMenu.itemsFor(shot)}
          />
        }
      />
      <div ref={body} className="workbench-panel-body relative min-h-0 flex-1 overflow-auto">
        {/*
          作業の順に並べる（制作者 2026-10-03「Take 作成より先にやるべき画像生成を上のほうに持ってくるとか、順序に応じて
          並び替えたり整理したほうがいい」）: 絵コンテ → 参照 → 絵 → Take を作る → Take → 時間。普段触らないものは下に畳む。
        */}
        <div>
          <div
            ref={(element) => {
              sections.current.settings = element
            }}
          >
            <Section title="絵コンテ">
              <ShotStoryboardSection shot={shot} disabled={generating} />
            </Section>
          </div>

          <Section title="参照">
            <LocationField shot={shot} disabled={generating} onSave={save} />
            <ShotCastSection shot={shot} version={workbench.serverEpoch} />
          </Section>

          <Section title="絵">
            <StartFrameField
              shot={shot}
              workspaceId={workbench.project.workspaceId}
              disabled={generating}
              onChange={setHasStartFrame}
              // 付け外ししたら、サムネとプレビュー（Take が無い Shot は絵を映す）を読み直す。ドロップで付けたときと同じ。
              onSaved={workbench.refresh}
              // 絵ができたとき（出来事で posterEpoch が進む）にも読み直す。どちらも増えるだけなので和で足りる。
              version={workbench.serverEpoch + workbench.posterEpoch}
            />
          </Section>

          <div
            ref={(element) => {
              sections.current.generate = element
            }}
          >
            <Section title="Take を作る">
              <ShotGenerateSection shot={shot} hasStartFrame={hasStartFrame} />
            </Section>
          </div>

          <div
            ref={(element) => {
              sections.current.review = element
            }}
          >
            <TakeSection shot={shot} />
          </div>

          <Section title="時間">
            <AutoSaveField
              label="コード"
              value={shot.code}
              disabled={generating}
              validate={(next) => (next.trim() === '' ? 'コードを入れてください' : null)}
              onSave={(next) => save({ code: next.trim() })}
            />
            <AutoSaveField
              label="開始"
              value={formatClock(shot.startSec)}
              disabled={generating}
              validate={(next) =>
                parseClockInput(next) === null ? '0:12.34 か 12.34 の形で入れてください' : null
              }
              onSave={(next) => save({ startSec: parseClockInput(next) ?? shot.startSec })}
            />
            <AutoSaveField
              label="尺"
              value={formatDuration(shot.durationSec)}
              disabled={generating}
              validate={(next) =>
                parseDurationInput(next) === null
                  ? '1.50s のように 0 より大きい秒で入れてください'
                  : null
              }
              onSave={(next) => save({ durationSec: parseDurationInput(next) ?? shot.durationSec })}
            />
          </Section>

          <CollapsibleSection title="詳しい設定">
            <CameraFields shot={shot} disabled={generating} onSave={save} />
            <AutoSaveCheckbox
              label="前の Shot から画を繋ぐ"
              checked={!isFirst && shot.continuityMode === 'previous_shot'}
              disabled={isFirst || generating}
              hint={
                isFirst
                  ? '先頭の Shot には前のカットがありません。'
                  : '前の採用 Take の最終フレームを開始画像にします。境界で約 1 フレーム止まって見える場合があります。'
              }
              onSave={(next) => save({ continuityMode: next ? 'previous_shot' : 'independent' })}
            />
          </CollapsibleSection>

          <ReviewSection shot={shot} />
        </div>
      </div>
    </div>
  )
}

type SaveShot = (patch: Parameters<ReturnType<typeof useWorkbench>['saveShot']>[1]) => Promise<void>

/** カメラは 1 行ずつの選択に畳む（以前は 5 つの大きな欄）。選んだ時点で保存する。 */
const CameraFields = ({
  shot,
  disabled,
  onSave,
}: {
  readonly shot: Shot
  readonly disabled: boolean
  readonly onSave: SaveShot
}) => {
  const saveCamera = async (
    patch: Partial<Record<keyof Shot['camera'], string | null>>,
  ): Promise<void> => {
    await onSave({ camera: ShotCamera.parse({ ...shot.camera, ...patch }) })
  }
  const orNull = (value: string): string | null => (value === NONE_VALUE ? null : value)
  return (
    <>
      <AutoSaveSelect
        label="景別"
        value={shot.camera.size}
        options={SHOT_SIZE_OPTIONS}
        disabled={disabled}
        onSave={(next) => saveCamera({ size: next })}
      />
      <AutoSaveSelect
        label="向き"
        value={shot.camera.angleH ?? NONE_VALUE}
        options={ANGLE_HORIZONTAL_OPTIONS}
        disabled={disabled}
        onSave={(next) => saveCamera({ angleH: orNull(next) })}
      />
      <AutoSaveSelect
        label="高さ"
        value={shot.camera.angle ?? NONE_VALUE}
        options={ANGLE_VERTICAL_OPTIONS}
        disabled={disabled}
        onSave={(next) => saveCamera({ angle: orNull(next) })}
      />
      <AutoSaveSelect
        label="動き"
        value={shot.camera.movement ?? NONE_VALUE}
        options={CAMERA_MOVEMENT_OPTIONS}
        disabled={disabled}
        onSave={(next) => saveCamera({ movement: orNull(next) })}
      />
      <AutoSaveSelect
        label="動きの強さ"
        value={shot.camera.movementIntensity ?? NONE_VALUE}
        options={MOVEMENT_INTENSITY_OPTIONS}
        disabled={disabled}
        onSave={(next) => saveCamera({ movementIntensity: orNull(next) })}
      />
      <AutoSaveField
        label="レンズ"
        value={shot.camera.lensMm === null ? '' : `${String(shot.camera.lensMm)}mm`}
        placeholder="35mm"
        disabled={disabled}
        validate={(next) =>
          next.trim() === '' || /^\d+(\.\d+)?\s*(mm)?$/i.test(next.trim())
            ? null
            : '35mm のように入れてください'
        }
        onSave={async (next) => {
          const mm = next.trim() === '' ? null : Number.parseFloat(next)
          await onSave({ camera: ShotCamera.parse({ ...shot.camera, lensMm: mm }) })
        }}
      />
    </>
  )
}

/** ロケーション。選択肢は素材の共有状態から（ツリーで足したものがすぐ出る）。 */
const LocationField = ({
  shot,
  disabled,
  onSave,
}: {
  readonly shot: Shot
  readonly disabled: boolean
  readonly onSave: SaveShot
}) => {
  const { locations } = useAssets()
  const options = [
    { value: '', label: 'なし' },
    ...(locations.state === 'ready' ? locations.value : []).map((location) => ({
      value: location.id,
      label: location.name,
    })),
  ]
  return (
    <>
      <AutoSaveSelect
        label="ロケーション"
        value={shot.locationId ?? ''}
        options={options}
        disabled={disabled || locations.state !== 'ready'}
        onSave={(next) => onSave({ locationId: next === '' ? null : LocationId.parse(next) })}
      />
      {locations.state === 'error' && (
        <p role="alert" className="text-xs text-danger">
          {locations.message}
        </p>
      )}
    </>
  )
}

/**
 * Take の要約と、採用の外し方（PHASE 8 / ADR-0022）。比べるのは中央の Take 比較。
 * 手持ちの動画もここから Take にできる（ADR-0026）。
 */
const TakeSection = ({ shot }: { readonly shot: Shot }) => {
  const workbench = useWorkbench()
  const { takes, error } = useShotTakes(shot, workbench.posterEpoch)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const adopted = useMemo(
    () => takes?.find((take) => take.id === shot.selectedTakeId) ?? null,
    [takes, shot.selectedTakeId],
  )

  const unselect = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const updated = await createApiClient().unselectTake(shot.id)
      workbench.replaceShots([updated])
      workbench.refresh()
    } catch (cause) {
      setMessage(`採用を外せませんでした: ${describeForPerson(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title="Take"
      action={
        <Button
          size="sm"
          onClick={() => {
            workbench.focusPanel('compare')
          }}
        >
          比較を開く
        </Button>
      }
    >
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <p className="text-sm text-text">
        {takes === null
          ? '読み込んでいます…'
          : `${String(takes.length)} 本 / 採用: ${adopted === null ? 'なし' : `Take ${String(adopted.index)}`}`}
      </p>
      {adopted !== null && (
        <Button size="sm" disabled={busy} onClick={() => void unselect()}>
          {busy ? '外しています…' : '採用を外す'}
        </Button>
      )}
      {message !== null && (
        <p role="alert" className="text-xs text-danger">
          {message}
        </p>
      )}
      {/* 普段触らない操作（尺に合わせる・手持ちの動画を取り込む）は畳んでおく。 */}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted hover:text-text">尺に合わせる・動画を取り込む</summary>
        <div className="mt-1.5 space-y-1.5">
          <TakeTimingField
            shot={shot}
            adopted={adopted}
            disabled={isGeneratingStatus(shot.status)}
            onSave={async (timing) => {
              await workbench.saveShot(shot.id, { timing })
            }}
          />
          <FootageImportForm
            shot={shot}
            workspaceId={workbench.project.workspaceId}
            projectId={workbench.projectId}
            disabled={isGeneratingStatus(shot.status)}
            onImported={() => {
              workbench.refresh()
            }}
          />
        </div>
      </details>
    </Section>
  )
}

/** レビュー。採用中の Take に対して行う。 */
const ReviewSection = ({ shot }: { readonly shot: Shot }) => {
  const workbench = useWorkbench()
  const { takes } = useShotTakes(shot, workbench.posterEpoch)
  const selected = takes?.find((take) => take.id === shot.selectedTakeId) ?? null
  return (
    <CollapsibleSection title="レビュー">
      {selected === null ? (
        <p className="text-sm text-muted">
          採用している Take がありません。Take 比較で採用するとレビューできます。
        </p>
      ) : (
        <ReviewPanel
          shotId={shot.id}
          takeId={selected.id}
        />
      )}
    </CollapsibleSection>
  )
}
