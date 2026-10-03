'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { isPlaceKeyAnywhere, resolveCutEditorCommand, type CutEditorKeyEvent } from '@/lib/cut-editor-keys'

/** 打鍵が呼ぶ先。中身は `cut-editor.tsx` が持つ（区切りの状態はそこにある）。 */
export type CutEditorKeyHandlers = {
  readonly placeMark: () => void
  readonly removePreviousMark: () => void
  readonly removeSelectedMark: () => void
  readonly selectPreviousMark: () => void
  readonly selectNextMark: () => void
  readonly nudgeSelectedMark: (deltaSec: number) => void
  readonly toggleSnap: () => void
  readonly togglePlay: () => void
  readonly nudgePlayhead: (deltaSec: number) => void
  readonly seekEdge: (edge: 'start' | 'end') => void
}

const targetOf = (node: HTMLElement | null): CutEditorKeyEvent['target'] =>
  node === null
    ? null
    : { tagName: node.tagName, isContentEditable: node.isContentEditable, role: node.getAttribute('role') }

/**
 * 聴きながら切るの打鍵（`cut-editor.tsx` から分けた）。行き先の判定は `cut-editor-keys.ts`（純粋な関数）。
 *
 * - フォーカスが**この画面の入れ物の中**にあるときは、区切りと再生の割り当てをすべて受ける
 * - `placeAnywhere` なら、**外にあっても Enter / S で区切りを置く**（制作者 2026-10-03「テロップのように Enter とかで
 *   置けるようにしたい」）。歌詞の Enter と同じく、文字を打っている間は取らない
 */
export const useCutEditorKeyboard = ({
  enabled,
  placeAnywhere,
  containerRef,
  handlers,
}: {
  readonly enabled: boolean
  readonly placeAnywhere: boolean
  readonly containerRef: RefObject<HTMLElement | null>
  readonly handlers: CutEditorKeyHandlers
}): void => {
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    if (!enabled) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      const node = event.target instanceof HTMLElement ? event.target : null
      const keys = {
        key: event.key,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        target: targetOf(node),
      }
      const run = latest.current
      const resolved = resolveCutEditorCommand({
        ...keys,
        // **この画面の入れ物に限る。** 目印で `closest` すると、別の CutEditor の中でも真になり、両方が同じ打鍵で動く。
        insideCutEditor: node !== null && containerRef.current?.contains(node) === true,
      })
      if (resolved === null) {
        if (placeAnywhere && isPlaceKeyAnywhere(keys)) {
          event.preventDefault()
          run.placeMark()
        }
        return
      }
      event.preventDefault()

      if (resolved.source === 'playback') {
        const command = resolved.command
        if (command.kind === 'toggle') run.togglePlay()
        else if (command.kind === 'nudge') run.nudgePlayhead(command.deltaSec)
        else run.seekEdge(command.edge)
        return
      }

      const command = resolved.command
      switch (command.type) {
        case 'place_mark':
          run.placeMark()
          return
        case 'remove_previous_mark':
          run.removePreviousMark()
          return
        case 'remove_selected_mark':
          run.removeSelectedMark()
          return
        case 'select_previous_mark':
          run.selectPreviousMark()
          return
        case 'select_next_mark':
          run.selectNextMark()
          return
        case 'nudge_selected_mark':
          run.nudgeSelectedMark(command.deltaSec)
          return
        case 'toggle_snap':
          run.toggleSnap()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [enabled, placeAnywhere, containerRef])
}
