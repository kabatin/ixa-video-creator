/**
 * 再生の操作列のアイコン。**文字（⏮ ⏭ など）にしない。** Windows では絵文字の色付きの
 * 絵で出て、ボタンの中で浮く。線は `currentColor` で、ボタンの文字色に従う。
 */

import type { ReactNode } from 'react'

type IconProps = { readonly className?: string }

const Icon = ({ className, children }: IconProps & { readonly children: ReactNode }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true" className={className}>
    {children}
  </svg>
)

export const PlayIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 2.5 13.5 8 4 13.5Z" />
  </Icon>
)

export const PauseIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="2.5" width="3" height="11" rx="0.5" />
    <rect x="9.5" y="2.5" width="3" height="11" rx="0.5" />
  </Icon>
)

/** 1 コマ戻る（◀|）。 */
export const StepBackIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10.5 3 4 8l6.5 5Z" />
    <rect x="11.5" y="3" width="2" height="10" rx="0.5" />
  </Icon>
)

/** 1 コマ進む（|▶）。 */
export const StepForwardIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.5" y="3" width="2" height="10" rx="0.5" />
    <path d="M5.5 3 12 8l-6.5 5Z" />
  </Icon>
)

/** 前の境目へ（|◀◀）。 */
export const PreviousEditIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="1.5" y="3" width="2" height="10" rx="0.5" />
    <path d="M9 3 4 8l5 5Z" />
    <path d="M14.5 3 9.5 8l5 5Z" />
  </Icon>
)

/** 次の境目へ（▶▶|）。 */
export const NextEditIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M1.5 3 6.5 8l-5 5Z" />
    <path d="M7 3 12 8l-5 5Z" />
    <rect x="12.5" y="3" width="2" height="10" rx="0.5" />
  </Icon>
)
