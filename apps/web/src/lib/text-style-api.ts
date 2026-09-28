import {
  CreateTextStylePresetInput,
  TextStyle,
  TextStyleId,
  TextStylePreset,
  TimelineClipId,
  UpdateTextStylePresetPatch,
  type ProjectId,
} from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'
import { WireTimelineClipList, type WireTimelineClip } from '@/lib/timeline-api'

/**
 * テロップのスタイル（ADR-0028）。名前を付けて保存し、テロップへまとめて当てる。
 * 当てると値を写す（テロップ側に見た目と `styleId` が残る）。
 */
export const WireTextStylePreset = TextStylePreset.extend({
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type WireTextStylePreset = z.infer<typeof WireTextStylePreset>

export const ApplyTextStyleBody = z.object({
  clipIds: z.array(TimelineClipId).min(1),
  style: TextStyle,
  /** どの保存済みスタイルから当てたか。見た目だけ当てるなら null。 */
  styleId: TextStyleId.nullable(),
})
export type ApplyTextStyleBody = z.input<typeof ApplyTextStyleBody>

export type TextStyleApi = {
  listTextStyles: (projectId: ProjectId) => Promise<WireTextStylePreset[]>
  createTextStyle: (projectId: ProjectId, body: CreateTextStylePresetInput) => Promise<WireTextStylePreset>
  updateTextStyle: (id: TextStyleId, patch: UpdateTextStylePresetPatch) => Promise<WireTextStylePreset>
  deleteTextStyle: (id: TextStyleId) => Promise<void>
  applyTextStyle: (projectId: ProjectId, body: ApplyTextStyleBody) => Promise<WireTimelineClip[]>
}

const projectPath = (projectId: ProjectId, suffix: string): string =>
  `/projects/${encodeURIComponent(projectId)}${suffix}`
const stylePath = (id: TextStyleId): string => `/text-styles/${encodeURIComponent(id)}`

export const createTextStyleApi = (requester: Requester): TextStyleApi => ({
  listTextStyles: async (projectId) =>
    requester.get(projectPath(projectId, '/text-styles'), z.array(WireTextStylePreset)),
  createTextStyle: async (projectId, body) =>
    requester.post(
      projectPath(projectId, '/text-styles'),
      CreateTextStylePresetInput.parse(body),
      WireTextStylePreset,
    ),
  updateTextStyle: async (id, patch) =>
    requester.patch(stylePath(id), UpdateTextStylePresetPatch.parse(patch), WireTextStylePreset),
  deleteTextStyle: async (id) => requester.remove(stylePath(id)),
  applyTextStyle: async (projectId, body) =>
    requester.post(
      projectPath(projectId, '/clips/text-style'),
      ApplyTextStyleBody.parse(body),
      WireTimelineClipList,
    ),
})
