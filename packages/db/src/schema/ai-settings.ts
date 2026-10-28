import { sql } from 'drizzle-orm'
import { boolean, check, pgTable, text } from 'drizzle-orm/pg-core'
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
    /**
     * 声と文字起こし（ADR-0038）。**既定値をお試しにする。** 既定値の無い列を足すと、
     * 既にある 1 行が読めなくなり、保存済みの選択が全部「まだ選んでいない」に戻る。
     */
    voiceTool: text('voice_tool').notNull().default('stub'),
    transcribeTool: text('transcribe_tool').notNull().default('stub'),
    /** 曲（ADR-0048）。声と同じ理由で既定値をお試しにする。 */
    musicTool: text('music_tool').notNull().default('stub'),
    /** 効果音（ADR-0052）。声と同じ理由で既定値をお試しにする。 */
    sfxTool: text('sfx_tool').notNull().default('stub'),
    /**
     * AI のチェック（ADR-0066）。描いた絵と動画の Take を Claude が見るか。**既定は切る**
     * （声と同じ理由で既定値が要る。切るのは、チェックが Claude の利用枠を多く使うため）。
     */
    imageCheck: boolean('image_check').notNull().default(false),
    videoCheck: boolean('video_check').notNull().default(false),
    updatedAt: updatedAt(),
  },
  (table) => [check('ai_settings_single_row', sql`${table.id} = 'default'`)],
)
