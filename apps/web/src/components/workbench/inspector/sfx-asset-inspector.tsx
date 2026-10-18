'use client'

import type { MediaAssetId } from '@ixa/domain'
import { Button } from '@/components/ui/button'
import { PanelEmpty } from '@/components/workbench/panels/panel-frame'
import { useSfxAssets } from '@/components/workbench/sfx-assets'
import { AudioSoloButton } from '@/components/workbench/ui/audio-solo-button'
import { ObjectHeader } from '@/components/workbench/ui/object-header'
import { Section } from '@/components/workbench/ui/section'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { formatSpan } from '@/lib/format-time'

/**
 * 効果音の素材（音 1 本。ADR-0052）。聴いて、どこに置いたかを見る。
 * 位置・音量・フェードを直すのは置いたクリップの方（`AudioClipInspector`）なので、そこへ行く口を並べる。
 */
export const SfxAssetInspector = ({ id }: { readonly id: MediaAssetId }) => {
  const workbench = useWorkbench()
  const sfx = useSfxAssets()
  if (sfx === null || sfx.state === 'loading') return <PanelEmpty title="効果音を読み込んでいます…" />
  if (sfx.state === 'error') return <PanelEmpty title="効果音を読めませんでした" hint={sfx.message} />
  const item = sfx.value.find((candidate) => candidate.mediaAssetId === id)
  if (item === undefined) {
    return <PanelEmpty title="この効果音は見つかりません" hint="消されたか、まだ読み込めていません。" />
  }

  return (
    <div className="flex h-full flex-col">
      <ObjectHeader kind="効果音" title={item.label} />
      <div className="workbench-panel-body relative min-h-0 flex-1 overflow-auto">
        <Section title="効果音">
          <AudioSoloButton mediaAssetId={item.mediaAssetId} label={item.label} />
        </Section>
        <Section title="置いた位置">
          {item.placements.length === 0 ? (
            <p className="text-xs text-muted">タイムラインにはまだ置いていません。</p>
          ) : (
            <ul className="space-y-1">
              {item.placements.map((placement) => (
                <li key={placement.clipId} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate tabular-nums">
                    {formatSpan(placement.startSec, placement.durationSec)}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => {
                      workbench.inspect({ kind: 'audio-clip', id: placement.clipId })
                      workbench.focusPanel('inspector')
                    }}
                  >
                    直す
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}
