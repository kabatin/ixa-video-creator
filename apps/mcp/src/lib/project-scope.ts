import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { ToolInputError } from '../tool-def.js'
import { WireShot, WireTake } from '../wire.js'

/**
 * ID が `projectId` の作品のものかを、書く前（他作品の中身を返す前）に API で確かめる。
 * API の多くの口は ID だけで動くので、確かめないと会話の作品の ID を名乗りながら別の作品を触れてしまう
 * （AI エージェントの確認は top-level の `projectId` で「作品の外か」を決める。ADR-0058）。
 * 違えば API を呼ばずに `ToolInputError` で断る。
 */

const Row = z.object({ id: z.string() }).passthrough()

const foreignOf = (known: ReadonlySet<string>, ids: readonly string[]): readonly string[] =>
  [...new Set(ids)].filter((id) => !known.has(id))

/**
 * 作品の一覧の口（`/projects/{id}/characters` など）に ids が全部あるか。一覧を返す（呼び手が使い回せる）。
 * `label` は断るときの名前（「キャラクター」など）。
 */
export const assertListed = async <T extends { readonly id: string }>(
  api: ApiClient,
  listPath: string,
  ids: readonly string[],
  label: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown> = Row as unknown as z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<readonly T[]> => {
  const rows = await api.get(listPath, z.array(schema))
  const foreign = foreignOf(new Set(rows.map((r) => r.id)), ids)
  if (foreign.length > 0) throw new ToolInputError(`この作品に無い${label}です: ${foreign.join(', ')}`)
  return rows
}

/** Shot が全部この作品のものか。作品の Shot の一覧を返す。 */
export const assertShotsInProject = (
  api: ApiClient,
  projectId: string,
  shotIds: readonly string[],
): Promise<readonly WireShot[]> => assertListed(api, `/projects/${seg(projectId)}/shots`, shotIds, ' Shot ', WireShot)

/** Take が全部、この作品のこの Shot のものか。その Shot の Take の一覧を返す。 */
export const assertTakesOfShot = async (
  api: ApiClient,
  projectId: string,
  shotId: string,
  takeIds: readonly string[],
): Promise<readonly WireTake[]> => {
  await assertShotsInProject(api, projectId, [shotId])
  const takes = await api.get(`/shots/${seg(shotId)}/takes`, z.array(WireTake))
  const foreign = foreignOf(new Set(takes.map((t) => t.id)), takeIds)
  if (foreign.length > 0) throw new ToolInputError(`その Shot に無い Take です: ${foreign.join(', ')}`)
  return takes
}

const WireOwnedMedia = z.object({ id: z.string(), projectId: z.string().nullable().optional() })

/**
 * 素材がこの作品のものか。作品に属さない素材（`projectId` が null。ワークスペースの共有）は通す。
 * 別の作品の素材は断る。
 */
export const assertMediaInProject = async (
  api: ApiClient,
  projectId: string,
  mediaAssetIds: readonly string[],
): Promise<void> => {
  const owners = await Promise.all(
    [...new Set(mediaAssetIds)].map(async (id) => ({ id, owner: (await api.get(`/media/${seg(id)}`, WireOwnedMedia)).projectId ?? null })),
  )
  const foreign = owners.filter((o) => o.owner !== null && o.owner !== projectId).map((o) => o.id)
  if (foreign.length > 0) throw new ToolInputError(`この作品に無い素材です: ${foreign.join(', ')}`)
}

const WireNarrationLineRows = z.object({ lines: z.array(Row) })

/** ナレーションの行が全部この作品のものか（`PATCH /narration-lines/{id}` などは ID だけで動く）。 */
export const assertNarrationLinesInProject = async (
  api: ApiClient,
  projectId: string,
  lineIds: readonly string[],
): Promise<void> => {
  const { lines } = await api.get(`/projects/${seg(projectId)}/narration`, WireNarrationLineRows)
  const foreign = foreignOf(new Set(lines.map((l) => l.id)), lineIds)
  if (foreign.length > 0) throw new ToolInputError(`この作品に無いナレーションの行です: ${foreign.join(', ')}`)
}

/** Look が全部そのキャラクターのものか。Look の一覧を返す（キャラクターが作品のものかは呼び手が確かめる）。 */
export const assertLooksOfCharacter = async <T extends { readonly id: string }>(
  api: ApiClient,
  characterId: string,
  lookIds: readonly string[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<readonly T[]> => {
  const looks = await api.get(`/characters/${seg(characterId)}/looks`, z.array(schema))
  const foreign = foreignOf(new Set(looks.map((l) => l.id)), lookIds)
  if (foreign.length > 0) throw new ToolInputError(`そのキャラクターに無い Look です: ${foreign.join(', ')}`)
  return looks
}

const WireLookOwner = z.object({ id: z.string(), characterId: z.string() })

/** Look だけを受ける口のため。Look の持ち主のキャラクターがこの作品のものか。 */
export const assertLookInProject = async (api: ApiClient, projectId: string, lookId: string): Promise<void> => {
  const [look, characters] = await Promise.all([
    api.get(`/looks/${seg(lookId)}`, WireLookOwner),
    api.get(`/projects/${seg(projectId)}/characters`, z.array(Row)),
  ])
  if (!characters.some((c) => c.id === look.characterId)) throw new ToolInputError(`この作品に無い Look です: ${lookId}`)
}

const WireJobRows = z.object({ items: z.array(z.object({ jobId: z.string() })) })
const WireJobIdRows = z.array(z.object({ jobId: z.string() }))

/**
 * 絵のジョブがこの作品のものか。ジョブを引く口が無いので、持ち主の履歴で引く:
 * 最初のコマは Shot の履歴、キャラクターシートはキャラクターの識別画像、どちらも無ければ作品のキーアート。
 */
export const assertImageJobInProject = async (
  api: ApiClient,
  projectId: string,
  jobId: string,
  owner: { readonly shotId?: string | undefined; readonly characterId?: string | undefined },
): Promise<void> => {
  const jobIds = async (): Promise<readonly string[]> => {
    if (owner.shotId !== undefined) {
      await assertShotsInProject(api, projectId, [owner.shotId])
      const history = await api.get(`/shots/${seg(owner.shotId)}/start-frame/history`, WireJobRows)
      return history.items.map((i) => i.jobId)
    }
    if (owner.characterId !== undefined) {
      await assertListed(api, `/projects/${seg(projectId)}/characters`, [owner.characterId], 'キャラクター')
      const checks = await api.get(`/characters/${seg(owner.characterId)}/identity-images/checks`, WireJobIdRows)
      return checks.map((c) => c.jobId)
    }
    return (await api.get(`/projects/${seg(projectId)}/key-art`, z.array(Row))).map((r) => r.id)
  }
  if (!(await jobIds()).includes(jobId)) {
    throw new ToolInputError(`この作品（その持ち主）の絵のジョブではありません: ${jobId}`)
  }
}

/**
 * Shot と Take の組がどれも「この作品のその Shot の Take」か（粗編集の select、待つ Take など、組で来るもの）。
 * Shot の一覧は 1 回、Take の一覧は Shot ごとに 1 回だけ引く。
 */
export const assertTakePairs = async (
  api: ApiClient,
  projectId: string,
  pairs: readonly { readonly shotId: string; readonly takeId: string }[],
): Promise<void> => {
  if (pairs.length === 0) return
  const shotIds = [...new Set(pairs.map((p) => p.shotId))]
  await assertShotsInProject(api, projectId, shotIds)
  const takesByShot = new Map(
    await Promise.all(
      shotIds.map(async (shotId) => {
        const takes = await api.get(`/shots/${seg(shotId)}/takes`, z.array(Row))
        return [shotId, new Set(takes.map((t) => t.id))] as const
      }),
    ),
  )
  const foreign = pairs.filter((p) => !(takesByShot.get(p.shotId)?.has(p.takeId) ?? false)).map((p) => p.takeId)
  if (foreign.length > 0) throw new ToolInputError(`その Shot に無い Take です: ${[...new Set(foreign)].join(', ')}`)
}
