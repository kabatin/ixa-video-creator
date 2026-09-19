'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { usePreferences } from '@/components/preferences-root'
import { ShortcutList } from '@/components/workbench/dialogs/shortcuts-dialog'
import { describeVolume } from '@/lib/playback-state'
import {
  DENSITIES,
  DENSITY_LABELS,
  FONT_SIZES,
  FONT_SIZE_LABELS,
  THEMES,
  updateDisplay,
  updatePlayback,
} from '@/lib/preferences'
import { themeLabel } from '@/lib/theme'

/**
 * 環境設定（UI-WORKBENCH §3.4）。左に分類、右に項目。**分類を足せば項目が増やせる箱。**
 *
 * 保存先は `localStorage`（`preferences.ts`）。制作データではない。
 * **入れないもの**: API キー・Provider の接続先（規約 6: シークレットは env のみ）。
 */
const CATEGORIES = ['display', 'playback', 'shortcuts'] as const
type Category = (typeof CATEGORIES)[number]

const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  display: '表示',
  playback: '再生',
  shortcuts: 'ショートカット',
}

export const PreferencesDialogBody = () => {
  const [category, setCategory] = useState<Category>('display')
  const tabId = (value: Category): string => `preferences-${value}`

  return (
    <div className="flex h-full min-h-80 gap-4">
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label="環境設定の分類"
        className="w-40 shrink-0"
      >
        {CATEGORIES.map((value) => (
          <button
            key={value}
            id={tabId(value)}
            type="button"
            role="tab"
            aria-selected={category === value}
            aria-controls={`${tabId(value)}-panel`}
            onClick={() => {
              setCategory(value)
            }}
            className={`block h-7 w-full rounded px-2 text-left text-sm ${
              category === value
                ? 'bg-surface-2 font-semibold text-text'
                : 'text-muted hover:text-text'
            }`}
          >
            {CATEGORY_LABELS[value]}
          </button>
        ))}
      </div>
      <div
        id={`${tabId(category)}-panel`}
        role="tabpanel"
        aria-labelledby={tabId(category)}
        className="min-w-0 flex-1 space-y-4"
      >
        {category === 'display' && <DisplaySettings />}
        {category === 'playback' && <PlaybackSettings />}
        {category === 'shortcuts' && (
          <>
            <p className="text-sm text-muted">いまは読むだけです。変更はまだできません。</p>
            <ShortcutList />
          </>
        )}
      </div>
    </div>
  )
}

const Row = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <fieldset className="flex flex-wrap items-center gap-3">
    <legend className="float-left w-32 text-sm text-text">{label}</legend>
    <div className="flex flex-wrap gap-1">{children}</div>
  </fieldset>
)

/** 押して選ぶ。いま選んでいるものは `aria-pressed`。 */
const Choice = ({
  selected,
  onSelect,
  children,
}: {
  readonly selected: boolean
  readonly onSelect: () => void
  readonly children: ReactNode
}) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onSelect}
    className={`h-7 rounded-md px-3 text-sm ring-1 ${
      selected
        ? 'bg-accent text-accent-fg ring-accent'
        : 'bg-surface text-text ring-line-strong hover:bg-surface-2'
    }`}
  >
    {children}
  </button>
)

const DisplaySettings = () => {
  const { preferences, setPreferences } = usePreferences()
  const { display } = preferences
  return (
    <>
      <Row label="テーマ">
        {THEMES.map((theme) => (
          <Choice
            key={theme}
            selected={display.theme === theme}
            onSelect={() => {
              setPreferences(updateDisplay(preferences, { theme }))
            }}
          >
            {themeLabel(theme)}
          </Choice>
        ))}
      </Row>
      <Row label="文字の大きさ">
        {FONT_SIZES.map((fontSize) => (
          <Choice
            key={fontSize}
            selected={display.fontSize === fontSize}
            onSelect={() => {
              setPreferences(updateDisplay(preferences, { fontSize }))
            }}
          >
            {FONT_SIZE_LABELS[fontSize]}
          </Choice>
        ))}
      </Row>
      <Row label="画面の密度">
        {DENSITIES.map((density) => (
          <Choice
            key={density}
            selected={display.density === density}
            onSelect={() => {
              setPreferences(updateDisplay(preferences, { density }))
            }}
          >
            {DENSITY_LABELS[density]}
          </Choice>
        ))}
      </Row>
    </>
  )
}

/**
 * 再生の既定値。**開いている再生器の音量はその場の操作盤で変える。**
 * ここで変えるのは次に開いたときの初期値（再生器は開くときにこの値を読む）。
 */
const PlaybackSettings = () => {
  const { preferences, setPreferences } = usePreferences()
  const { playback } = preferences
  return (
    <>
      <Row label="音量の初期値">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={playback.volume}
          aria-label="音量の初期値"
          onChange={(event) => {
            setPreferences(updatePlayback(preferences, { volume: Number(event.target.value) }))
          }}
        />
        <span className="text-sm tabular-nums text-muted">
          {describeVolume(playback.volume, playback.muted)}
        </span>
      </Row>
      <Row label="消音">
        <Choice
          selected={playback.muted}
          onSelect={() => {
            setPreferences(updatePlayback(preferences, { muted: !playback.muted }))
          }}
        >
          {playback.muted ? '消音中' : '消音しない'}
        </Choice>
      </Row>
      <Row label="拍に吸着の既定">
        <Choice
          selected={playback.snapToBeat}
          onSelect={() => {
            setPreferences(updatePlayback(preferences, { snapToBeat: true }))
          }}
        >
          ON
        </Choice>
        <Choice
          selected={!playback.snapToBeat}
          onSelect={() => {
            setPreferences(updatePlayback(preferences, { snapToBeat: false }))
          }}
        >
          OFF
        </Choice>
      </Row>
      <p className="text-xs text-muted">
        聴きながら切る・タイムラインを開いたときの初期値です。開いている画面の切り替えはその場で行えます。
      </p>
    </>
  )
}
