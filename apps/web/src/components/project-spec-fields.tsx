import type { AspectRatio } from '@ixa/domain'
import type { ReactNode } from 'react'
import { ChoiceCard, ChoiceGroup } from '@/components/ui/choice-card'
import { FieldError } from '@/components/form/field-error'
import { ASPECT_CHOICES, FPS_CHOICES, resolutionChoicesFor } from '@/lib/project-spec-choices'

/**
 * 新規作成とプロジェクト設定で共有する「形・大きさ・fps」の選択（制作者 2026-10-03「アスペクト比は数字を見ても、縦だっけ？
 * 横だっけ？となり形も分かりづらい。実際のサイズ図を選ぶ形がよさそう」「解像度もサイズ図的なものを選ぶ形式」）。
 * 言葉と図の材料は `lib/project-spec-choices.ts`。ここは描くだけ。
 */

/** 図の入れ物の一辺（px）。 */
const BOX = 40

const fit = (width: number, height: number): { readonly w: number; readonly h: number } =>
  width >= height ? { w: BOX, h: (BOX * height) / width } : { w: (BOX * width) / height, h: BOX }

/** 画面の形（縦横の比どおりの四角）。 */
const ShapeFigure = ({ width, height }: { readonly width: number; readonly height: number }) => {
  const { w, h } = fit(width, height)
  return (
    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center">
      <span className="rounded-sm border-2 border-current text-text" style={{ width: w, height: h }} />
    </span>
  )
}

/** 大きさ（その形でいちばん大きいものの枠の中に、この大きさを塗る）。 */
const SizeFigure = ({ aspect, scale }: { readonly aspect: AspectRatio; readonly scale: number }) => {
  const [width = 1, height = 1] = aspect.split(':').map(Number)
  const { w, h } = fit(width, height)
  return (
    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center">
      <span className="relative rounded-sm border border-dashed border-line-strong" style={{ width: w, height: h }}>
        <span
          className="absolute bottom-0 left-0 rounded-sm bg-text/70"
          style={{ width: w * scale, height: h * scale }}
        />
      </span>
    </span>
  )
}

const Name = ({ children }: { readonly children: ReactNode }) => (
  <span className="text-sm font-medium text-text">{children}</span>
)
const Hint = ({ children }: { readonly children: ReactNode }) => (
  <span className="text-xs text-muted">{children}</span>
)

export const AspectRatioField = ({
  value,
  disabled,
  error,
  onChange,
}: {
  readonly value: string
  readonly disabled: boolean
  readonly error?: string | undefined
  readonly onChange: (value: AspectRatio) => void
}) => (
  <div>
    <ChoiceGroup legend="画面の形（アスペクト比）" columns={5} disabled={disabled}>
      {ASPECT_CHOICES.map((choice) => (
        <ChoiceCard
          key={choice.value}
          name="project-aspect-ratio"
          checked={value === choice.value}
          onSelect={() => {
            onChange(choice.value)
          }}
          figure={<ShapeFigure width={choice.width} height={choice.height} />}
          stacked
        >
          <Name>{`${choice.name} ${choice.value}`}</Name>
          <Hint>{choice.hint}</Hint>
        </ChoiceCard>
      ))}
    </ChoiceGroup>
    <FieldError id="project-aspect-ratio-error" message={error} />
  </div>
)

export const ResolutionField = ({
  aspectRatio,
  value,
  disabled,
  error,
  savedKey,
  onChange,
}: {
  readonly aspectRatio: AspectRatio
  readonly value: string
  readonly disabled: boolean
  readonly error?: string | undefined
  /**
   * 保存済みの値がこの形の選択肢に無いとき、その値（`1920x1080`）。**落とさず選択肢に残す**
   * （落とすと、開いただけで別の解像度に化ける）。
   */
  readonly savedKey?: string
  readonly onChange: (key: string) => void
}) => {
  const choices = resolutionChoicesFor(aspectRatio)
  const extra = savedKey !== undefined && !choices.some((choice) => choice.key === savedKey) ? savedKey : null
  return (
    <div>
      <ChoiceGroup legend="大きさ（解像度）" columns={3} disabled={disabled}>
        {choices.map((choice) => (
          <ChoiceCard
            key={choice.key}
            name="project-resolution"
            checked={value === choice.key}
            onSelect={() => {
              onChange(choice.key)
            }}
            figure={<SizeFigure aspect={aspectRatio} scale={choice.scale} />}
          >
            <Name>{choice.name}</Name>
            <span className="text-xs tabular-nums text-text">{choice.size}</span>
            <Hint>{choice.hint}</Hint>
          </ChoiceCard>
        ))}
        {extra !== null && (
          <ChoiceCard
            name="project-resolution"
            checked={value === extra}
            onSelect={() => {
              onChange(extra)
            }}
          >
            <Name>保存済みの値</Name>
            <span className="text-xs tabular-nums text-text">{extra.replace('x', '×')}</span>
            <Hint>この形の選択肢にない大きさです</Hint>
          </ChoiceCard>
        )}
      </ChoiceGroup>
      <FieldError id="project-resolution-error" message={error} />
    </div>
  )
}

export const FpsField = ({
  value,
  disabled,
  error,
  note,
  onChange,
}: {
  readonly value: string
  readonly disabled: boolean
  readonly error?: string | undefined
  /** 動画の AI に合わせる案内など（下に添える）。 */
  readonly note?: ReactNode
  readonly onChange: (fps: string) => void
}) => (
  <div>
    <ChoiceGroup legend="なめらかさ（fps・1 秒のコマ数）" columns={2} disabled={disabled}>
      {FPS_CHOICES.map((choice) => (
        <ChoiceCard
          key={choice.value}
          name="project-fps"
          checked={value === String(choice.value)}
          onSelect={() => {
            onChange(String(choice.value))
          }}
        >
          <Name>{`${String(choice.value)} fps`}</Name>
          <Hint>{choice.hint}</Hint>
        </ChoiceCard>
      ))}
    </ChoiceGroup>
    {note}
    <FieldError id="project-fps-error" message={error} />
  </div>
)
