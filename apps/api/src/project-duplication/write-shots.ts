import {
  TakeId as TakeIdSchema,
  copyCastEntries,
  copyShotInput,
  copyTakeInput,
  copyTransitionInputs,
  newId,
  shotStatusAfterCancel,
  type DuplicationItem,
  type Project,
  type SequenceId,
  type ShotId,
  type Take,
  type TakeId,
} from '@ixa/domain'
import { sequentially } from '../sequentially.js'
import type { ProjectDuplicationDeps } from './deps.js'
import type { DuplicationSource, SourceShot } from './read-source.js'
import type { LibraryMaps } from './write-project.js'

/**
 * Shot と、それに付くもの（登場人物・最初のフレーム・Take・トランジション）を書く。
 *
 * - Take の新しい ID を先に決める（Shot の「前の Take から作る」指定を、Shot を作るときに張り直すため）
 * - Shot の状態は写さず、写した Take から決め直す（Take が無ければ下書き）
 * - Take は元の作った順に作る（作り直しの元が先にできる・Shot ごとの番号が元と同じになる）
 */

export type ShotDrops = {
  readonly castDropped: number
  readonly locationDropped: number
}

const NO_DROPS: ShotDrops = { castDropped: 0, locationDropped: 0 }

/** 写した Take のうち、外していない Take があるか（状態を決めるのに使う）。 */
const visibleTakes = (shot: SourceShot): readonly Take[] => shot.takes.filter((take) => !shot.hiddenTakeIds.has(take.id))

const writeSequences = async (
  deps: ProjectDuplicationDeps,
  target: Project,
  source: DuplicationSource,
): Promise<ReadonlyMap<SequenceId, SequenceId>> => {
  const map = new Map<SequenceId, SequenceId>()
  await sequentially(source.sequences, async (sequence) => {
    const copied = await deps.sequences.create({
      projectId: target.id,
      order: sequence.order,
      name: sequence.name,
      musicSectionLabel: sequence.musicSectionLabel,
      notes: sequence.notes,
    })
    map.set(sequence.id, copied.id)
  })
  return map
}

/** 写した Take（外したもの・採用・レビュー）を Shot ごとの元の順で作る。 */
const writeTakes = async (
  deps: ProjectDuplicationDeps,
  source: DuplicationSource,
  shotMap: ReadonlyMap<ShotId, ShotId>,
  takeMap: ReadonlyMap<TakeId, TakeId>,
): Promise<void> => {
  const ordered = source.shots
    .flatMap((shot) => shot.takes.map((take) => ({ take, hidden: shot.hiddenTakeIds.has(take.id) })))
    .sort((a, b) => (a.take.id < b.take.id ? -1 : 1))
  await sequentially(ordered, async ({ take, hidden }) => {
    const created = await deps.takes.create(await copyTakeInput(take, { shots: shotMap, takes: takeMap }))
    // レビューの記録は持っていかないので「未レビュー」のまま。人の判定だけ残す。
    if (take.humanVerdict !== 'unreviewed') await deps.takes.updateReview(created.id, { humanVerdict: take.humanVerdict })
    if (hidden) await deps.takes.hide(created.id, new Date())
  })
  await sequentially(source.shots, async ({ shot }) => {
    const selected = shot.selectedTakeId === null ? undefined : takeMap.get(shot.selectedTakeId)
    const copiedShot = shotMap.get(shot.id)
    if (selected !== undefined && copiedShot !== undefined) await deps.shots.selectTake(copiedShot, selected)
  })
}

export const writeShots = async (
  deps: ProjectDuplicationDeps,
  target: Project,
  source: DuplicationSource,
  items: ReadonlySet<DuplicationItem>,
  library: LibraryMaps,
): Promise<ShotDrops> => {
  if (source.shots.length === 0) return NO_DROPS
  const sequences = await writeSequences(deps, target, source)
  const takeMap = new Map(source.shots.flatMap((shot) => shot.takes.map((take) => [take.id, newId(TakeIdSchema)] as const)))
  const copies = source.shots.map((entry) => {
    const visible = visibleTakes(entry)
    const hasSelectedTake = entry.shot.selectedTakeId !== null && takeMap.has(entry.shot.selectedTakeId)
    return copyShotInput(entry.shot, {
      projectId: target.id,
      keepStoryboard: items.has('storyboard'),
      locations: library.locations,
      sequences,
      takes: takeMap,
      status: shotStatusAfterCancel({ hasSelectedTake, hasTakes: visible.length > 0 }),
    })
  })
  const created = await deps.shots.createMany(copies.map((copy) => copy.input))
  // 作った順で返る保証に頼らず、作品の中で重ならないコードで対応を取る。
  const byCode = new Map(created.map((shot) => [shot.code, shot.id] as const))
  const shotMap = new Map(
    source.shots.flatMap(({ shot }) => {
      const copied = byCode.get(shot.code)
      return copied === undefined ? [] : [[shot.id, copied] as const]
    }),
  )

  let castDropped = 0
  await sequentially(source.shots, async ({ shot, cast, frames }) => {
    const copiedShot = shotMap.get(shot.id)
    if (copiedShot === undefined) throw new Error(`複製した Shot が見つかりません（${shot.code}）`)
    if (shot.lockedAt !== null) await deps.shots.update(copiedShot, { lockedAt: shot.lockedAt })
    const castCopy = copyCastEntries(cast, library)
    if (castCopy.dropped > 0) castDropped += 1
    if (castCopy.entries.length > 0) await deps.shotCharacters.replaceAll(copiedShot, castCopy.entries)
    await sequentially(frames, (frame) =>
      deps.shotReferences.create({
        shotId: copiedShot,
        mediaAssetId: frame.mediaAssetId,
        role: frame.role,
        weight: frame.weight,
        order: frame.order,
        sourceKind: frame.sourceKind,
      }),
    )
  })
  if (items.has('takes')) await writeTakes(deps, source, shotMap, takeMap)
  await sequentially(copyTransitionInputs(source.transitions, { projectId: target.id, shots: shotMap }), (input) =>
    deps.transitions.create(input),
  )
  return { castDropped, locationDropped: copies.filter((copy) => copy.locationDropped).length }
}
