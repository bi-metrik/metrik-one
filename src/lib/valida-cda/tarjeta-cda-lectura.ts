/**
 * La tarjeta activa del pago automático de un CDA (`tarjetas_pago_cda`, 20261030220000), leída con el
 * cliente de servicio. Aparte de `tarjeta-cda-servidor.ts` para que el motor de cobro
 * (`cobro-token-servidor.ts`) la lea sin importar las acciones, que a su vez lo importan a él.
 *
 * Sin la tabla (migración sin aplicar) no hay tarjeta: ningún plan de un CDA puede estar en ePayco sin
 * ella, así que el lado seguro es «sin tarjeta». Cualquier otro error se lanza: no se cobra a ciegas.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface TarjetaCda {
  id: string
  workspaceId: string
  workspaceClienteId: string
  servicioContratadoId: string
  negocioId: string
  planCobroId: string
  ref: string
  ultimos4: string | null
  titular: Record<string, unknown>
  celular: string
  correo: string
  /** 'YYYY-MM-DD': solo los períodos que empiezan DESPUÉS de este día se cobran solos (D3). */
  cobroDesde: string
  diaRenovacion: number
  /** La vigencia de la v1.5 aceptada (11.7). */
  terminosVigenteDesde: string
  ip: string | null
}

export const COLUMNAS_TARJETA_CDA =
  'id, workspace_id, workspace_cliente_id, servicio_contratado_id, negocio_id, plan_cobro_id, metodo_pago_ref, ultimos4, titular, celular, correo, cobro_desde, dia_renovacion, terminos_vigente_desde, ip'

interface FilaTarjetaCda {
  id: string
  workspace_id: string
  workspace_cliente_id: string
  servicio_contratado_id: string
  negocio_id: string
  plan_cobro_id: string
  metodo_pago_ref: string
  ultimos4: string | null
  titular: Record<string, unknown> | null
  celular: string
  correo: string
  cobro_desde: string
  dia_renovacion: number
  terminos_vigente_desde: string
  ip: string | null
}

export function deFilaTarjetaCda(f: FilaTarjetaCda): TarjetaCda {
  return {
    id: f.id,
    workspaceId: f.workspace_id,
    workspaceClienteId: f.workspace_cliente_id,
    servicioContratadoId: f.servicio_contratado_id,
    negocioId: f.negocio_id,
    planCobroId: f.plan_cobro_id,
    ref: f.metodo_pago_ref,
    ultimos4: f.ultimos4,
    titular: f.titular ?? {},
    celular: f.celular,
    correo: f.correo,
    cobroDesde: String(f.cobro_desde).slice(0, 10),
    diaRenovacion: Number(f.dia_renovacion),
    terminosVigenteDesde: String(f.terminos_vigente_desde).slice(0, 10),
    ip: f.ip,
  }
}

/** ¿El error es «la tabla no existe»? (Postgres 42P01; PostgREST PGRST205 sin la tabla en su caché.) */
export function esTablaAusente(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return e?.code === '42P01' || e?.code === 'PGRST205' || /tarjetas_pago_cda.*(does not exist|not find)/i.test(e?.message ?? '')
}

async function una(q: Promise<{ data: unknown; error: { code?: string; message: string } | null }>, que: string): Promise<TarjetaCda | null> {
  const r = await q
  if (r.error) {
    if (esTablaAusente(r.error)) return null
    throw new Error(`tarjeta del CDA (${que}): ${r.error.message}`)
  }
  const filas = (Array.isArray(r.data) ? r.data : r.data ? [r.data] : []) as FilaTarjetaCda[]
  return filas[0] ? deFilaTarjetaCda(filas[0]) : null
}

/** La tarjeta activa del plan de cobro, o `null`. */
export function tarjetaCdaDelPlan(db: unknown, planCobroId: string): Promise<TarjetaCda | null> {
  return una(
    (db as Db).from('tarjetas_pago_cda').select(COLUMNAS_TARJETA_CDA).eq('plan_cobro_id', planCobroId).eq('estado', 'activa').limit(1),
    `plan ${planCobroId}`,
  )
}

/** La tarjeta activa del contrato, o `null`. */
export function tarjetaCdaDelContrato(db: unknown, servicioContratadoId: string): Promise<TarjetaCda | null> {
  return una(
    (db as Db).from('tarjetas_pago_cda').select(COLUMNAS_TARJETA_CDA).eq('servicio_contratado_id', servicioContratadoId).eq('estado', 'activa').limit(1),
    `contrato ${servicioContratadoId}`,
  )
}

/** La tarjeta activa del negocio del cobrador que paga ese espacio, o `null` (el pagador del motor de cobro). */
export function tarjetaCdaDelNegocio(db: unknown, p: { cobradorId: string; negocioId: string; pagadorId: string }): Promise<TarjetaCda | null> {
  return una(
    (db as Db)
      .from('tarjetas_pago_cda')
      .select(COLUMNAS_TARJETA_CDA)
      .eq('workspace_id', p.cobradorId)
      .eq('negocio_id', p.negocioId)
      .eq('workspace_cliente_id', p.pagadorId)
      .eq('estado', 'activa')
      .limit(1),
    `negocio ${p.negocioId}`,
  )
}

/** Las tarjetas activas de varios planes, por plan (para el paso 6). Sin la tabla, ninguna. */
export async function tarjetasCdaDePlanes(db: unknown, planIds: readonly string[]): Promise<Map<string, TarjetaCda>> {
  const out = new Map<string, TarjetaCda>()
  if (planIds.length === 0) return out
  const r = await (db as Db).from('tarjetas_pago_cda').select(COLUMNAS_TARJETA_CDA).in('plan_cobro_id', [...planIds]).eq('estado', 'activa')
  if (r.error) {
    if (esTablaAusente(r.error)) return out
    throw new Error(`tarjetas de los CDA: ${r.error.message}`)
  }
  for (const f of (r.data ?? []) as FilaTarjetaCda[]) out.set(f.plan_cobro_id, deFilaTarjetaCda(f))
  return out
}
