import type { Ancla } from '@/lib/suscripciones-producto/ancla'
import { anotarEnAncla } from '@/lib/suscripciones-producto/bitacora'
import { consultarEnlaceBold, idEnlaceDeUrl } from '@/lib/suscripciones/pasarela/bold'
import { estadoDelEnlace, textoCargoSaltado, type EstadoPagoPorEnlace } from './pago-unico'

/**
 * El lado de Supabase (y de la consulta a Bold) de la exclusión mutua entre el enlace de pago y la
 * tarjeta de un CDA (reglas en `pago-unico.ts`). Sin `server-only`: recibe el cliente y la consulta, y lo
 * importan el cobro con la tarjeta y sus pruebas.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface DepsPagoUnico {
  /** La consulta del enlace de Bold (`GET /online/link/v1/{id}`). En pruebas, un doble: nunca Bold real. */
  consultarEnlace?: (idEnlace: string) => Promise<{ ok: true; estado: string } | { ok: false; error: string }>
}

interface Cuota {
  cobradorId: string
  planCobroId: string
  numeroCuota: number
}

/** El cobro programado de la cuota sin pagar ni anular, con su enlace (vigente o retirado). */
async function cobroConEnlace(db: Db, c: Cuota): Promise<{ id: string; url: string; expira: string | null } | null> {
  const r = await db
    .from('cobros')
    .select('id, enlace_pago_url, enlace_pago_expira, fecha, anulado_at')
    .eq('workspace_id', c.cobradorId)
    .eq('plan_cobro_id', c.planCobroId)
    .eq('numero_cuota', c.numeroCuota)
    .eq('tipo_cobro', 'programado')
    .maybeSingle()
  if (r.error) throw new Error(`el cobro de la cuota ${c.numeroCuota}: ${r.error.message}`)
  const f = r.data as { id: string; enlace_pago_url: string | null; enlace_pago_expira: string | null; fecha: string | null; anulado_at: string | null } | null
  if (!f || f.fecha || f.anulado_at || !f.enlace_pago_url) return null
  return { id: f.id, url: f.enlace_pago_url, expira: f.enlace_pago_expira }
}

/**
 * ¿Hay un pago en curso (o hecho y sin registrar) por el enlace de Bold de esta cuota? Se consulta aunque
 * ONE ya haya retirado el enlace: Bold no lo anula, y quien tenga la URL lo puede seguir pagando. Un
 * enlace de otra pasarela no se consulta (los CDA pagan por Bold). Una lectura de la base que falla se
 * cuenta como `sin_consulta`: sin saberlo, no se cobra.
 */
export async function pagoPorEnlaceDeLaCuota(db: unknown, c: Cuota, deps: DepsPagoUnico = {}): Promise<EstadoPagoPorEnlace> {
  let cobro: Awaited<ReturnType<typeof cobroConEnlace>>
  try {
    cobro = await cobroConEnlace(db as Db, c)
  } catch (e) {
    return { tipo: 'sin_consulta', idEnlace: '(sin leer)', error: e instanceof Error ? e.message : String(e) }
  }
  const idEnlace = cobro ? idEnlaceDeUrl(cobro.url) : null
  if (!idEnlace) return { tipo: 'libre' }
  const consultar = deps.consultarEnlace ?? ((id: string) => consultarEnlaceBold(id))
  const r = await consultar(idEnlace).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
  return estadoDelEnlace(idEnlace, r)
}

/**
 * Retira el enlace VIGENTE de la cuota: lo vence ahora en `enlace_pago_expira` y conserva la URL (ver
 * `pago-unico.ts`, «Bold no anula enlaces»). Deja la línea en la historia del cliente. `false` si no
 * había enlace vigente que retirar. Nunca lanza: retirar acompaña a lo que la persona pidió.
 */
export async function retirarEnlaceDeCuota(
  dbCliente: unknown,
  c: Cuota & { ancla: Ancla | null; motivo: string; ahoraMs: number },
): Promise<boolean> {
  const db = dbCliente as Db
  try {
    const cobro = await cobroConEnlace(db, c)
    if (!cobro) return false
    const ahora = new Date(c.ahoraMs).toISOString()
    if (cobro.expira !== null && !(Date.parse(cobro.expira) > c.ahoraMs)) return false
    const u = await db
      .from('cobros')
      .update({ enlace_pago_expira: ahora })
      .eq('id', cobro.id)
      .eq('enlace_pago_url', cobro.url)
      .is('fecha', null)
      .select('id')
    if (u.error) throw new Error(u.error.message)
    if ((u.data ?? []).length !== 1) return false
    const id = idEnlaceDeUrl(cobro.url)
    await anotarEnAncla(
      db,
      {
        ancla: c.ancla,
        workspaceId: c.cobradorId,
        tipo: 'enlace_pago_retirado',
        texto: `Se retiró el enlace de pago de la cuota ${c.numeroCuota} (${c.motivo}).${id ? ` Bold no permite anular el enlace ${id}: antes de cada cobro con tarjeta se consulta su estado.` : ''}`,
        datos: { cobro_id: cobro.id, numero_cuota: c.numeroCuota, enlace: id, motivo: c.motivo },
      },
      'pago-unico-cda',
    )
    return true
  } catch (e) {
    console.error(`[pago-unico] retirar el enlace de la cuota ${c.numeroCuota}:`, e instanceof Error ? e.message : e)
    return false
  }
}

/** La línea del rastro de un cargo a la tarjeta que no se hizo por un pago del enlace. Nunca lanza. */
export async function anotarCargoSaltado(
  db: unknown,
  c: { cobradorId: string; ancla: Ancla | null; numeroCuota: number; estado: Exclude<EstadoPagoPorEnlace, { tipo: 'libre' }>; manual: boolean },
): Promise<void> {
  await anotarEnAncla(
    db,
    {
      ancla: c.ancla,
      workspaceId: c.cobradorId,
      tipo: 'cobro_tarjeta_saltado',
      texto: textoCargoSaltado(c.numeroCuota, c.estado, c.manual),
      datos: {
        numero_cuota: c.numeroCuota,
        enlace: c.estado.idEnlace,
        estado_enlace: c.estado.tipo === 'en_curso' ? c.estado.estado : 'sin_consulta',
        ...(c.manual ? { manual: true } : {}),
      },
    },
    'pago-unico-cda',
  )
}
