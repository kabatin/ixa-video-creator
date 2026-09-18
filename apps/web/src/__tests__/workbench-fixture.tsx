import { Project, Shot, ShotId } from '@ixa/domain'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import {
  WorkbenchContext,
  type WorkbenchContextValue,
} from '@/components/workbench/workbench-context'
import { EMPTY_SELECTION } from '@/lib/shot-bulk'
import { PROJECT_ID, WORKSPACE_ID, shotJson } from './fixtures'

/**
 * ワークベンチのパネルを Provider 抜きで描くための偽の共有状態。
 * **パネルは `useWorkbench()` だけを見る**ので、ここで値を差し替えれば描画を確かめられる。
 */

export const aProject = Project.parse({
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  name: 'iXA CUP MUSIC VIDEO',
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  durationSec: 116,
  budgetUsd: 250,
  styleGuide: 'シネマティック',
  status: 'production',
  createdAt: new Date('2026-09-16T01:02:03.000Z'),
  updatedAt: new Date('2026-09-16T01:02:03.000Z'),
})

export const aWorkbenchShot = (index: number, patch: Partial<Record<string, unknown>> = {}): Shot =>
  Shot.parse({
    ...shotJson,
    id: ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5F${String(index).padStart(2, '0')}`),
    code: `CUT-${String(index).padStart(2, '0')}`,
    order: index * 1000,
    startSec: index * 4,
    durationSec: 4,
    createdAt: new Date(shotJson.createdAt),
    updatedAt: new Date(shotJson.updatedAt),
    ...patch,
  })

export const workbenchValue = (
  patch: Partial<WorkbenchContextValue> = {},
): WorkbenchContextValue => ({
  project: aProject,
  projectId: aProject.id,
  track: null,
  analysis: null,
  musicLoaded: true,
  sequences: [],
  locations: [],
  loadErrors: [],
  shots: [],
  posters: new Map(),
  posterError: null,
  posterEpoch: 0,
  serverEpoch: 0,
  selectedShotId: null,
  selectShot: vi.fn(),
  checked: EMPTY_SELECTION,
  setChecked: vi.fn(),
  transport: { currentSec: 0, playing: false, seek: null, owner: null },
  transportControls: {
    setCurrentSec: vi.fn(),
    seekTo: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    toggle: vi.fn(),
  },
  live: { state: 'live', lastEventAt: null, attempt: 0, invalidCount: 0, newTakeCount: 0 },
  saveShot: vi.fn(),
  replaceShots: vi.fn(),
  applyAdoptedShots: vi.fn(),
  refresh: vi.fn(),
  dialog: null,
  openDialog: vi.fn(),
  closeDialog: vi.fn(),
  focusPanel: vi.fn(),
  inspectorTab: 'settings',
  openInspector: vi.fn(),
  openAsset: vi.fn(),
  ...patch,
})

export const renderInWorkbench = (ui: ReactElement, patch: Partial<WorkbenchContextValue> = {}) => {
  const value = workbenchValue(patch)
  return { value, ...render(<WorkbenchContext.Provider value={value}>{ui}</WorkbenchContext.Provider>) }
}
