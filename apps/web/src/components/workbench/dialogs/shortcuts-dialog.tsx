'use client'

import { EXTRA_SHORTCUTS, buildMenus, listShortcuts } from '@/lib/menu-model'

/**
 * キーボードショートカットの一覧（読むだけ）。**メニューから作る。**
 * 一覧を別に書き写すと、メニューと食い違う（lessons L-012）。
 */
export const ShortcutList = () => {
  const rows = [
    ...listShortcuts(
      buildMenus({ hasCurrentShot: true, checkedCount: 1, canUndo: true, currentHasTake: true }),
    ),
    ...EXTRA_SHORTCUTS,
  ]
  return (
    <table className="w-full max-w-md border-collapse text-sm">
      <caption className="sr-only">キーボードショートカット</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="h-6 border-b border-line">
            <th scope="row" className="py-1 text-left font-normal text-text">
              {row.label}
            </th>
            <td className="py-1 text-right">
              <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 text-xs text-text">
                {row.shortcut}
              </kbd>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
