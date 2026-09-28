'use client'

import { useMemo, type ReactNode } from 'react'
import {
  WorkbenchTransportContext,
  type TransportState,
  type WorkbenchTransport,
} from '@/components/workbench/workbench-context'
import { PlayheadSecContext } from '@/lib/playhead-sec'

/**
 * 再生の状態と位置を**別々の文脈で**配る。
 *
 * 位置は毎コマ変わる。状態（鳴っているか・持ち主・明示的な移動）は操作したときしか変わらない。
 * 同じ値で配ると、状態しか見ないパネルまで毎コマ描き直される（`@/lib/playhead-sec` の経緯）。
 */
export const WorkbenchTransportProvider = ({
  transport,
  children,
}: {
  readonly transport: WorkbenchTransport
  readonly children: ReactNode
}) => {
  const { playing, seek, owner } = transport
  const state = useMemo<TransportState>(() => ({ playing, seek, owner }), [playing, seek, owner])
  return (
    <WorkbenchTransportContext.Provider value={state}>
      <PlayheadSecContext.Provider value={transport.currentSec}>{children}</PlayheadSecContext.Provider>
    </WorkbenchTransportContext.Provider>
  )
}
