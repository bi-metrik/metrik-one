import { redirect } from 'next/navigation'
import { getContextoCalidad } from '../actions'
import { MAX_MINUTOS_AUDIO } from '@/lib/calidad/transcribir'
import AuditarClient from './auditar-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Auditar una llamada nueva.
 *
 * Es accion de supervision: quien puede ver las llamadas de todo el piso puede
 * auditar una nueva. Un ejecutor no — subir una grabacion ajena y meterla al
 * tablero es exactamente lo que la segmentacion por rol existe para impedir.
 */
export default async function AuditarPage() {
  const ctx = await getContextoCalidad()
  if (!ctx) redirect('/')
  if (!ctx.canViewCalidadTodos) redirect('/calidad')

  return <AuditarClient maxMinutos={MAX_MINUTOS_AUDIO} />
}
