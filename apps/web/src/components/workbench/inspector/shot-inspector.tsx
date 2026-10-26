'use client'

import type { Shot } from '@ixa/domain'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ShotStatusBadge } from '@/components/shot-status-badge'
import { useAssets } from '@/components/workbench/asset-store'
import { ShotCastSection } from '@/components/workbench/inspector/shot-cast-section'
import { ShotDialogueSection } from '@/components/workbench/inspector/shot-dialogue-section'
import {
  DetailFields,
  LocationField,
  ReviewBody,
  TimeFields,
} from '@/components/workbench/inspector/shot-inspector-fields'
import { ShotStoryboardSection } from '@/components/workbench/inspector/shot-storyboard-section'
import { ShotTakeBlock } from '@/components/workbench/inspector/shot-take-block'
import { StartFrameField } from '@/components/workbench/inspector/start-frame-field'
import { EndFrameField, type EndFrameCandidate } from '@/components/workbench/inspector/end-frame-field'
import { useShotDub } from '@/components/workbench/use-shot-dub'
import { CollapsibleSection, SectionToc } from '@/components/workbench/ui/collapsible-section'
import { MenuButton } from '@/components/workbench/ui/more-menu'
import { useShotMenu } from '@/components/workbench/use-shot-menu'
import { ObjectHeader } from '@/components/workbench/ui/object-header'
import { useShotTakes } from '@/components/workbench/use-shot-takes'
import { useWorkbench, type InspectorTab } from '@/components/workbench/workbench-context'
import { Button } from '@/components/ui/button'
import { formatSpan } from '@/lib/format-time'
import { isGeneratingStatus } from '@/lib/shot-display'
import { startFrameKnownFor } from '@/lib/shot-posters'
import {
  SHOT_SECTION_IDS,
  SHOT_SECTION_TITLES,
  shotSectionDefaultOpen,
  shotSectionSummary,
  shotSectionTocLabel,
  type ShotSectionFacts,
  type ShotSectionId,
} from '@/lib/shot-inspector-sections'

/** 上の欄が読み込まれて背が伸びる間、頼まれた区切りへ送り直す時間。 */
const FOLLOW_SCROLL_MS = 2_000

/** メニュー「生成」「Take を作る…」などから頼まれた所。どれも「Take」の区切りにまとまった（2026-10-26）。 */
const TAB_SECTION: Readonly<Record<InspectorTab, ShotSectionId>> = Object.freeze({
  settings: 'storyboard',
  generate: 'take',
  review: 'take',
})

/** 開く合図（同じ区切りをもう一度頼まれても、数が進むので開き直す）。 */
type OpenRequest = { readonly id: ShotSectionId; readonly seq: number }

/**
 * Shot のインスペクター（UI-WORKBENCH-2 §5.2）。**1 本のスクロール**（タブをやめた。生成とレビューが隠れて見つからなかった）。
 * 区切りは畳める見出しの行にし、上に目次を置く（制作者 2026-10-26「縦長だし区切りも良く分からない」）。
 * 欄は確定で自動保存する。取り消せない削除は `⋯` の中。
 */
export const ShotInspector = ({
  shot,
  isFirst,
}: {
  readonly shot: Shot
  readonly isFirst: boolean
}) => {
  const workbench = useWorkbench()
  const shotMenu = useShotMenu()
  const { locations } = useAssets()
  const save = async (patch: Parameters<typeof workbench.saveShot>[1]): Promise<void> => {
    await workbench.saveShot(shot.id, patch)
  }
  const generating = isGeneratingStatus(shot.status)
  // 声の差し替え（ADR-0062）。終わったら採用が新しい Take に移るので、Shot を読み直す。
  const dub = useShotDub(shot, workbench.serverEpoch, workbench.refresh)
  // Take は 1 回だけ引く（要約・Take の区切り・声の差し替え・レビューで使い回す）。
  const { takes, error: takesError } = useShotTakes(shot, workbench.posterEpoch)
  const adopted = useMemo(
    () => takes?.find((take) => take.id === shot.selectedTakeId) ?? null,
    [takes, shot.selectedTakeId],
  )
  const failedDub = dub.state?.latestJob?.status === 'failed' ? dub.state.latestJob : null
  /**
   * 最初のフレームが付いているか（ADR-0025）。欄が読めたら欄の答え、まだならサムネの答え（**null は分からない**）。
   * どの Shot の答えかを一緒に持つ（Shot を替えた直後に前の Shot の答えを使わない）。
   */
  const [reportedFrame, setReportedFrame] = useState<{ readonly shotId: Shot['id']; readonly has: boolean } | null>(null)
  const onStartFrameChange = useCallback(
    (has: boolean) => {
      setReportedFrame({ shotId: shot.id, has })
    },
    [shot.id],
  )
  const hasStartFrame =
    reportedFrame?.shotId === shot.id ? reportedFrame.has : startFrameKnownFor(workbench.posters, shot.id)
  /** 終わりの画像に使える、最初のフレームが付いているほかの Shot（ループの終わりに最初の Shot の絵を使う）。 */
  const endFrameCandidates = useMemo<readonly EndFrameCandidate[]>(
    () =>
      (workbench.shots ?? [])
        .filter((other) => other.id !== shot.id && startFrameKnownFor(workbench.posters, other.id) === true)
        .map((other) => ({ id: other.id, code: other.code })),
    [workbench.shots, workbench.posters, shot.id],
  )
  const locationName =
    locations.state === 'ready' ? (locations.value.find((item) => item.id === shot.locationId)?.name ?? null) : null
  const facts: ShotSectionFacts = { shot, locationName, hasStartFrame, takes }

  const sections = useRef<Partial<Record<ShotSectionId, HTMLElement | null>>>({})
  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(null)
  const requestOpen = useCallback((id: ShotSectionId) => {
    setOpenRequest((current) => ({ id, seq: (current?.seq ?? 0) + 1 }))
  }, [])

  /** 目次から: その区切りを開いて送る。 */
  const jump = (id: ShotSectionId): void => {
    requestOpen(id)
    sections.current[id]?.scrollIntoView({ block: 'start' })
  }

  /**
   * メニュー「生成」や「Take を作る…」から来たら、その区切りを開く（畳んでいても）。
   * 最初に開いたときの「絵コンテ」は頼まれたわけではないので、覚えた開け閉めを崩さない。
   */
  useEffect(() => {
    if (workbench.inspectorTab === 'settings' && workbench.inspectorRequest === 0) return
    requestOpen(TAB_SECTION[workbench.inspectorTab])
  }, [workbench.inspectorTab, workbench.inspectorRequest, requestOpen])

  /**
   * 頼まれた区切りまで送る（同じタブをもう一度頼まれても送り直す）。
   * 上の欄（案・絵・登場人物）は遅れて読み込まれて背が伸びるので、少しの間は伸びるたびに送り直す
   * （「Take を作る」を一番上に置いていた頃の理由。並びを作業の順に戻したので、ここで追いかける）。
   */
  const body = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const target = sections.current[TAB_SECTION[workbench.inspectorTab]]
    target?.scrollIntoView({ block: 'start' })
    const scroller = body.current
    const content = scroller?.firstElementChild
    // 一番上（絵コンテ）は伸びても位置が変わらないので追わない。
    if (workbench.inspectorTab === 'settings' || typeof ResizeObserver === 'undefined') return undefined
    if (target === null || target === undefined || scroller === null || content === null || content === undefined) {
      return undefined
    }
    const observer = new ResizeObserver(() => {
      target.scrollIntoView({ block: 'start' })
    })
    observer.observe(content)
    // **利用者が自分で動かしたら追わない**（欄が読み込まれて伸びるたびに引き戻されていた。レビューで見つけた）。
    const stop = (): void => {
      observer.disconnect()
    }
    const userMoves = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const
    userMoves.forEach((type) => {
      scroller.addEventListener(type, stop, { once: true, passive: true })
    })
    const timer = window.setTimeout(stop, FOLLOW_SCROLL_MS)
    return () => {
      window.clearTimeout(timer)
      userMoves.forEach((type) => {
        scroller.removeEventListener(type, stop)
      })
      observer.disconnect()
    }
  }, [workbench.inspectorTab, workbench.inspectorRequest, shot.id])

  /** 区切りの見出しの行。名前・要約・既定の開け閉めは `lib/shot-inspector-sections`。 */
  const block = (id: ShotSectionId, children: ReactNode, action?: ReactNode) => (
    <CollapsibleSection
      scope="shot"
      id={id}
      title={SHOT_SECTION_TITLES[id]}
      summary={shotSectionSummary(id, facts)}
      defaultOpen={shotSectionDefaultOpen(id, facts)}
      openSignal={openRequest?.id === id ? openRequest.seq : 0}
      action={action}
      sectionRef={(element) => {
        sections.current[id] = element
      }}
    >
      {children}
    </CollapsibleSection>
  )

  return (
    <div className="flex h-full flex-col">
      <ObjectHeader
        kind="Shot"
        title={shot.code}
        meta={formatSpan(shot.startSec, shot.durationSec)}
        badge={<ShotStatusBadge status={shot.status} />}
        menu={
          // 右クリック（長押し）と同じ中身（2026-09-30）。再生位置で決まる行があるので押した瞬間に作る。
          <MenuButton label={`${shot.code} のその他の操作`} items={() => shotMenu.itemsFor(shot)} />
        }
      />
      <SectionToc
        items={SHOT_SECTION_IDS.map((id) => ({ id, label: shotSectionTocLabel(id, facts) }))}
        onJump={(id) => {
          const known = SHOT_SECTION_IDS.find((candidate) => candidate === id)
          if (known !== undefined) jump(known)
        }}
      />
      <div ref={body} className="workbench-panel-body relative min-h-0 flex-1 overflow-auto">
        {/*
          作業の順に並べる（制作者 2026-10-03「Take 作成より先にやるべき画像生成を上のほうに持ってくる」）:
          絵コンテ → 参照 → セリフ → 絵 → Take → 時間。普段触らないもの（詳しい設定・レビュー）は下に畳む。
        */}
        <div>
          {block('storyboard', <ShotStoryboardSection shot={shot} disabled={generating} />)}
          {block(
            'references',
            <>
              <LocationField shot={shot} disabled={generating} onSave={save} />
              <ShotCastSection shot={shot} version={workbench.serverEpoch} />
            </>,
          )}
          {block(
            'dialogue',
            <ShotDialogueSection
              key={shot.id}
              shot={shot}
              version={workbench.serverEpoch}
              disabled={generating}
              suggestedSpans={failedDub?.error?.suggestedSpans ?? []}
              onSave={save}
            />,
          )}
          {block(
            'frame',
            <>
              <StartFrameField
                shot={shot}
                workspaceId={workbench.project.workspaceId}
                disabled={generating}
                onChange={onStartFrameChange}
                // 付け外ししたら、サムネとプレビュー（Take が無い Shot は絵を映す）を読み直す。ドロップで付けたときと同じ。
                onSaved={workbench.refresh}
                // 絵ができたとき（出来事で posterEpoch が進む）にも読み直す。どちらも増えるだけなので和で足りる。
                version={workbench.serverEpoch + workbench.posterEpoch}
              />
              <EndFrameField
                shot={shot}
                workspaceId={workbench.project.workspaceId}
                candidates={endFrameCandidates}
                disabled={generating}
                // 付けるとサーバが「Take を尺に合わせる」に替えるので、Shot を読み直して時間の合わせ方の欄を追いつかせる。
                onSaved={workbench.refresh}
                // 取り消し（⌘Z）で戻ったときも読み直す。最初のフレームの欄と同じ。
                version={workbench.serverEpoch}
              />
            </>,
          )}
          {block(
            'take',
            <ShotTakeBlock
              shot={shot}
              hasStartFrame={hasStartFrame === true}
              takes={takes}
              takesError={takesError}
              adopted={adopted}
              dub={dub}
            />,
            <Button
              size="sm"
              onClick={() => {
                workbench.focusPanel('compare')
              }}
            >
              比較を開く
            </Button>,
          )}
          {block('time', <TimeFields shot={shot} disabled={generating} onSave={save} />)}
          {block('details', <DetailFields shot={shot} isFirst={isFirst} disabled={generating} onSave={save} />)}
          {block('review', <ReviewBody shot={shot} adopted={adopted} />)}
        </div>
      </div>
    </div>
  )
}
