import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CobroParaPago } from '@/lib/cobros/pago-en-linea'
import type { CorreoSaliente, ResultadoEnvio } from '@/lib/cobros/enlace-automatico-servidor'
import { anclaDeFila } from '@/lib/suscripciones-producto/ancla'
import type { EventoPasarela } from '@/lib/suscripciones/pasarela/adapter'
import { ultimosDigitosTarjetaEpayco } from '@/lib/suscripciones/pasarela/epayco'
import { correoDelCobro } from './cobro-prueba-servidor'
import { ramaDeRechazo } from './cobro-token-servidor'

/**
 * El cierre de un cargo con la tarjeta guardada que ePayco dejó PENDIENTE y decidió DESPUÉS: la revisión
 * antifraude (eControl, «Pendiente por aprobación del comercio») lo aprueba o lo rechaza horas más tarde,
 * y eso llega por la confirmación de ePayco (`/api/webhooks/epayco`) o por la conciliación del cron
 * (`conciliarCargoPendiente`). Los dos caminos pasan por `procesarEventoPasarela`, que registra el pago;
 * esto cierra lo que el pago por sí solo no cerraba (caso real: transacción 390720992, 2026-10-22):
 *
 *   - el intento (`cobro_intentos_tarjeta`) seguía en `pendiente`;
 *   - el registro de Valida (`valida_registros.cobro_estado`) seguía en `cobro_pendiente`, con el detalle
 *     «lo cierra la confirmación», que nada cerraba;
 *   - el correo C3 (cobro confirmado) no salía: solo se manda cuando el cargo se aprueba en el acto.
 *
 * Todo con guardas en el update (`resultado = 'pendiente'`, `cobro_estado = 'cobro_pendiente'`): una
 * segunda notificación, o la confirmación y la conciliación a la vez, no hacen nada dos veces. Un cargo
 * aprobado o rechazado EN EL ACTO ya dejó el intento cerrado y el registro en `cobrando`: aquí no aplica.
 *
 * Lo que NO hace (decisión abierta, Mauricio con Emilio): la suscripción se activa ANTES del cobro
 * (`activarYCobrarReclamado`, paso b) y un rechazo, tardío o no, no la desactiva. Por eso el rechazo
 * tardío de la cuota 1 queda en revisión.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface DepsCargoTardio {
  db: SupabaseClient
  ahoraMs?: number
  enviarCorreo?: (m: CorreoSaliente) => Promise<ResultadoEnvio>
  urlCuenta?: (slug: string) => string
  ultimos4?: (ref: string | null) => Promise<string | null>
}

interface FilaIntento {
  id: string
  plan_cobro_id: string
  numero_cuota: number
  intento: number
  referencia: string | null
}

interface RegistroDelCargo {
  id: string
  workspace_id: string
  correo: string
  razon_social: string
  slug_creado: string | null
  metodo_pago_ref: string | null
  cobro_estado: string | null
  cobro_intento_at: string | null
  cobro_confirmado_at: string | null
}

const COLUMNAS_REGISTRO = 'id, workspace_id, correo, razon_social, slug_creado, metodo_pago_ref, cobro_estado, cobro_intento_at, cobro_confirmado_at'

/** El intento pendiente del cobro (con la referencia de ESA transacción, si se sabe). */
async function intentoPendiente(db: Db, cobroId: string, referenciaPago: string | null): Promise<FilaIntento | null> {
  let q = db.from('cobro_intentos_tarjeta').select('id, plan_cobro_id, numero_cuota, intento, referencia').eq('cobro_id', cobroId).eq('resultado', 'pendiente')
  if (referenciaPago) q = q.eq('referencia', referenciaPago)
  const r = await q
  if (r.error) throw new Error(`intento pendiente del cobro ${cobroId}: ${r.error.message}`)
  const filas = (r.data ?? []) as FilaIntento[]
  return filas.length === 1 ? filas[0] : null
}

/** Pasa el intento de `pendiente` a `resultado`, con la guarda. `false` si otra corrida ya lo cerró. */
async function cerrarIntento(db: Db, id: string, resultado: 'aprobado' | 'rechazado', mensaje: string): Promise<boolean> {
  const u = await db
    .from('cobro_intentos_tarjeta')
    .update({ resultado, mensaje: mensaje.slice(0, 300), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('resultado', 'pendiente')
    .select('id')
  if (u.error) throw new Error(`cerrar el intento ${id}: ${u.error.message}`)
  return (u.data ?? []).length === 1
}

/**
 * El registro de Valida del que salió el primer cobro: el de la suscripción (`valida_registro_id`) o,
 * en un contrato colgado de un negocio, el del espacio que paga.
 */
async function registroDelCobro(db: Db, cobro: CobroParaPago): Promise<RegistroDelCargo | null> {
  if (cobro.suscripcionId) {
    const s = await db.from('suscripciones_producto').select('valida_registro_id').eq('id', cobro.suscripcionId).eq('workspace_id', cobro.workspaceId).maybeSingle()
    if (s.error) throw new Error(`suscripción ${cobro.suscripcionId}: ${s.error.message}`)
    const id = (s.data?.valida_registro_id as string | null | undefined) ?? null
    if (!id) return null
    const r = await db.from('valida_registros').select(COLUMNAS_REGISTRO).eq('id', id).maybeSingle()
    if (r.error) throw new Error(`registro ${id}: ${r.error.message}`)
    return (r.data as RegistroDelCargo | null) ?? null
  }
  if (!cobro.negocioId) return null
  const sc = await db.from('servicios_contratados').select('workspace_pagador_id').eq('workspace_id', cobro.workspaceId).eq('negocio_id', cobro.negocioId)
  if (sc.error) throw new Error(`contrato del negocio ${cobro.negocioId}: ${sc.error.message}`)
  const pagadores = [...new Set(((sc.data ?? []) as { workspace_pagador_id: string | null }[]).map((c) => c.workspace_pagador_id).filter(Boolean))] as string[]
  if (pagadores.length !== 1) return null
  const r = await db.from('valida_registros').select(COLUMNAS_REGISTRO).eq('workspace_id', pagadores[0]).eq('estado', 'creado').maybeSingle()
  if (r.error) throw new Error(`registro de ${pagadores[0]}: ${r.error.message}`)
  return (r.data as RegistroDelCargo | null) ?? null
}

/**
 * El cargo salió de «Activar y pagar» (`cobrarAlConfirmar`, Condiciones 7.1 literal a) y no del cron del
 * día 7: el clic escribe `cobro_intento_at` y `cobro_confirmado_at` con el MISMO instante; el día 7
 * solo escribe `cobro_intento_at`.
 */
function vinoDeLaConfirmacion(r: RegistroDelCargo): boolean {
  if (!r.cobro_confirmado_at || !r.cobro_intento_at) return false
  return Date.parse(r.cobro_confirmado_at) === Date.parse(r.cobro_intento_at)
}

/** Actualiza el registro con la guarda `cobro_pendiente`. `true` si esta corrida lo movió. */
async function moverRegistro(db: Db, id: string, cambios: Record<string, unknown>): Promise<boolean> {
  const u = await db
    .from('valida_registros')
    .update({ ...cambios, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('cobro_estado', 'cobro_pendiente')
    .select('id')
  if (u.error) throw new Error(`registro ${id}: ${u.error.message}`)
  return (u.data ?? []).length === 1
}

/** Los intentos con la tarjeta de ese cobro (cualquier resultado). Sin ninguno, no hubo cargo con la tarjeta. */
async function intentosDelCobro(db: Db, cobroId: string): Promise<(FilaIntento & { resultado: string | null })[]> {
  const r = await db.from('cobro_intentos_tarjeta').select('id, plan_cobro_id, numero_cuota, intento, referencia, resultado').eq('cobro_id', cobroId)
  if (r.error) throw new Error(`intentos del cobro ${cobroId}: ${r.error.message}`)
  return (r.data ?? []) as (FilaIntento & { resultado: string | null })[]
}

/** El pago del cobro TAL COMO QUEDÓ en la base: `null` si no tiene pago o está anulado. */
async function pagoDelCobro(db: Db, cobroId: string): Promise<{ externalRef: string | null } | null> {
  const r = await db.from('cobros').select('fecha, anulado_at, external_ref').eq('id', cobroId).maybeSingle()
  if (r.error) throw new Error(`cobro ${cobroId}: ${r.error.message}`)
  const f = r.data as { fecha: string | null; anulado_at: string | null; external_ref: string | null } | null
  if (!f?.fecha || f.anulado_at) return null
  return { externalRef: f.external_ref }
}

/**
 * (a) Un pago REGISTRADO sobre un cobro de un cargo con la tarjeta: el intento pendiente pasa a
 * `aprobado`; si es la cuota 1 y el registro sigue en `cobro_pendiente`, pasa a `cobrado` y, si el cobro
 * vino de «Activar y pagar» y lo pagó ESA tarjeta, sale el C3.
 *
 * Cada paso tiene su guarda y no depende del anterior: el intento puede estar ya cerrado y el registro
 * seguir en `cobro_pendiente` (la confirmación llegó mientras el cargo aún no había escrito el
 * `cobro_pendiente`, o el pago se registró con un código que no cerraba nada, como el del 2026-10-22);
 * entonces se cierra solo el registro. Lee el pago de la base: sin pago registrado (o anulado) no hace
 * nada. `null` si no hubo nada que cerrar (el caso común: el cargo se aprobó en el acto).
 */
export async function cerrarCargoAprobadoTardio(deps: DepsCargoTardio, cobro: CobroParaPago): Promise<{ revisar: boolean; detalle: string } | null> {
  const db = deps.db as Db
  const intentos = await intentosDelCobro(db, cobro.id)
  if (intentos.length === 0) return null
  const pago = await pagoDelCobro(db, cobro.id)
  if (!pago) return null
  const pendientes = intentos.filter((i) => i.resultado === 'pendiente')
  const pendiente = pendientes.length === 1 ? pendientes[0] : null
  const referencia = pago.externalRef ?? cobro.externalRef ?? pendiente?.referencia ?? null
  const partes: string[] = []
  const resultado = (revisar = false) => (partes.length > 0 ? { revisar, detalle: partes.join(' ') } : null)

  if (pendiente && (await cerrarIntento(db, pendiente.id, 'aprobado', `Aprobado después de quedar pendiente (${referencia ?? 'sin referencia'}).`))) {
    partes.push('Cobro con tarjeta aprobado después de quedar pendiente: intento cerrado.')
  }
  if (!intentos.every((i) => i.numero_cuota === 1)) return resultado()

  const reg = await registroDelCobro(db, cobro)
  if (!reg || reg.cobro_estado !== 'cobro_pendiente') return resultado()
  const movido = await moverRegistro(db, reg.id, {
    cobro_estado: 'cobrado',
    cobro_detalle: `Aprobado después de quedar pendiente (${referencia ?? 'sin referencia'}).`,
    ...(referencia ? { cobro_ref: referencia } : {}),
  })
  if (!movido) return resultado()
  partes.push('Registro de Valida: cobrado.')
  // El C3 nombra la tarjeta: solo si el pago es el de un cargo con ella (no un enlace pagado aparte).
  const conLaTarjeta = referencia !== null && intentos.some((i) => i.referencia === referencia)
  if (!vinoDeLaConfirmacion(reg) || !conLaTarjeta) return resultado()

  // C3. Sin los 4 dígitos no hay correo que mandar (el texto los nombra): queda dicho en el evento.
  const ultimos4 = await (deps.ultimos4 ?? ((ref) => ultimosDigitosTarjetaEpayco(ref)))(reg.metodo_pago_ref)
  if (!ultimos4) {
    partes.push('Correo del cobro (C3) SIN enviar: ePayco no dio los últimos 4 dígitos de la tarjeta.')
    return { revisar: true, detalle: partes.join(' ') }
  }
  const ok = await correoDelCobro({ enviarCorreo: deps.enviarCorreo, urlCuenta: deps.urlCuenta }, reg, deps.ahoraMs ?? Date.now(), ultimos4)
  partes.push(ok ? 'Correo del cobro (C3) enviado.' : 'Correo del cobro (C3) SIN enviar: revisar.')
  return { revisar: !ok, detalle: partes.join(' ') }
}

/**
 * (b) Un RECHAZO sobre un cobro con un cargo pendiente de ESA transacción: el intento pasa a `rechazado`,
 * el cobro suelta la referencia (si no, la cuota quedaba en «pendiente» para siempre y sin enlace) y
 * sigue la misma rama del rechazo en el acto (`ramaDeRechazo`). En la cuota 1, el registro sale de
 * `cobro_pendiente` como habría salido en el acto: del literal (a) vuelve a `programado` con la marca del
 * rechazo (la prueba y el cobro del día 7 siguen, 7.5); del (b), `rechazado`.
 * `null` si no había un cargo pendiente de esa transacción: el rechazo se ignora como antes.
 */
export async function aplicarRechazoTardio(deps: DepsCargoTardio, cobro: CobroParaPago, e: EventoPasarela): Promise<{ revisar: boolean; detalle: string } | null> {
  const db = deps.db as Db
  const intento = await intentoPendiente(db, cobro.id, e.referenciaPago)
  if (!intento) return null
  const motivo = e.tipoOriginal || 'Rechazada'
  if (!(await cerrarIntento(db, intento.id, 'rechazado', `${motivo} (después de quedar pendiente)`))) return null

  const suelta = await db.from('cobros').update({ external_ref: null }).eq('id', cobro.id).eq('external_ref', e.referenciaPago).is('fecha', null)
  if (suelta.error) throw new Error(`soltar la referencia del cobro ${cobro.id}: ${suelta.error.message}`)

  const plan = await db.from('planes_cobro').select('id, negocio_id, suscripcion_id').eq('id', intento.plan_cobro_id).maybeSingle()
  if (plan.error || !plan.data) throw new Error(`plan del intento ${intento.id}: ${plan.error?.message ?? 'no existe'}`)
  const ancla = anclaDeFila(plan.data)
  if (!ancla) throw new Error(`el plan ${intento.plan_cobro_id} no tiene ancla`)
  await ramaDeRechazo(deps.db, {
    cobradorId: cobro.workspaceId,
    planCobroId: intento.plan_cobro_id,
    ancla,
    cobroId: cobro.id,
    numeroCuota: intento.numero_cuota,
    intento: intento.intento,
    mensaje: motivo,
    tardio: true,
  })
  const partes = [`Cobro con tarjeta rechazado después de quedar pendiente (${e.referenciaPago}): intento cerrado como rechazado y referencia liberada.`]
  if (intento.numero_cuota !== 1) return { revisar: false, detalle: partes.join(' ') }

  partes.push('Primer cobro: el plan pasa a enlace de pago.')
  const reg = await registroDelCobro(db, cobro)
  if (reg && reg.cobro_estado === 'cobro_pendiente') {
    const ahora = new Date(deps.ahoraMs ?? Date.now()).toISOString()
    const movido = vinoDeLaConfirmacion(reg)
      ? await moverRegistro(db, reg.id, { cobro_estado: 'programado', cobro_detalle: `confirmación rechazada después de quedar pendiente: ${motivo}`.slice(0, 300), cobro_confirmacion_rechazada_at: ahora })
      : await moverRegistro(db, reg.id, { cobro_estado: 'rechazado', cobro_detalle: `rechazado después de quedar pendiente: ${motivo}`.slice(0, 300) })
    if (movido) partes.push(vinoDeLaConfirmacion(reg) ? 'Registro: vuelve a la prueba (el cobro del día 7 sigue en pie).' : 'Registro: rechazado.')
  }
  // La suscripción quedó activa sin el pago (se activa antes del cobro): lo revisa una persona.
  partes.push('La suscripción se activó antes del cobro y sigue activa: revisar.')
  return { revisar: true, detalle: partes.join(' ') }
}

/**
 * (d) Un registro en `cobro_pendiente` cuyo primer cobro YA está pagado: lo cierra como lo habría cerrado
 * la confirmación (`cerrarCargoAprobadoTardio`). Dos caminos lo usan:
 *   - el cargo, justo después de escribir `cobro_pendiente`: si la confirmación de la aprobación llegó
 *     ENTRE el cargo y esa escritura, la confirmación no encontró el registro en `cobro_pendiente` y nada
 *     más lo iba a cerrar;
 *   - el cron (`conciliarRegistrosConCobroPendiente`): la red para lo que quedó colgado igual (el caso
 *     del 2026-10-22: el pago se registró antes de que existiera el cierre; la confirmación ya estaba
 *     procesada y la conciliación del cargo pendiente no mira una cuota pagada).
 * Solo la suscripción del registro (`valida_registro_id`), su cuota 1 y un pago no anulado.
 */
export async function cerrarRegistroConPagoRegistrado(
  deps: DepsCargoTardio,
  registroId: string,
): Promise<{ tipo: 'cerrado'; revisar: boolean; detalle: string } | { tipo: 'sin_cambio'; motivo: string }> {
  const db = deps.db as Db
  const reg = await db.from('valida_registros').select('cobro_estado').eq('id', registroId).maybeSingle()
  if (reg.error) throw new Error(`registro ${registroId}: ${reg.error.message}`)
  if ((reg.data as { cobro_estado: string | null } | null)?.cobro_estado !== 'cobro_pendiente') return { tipo: 'sin_cambio', motivo: 'no_esta_en_cobro_pendiente' }

  const s = await db.from('suscripciones_producto').select('id, workspace_id').eq('valida_registro_id', registroId)
  if (s.error) throw new Error(`suscripción del registro ${registroId}: ${s.error.message}`)
  const subs = (s.data ?? []) as { id: string; workspace_id: string }[]
  if (subs.length !== 1) return { tipo: 'sin_cambio', motivo: subs.length === 0 ? 'sin_suscripcion' : 'varias_suscripciones' }

  const c = await db
    .from('cobros')
    .select('id, workspace_id, negocio_id, suscripcion_id, monto, fecha, anulado_at, tipo_cobro, external_ref, notas')
    .eq('suscripcion_id', subs[0].id)
    .eq('workspace_id', subs[0].workspace_id)
    .eq('numero_cuota', 1)
    .eq('tipo_cobro', 'programado')
  if (c.error) throw new Error(`cuota 1 del registro ${registroId}: ${c.error.message}`)
  const filas = (c.data ?? []) as {
    id: string
    workspace_id: string
    negocio_id: string | null
    suscripcion_id: string | null
    monto: number | string | null
    fecha: string | null
    anulado_at: string | null
    tipo_cobro: string | null
    external_ref: string | null
    notas: string | null
  }[]
  const pagados = filas.filter((f) => f.fecha && !f.anulado_at)
  if (pagados.length !== 1) return { tipo: 'sin_cambio', motivo: pagados.length === 0 ? 'cuota_1_sin_pago' : 'varios_pagos' }
  const f = pagados[0]
  const r = await cerrarCargoAprobadoTardio(deps, {
    id: f.id,
    workspaceId: f.workspace_id,
    negocioId: f.negocio_id,
    suscripcionId: f.suscripcion_id,
    monto: Number(f.monto ?? 0),
    fecha: f.fecha,
    anuladoAt: f.anulado_at,
    tipoCobro: f.tipo_cobro,
    externalRef: f.external_ref,
    notas: f.notas,
  })
  if (!r) return { tipo: 'sin_cambio', motivo: 'nada_que_cerrar' }
  return { tipo: 'cerrado', revisar: r.revisar, detalle: r.detalle }
}

export interface ResumenRegistrosCobroPendiente {
  revisados: number
  cerrados: { registroId: string; revisar: boolean; detalle: string }[]
  errores: { registroId: string; error: string }[]
}

/** Registros por corrida: `cobro_pendiente` es un estado de horas, nunca debería haber muchos. */
export const TOPE_REGISTROS_COBRO_PENDIENTE = 50

/**
 * Paso 7e del cron `procesar-planes-cobro`: todo registro en `cobro_pendiente` con su primer cobro ya
 * pagado se cierra (intento, registro y C3, una sola vez). Sin pago, no lo toca: lo cierra la
 * confirmación o la conciliación del cargo pendiente (7b). No llama a ePayco ni cobra.
 */
export async function conciliarRegistrosConCobroPendiente(deps: DepsCargoTardio): Promise<ResumenRegistrosCobroPendiente> {
  const db = deps.db as Db
  const resumen: ResumenRegistrosCobroPendiente = { revisados: 0, cerrados: [], errores: [] }
  const q = await db.from('valida_registros').select('id').eq('cobro_estado', 'cobro_pendiente').order('updated_at', { ascending: true }).limit(TOPE_REGISTROS_COBRO_PENDIENTE)
  if (q.error) throw new Error(`registros en cobro_pendiente: ${q.error.message}`)
  for (const { id } of (q.data ?? []) as { id: string }[]) {
    resumen.revisados += 1
    try {
      const r = await cerrarRegistroConPagoRegistrado(deps, id)
      if (r.tipo === 'cerrado') {
        resumen.cerrados.push({ registroId: id, revisar: r.revisar, detalle: r.detalle })
        console.log(`[valida-cobro] registro ${id} cerrado por la conciliación: ${r.detalle}`)
      }
    } catch (e) {
      resumen.errores.push({ registroId: id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return resumen
}
