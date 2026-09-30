import { sql } from 'drizzle-orm'
import { check, pgTable, text } from 'drizzle-orm/pg-core'
import { updatedAt } from './columns.js'

/**
 * 使う AI（ADR-0032）。**この環境に 1 行だけ。** 入っている AI は API と worker が動く機械のものなので、
 * ワークスペースや Project ではなく環境に 1 つ持つ。行が無ければ「まだ選んでいない」（環境変数を初期値に使う）。
 *
 * 用途ごとの値は `@ixa/domain` の `AiToolId`。ここでは列挙で縛らない
 * （名前を消した AI が残っても読み込みで落とさず、選び直してもらうため。`ai-settings-repository.ts`）。
 */
export const aiSettings = pgTable(
  'ai_settings',
  {
    id: text('id').primaryKey(),
    textTool: text('text_tool').notNull(),
    imageTool: text('image_tool').notNull(),
    videoTool: text('video_tool').notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [check('ai_settings_single_row', sql`${table.id} = 'default'`)],
)
