'use client'

import { ShotForm } from '@/components/shot-form'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { nextShotOrder, nextShotStartSec } from '@/lib/shot-form'

/** 新規 Shot（ダイアログ）。作ったらその Shot を選んで閉じる。 */
export const NewShotDialogBody = () => {
  const workbench = useWorkbench()
  const shots = workbench.shots ?? []
  return (
    <div className="mx-auto w-full max-w-2xl">
      <ShotForm
        projectId={workbench.projectId}
        nextOrder={nextShotOrder(shots)}
        defaultStartSec={nextShotStartSec(shots)}
        locations={workbench.locations ?? []}
        locationsError={workbench.locations === null ? 'ロケーションを読み込めませんでした。' : undefined}
        onCreated={(shot) => {
          workbench.closeDialog()
          workbench.selectShot(shot.id)
          workbench.openInspector('settings')
        }}
      />
    </div>
  )
}
