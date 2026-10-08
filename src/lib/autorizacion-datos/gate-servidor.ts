import 'server-only'

/**
 * El gate `autorizacion_datos` de `cambiarEtapa`: sin autorización vigente del contacto, el
 * negocio no pasa de la etapa que lo declara en `config_extra.gates`. Si el viaje lleva menores,
 * exige además la casilla de menores.
 *
 * El bloqueo trae el link listo (`enlace`) para que el modal lo copie ahí mismo: el gate que dice
 * «falta» sin dar la salida deja a la comercial buscando dónde se pide.
 *
 * Falla CERRADO: si no se puede leer el estado, retiene. Es un control legal; dejar pasar por
 * falta de información es lo único que no puede hacer.
 */

import { estadoDelContacto, pedirEnlace } from './servidor'
import { faltaParaAvanzar, hayMenores, MENSAJE_GATE } from './estado'

export interface BloqueoAutorizacion {
  nombre: string
  es_gate: true
  tipo: 'autorizacion_datos'
  enlace?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

export async function bloqueoAutorizacionDatos(p: {
  supabase: Cliente
  workspaceId: string
  negocioId: string
  staffId: string | null
  mensajes?: Record<string, string>
}): Promise<BloqueoAutorizacion | null> {
  const retener = (nombre: string): BloqueoAutorizacion => ({ nombre, es_gate: true, tipo: 'autorizacion_datos' })
  const { data: neg, error } = await p.supabase
    .from('negocios')
    .select('contacto_id')
    .eq('id', p.negocioId)
    .eq('workspace_id', p.workspaceId)
    .maybeSingle()
  if (error) return retener('No se pudo revisar la autorización de datos del cliente.')
  const contactoId = (neg as { contacto_id: string | null } | null)?.contacto_id ?? null
  if (!contactoId) return retener(MENSAJE_GATE.sin_contacto)

  const [{ estado, error: errEstado }, bloques] = await Promise.all([
    estadoDelContacto(p.workspaceId, contactoId),
    p.supabase.from('negocio_bloques').select('data').eq('negocio_id', p.negocioId),
  ])
  if (errEstado || bloques.error) return retener('No se pudo revisar la autorización de datos del cliente.')

  const menores = hayMenores(((bloques.data ?? []) as Array<{ data: Record<string, unknown> | null }>).map(b => b.data))
  const falta = faltaParaAvanzar(estado, { menores })
  if (!falta) return null
  if (falta === 'sin_contacto') return retener(MENSAJE_GATE.sin_contacto)

  const { enlace } = await pedirEnlace({
    workspaceId: p.workspaceId, contactoId, staffId: p.staffId, negocioId: p.negocioId, medio: 'whatsapp_reenviado',
  })
  const nombre = p.mensajes?.[`autorizacion_datos:${falta}`] ?? p.mensajes?.autorizacion_datos ?? MENSAJE_GATE[falta]
  return { nombre, es_gate: true, tipo: 'autorizacion_datos', ...(enlace ? { enlace: enlace.url } : {}) }
}
