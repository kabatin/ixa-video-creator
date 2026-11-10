import type { ProjectId } from '@ixa/domain'
import { waveformKey, type ObjectStorage } from '@ixa/storage'
import type { ProjectDuplicationDeps } from '../project-duplication/deps.js'
import { sha256Hex } from './bundle-source.js'
import { DemoFileError, DemoManifestError } from './errors.js'
import type { FetchedFiles } from './media.js'

/**
 * 見本の曲の解析の波形を、**入れた作品・曲の ID から決まる置き場**に置く（ADR-0067）。
 *
 * 目録の `files[].key`（作る人の作品の置き場）は目録の中の名前でしかない。そのまま使うと、作る人の機械に入れたとき
 * 元の作品の波形を共有し、元が直されると黙って変わる。入れる側は、曲を作った後・解析を書く前に、
 * `waveformKey(入れた作品, 入れた曲)` に確かめ済みの中身を置き、解析の `waveformPeaksKey` をそこへ書き換える。
 * その置き場に中身の違うものが既にあれば、上書きせずに断る（食い違い）。
 *
 * 書き手（作品の複製と同じ）は変えない。書く口の 2 つ（曲を作る・解析を作る）を包むだけ。
 */
export const withInstalledWaveforms = (
  writers: ProjectDuplicationDeps,
  files: FetchedFiles,
  storage: Pick<ObjectStorage, 'put' | 'get' | 'exists'>,
): ProjectDuplicationDeps => {
  const projectOfTrack = new Map<string, ProjectId>()

  /** 置き場に置く。同じ中身が既にあればそのまま、違えば断る。 */
  const place = async (key: string, entry: { readonly file: string; readonly bytes: Uint8Array }): Promise<void> => {
    if (await storage.exists(key)) {
      const current = await storage.get(key)
      if (current.byteLength !== entry.bytes.byteLength || sha256Hex(current) !== sha256Hex(entry.bytes)) {
        throw new DemoFileError('conflict', entry.file, '入れる先の置き場に、中身の違うファイルがもうあります')
      }
      return
    }
    await storage.put(key, entry.bytes, { contentType: 'application/json' })
  }

  return {
    ...writers,
    musicTracks: {
      ...writers.musicTracks,
      create: async (input) => {
        const track = await writers.musicTracks.create(input)
        projectOfTrack.set(track.id, track.projectId)
        return track
      },
    },
    musicAnalyses: {
      ...writers.musicAnalyses,
      create: async (input) => {
        const entry = files.get(input.waveformPeaksKey)
        const projectId = projectOfTrack.get(input.musicTrackId)
        // 点検（preflight）が、波形の置き場は files のどれかだと確かめている。ここで外れるのは書き手の変化。
        if (entry === undefined || projectId === undefined) {
          throw new DemoManifestError('見本の曲の解析の波形が、目録のファイルにも入れた曲にも結び付きません')
        }
        const key = waveformKey(projectId, input.musicTrackId)
        await place(key, entry)
        return writers.musicAnalyses.create({ ...input, waveformPeaksKey: key })
      },
    },
  }
}
