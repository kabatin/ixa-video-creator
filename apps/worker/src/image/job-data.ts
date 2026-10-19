import { ImageGenerationJobId } from '@ixa/domain'
import { z } from 'zod'

/**
 * image キューのジョブデータ。**ID だけを運ぶ**（ADR-0008）。中身の正は `image_generation_jobs` の行。
 * `.strict()` で、ほかの値を積んで行とずれる余地を無くす。
 */
export const ImageJobData = z
  .object({
    imageJobId: ImageGenerationJobId,
    /** 省略は描く手順。`check` は作った絵のチェックと、当てる・やり直すの判断（ADR-0055）。 */
    step: z.literal('check').optional(),
  })
  .strict()
export type ImageJobData = z.infer<typeof ImageJobData>
