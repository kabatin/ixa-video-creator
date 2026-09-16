import { and, desc, eq, isNull } from 'drizzle-orm'
import type {
  CreateScriptInput, CreateScriptVersionInput, ProjectId, Script, ScriptId, ScriptVersion,
  ScriptVersionId,
} from '@ixa/domain'
import {
  CreateScriptInput as CreateScriptInputSchema,
  CreateScriptVersionInput as CreateScriptVersionInputSchema,
  Script as ScriptSchema,
  ScriptId as ScriptIdSchema,
  ScriptVersion as ScriptVersionSchema,
  ScriptVersionId as ScriptVersionIdSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { scriptVersions, scripts } from '../schema/script.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type ScriptRow = typeof scripts.$inferSelect
export type ScriptVersionRow = typeof scriptVersions.$inferSelect

/**
 * 追記の結果。`currentVersionId` を同じトランザクションで進めるため、
 * 呼び出し側が読み直さずに済むよう Script も一緒に返す。
 */
export type AppendedScriptVersion = {
  readonly script: Script
  readonly version: ScriptVersion
}

/**
 * Script と ScriptVersion の読み書き（DOMAIN.md §8）。戻り値は必ず `@ixa/domain` の型。
 *
 * **ScriptVersion は追記のみ。** 本文を書き換えると、その版を根拠に承認した Shot の
 * 出どころが消える。書き直しは常に新しい版として積む。
 * したがって既存の版を更新するメソッドをこのリポジトリに追加してはならない。
 */
export type ScriptRepository = {
  findById(id: ScriptId): Promise<Script | null>
  /** Project の Script。まだ無ければ null。ソフトデリート済みは含まない。 */
  findByProject(projectId: ProjectId): Promise<Script | null>
  create(input: CreateScriptInput): Promise<Script>
  /** Project の Script を返し、無ければ版を持たない Script を作って返す。 */
  ensureForProject(projectId: ProjectId): Promise<Script>
  findVersionById(id: ScriptVersionId): Promise<ScriptVersion | null>
  /** version 降順（新しい版が先頭）。 */
  listVersions(scriptId: ScriptId): Promise<ScriptVersion[]>
  /**
   * 版を 1 件追記し、それを現在の版にする。
   * version は Script 内の最大値 + 1 をリポジトリが採番する（Take の index と同じ）。
   */
  appendVersion(input: CreateScriptVersionInput): Promise<AppendedScriptVersion>
  /** 現在の版を切り替える。過去の版へ戻すための口。 */
  setCurrentVersion(scriptId: ScriptId, versionId: ScriptVersionId): Promise<Script>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const scriptRowToDomain = (row: ScriptRow): Script =>
  ScriptSchema.parse({
    id: row.id,
    projectId: row.projectId,
    currentVersionId: row.currentVersionId,
  })

export const scriptVersionRowToDomain = (row: ScriptVersionRow): ScriptVersion =>
  ScriptVersionSchema.parse({
    id: row.id,
    scriptId: row.scriptId,
    version: row.version,
    content: row.content,
    authoredBy: row.authoredBy,
    createdAt: row.createdAt,
  })

const liveById = (id: ScriptId) => and(eq(scripts.id, id), isNull(scripts.deletedAt))

export const createScriptRepository = (db: DbClient): ScriptRepository => {
  const scriptByProject = async (projectId: ProjectId): Promise<Script | null> => {
    const rows = await db
      .select()
      .from(scripts)
      .where(and(eq(scripts.projectId, projectId), isNull(scripts.deletedAt)))
      .limit(1)
    const row = rows[0]
    return row ? scriptRowToDomain(row) : null
  }

  const insertScript = async (input: CreateScriptInput): Promise<Script> => {
    const validated = CreateScriptInputSchema.parse(input)
    const rows = await db
      .insert(scripts)
      .values({ ...validated, id: newId(ScriptIdSchema) })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('scripts への INSERT が行を返しませんでした')
    return scriptRowToDomain(row)
  }

  return {
    async findById(id) {
      const rows = await db.select().from(scripts).where(liveById(id)).limit(1)
      const row = rows[0]
      return row ? scriptRowToDomain(row) : null
    },

    findByProject: scriptByProject,

    create: insertScript,

    async ensureForProject(projectId) {
      const existing = await scriptByProject(projectId)
      // scripts.project_id に UNIQUE が無いため、同時実行では 2 本作られうる。
      // 以降は先に見つかった側だけが読まれる。Architect へ報告済み。
      return existing ?? (await insertScript({ projectId }))
    },

    async findVersionById(id) {
      const rows = await db.select().from(scriptVersions).where(eq(scriptVersions.id, id)).limit(1)
      const row = rows[0]
      return row ? scriptVersionRowToDomain(row) : null
    },

    async listVersions(scriptId) {
      const rows = await db
        .select()
        .from(scriptVersions)
        .where(eq(scriptVersions.scriptId, scriptId))
        .orderBy(desc(scriptVersions.version))
      return rows.map(scriptVersionRowToDomain)
    },

    appendVersion(input) {
      const validated = CreateScriptVersionInputSchema.parse(input)
      /**
       * 採番・追記・currentVersionId の前進を 1 トランザクションにまとめる。
       * 分けると「版は積まれたが現在の版は古いまま」という中途半端な状態が残り、
       * GET が常に古い本文を返すようになる。
       */
      return db.transaction(async (tx) => {
        // (script_id, version) は UNIQUE。1 始まりの連番を維持する。
        const highest = await tx
          .select({ version: scriptVersions.version })
          .from(scriptVersions)
          .where(eq(scriptVersions.scriptId, validated.scriptId))
          .orderBy(desc(scriptVersions.version))
          .limit(1)
        const latest = highest[0]

        const inserted = await tx
          .insert(scriptVersions)
          .values({
            ...validated,
            id: newId(ScriptVersionIdSchema),
            version: latest === undefined ? 1 : latest.version + 1,
            createdAt: new Date(),
          })
          .returning()
        const versionRow = inserted[0]
        if (!versionRow) throw new Error('script_versions への INSERT が行を返しませんでした')

        const updated = await tx
          .update(scripts)
          .set({ currentVersionId: versionRow.id })
          .where(and(eq(scripts.id, validated.scriptId), isNull(scripts.deletedAt)))
          .returning()
        const scriptRow = updated[0]
        if (!scriptRow) throw new DbNotFoundError('Script', validated.scriptId)

        return {
          script: scriptRowToDomain(scriptRow),
          version: scriptVersionRowToDomain(versionRow),
        }
      })
    },

    async setCurrentVersion(scriptId, versionId) {
      const rows = await db
        .update(scripts)
        .set({ currentVersionId: versionId })
        .where(liveById(scriptId))
        .returning()
      const row = rows[0]
      if (!row) throw new DbNotFoundError('Script', scriptId)
      return scriptRowToDomain(row)
    },
  }
}
