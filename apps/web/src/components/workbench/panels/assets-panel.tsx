'use client'

import { AssetTree } from '@/components/workbench/asset-tree'
import { PanelFrame } from '@/components/workbench/panels/panel-frame'

/** 素材（左）。 */
export const AssetsPanel = () => (
  <PanelFrame>
    <AssetTree />
  </PanelFrame>
)
