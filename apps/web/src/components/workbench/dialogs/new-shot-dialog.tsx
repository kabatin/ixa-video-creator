'use client'

import { ShotForm } from '@/components/shot-form'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { useAssets } from '@/components/workbench/asset-store'
import { nextShotOrder, nextShotStartSec } from '@/lib/shot-form'

/** 新規 Shot（ダイアログ）。作ったらその Shot を選んで閉じる。 */
export const NewShotDialogBody = () => {
  const workbench = useWorkbench()
  const shots = workbench.shots ?? []
  const { locations } = useAssets()
  return (
    <div className="mx-auto w-full max-w-2xl">
      <ShotForm
        projectId={workbench.projectId}
        nextOrder={nextShotOrder(shots)}
        defaultStartSec={nextShotStartSec(shots)}
        locations={locations.state === 'ready' ? locations.value : []}
        locationsError={locations.state === 'error' ? locations.message : undefined}
        onCreated={(shot) => {
          workbench.closeDialog()
          workbench.selectShot(shot.id)
          workbench.openInspector('settings')
        }}
        onCancel={workbench.closeDialog}
      />
    </div>
  )
}
