import { redirect } from 'next/navigation'
import { getContextoCalidad, getDatosDueno } from '../actions'
import DuenoClient from './dueno-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Vista de dueno. Privada: plata y riesgo.
 *
 * Es lo opuesto al muro. El muro vive en un televisor que ve todo el piso; esta
 * pantalla la ve una sola persona. Por eso no comparten componentes ni datos:
 * fundidas, no sirven para ninguna de las dos audiencias.
 *
 * Guard doble:
 *   - Aqui, por rol (un supervisor que teclee la URL cae en /calidad).
 *   - En getDatosDueno, otra vez, porque `calidad_dinero_cuotas` se lee con
 *     service_role y ahi no hay RLS que respalde nada.
 */
export default async function DuenoPage() {
  const ctx = await getContextoCalidad()
  if (!ctx) redirect('/')
  if (!ctx.canViewCalidadDinero) redirect('/calidad')

  const datos = await getDatosDueno()
  if (!datos) redirect('/calidad')

  return <DuenoClient datos={datos} />
}
