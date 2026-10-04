import type { LocationRepository } from '@ixa/db'
import type { LocationId, ProjectId } from '@ixa/domain'

/**
 * キャラクター・ロケーション・ブランド資産はプロジェクトごと（ADR-0034。制作者 2026-10-03「全プロジェクトで共有に
 * なっている。プロジェクト単位にしないと大変なことになる」）。Shot に付けられるのは同じプロジェクトのものだけ。
 * ほかのプロジェクトのものは「ほかのプロジェクトから取り込む」で複製してから使う。
 */

const IMPORT_HINT = '（ほかのプロジェクトのものは取り込んでから使ってください）'

export const FOREIGN_CHARACTER_MESSAGE = `この Project のキャラクターではありません${IMPORT_HINT}`
export const FOREIGN_LOCATION_MESSAGE = `この Project のロケーションではありません${IMPORT_HINT}`
export const MISSING_LOCATION_MESSAGE = '指定されたロケーションが存在しません'

/**
 * Shot に付けるロケーションを付けられない理由。付けられるなら null。
 * `null`（外す）と `undefined`（触らない）はそのまま通す。
 */
export const locationProblem = async (
  locations: Pick<LocationRepository, 'findById'>,
  projectId: ProjectId,
  locationId: LocationId | null | undefined,
): Promise<string | null> => {
  if (locationId === null || locationId === undefined) return null
  const location = await locations.findById(locationId)
  if (location === null) return MISSING_LOCATION_MESSAGE
  return location.projectId === projectId ? null : FOREIGN_LOCATION_MESSAGE
}
