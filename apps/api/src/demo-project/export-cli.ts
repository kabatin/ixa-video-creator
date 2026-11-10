import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig } from '@ixa/config'
import {
  closeDbClient,
  createBrandAssetRepository,
  createCharacterLookRepository,
  createCharacterRepository,
  createDbClient,
  createLocationRepository,
  createMediaAssetRepository,
  createMusicAnalysisRepository,
  createMusicTrackRepository,
  createNarrationLineRepository,
  createNarrationTakeRepository,
  createProjectRepository,
  createScriptRepository,
  createSequenceRepository,
  createShotCharacterRepository,
  createShotReferenceRepository,
  createShotRepository,
  createTakeRepository,
  createTextStyleRepository,
  createTimelineClipRepository,
  createTransitionRepository,
  createVoiceProfileRepository,
} from '@ixa/db'
import { DemoBaseUrl, PROJECT_NAME_MAX_LENGTH, ProjectDemoKey, ProjectId } from '@ixa/domain'
import { createStorage } from '@ixa/storage'
import { z } from 'zod'
import { createLogger } from '../logger.js'
import { DEMO_MANIFEST_FILE, exportDemo, type DemoExportRequest } from './exporter.js'

/**
 * `pnpm --filter @ixa/api demo:export -- --project <id> --out <dir> --demo-key <key> --base-url <https の頭> --title <名前>`
 * （作る人の道具。ADR-0067）。中身は `exporter.ts`。ここは引数を読み、本物の DB と置き場を繋ぐだけ。
 */

const ExportArgs = z.object({
  projectId: ProjectId,
  out: z.string().min(1),
  demoKey: ProjectDemoKey,
  baseUrl: DemoBaseUrl,
  title: z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH),
})
export type ExportArgs = z.infer<typeof ExportArgs>

export const EXPORT_USAGE =
  '使い方: pnpm --filter @ixa/api demo:export -- --project <作品の ID> --out <書き出すフォルダ> ' +
  '--demo-key <見本の印 例 ixa-demo-v1> --base-url <https://…/ で終わる取りに行く先> --title <作品の名前>'

/** 引数を読む（純粋）。知らない引数・欠けた引数は止める。 */
export const parseExportArgs = (argv: readonly string[]): ExportArgs => {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv]
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      project: { type: 'string' },
      out: { type: 'string' },
      'demo-key': { type: 'string' },
      'base-url': { type: 'string' },
      title: { type: 'string' },
    },
  })
  const parsed = ExportArgs.safeParse({
    projectId: values.project,
    out: values.out,
    demoKey: values['demo-key'],
    baseUrl: values['base-url'],
    title: values.title,
  })
  if (!parsed.success) {
    const where = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')
    throw new Error(`引数が足りないか、形が合いません（${where}）\n${EXPORT_USAGE}`)
  }
  return parsed.data
}

/** 書き出す。**DB は読むだけ**（書く口は exporter が呼ばない）。書いた目録の場所を返す。 */
export const runExportDemo = async (argv: readonly string[], env: NodeJS.ProcessEnv): Promise<string> => {
  const args = parseExportArgs(argv)
  const outDir = resolve(args.out)
  if (existsSync(join(outDir, DEMO_MANIFEST_FILE))) {
    throw new Error(`${join(outDir, DEMO_MANIFEST_FILE)} がもうあります。空のフォルダを指定してください`)
  }
  const config = loadConfig(env)
  const db = createDbClient(config.database.url)
  try {
    const { storage } = createStorage(config.storage)
    await mkdir(outDir, { recursive: true })
    const request: DemoExportRequest = { projectId: args.projectId, demoKey: args.demoKey, baseUrl: args.baseUrl, title: args.title }
    await exportDemo(
      {
        projects: createProjectRepository(db),
        scripts: createScriptRepository(db),
        musicTracks: createMusicTrackRepository(db),
        musicAnalyses: createMusicAnalysisRepository(db),
        characters: createCharacterRepository(db),
        looks: createCharacterLookRepository(db),
        locations: createLocationRepository(db),
        brandAssets: createBrandAssetRepository(db),
        textStyles: createTextStyleRepository(db),
        timelineClips: createTimelineClipRepository(db),
        sequences: createSequenceRepository(db),
        shots: createShotRepository(db),
        shotCharacters: createShotCharacterRepository(db),
        shotReferences: createShotReferenceRepository(db),
        takes: createTakeRepository(db),
        transitions: createTransitionRepository(db),
        voices: createVoiceProfileRepository(db),
        narrationLines: createNarrationLineRepository(db),
        narrationTakes: createNarrationTakeRepository(db),
        // 読むだけなので字幕を作り直さない（呼ばれたら止める）。
        syncDialogueTelops: () => Promise.reject(new Error('書き出しは作品を書き換えません')),
        logger: createLogger(config.logLevel),
        mediaAssets: createMediaAssetRepository(db),
        storage,
        writeOut: (name, bytes) => writeFile(join(outDir, name), bytes),
        secrets: [
          config.storage.signingSecret ?? '',
          config.storage.s3?.secretAccessKey ?? '',
          config.storage.s3?.accessKeyId ?? '',
          config.api.passphrase ?? '',
        ],
      },
      request,
    )
    return join(outDir, DEMO_MANIFEST_FILE)
  } finally {
    await closeDbClient(db)
  }
}
