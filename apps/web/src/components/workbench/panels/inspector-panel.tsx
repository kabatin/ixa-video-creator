'use client'

import {
  BrandAssetInspector,
  CharacterInspector,
  LocationInspector,
  LookInspector,
  TrackInspector,
} from '@/components/workbench/inspector/asset-inspectors'
import { ProjectConceptInspector } from '@/components/workbench/inspector/project-concept-inspector'
import { ShotInspector } from '@/components/workbench/inspector/shot-inspector'
import { TextClipInspector } from '@/components/workbench/inspector/text-clip-inspector'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty, PanelFrame } from '@/components/workbench/panels/panel-frame'

/**
 * インスペクター（右。UI-WORKBENCH-2 §5）。**選んだ物の種類で中身が変わる**
 * （Shot・キャラクター・Look・ロケーション・ブランド資産・楽曲・テロップ・作品の方針）。
 */
export const InspectorPanel = () => {
  const { inspected, shots } = useWorkbench()

  if (inspected === null) {
    return (
      <PanelFrame>
        <PanelEmpty
          title="何も選んでいません"
          hint="ストーリーボード・Shot 一覧・素材ツリーで選ぶと、ここで直せます。"
        />
      </PanelFrame>
    )
  }

  if (inspected.kind === 'shot') {
    const index = shots?.findIndex((shot) => shot.id === inspected.id) ?? -1
    const shot = index < 0 ? null : (shots?.[index] ?? null)
    return (
      <PanelFrame flush>
        {shot === null ? (
          <PanelEmpty
            title="この Shot は見つかりません"
            hint="消されたか、まだ読み込めていません。"
          />
        ) : (
          <ShotInspector key={shot.id} shot={shot} isFirst={index === 0} />
        )}
      </PanelFrame>
    )
  }

  if (inspected.kind === 'project') {
    return (
      <PanelFrame flush>
        <ProjectConceptInspector />
      </PanelFrame>
    )
  }

  if (inspected.kind === 'text-clip') {
    return (
      <PanelFrame flush>
        <TextClipInspector key={inspected.id} id={inspected.id} />
      </PanelFrame>
    )
  }

  return (
    <PanelFrame flush>
      {inspected.kind === 'character' && (
        <CharacterInspector key={inspected.id} id={inspected.id} />
      )}
      {inspected.kind === 'look' && (
        <LookInspector key={inspected.id} id={inspected.id} characterId={inspected.characterId} />
      )}
      {inspected.kind === 'location' && <LocationInspector key={inspected.id} id={inspected.id} />}
      {inspected.kind === 'brand-asset' && (
        <BrandAssetInspector key={inspected.id} id={inspected.id} />
      )}
      {inspected.kind === 'track' && <TrackInspector key={inspected.id} id={inspected.id} />}
    </PanelFrame>
  )
}
