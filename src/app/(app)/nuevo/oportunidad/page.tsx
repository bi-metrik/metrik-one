import { Suspense } from 'react'
import { getActiveStaffList } from '@/lib/actions/get-staff-list'
import StepperForm from './stepper-form'

export default async function NuevaOportunidadPage() {
  const staffList = await getActiveStaffList()
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-16 text-sm text-muted-foreground">Cargando...</div>}>
      <StepperForm staffList={staffList} />
    </Suspense>
  )
}
