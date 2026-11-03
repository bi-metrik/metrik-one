import type { SupabaseClient } from '@supabase/supabase-js'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { eliminarTarjetasEpayco, leerRefMedioPagoEpayco } from '@/lib/suscripciones/pasarela/epayco'
import { anclaDeFila, filtrarPorAncla, type Ancla } from '@/lib/suscripciones-producto/ancla'
import { anotarEnAncla } from '@/lib/suscripciones-producto/bitacora'
import type { EnvioCorreoInterno } from '@/lib/cobros/reverso-pasarela-servidor'
import { planDeConfig, type PlanAbierto, type TerminacionPlan } from './plan'
import {
  AVISO_TERMINACION_PARA,
  correoAvisoTerminacion,
  cumplioTreintaDias,
  motivoCancelacion,
  suspensionDelPlan,
  terminacionHabilitada,
  terminacionIncompleta,
  TOPE_INTENTOS_TARJETA,
  type Suspension,
} from './terminacion'

/**
 * Paso 8c del cron `procesar-planes-cobro`: la terminación de la 11.2 de los Términos de autoservicio
 * (ver `terminacion.ts`). Por cada espacio del registro autogestionado con plan:
 *
 *   1. ¿Está suspendido (mora o reverso) y ya se cumplieron los 30 días? ¿Tiene un contrato de Valida
 *      vivo (activo o pausado)? Uno ya retirado o terminado no se toca.
 *   2. ¿Hay deuda que sostenga la suspensión? Un pago registrado de una cuota posterior (o el pago de
 *      reactivación) cuyo ciclo no se abrió —Valida caída— NO es falta de pago: no se termina y queda en
 *      el resumen. Por mora, además, tiene que haber una cuota vencida sin pagar.
 *   3. Con la terminación APAGADA en producción: `por_terminar` en el plan, una línea en la bitácora y
 *      el aviso interno de ensayo, una vez.
 *   4. Encendida: primero se guarda `terminada` (si algo se cae a mitad, la corrida siguiente sigue
 *      desde ahí), después se cierran los cobros (contrato `terminado`, plan sin `auto_renovar` ni
 *      `activo`, suscripción `cancelada`), se pide a ePayco borrar la tarjeta y se avisa a MéTRIK.
 *
 * Idempotente: cada escritura lleva su guarda y el estado vive en `valida_plan.terminacion`. Correr dos
 * veces no cierra, no borra ni avisa dos veces (el correo además lleva llave de idempotencia).
 *
 * Lo que NO hace:
 *   - escribirle al cliente («sin más aviso»);
 *   - llamar a Valida: el ciclo ya está cerrado (vencido o anulado) y ningún ciclo se abre sin un
 *     contrato vivo (`abrirCicloSiCorresponde`). Revocar la llave o cerrar el cliente en Valida cortaría
 *     el acceso a los reportes (la ruta firmada de metrik-valida#83 exige cliente activo): eso espera la
 *     respuesta de Emilio sobre la 12.6;
 *   - anular las cuotas vencidas: siguen en la cartera.
 *
 * Sin `server-only`: recibe el cliente y los envíos; las pruebas lo importan directo.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface DepsTerminacion {
  db: SupabaseClient
  ahoraMs?: number
  enviarCorreo?: EnvioCorreoInterno
  eliminarTarjeta?: (ref: string) => Promise<{ ok: true; borradas: number } | { ok: false; error: string }>
  env?: Record<string, string | undefined>
}

export interface ResumenTerminacion {
  revisados: number
  /** Ensayo en producción: cumplieron los 30 días y se terminarían. */
  porTerminar: string[]
  terminados: string[]
  /** Suspendidos con un pago registrado que la levanta (ciclo sin abrir) o sin cuota vencida: no se tocan. */
  sinDeuda: { workspaceId: string; detalle: string }[]
  tarjetasPendientes: { workspaceId: string; detalle: string }[]
  errores: { workspaceId: string; error: string }[]
}

interface Espacio {
  id: string
  slug: string
  config_extra: Record<string, unknown> | null
}

interface Contrato {
  id: string
  workspace_id: string
  negocio_id: string | null
  suscripcion_id?: string | null
  servicio_slug: string
  estado: string
}

interface Registro {
  id: string
  correo: string | null
  razon_social: string | null
  identificacion: string | null
  metodo_pago_ref: string | null
  metodo_pago_estado: string | null
}

async function enviarPorDefecto(m: Parameters<EnvioCorreoInterno>[0]) {
  const { enviarCorreoInternoPorResend } = await import('@/lib/cobros/reverso-pasarela-servidor')
  return enviarCorreoInternoPorResend(m)
}

/** El contrato de Valida vivo que paga el espacio; `null` si no hay (retirado, terminado) o hay dos. */
async function contratoVivo(db: Db, workspaceId: string): Promise<Contrato | null> {
  const r = await db
    .from('servicios_contratados')
    .select('id, workspace_id, negocio_id, suscripcion_id, servicio_slug, estado')
    .eq('workspace_pagador_id', workspaceId)
    .in('estado', ['activo', 'pausado'])
  if (r.error) throw new Error(`contrato del espacio: ${r.error.message}`)
  const contratos = (r.data ?? []) as Contrato[]
  if (contratos.length === 0) return null
  const cat = await db.from('catalogo_servicios').select('slug, modulo').in('slug', [...new Set(contratos.map((c) => c.servicio_slug))])
  if (cat.error) throw new Error(`catálogo del contrato: ${cat.error.message}`)
  const deValida = new Set(((cat.data ?? []) as { slug: string; modulo: string }[]).filter((s) => s.modulo === 'valida_consulta').map((s) => s.slug))
  const candidatos = contratos.filter((c) => deValida.has(c.servicio_slug))
  if (candidatos.length > 1) throw new Error(`el espacio paga ${candidatos.length} contratos vivos de Valida: no se adivina cuál terminar`)
  return candidatos[0] ?? null
}

/**
 * ¿Hay deuda que sostenga la suspensión? `{ ok: true, deuda }` (lo vencido sin pagar, en pesos) o
 * `{ ok: false, detalle }` si un pago la levanta o no hay nada vencido. Lanza si no puede leer.
 */
async function deudaDeLaSuspension(
  db: Db,
  contrato: Contrato,
  ancla: Ancla,
  plan: PlanAbierto,
  s: Suspension,
  hoy: string,
): Promise<{ ok: true; deuda: number } | { ok: false; detalle: string }> {
  const planes = await filtrarPorAncla(db.from('planes_cobro').select('id'), ancla).eq('workspace_id', contrato.workspace_id)
  if (planes.error) throw new Error(`planes de cobro: ${planes.error.message}`)
  const planIds = ((planes.data ?? []) as { id: string }[]).map((p) => p.id)
  const cobrosR = await filtrarPorAncla(db.from('cobros').select('id, plan_cobro_id, numero_cuota, fecha, anulado_at'), ancla).eq('workspace_id', contrato.workspace_id)
  if (cobrosR.error) throw new Error(`cobros: ${cobrosR.error.message}`)
  const cobros = (cobrosR.data ?? []) as { id: string; plan_cobro_id: string | null; numero_cuota: number | null; fecha: string | null; anulado_at: string | null }[]
  const pagado = (c: (typeof cobros)[number]) => c.fecha !== null && c.anulado_at === null

  const recobro = plan.reversado?.recobro_cobro_id
  if (recobro && cobros.some((c) => c.id === recobro && pagado(c))) {
    return { ok: false, detalle: 'el pago de reactivación está registrado y su ciclo no se abrió' }
  }
  const posterior = cobros.find((c) => pagado(c) && c.plan_cobro_id !== null && planIds.includes(c.plan_cobro_id) && (c.numero_cuota ?? 0) > plan.cuota_numero)
  if (posterior) return { ok: false, detalle: `la cuota ${posterior.numero_cuota} está pagada y su ciclo no se abrió` }

  const cuotasR =
    planIds.length === 0
      ? { data: [], error: null }
      : await db.from('plan_cobro_cuotas').select('plan_cobro_id, numero, monto, fecha_vencimiento').in('plan_cobro_id', planIds).lte('fecha_vencimiento', hoy)
  if (cuotasR.error) throw new Error(`cuotas: ${cuotasR.error.message}`)
  const vencidas = ((cuotasR.data ?? []) as { plan_cobro_id: string; numero: number; monto: number | string; fecha_vencimiento: string }[]).filter(
    (q) => !cobros.some((c) => pagado(c) && c.plan_cobro_id === q.plan_cobro_id && c.numero_cuota === q.numero),
  )
  const deuda = vencidas.reduce((t, q) => t + Number(q.monto ?? 0), 0)

  if (s.motivo === 'reverso') {
    const reversado = cobros.find((c) => c.id === plan.cobro_id)
    if (reversado && reversado.anulado_at === null) return { ok: false, detalle: 'el cobro del ciclo cortado no está anulado' }
    return { ok: true, deuda }
  }
  if (!vencidas.some((q) => q.numero > plan.cuota_numero)) return { ok: false, detalle: 'la bolsa venció pero no hay una cuota vencida sin pagar' }
  return { ok: true, deuda }
}

async function registroDelEspacio(db: Db, workspaceId: string): Promise<Registro | null> {
  const r = await db
    .from('valida_registros')
    .select('id, correo, razon_social, identificacion, metodo_pago_ref, metodo_pago_estado')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'creado')
    .maybeSingle()
  if (r.error) throw new Error(`registro del espacio: ${r.error.message}`)
  return (r.data as Registro | null) ?? null
}

/**
 * Guarda la terminación en el plan, SOLO si el plan sigue siendo el mismo (un pago que abrió un ciclo en
 * el medio levantó la suspensión: no se le pega una terminación vieja). Relee la configuración antes.
 */
async function guardar(db: Db, workspaceId: string, cobroId: string, t: TerminacionPlan): Promise<boolean> {
  const ws = await db.from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle()
  if (ws.error) throw new Error(`releer el espacio: ${ws.error.message}`)
  const config = (ws.data?.config_extra ?? {}) as Record<string, unknown>
  const plan = planDeConfig(config)
  if (!plan || plan.cobro_id !== cobroId) return false
  const u = await db.from('workspaces').update({ config_extra: { ...config, valida_plan: { ...plan, terminacion: t } } }).eq('id', workspaceId)
  if (u.error) throw new Error(`guardar la terminación: ${u.error.message}`)
  return true
}

async function avisar(deps: DepsTerminacion, w: Espacio, registro: Registro | null, t: TerminacionPlan, deuda: number | null, ensayo: boolean, ahora: string) {
  const correo = correoAvisoTerminacion({ ensayo, slug: w.slug, razonSocial: registro?.razon_social ?? null, nit: registro?.identificacion ?? null, t, deuda })
  let envio: { ok: true } | { ok: false; error: string }
  try {
    envio = await (deps.enviarCorreo ?? enviarPorDefecto)({
      to: AVISO_TERMINACION_PARA,
      ...correo,
      idempotencyKey: `valida-terminacion-${ensayo ? 'ensayo-' : ''}${w.id}-${Date.parse(t.suspendida_desde)}`,
    })
  } catch (e) {
    envio = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  return envio.ok ? { estado: 'enviado' as const, at: ahora } : { estado: 'fallido' as const, at: ahora, error: envio.error }
}

/** Contrato terminado, plan sin renovación ni cobros, suscripción cancelada. Cada paso con su guarda. */
async function cerrarCobros(db: Db, t: TerminacionPlan, hoy: string, ahora: string): Promise<void> {
  const ancla = anclaDeFila({ negocio_id: t.negocio_id ?? null, suscripcion_id: t.suscripcion_id ?? null })
  if (!t.contrato_id || !t.cobrador_id || !ancla) throw new Error('la terminación no tiene contrato ni ancla')
  const sc = await db
    .from('servicios_contratados')
    .update({ estado: 'terminado', vigente_hasta: hoy, updated_at: ahora })
    .eq('id', t.contrato_id)
    .in('estado', ['activo', 'pausado'])
    .select('id')
  if (sc.error) throw new Error(`terminar el contrato: ${sc.error.message}`)
  const pl = await filtrarPorAncla(db.from('planes_cobro').update({ auto_renovar: false, activo: false }), ancla).eq('workspace_id', t.cobrador_id)
  if (pl.error) throw new Error(`apagar el plan de cobro: ${pl.error.message}`)
  if (ancla.tipo === 'suscripcion') {
    const sus = await db
      .from('suscripciones_producto')
      .update({ estado: 'cancelada', cancelada_at: ahora, cancelacion_motivo: motivoCancelacion(t) })
      .eq('id', ancla.id)
      .neq('estado', 'cancelada')
    if (sus.error) throw new Error(`cancelar la suscripción: ${sus.error.message}`)
  }
  // Una línea en la historia del cliente, solo la corrida que terminó el contrato.
  if ((sc.data ?? []).length > 0) {
    await anotarEnAncla(
      db,
      {
        ancla,
        workspaceId: t.cobrador_id,
        tipo: 'terminacion_11_2',
        texto: `${motivoCancelacion(t)} Sin más cobros automáticos; se pide a ePayco borrar la tarjeta. Sin correo al cliente.`,
        datos: { motivo: t.motivo, suspendida_desde: t.suspendida_desde, dia_terminacion: t.dia_terminacion, contrato_id: t.contrato_id },
      },
      'valida-terminacion',
    )
  }
}

/** Pide a ePayco borrar la tarjeta (11.2). Devuelve el nuevo estado de `tarjeta`. */
async function borrarTarjeta(db: Db, deps: DepsTerminacion, t: TerminacionPlan, registro: Registro | null, ahora: string): Promise<NonNullable<TerminacionPlan['tarjeta']>> {
  let refSus: string | null = null
  if (t.suscripcion_id) {
    const s = await db.from('suscripciones_producto').select('metodo_pago_ref').eq('id', t.suscripcion_id).maybeSingle()
    if (s.error) throw new Error(`tarjeta de la suscripción: ${s.error.message}`)
    refSus = (s.data?.metodo_pago_ref as string | null | undefined) ?? null
  }
  const refReg = registro?.metodo_pago_estado === 'registrado' ? registro.metodo_pago_ref : null
  const ref = refSus ?? refReg
  const intentos = (t.tarjeta?.intentos ?? 0) + 1
  if (!ref) return { estado: 'sin_tarjeta', intentos: t.tarjeta?.intentos ?? 0, at: ahora }
  if (!leerRefMedioPagoEpayco(ref)) {
    return { estado: 'final', intentos, at: ahora, error: 'el medio de pago no es una tarjeta de ePayco: pedir el borrado a mano' }
  }
  let r: { ok: true; borradas: number } | { ok: false; error: string }
  try {
    r = await (deps.eliminarTarjeta ?? ((x: string) => eliminarTarjetasEpayco(x)))(ref)
  } catch (e) {
    r = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (!r.ok) {
    return intentos >= TOPE_INTENTOS_TARJETA
      ? { estado: 'final', intentos, at: ahora, error: `${r.error} (${intentos} intentos: queda para una persona)` }
      : { estado: 'pendiente', intentos, at: ahora, error: r.error }
  }
  if (registro) {
    await db
      .from('valida_registros')
      .update({ cobro_token_borrado_at: ahora, metodo_pago_estado: 'eliminado', updated_at: ahora })
      .eq('id', registro.id)
      .is('cobro_token_borrado_at', null)
  }
  if (t.suscripcion_id) {
    const u = await db.from('suscripciones_producto').update({ metodo_pago_ref: null, metodo_pago_pasarela: null }).eq('id', t.suscripcion_id).not('metodo_pago_ref', 'is', null)
    if (u?.error) console.error('[valida-terminacion] referencia de la tarjeta en la suscripción:', t.suscripcion_id, u.error.message)
  }
  return { estado: 'borrada', intentos, at: ahora }
}

/** Lo que falta de una terminación `terminada` (todo, la primera vez). */
async function completar(db: Db, deps: DepsTerminacion, w: Espacio, plan: PlanAbierto, t0: TerminacionPlan, deuda: number | null, ahoraMs: number): Promise<TerminacionPlan> {
  const ahora = new Date(ahoraMs).toISOString()
  const hoy = todayBogotaISO(new Date(ahoraMs))
  let t = { ...t0 }
  if (!t.cobros_cerrados) {
    await cerrarCobros(db, t, hoy, ahora)
    t = { ...t, cobros_cerrados: true }
    await guardar(db, w.id, plan.cobro_id, t)
  }
  const registro = await registroDelEspacio(db, w.id)
  const tarjetaAntes = t.tarjeta?.estado
  if (!t.tarjeta || t.tarjeta.estado === 'pendiente') {
    t = { ...t, tarjeta: await borrarTarjeta(db, deps, t, registro, ahora) }
    await guardar(db, w.id, plan.cobro_id, t)
  }
  if (t.aviso_interno?.estado !== 'enviado') {
    t = { ...t, aviso_interno: await avisar(deps, w, registro, t, deuda, false, ahora) }
    await guardar(db, w.id, plan.cobro_id, t)
  } else if (tarjetaAntes === 'pendiente' && t.tarjeta?.estado === 'final') {
    // El primer aviso decía «se reintenta»: ahora queda para una persona, y se dice una vez.
    const correo = correoAvisoTerminacion({ ensayo: false, slug: w.slug, razonSocial: registro?.razon_social ?? null, nit: registro?.identificacion ?? null, t, deuda })
    try {
      await (deps.enviarCorreo ?? enviarPorDefecto)({ to: AVISO_TERMINACION_PARA, ...correo, idempotencyKey: `valida-terminacion-tarjeta-final-${w.id}-${Date.parse(t.suspendida_desde)}` })
    } catch (e) {
      console.error('[valida-terminacion] aviso de la tarjeta sin borrar:', w.id, e instanceof Error ? e.message : e)
    }
  }
  return t
}

export async function terminarSuspensionesVencidas(deps: DepsTerminacion): Promise<ResumenTerminacion> {
  const db = deps.db as Db
  const ahoraMs = deps.ahoraMs ?? Date.now()
  const ahora = new Date(ahoraMs).toISOString()
  const hoy = todayBogotaISO(new Date(ahoraMs))
  const habilitada = terminacionHabilitada(deps.env ?? process.env)
  const resumen: ResumenTerminacion = { revisados: 0, porTerminar: [], terminados: [], sinDeuda: [], tarjetasPendientes: [], errores: [] }

  const ws = await db.from('workspaces').select('id, slug, config_extra').eq('config_extra->>origen_registro', 'valida_autogestion')
  if (ws.error) throw new Error(`espacios autogestionados: ${ws.error.message}`)
  for (const w of (ws.data ?? []) as Espacio[]) {
    const plan = planDeConfig(w.config_extra)
    if (!plan) continue
    try {
      const previa = plan.terminacion

      // Una terminación ya hecha: solo lo que quedó a medias (tarjeta, aviso), sin volver a evaluar.
      if (previa?.estado === 'terminada') {
        if (!terminacionIncompleta(previa)) continue
        resumen.revisados += 1
        const t = await completar(db, deps, w, plan, previa, null, ahoraMs)
        if (t.tarjeta?.estado === 'pendiente') resumen.tarjetasPendientes.push({ workspaceId: w.id, detalle: t.tarjeta.error ?? '' })
        continue
      }

      const s = suspensionDelPlan(plan, ahoraMs)
      if (!s || !cumplioTreintaDias(s, ahoraMs)) continue
      const contrato = await contratoVivo(db, w.id)
      if (!contrato) continue
      const ancla = anclaDeFila(contrato)
      if (!ancla) throw new Error('el contrato no tiene ancla (ni negocio ni suscripción)')
      resumen.revisados += 1

      const deuda = await deudaDeLaSuspension(db, contrato, ancla, plan, s, hoy)
      if (!deuda.ok) {
        resumen.sinDeuda.push({ workspaceId: w.id, detalle: deuda.detalle })
        continue
      }

      const mismaSuspension = previa?.estado === 'por_terminar' && previa.suspendida_desde === s.desde
      const base: TerminacionPlan = {
        estado: 'por_terminar',
        motivo: s.motivo,
        suspendida_desde: s.desde,
        dia_terminacion: s.diaTerminacion,
        detectada_at: mismaSuspension ? previa.detectada_at : ahora,
        contrato_id: contrato.id,
        cobrador_id: contrato.workspace_id,
        negocio_id: contrato.negocio_id,
        suscripcion_id: contrato.suscripcion_id ?? null,
      }

      if (!habilitada) {
        // Ensayo: se registra una vez y se avisa a MéTRIK una vez (un aviso fallido se reintenta).
        if (mismaSuspension && previa.aviso_interno?.estado === 'enviado') {
          resumen.porTerminar.push(w.id)
          continue
        }
        const registro = await registroDelEspacio(db, w.id)
        const aviso = await avisar(deps, w, registro, base, deuda.deuda, true, ahora)
        if (!(await guardar(db, w.id, plan.cobro_id, { ...base, aviso_interno: aviso }))) continue
        if (!mismaSuspension) {
          await anotarEnAncla(
            db,
            {
              ancla,
              workspaceId: contrato.workspace_id,
              tipo: 'terminacion_por_terminar',
              texto: `Cumplió 30 días de suspensión el ${s.diaTerminacion} (cláusula 11.2). Terminación APAGADA en producción: no se hizo nada; se avisó a MéTRIK.`,
              datos: { motivo: s.motivo, suspendida_desde: s.desde, dia_terminacion: s.diaTerminacion },
            },
            'valida-terminacion',
          )
        }
        resumen.porTerminar.push(w.id)
        continue
      }

      // Encendida. Primero el estado: si algo se cae a mitad, la corrida siguiente sigue desde aquí.
      const t0: TerminacionPlan = { ...base, estado: 'terminada', terminada_at: ahora, cobros_cerrados: false, tarjeta: undefined, aviso_interno: undefined }
      if (!(await guardar(db, w.id, plan.cobro_id, t0))) continue
      const t = await completar(db, deps, w, plan, t0, deuda.deuda, ahoraMs)
      resumen.terminados.push(w.id)
      if (t.tarjeta?.estado === 'pendiente') resumen.tarjetasPendientes.push({ workspaceId: w.id, detalle: t.tarjeta.error ?? '' })
    } catch (e) {
      resumen.errores.push({ workspaceId: w.id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return resumen
}
