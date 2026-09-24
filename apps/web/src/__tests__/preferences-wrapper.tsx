import type { ReactNode } from 'react'
import { PreferencesRoot } from '@/components/preferences-root'

/**
 * 環境設定を要る部品を描くときの殻。
 *
 * 音量と消音の持ち主は `PreferencesRoot`（`usePlaybackVolume` が引く）。
 * 鳴らす側が複数あるので**持ち主はひとつでなければならない**。
 * 殻の外で描くと `usePreferences` が落ちる。それは契約どおりなので、
 * 各テストは既定値を持つこの殻の中で描く。
 */
export const PreferencesWrapper = ({ children }: { readonly children: ReactNode }) => (
  <PreferencesRoot>{children}</PreferencesRoot>
)
