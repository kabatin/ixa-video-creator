import { z } from 'zod'

/**
 * 書き出しの仕上げの音量（ADR-0060）。
 *
 * - `loudnorm`: 全体を -14 LUFS にそろえる（ADR-0039。今まで通り）。曲だけの MV 向け
 * - `peak`: 山だけ -1.5 dBFS で抑える。セリフと曲の釣り合いを、Take の音のまま残す
 *   （全体をそろえると、声の大きさに合わせて曲まで上下する）
 */
export const MasteringMode = z.enum(['loudnorm', 'peak'])
export type MasteringMode = z.infer<typeof MasteringMode>

/**
 * 作品に保存する値。**null は「制作者がまだ選んでいない」**（自動）。
 * 自動は、セリフのある Shot が 1 つでもあれば `peak`、無ければ `loudnorm`。
 * 制作者が選べばその値を保存し、以後は自動で切り替えない。
 */
export const ProjectMasteringMode = MasteringMode.nullable()
export type ProjectMasteringMode = z.infer<typeof ProjectMasteringMode>

/** 書き出しに使う仕上げ。選んであればそれ、無ければセリフの有無で決める。 */
export const resolveMasteringMode = (
  chosen: ProjectMasteringMode,
  shots: readonly { readonly dialogue: readonly unknown[] }[],
): MasteringMode => chosen ?? (shots.some((shot) => shot.dialogue.length > 0) ? 'peak' : 'loudnorm')
