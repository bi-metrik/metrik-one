/**
 * Ciclo de cobro de UNA suscripción para UNA cuota. Lo invoca el cron
 * `procesar-planes-cobro` cuando `suscripciones.proximo_cobro <= hoy`.
 *
 * Orden del ciclo, y por qué en ese orden:
 *
 *   1. Resolver la cuota que toca (`cuotaParaFecha`, la misma aritmética del cron).
 *   2. Asegurar el cobro programado de esa cuota. Idempotente por el unique
 *      `(plan_cobro_id, numero_cuota)`: si ya existe se reusa, si no se crea, y un
 *      23505 en el medio se resuelve releyendo.
 *   3. Si ese cobro YA tiene `fecha`, la plata entró por otra vía (confirmación manual,
 *      webhook): se registra `pago_recibido`, se avanza `proximo_cobro` y se termina.
 *      **El emisor no valida pagos** (memoria del equipo): aquí el ciclo sí lo hace,
 *      y es lo que impide cobrar dos veces una cuota que alguien ya confirmó.
 *   4. Factura ANTES del cargo. La SAS cobra contra factura; sin factura no se
 *      debita. En Fase 1 el paso se omite (`facturaOmitidaFase1`), pero el hueco
 *      queda en el orden correcto para que la Fase 2 no lo ponga después del cargo.
 *   5. Cargo por el adaptador. Si el cobro ya tiene `external_ref`, se SONDEA
 *      (`consultar`) en vez de volver a cobrar: un intento vivo no se duplica.
 *   6. Registrar el resultado en `cobros` y en `suscripciones`, y proyectar el estado
 *      en `workspaces.subscription_status`, que es lo que lee el gate del layout.
 *
 * Escribe solo cuando algo cambió: correrlo diez veces sobre la misma cuota pendiente
 * deja la base igual que correrlo una.
 *
 * Con `manual` (Fase 1): 2 deja el cobro programado igual que el paso 1 del cron, 4 se
 * omite, 5 devuelve `pendiente` sin efectos, y 6 solo mueve el estado cuando la cuota
 * vence (`activa → pendiente_pago`) o cuando el pago entra. Nadie se suspende solo:
 * `POLITICA_FASE_1.suspenderAutomaticamente = false`.
 *
 * Spec: docs/specs/2026-09-08_suscripciones-cobro-automatico.md
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { cuotaParaFecha, cuotaSiguiente, diasEntreISO, type CuotaDelPlan, type PlanParaCuotas } from '@/lib/cobros/fecha-cuota'
import {
  POLITICA_FASE_1,
  transicionar,
  type EstadoMaquina,
  type EstadoSuscripcion,
  type PoliticaSuspension,
} from './estado'
import { referenciaCargo, type MedioPagoEnmascarado, type PasarelaAdapter, type ResultadoCargo } from './pasarela/adapter'

// ── Tipos de entrada ─────────────────────────────────────────────────────────

export interface SuscripcionRow {
  id: string
  /** Workspace del CLIENTE (el que paga y cuyo acceso se gobierna). */
  workspace_id: string
  /** Plan de cobro en el workspace del COBRADOR (metrik). */
  plan_cobro_id: string
  pasarela: string
  medio_pago: MedioPagoEnmascarado | null
  estado: EstadoSuscripcion
  proximo_cobro: string | null
  intentos_fallidos: number
  ultimo_error: string | null
}

export interface PlanDeSuscripcion extends PlanParaCuotas {
  id: string
  /** Workspace del cobrador: es donde viven el negocio y los cobros. */
  workspace_id: string
  negocio_id: string
  monto: number
  auto_renovar: boolean
  activo: boolean
}

export interface CobroCuota {
  id: string
  fecha: string | null
  external_ref: string | null
  anulado_at?: string | null
}

export type ResultadoFacturaCiclo =
  | { ok: true; omitida: true; motivo: string }
  | { ok: true; omitida: false; referencia: string }
  | { ok: false; error: string }

export interface ContextoFactura {
  suscripcion: SuscripcionRow
  plan: PlanDeSuscripcion
  cobro: CobroCuota
  cuota: CuotaDelPlan
  monto: number
}

/** Quién emite la factura de la cuota. Fase 1: nadie. Fase 2: `emitirFacturaCuota` (Siigo). */
export type FacturarCuota = (ctx: ContextoFactura) => Promise<ResultadoFacturaCiclo>

export const facturaOmitidaFase1: FacturarCuota = async () => ({ ok: true, omitida: true, motivo: 'fase_1' })

export interface CicloDeps {
  db: SupabaseClient
  adapter: PasarelaAdapter
  facturar: FacturarCuota
  politica?: PoliticaSuspension
  /** 'YYYY-MM-DD' Bogotá. Entra por parámetro: una marca por lote, y testeable. */
  hoy: string
}

// ── Tipos de salida ──────────────────────────────────────────────────────────

export type AccionCiclo =
  | 'plan_terminado'
  | 'pago_registrado'
  | 'cargo_aprobado'
  | 'cargo_pendiente'
  | 'cargo_rechazado'
  | 'factura_fallida'
  | 'error'

export interface ResultadoCiclo {
  suscripcionId: string
  accion: AccionCiclo
  numeroCuota: number | null
  cobroId: string | null
  cobroCreado: boolean
  estadoAntes: EstadoSuscripcion
  estadoDespues: EstadoSuscripcion
  proximoCobro: string | null
  detalle?: string
}

// ── Acceso a datos (sin tipos generados: `suscripciones` y `cobros.fuente` no están en database.ts) ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function q(db: SupabaseClient): any {
  return db
}

async function leerCobroCuota(db: SupabaseClient, planId: string, numero: number): Promise<CobroCuota | null> {
  const { data, error } = await q(db)
    .from('cobros')
    .select('id, fecha, external_ref, anulado_at')
    .eq('plan_cobro_id', planId)
    .eq('numero_cuota', numero)
    .maybeSingle()
  // `maybeSingle()` sin mirar el error se cae con dos filas (memoria del equipo).
  // Aquí dos filas son imposibles por el unique, pero el error sí puede ser otro.
  if (error) throw new Error(`leer cobro de la cuota ${numero}: ${error.message}`)
  return (data as CobroCuota | null) ?? null
}

async function crearCobroCuota(
  db: SupabaseClient,
  plan: PlanDeSuscripcion,
  cuota: CuotaDelPlan,
): Promise<{ cobro: CobroCuota; creado: boolean }> {
  const { data, error } = await q(db)
    .from('cobros')
    .insert({
      workspace_id: plan.workspace_id,
      negocio_id: plan.negocio_id,
      plan_cobro_id: plan.id,
      numero_cuota: cuota.numero,
      monto: plan.monto,
      tipo_cobro: 'programado',
      fecha_esperada: cuota.fechaEsperada,
      fecha: null,
      revisado: false,
      notas: `Cuota ${cuota.numero} de ${plan.total_cuotas}`,
      retencion: 0,
    })
    .select('id')
    .single()

  if (!error && data?.id) {
    return { cobro: { id: data.id as string, fecha: null, external_ref: null, anulado_at: null }, creado: true }
  }
  // 23505: otro proceso (el paso 1 del cron, u otra corrida) la creó entre la lectura
  // y el insert. Se relee: la fila que ganó es la buena.
  if (error?.code === '23505') {
    const releido = await leerCobroCuota(db, plan.id, cuota.numero)
    if (releido) return { cobro: releido, creado: false }
  }
  throw new Error(`crear cobro de la cuota ${cuota.numero}: ${error?.message ?? 'sin fila'}`)
}

interface PatchSuscripcion {
  estado: EstadoSuscripcion
  intentos_fallidos: number
  ultimo_error: string | null
  proximo_cobro: string | null
}

/**
 * Persiste el estado de la suscripción y lo proyecta al workspace del cliente.
 * Escribe solo si algo difiere de la fila leída al empezar.
 */
async function persistir(db: SupabaseClient, sus: SuscripcionRow, patch: PatchSuscripcion, ahoraISO: string): Promise<void> {
  const cambioEstado = patch.estado !== sus.estado
  const cambio =
    cambioEstado ||
    patch.intentos_fallidos !== sus.intentos_fallidos ||
    (patch.ultimo_error ?? null) !== (sus.ultimo_error ?? null) ||
    (patch.proximo_cobro ?? null) !== (sus.proximo_cobro ?? null)
  if (!cambio) return

  const { error } = await q(db)
    .from('suscripciones')
    .update({
      estado: patch.estado,
      intentos_fallidos: patch.intentos_fallidos,
      ultimo_error: patch.ultimo_error,
      proximo_cobro: patch.proximo_cobro,
      ...(cambioEstado ? { estado_cambiado_at: ahoraISO } : {}),
      updated_at: ahoraISO,
    })
    .eq('id', sus.id)
  if (error) throw new Error(`actualizar suscripción: ${error.message}`)

  // La proyección es lo que lee el layout en cada render. Va SIEMPRE que la
  // suscripción cambie, no solo cuando cambia el estado: `subscription_expires_at`
  // sigue a `proximo_cobro` (hasta cuándo está pago el acceso).
  const { error: errWs } = await q(db)
    .from('workspaces')
    .update({
      subscription_status: patch.estado,
      subscription_expires_at: patch.proximo_cobro ? `${patch.proximo_cobro}T05:00:00Z` : null,
    })
    .eq('id', sus.workspace_id)
  if (errWs) throw new Error(`proyectar estado en workspace: ${errWs.message}`)
}

async function marcarCobroPagado(db: SupabaseClient, cobroId: string, r: Extract<ResultadoCargo, { estado: 'aprobado' }>, fuente: string): Promise<void> {
  const { error } = await q(db)
    .from('cobros')
    .update({ fecha: r.fecha, external_ref: r.externalRef, fuente, vencido: false })
    .eq('id', cobroId)
  if (error) throw new Error(`marcar cobro pagado: ${error.message}`)
}

async function anotarIntentoEnCobro(db: SupabaseClient, cobroId: string, externalRef: string, fuente: string): Promise<void> {
  const { error } = await q(db)
    .from('cobros')
    .update({ external_ref: externalRef, fuente })
    .eq('id', cobroId)
  if (error) throw new Error(`anotar intento en cobro: ${error.message}`)
}

// ── El ciclo ─────────────────────────────────────────────────────────────────

export async function correrCicloSuscripcion(
  sus: SuscripcionRow,
  plan: PlanDeSuscripcion,
  deps: CicloDeps,
): Promise<ResultadoCiclo> {
  const politica = deps.politica ?? POLITICA_FASE_1
  const ahoraISO = new Date().toISOString()
  const maquina: EstadoMaquina = { estado: sus.estado, intentosFallidos: sus.intentos_fallidos }
  const base = {
    suscripcionId: sus.id,
    estadoAntes: sus.estado,
    estadoDespues: sus.estado,
    proximoCobro: sus.proximo_cobro,
    cobroCreado: false,
  }

  // 1. La cuota que toca
  if (!sus.proximo_cobro) {
    return { ...base, accion: 'plan_terminado', numeroCuota: null, cobroId: null, detalle: 'sin proximo_cobro' }
  }
  const cuota = cuotaParaFecha(plan, sus.proximo_cobro)
  if (!cuota) {
    return { ...base, accion: 'plan_terminado', numeroCuota: null, cobroId: null, detalle: `el plan no tiene cuotas desde ${sus.proximo_cobro}` }
  }
  const siguiente = cuotaSiguiente(plan, cuota.numero)

  let cobroId: string | null = null
  let cobroCreado = false
  try {
    // 2. Asegurar el cobro programado
    let cobro = await leerCobroCuota(deps.db, plan.id, cuota.numero)
    if (!cobro) {
      const c = await crearCobroCuota(deps.db, plan, cuota)
      cobro = c.cobro
      cobroCreado = c.creado
    }
    cobroId = cobro.id

    if (cobro.anulado_at) {
      // Una cuota anulada no se recrea sola (el unique lo impide) ni se cobra sola.
      // Es una decisión de alguien: se reporta y se deja escrita.
      const detalle = `la cuota ${cuota.numero} está anulada (cobro ${cobro.id}); requiere intervención`
      await persistir(deps.db, sus, { ...maquina2patch(maquina), ultimo_error: detalle, proximo_cobro: sus.proximo_cobro }, ahoraISO)
      return { ...base, accion: 'error', numeroCuota: cuota.numero, cobroId, cobroCreado, detalle }
    }

    // 3. ¿Ya entró la plata?
    if (cobro.fecha) {
      const t = transicionar(maquina, 'pago_recibido', politica)
      const m = t.ok ? t.siguiente : maquina
      const proximo = siguiente?.fechaEsperada ?? null
      await persistir(deps.db, sus, { ...maquina2patch(m), ultimo_error: null, proximo_cobro: proximo }, ahoraISO)
      return {
        ...base, accion: 'pago_registrado', numeroCuota: cuota.numero, cobroId, cobroCreado,
        estadoDespues: m.estado, proximoCobro: proximo,
        detalle: siguiente ? undefined : 'última cuota pagada: el plan terminó',
      }
    }

    // 4. Factura antes del cargo
    let factura: ResultadoFacturaCiclo
    try {
      factura = await deps.facturar({ suscripcion: sus, plan, cobro, cuota, monto: plan.monto })
    } catch (e) {
      factura = { ok: false, error: (e as Error).message }
    }
    if (!factura.ok) {
      const detalle = `factura: ${factura.error}`
      await persistir(deps.db, sus, { ...maquina2patch(maquina), ultimo_error: detalle, proximo_cobro: sus.proximo_cobro }, ahoraISO)
      return { ...base, accion: 'factura_fallida', numeroCuota: cuota.numero, cobroId, cobroCreado, detalle }
    }

    // 5. El cargo
    let r: ResultadoCargo
    try {
      r = cobro.external_ref
        ? await deps.adapter.consultar(cobro.external_ref)
        : await deps.adapter.cobrar({
            referencia: referenciaCargo(sus.id, cuota.numero),
            suscripcionId: sus.id,
            workspaceId: sus.workspace_id,
            cobroId: cobro.id,
            planCobroId: plan.id,
            numeroCuota: cuota.numero,
            monto: plan.monto,
            moneda: 'COP',
            descripcion: `Licencia MéTRIK ONE — cuota ${cuota.numero} de ${plan.total_cuotas}`,
            facturaRef: factura.omitida ? null : factura.referencia,
            medioPago: sus.medio_pago,
            cliente: null,
          })
    } catch (e) {
      r = { estado: 'error', mensaje: (e as Error).message, reintentable: true }
    }

    // 6. Registrar
    switch (r.estado) {
      case 'aprobado': {
        await marcarCobroPagado(deps.db, cobro.id, r, deps.adapter.nombre)
        const t = transicionar(maquina, 'pago_recibido', politica)
        const m = t.ok ? t.siguiente : maquina
        const proximo = siguiente?.fechaEsperada ?? null
        await persistir(deps.db, sus, { ...maquina2patch(m), ultimo_error: null, proximo_cobro: proximo }, ahoraISO)
        return { ...base, accion: 'cargo_aprobado', numeroCuota: cuota.numero, cobroId, cobroCreado, estadoDespues: m.estado, proximoCobro: proximo }
      }

      case 'pendiente': {
        if (r.externalRef && !cobro.external_ref) {
          await anotarIntentoEnCobro(deps.db, cobro.id, r.externalRef, deps.adapter.nombre)
        }
        // La cuota vence: pasado el plazo de gracia sin plata, el estado lo dice.
        // Suspender es otro paso, y solo si la política lo permite.
        let m = maquina
        const vencida = diasEntreISO(cuota.fechaEsperada, deps.hoy) > politica.diasGracia
        if (vencida) {
          const t = transicionar(m, 'vencimiento', politica)
          if (t.ok) m = t.siguiente
          if (politica.suspenderAutomaticamente && m.estado === 'pendiente_pago') {
            const s = transicionar(m, 'suspender', politica)
            if (s.ok) m = s.siguiente
          }
        }
        await persistir(deps.db, sus, { ...maquina2patch(m), ultimo_error: null, proximo_cobro: sus.proximo_cobro }, ahoraISO)
        return {
          ...base, accion: 'cargo_pendiente', numeroCuota: cuota.numero, cobroId, cobroCreado,
          estadoDespues: m.estado, detalle: r.detalle ?? (r.linkPago ? `link: ${r.linkPago}` : undefined),
        }
      }

      case 'rechazado': {
        const t = transicionar(maquina, 'cargo_fallido', politica)
        const m = t.ok ? t.siguiente : maquina
        const detalle = `${r.codigo}: ${r.mensaje}${r.reintentable ? '' : ' (no reintentable)'}`
        await persistir(deps.db, sus, { ...maquina2patch(m), ultimo_error: detalle, proximo_cobro: sus.proximo_cobro }, ahoraISO)
        return { ...base, accion: 'cargo_rechazado', numeroCuota: cuota.numero, cobroId, cobroCreado, estadoDespues: m.estado, detalle }
      }

      case 'error': {
        await persistir(deps.db, sus, { ...maquina2patch(maquina), ultimo_error: r.mensaje, proximo_cobro: sus.proximo_cobro }, ahoraISO)
        return { ...base, accion: 'error', numeroCuota: cuota.numero, cobroId, cobroCreado, detalle: r.mensaje }
      }
    }
  } catch (e) {
    const detalle = (e as Error).message
    // Mejor esfuerzo: dejar escrito por qué falló, sin tapar el error original.
    try {
      await persistir(deps.db, sus, { ...maquina2patch(maquina), ultimo_error: detalle, proximo_cobro: sus.proximo_cobro }, ahoraISO)
    } catch {
      /* ya se reporta abajo */
    }
    return { ...base, accion: 'error', numeroCuota: cuota.numero, cobroId, cobroCreado, detalle }
  }
}

function maquina2patch(m: EstadoMaquina): Pick<PatchSuscripcion, 'estado' | 'intentos_fallidos'> {
  return { estado: m.estado, intentos_fallidos: m.intentosFallidos }
}
