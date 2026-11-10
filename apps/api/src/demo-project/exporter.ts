import type { MediaAssetRepository } from '@ixa/db'
import {
  DUPLICATION_ITEMS,
  MediaAssetId as MediaAssetIdSchema,
  DemoManifest,
  DemoStorageKey,
  publicLeaks,
  ulidValues,
  unlistedMediaReferences,
  type DemoFileEntry,
  type DemoMediaEntry,
  type MediaAsset,
  type ProjectId,
} from '@ixa/domain'
import { ObjectNotFoundError, type ObjectStorage } from '@ixa/storage'
import type { ProjectDuplicationDeps } from '../project-duplication/deps.js'
import { readDuplicationSource } from '../project-duplication/read-source.js'
import { fileExtension } from '../routes/uploads.js'
import { sha256Hex } from './bundle-source.js'
import { neutraliseForPublic } from './neutralise.js'
import { serializeDemoSource, type CharacterAssets, type DemoSource } from './source-wire.js'

/**
 * 見本の目録とファイルを書き出す（作る人の道具。ADR-0067）。**DB は読むだけ。**
 *
 * 1. 作品を全部読む（作品の複製と同じ読み方。キャラクターの Look と画像も）
 * 2. 値に出てくる ULID を素材の表で引き、素材の元のファイルを `<sha256>.<拡張子>` にする（中身を測り直して照らす）
 * 3. 曲の解析の波形を `files` にする
 * 4. 機械と持ち主の情報を外す（`neutralise.ts`）。**鍵・署名付きの URL・この機械の場所や名前が 1 つでも残れば書かない**
 *    （`publicLeaks`）。元のファイルが欠けていても書かない
 * 5. 全部そろってから書く（途中で止まったときに、半端な目録を残さない）
 */

/** 作品を読む口は複製と同じもの（**書く口は呼ばない**。DB は読むだけ）。 */
export type DemoExportDeps = ProjectDuplicationDeps & {
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
  readonly storage: Pick<ObjectStorage, 'get'>
  /** 書き出し先へ 1 つ書く（名前は目録の形が縛ったファイル名）。 */
  readonly writeOut: (name: string, bytes: Uint8Array) => Promise<void>
  /** 目録に入っていてはいけない値（置き場の署名の鍵・S3 の鍵など）。 */
  readonly secrets: readonly string[]
  /** 作る人の機械（ホームと利用者名）。目録に入っていれば書かない。 */
  readonly machine: { readonly homeDir: string; readonly userName: string }
}

export type DemoExportRequest = {
  readonly projectId: ProjectId
  readonly demoKey: string
  readonly baseUrl: string
  readonly title: string
}

export const DEMO_MANIFEST_FILE = 'manifest.json'

/** 断ったときに挙げる場所の数の上限。 */
const MAX_LEAK_PATHS = 10

type OutFile = { readonly name: string; readonly bytes: Uint8Array }

const readCharacterAssets = async (deps: DemoExportDeps, source: DemoSource['characters']): Promise<CharacterAssets[]> =>
  Promise.all(
    source.map(async (character) => ({
      characterId: character.id,
      identityImages: await deps.characters.listIdentityImages(character.id),
      looks: await Promise.all(
        (await deps.looks.findByCharacter(character.id)).map(async (look) => ({ look, images: await deps.looks.listLookImages(look.id) })),
      ),
    })),
  )

/** 置き場から読む。無ければ、何が欠けているかを言って止める。 */
const readObject = async (deps: DemoExportDeps, key: string, what: string): Promise<Uint8Array> => {
  try {
    return await deps.storage.get(key)
  } catch (error) {
    if (error instanceof ObjectNotFoundError) throw new Error(`${what}の元のファイルが置き場にありません`, { cause: error })
    throw error
  }
}

const exportMedia = async (deps: DemoExportDeps, asset: MediaAsset): Promise<{ readonly entry: DemoMediaEntry; readonly out: OutFile }> => {
  const bytes = await readObject(deps, asset.storageKey, `素材 ${asset.id} `)
  const sha256 = sha256Hex(bytes)
  if (sha256 !== asset.checksumSha256) throw new Error(`素材 ${asset.id} の中身が登録と違います（sha256 が合いません）`)
  const original = asset.storageKey.split('/').at(-1) ?? ''
  const ext = fileExtension(original)
  if (ext === null) throw new Error(`素材 ${asset.id} の拡張子が分かりません`)
  const file = `${sha256}.${ext}`
  return {
    entry: {
      id: asset.id,
      file,
      sha256,
      sizeBytes: bytes.byteLength,
      contentType: asset.mimeType,
      kind: asset.kind,
      probe: asset.probe,
    },
    out: { name: file, bytes },
  }
}

const exportWaveforms = async (deps: DemoExportDeps, source: DemoSource): Promise<{ readonly entries: DemoFileEntry[]; readonly outs: OutFile[] }> => {
  const keys = [...new Set(source.tracks.flatMap((track) => track.analyses.map((analysis) => analysis.waveformPeaksKey)))].sort()
  const exported = await Promise.all(
    keys.map(async (key, index) => {
      const parsedKey = DemoStorageKey.safeParse(key)
      if (!parsedKey.success) throw new Error(`曲の解析の波形の置き場が、見本に入れられる形ではありません（${key}）`)
      const bytes = await readObject(deps, key, '曲の解析の波形')
      const sha256 = sha256Hex(bytes)
      const file = `waveform-${String(index + 1)}-${sha256.slice(0, 16)}.json`
      return { entry: { key: parsedKey.data, file, sha256, sizeBytes: bytes.byteLength }, out: { name: file, bytes } }
    }),
  )
  return { entries: exported.map((item) => item.entry), outs: exported.map((item) => item.out) }
}

export const exportDemo = async (deps: DemoExportDeps, request: DemoExportRequest): Promise<DemoManifest> => {
  const project = await deps.projects.findById(request.projectId)
  if (project === null) throw new Error('書き出す作品が見つかりません')
  const read = await readDuplicationSource(deps, project, new Set(DUPLICATION_ITEMS))
  // 機械と持ち主の情報を外してから書く（中身は残す。neutralise.ts）。
  const source: DemoSource = neutraliseForPublic(
    { ...read, characterAssets: await readCharacterAssets(deps, read.characters) },
    { title: request.title },
  )
  const json = serializeDemoSource(source)

  // 値に出てくる ULID のうち、素材の表にあるものが素材（列の名前を並べないので、列が増えても漏れない）。
  const found = await Promise.all([...ulidValues(json)].sort().map((id) => deps.mediaAssets.findById(MediaAssetIdSchema.parse(id))))
  const assets = found.filter((asset): asset is MediaAsset => asset !== null)
  const media = []
  for (const asset of assets) media.push(await exportMedia(deps, asset))
  const waveforms = await exportWaveforms(deps, source)

  const manifest = DemoManifest.parse({
    formatVersion: 1,
    demoKey: request.demoKey,
    title: request.title,
    baseUrl: request.baseUrl,
    media: media.map((item) => item.entry),
    files: waveforms.entries,
    source: json,
  })
  const unlisted = unlistedMediaReferences(manifest, new Set(assets.map((asset) => asset.id)))
  if (unlisted.length > 0) throw new Error(`目録に入っていない素材を指しています（${String(unlisted.length)} 件）`)
  // 値そのものは出さない（秘密を端末やログに写さない）。数と場所（JSON の道）だけ言う。
  const leaks = publicLeaks(manifest, { secrets: deps.secrets, ...deps.machine })
  if (leaks.length > 0) {
    const shown = leaks.slice(0, MAX_LEAK_PATHS).join('、')
    const more = leaks.length > MAX_LEAK_PATHS ? ` ほか ${String(leaks.length - MAX_LEAK_PATHS)} 件` : ''
    throw new Error(`公開できない値（鍵・署名付きの URL・この機械の場所や名前）が ${String(leaks.length)} 件あるので、目録を書きません: ${shown}${more}`)
  }

  for (const out of [...media.map((item) => item.out), ...waveforms.outs]) await deps.writeOut(out.name, out.bytes)
  await deps.writeOut(DEMO_MANIFEST_FILE, new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`))
  return manifest
}
