'use client'

import { LocationId, ShotCamera, type Shot } from '@ixa/domain'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ReviewPanel } from '@/components/review-panel'
import { ShotStatusBadge } from '@/components/shot-status-badge'
import { useAssets } from '@/components/workbench/asset-store'
import { ShotCastSection } from '@/components/workbench/inspector/shot-cast-section'
import { ShotGenerateSection } from '@/components/workbench/inspector/shot-generate-section'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { AutoSaveCheckbox, AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import { MoreMenu } from '@/components/workbench/ui/more-menu'
import { ObjectHeader } from '@/components/workbench/ui/object-header'
import { Section } from '@/components/workbench/ui/section'
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
  const save = async (patch: Parameters<typeof workbench.saveShot>[1]): Promise<void> => {
    await workbench.saveShot(shot.id, patch)
  }
  const generating = isGeneratingStatus(shot.status)
  const sections = useRef<Partial<Record<InspectorTab, HTMLDivElement | null>>>({})

  // メニュー「生成」などから来たら、その区切りまで送る。
  useEffect(() => {
    sections.current[workbench.inspectorTab]?.scrollIntoView({ block: 'start' })
  }, [workbench.inspectorTab, shot.id])

  return (
    <div className="flex h-full flex-col">
      <ObjectHeader
        kind="Shot"
        title={shot.code}
        meta={formatSpan(shot.startSec, shot.durationSec)}
        badge={<ShotStatusBadge status={shot.status} />}
        menu={
          <MoreMenu
            label={`${shot.code} のその他の操作`}
            items={[
              {
                label: 'Shot を削除',
                confirm: `Shot ${shot.code} ${formatSpan(shot.startSec, shot.durationSec)} を削除します。Take は残りますが、この Shot は一覧から消えます。`,
                run: async () => {
                  await createApiClient().deleteShot(shot.id)
                  workbench.refresh()
                },
              },
            ]}
          />
        }
      />
      <div className="workbench-panel-body min-h-0 flex-1 overflow-auto">
        <div
          ref={(element) => {
            sections.current.settings = element
          }}
        >
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
          </Section>

          <Section title="画">
            <AutoSaveField
              label="説明"
              multiline
              value={shot.description}
              placeholder="夜のスタジアム。主人公がボールを追う。"
              onSave={(next) => save({ description: next })}
            />
            <AutoSaveField
              label="mood"
              value={shot.mood ?? ''}
              placeholder="tense, cinematic"
              // 空欄は「未設定」。空文字を保存すると「空という指定」と区別できなくなる。
              onSave={(next) => save({ mood: next.trim() === '' ? null : next })}
            />
            <CameraFields shot={shot} disabled={generating} onSave={save} />
          </Section>

          <Section title="参照">
            <LocationField shot={shot} disabled={generating} onSave={save} />
            <ShotCastSection shot={shot} version={workbench.serverEpoch} />
          </Section>
        </div>

        <div
          ref={(element) => {
            sections.current.review = element
          }}
        >
          <TakeSection shot={shot} />
        </div>

        <div
          ref={(element) => {
            sections.current.generate = element
          }}
        >
          <Section title="生成">
            <ShotGenerateSection shot={shot} />
          </Section>
        </div>

        <ReviewSection shot={shot} />
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

/** Take の要約と、採用の外し方（PHASE 8 / ADR-0022）。比べるのは中央の Take 比較。 */
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
    </Section>
  )
}

/** レビュー。採用中の Take に対して行う。 */
const ReviewSection = ({ shot }: { readonly shot: Shot }) => {
  const workbench = useWorkbench()
  const { takes, replaceTake } = useShotTakes(shot, workbench.posterEpoch)
  const selected = takes?.find((take) => take.id === shot.selectedTakeId) ?? null
  return (
    <Section title="レビュー">
      {selected === null ? (
        <p className="text-sm text-muted">
          採用している Take がありません。Take 比較で採用するとレビューできます。
        </p>
      ) : (
        <ReviewPanel
          shotId={shot.id}
          takeId={selected.id}
          humanVerdict={selected.humanVerdict}
          onVerdictSaved={replaceTake}
        />
      )}
    </Section>
  )
}
