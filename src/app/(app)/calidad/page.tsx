import { redirect } from 'next/navigation'
import { getContextoCalidad, getLlamadas } from './actions'
import CalidadClient from './calidad-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function CalidadPage() {
  // getContextoCalidad devuelve null si no hay sesion, si el workspace no tiene
  // modules.calidad_llamadas o si el rol no puede ver el modulo.
  const ctx = await getContextoCalidad()
  if (!ctx) redirect('/')

  const datos = await getLlamadas()
  if (!datos) redirect('/')

  return (
    <CalidadClient
      datos={datos}
      soloMias={!ctx.canViewCalidadTodos}
      puedeAuditar={ctx.canViewCalidadTodos}
    />
  )
}
