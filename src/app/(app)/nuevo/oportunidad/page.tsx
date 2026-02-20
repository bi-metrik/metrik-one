import { Suspense } from 'react'
import StepperForm from './stepper-form'

export default function NuevaOportunidadPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-16 text-sm text-muted-foreground">Cargando...</div>}>
      <StepperForm />
    </Suspense>
  )
}
