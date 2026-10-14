import 'server-only'

/**
 * Riel de cobro contra la base (F2): lo que pinta la cabecera, y el recibo de caja de cada pago.
 *
 * No es `'use server'`: recibe el cliente y el workspace de quien llama, que ya pasó su guarda.
 *
 * Recibo de caja (Vera C7, F2-6): uno por cobro, por el camino genérico de Siigo («un recibo por el
 * total», `emitirReciboDeCobro` sin `porConcepto`, idempotente por cobro), con la forma de pago de
 * la cuenta que recibió la plata. Solo con `siigo.recibo_total_automatico` en la línea: apagado, o
 * sin credenciales, o con datos que faltan, el pago queda registrado y el recibo PENDIENTE con su
 * motivo en `negocios.metadata.recibos_viaje[cobroId]`, y la cabecera ofrece «Reintentar».
 * **Nunca se emite contra el Siigo de un cliente en pruebas**: el interruptor nace apagado y las
 * pruebas usan un doble.
 */

import { createServiceClient } from '@/lib/supabase/server'
import type { emitirReciboDeCobro, ResultadoRecibo } from '@/lib/siigo/recibos'
import { proveedorDeFacturacion } from '@/lib/facturacion/proveedor'
import { formaDePagoRecibo } from '@/lib/siigo/config-viaje'
import type { SiigoConfig } from '@/lib/siigo/client'
import { primerRecibo } from '@/lib/siigo/recibo-componentes'
import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { configPlanPagos, type ReglaPlan } from './plan-pagos'
import { cuentasDeRecaudo, rielDeCobro, type CuentaRecaudo, type Riel } from './riel-cobro'
import { leerNegocioConLinea, planAcordado } from './confirmacion-datos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface PagoDelRiel {
  id: string
  monto: number
  fecha: string | null
  referencia: string | null
  cuenta: string | null
  recibo: { estado: 'emitido'; numero: string } | { estado: 'pendiente'; motivo: string } | { estado: 'no_aplica' }
  created_at: string | null
}

export interface VistaRiel {
  negocioId: string
  workspaceId: string
  agencia: string
  cliente: { nombre: string; telefono: string | null; correo: string | null }
  riel: Riel
  regla: ReglaPlan
  fechaSalida: string | null
  cuentas: CuentaRecaudo[]
  pagos: PagoDelRiel[]
  hoy: string
}

/** ¿La línea emite el recibo por el total al registrar el pago? Ausente = no (como hoy). */
export function reciboTotalAutomatico(configLinea: unknown): boolean {
  return (configLinea as { siigo?: { recibo_total_automatico?: unknown } } | null)?.siigo?.recibo_total_automatico === true
}

function conceptoDelRecibo(configLinea: unknown): string {
  const t = (configLinea as { siigo?: { recibo_concepto?: unknown } } | null)?.siigo?.recibo_concepto
  return typeof t === 'string' && t.trim() ? t.trim() : 'Abono a viaje'
}

/** Las cuentas que reciben la plata: las del espacio o, sin ellas, las de los términos de la línea. */
export async function cuentasDelNegocio(workspaceId: string, configLinea: Record<string, unknown>): Promise<CuentaRecaudo[]> {
  // `config_extra` del espacio es de servidor: se lee con el cliente de servicio, acotado al espacio.
  const { data } = await (createServiceClient() as Db).from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle()
  const terminos = typeof configLinea.terminos_base === 'string' ? configLinea.terminos_base : null
  return cuentasDeRecaudo((data as { config_extra?: unknown } | null)?.config_extra, terminos)
}

/** Lee el riel. `null` con el interruptor apagado o sin plan acordado (no hay nada que perseguir). */
export async function leerVistaRiel(db: Db, workspaceId: string, negocioId: string): Promise<VistaRiel | null> {
  const base = await leerNegocioConLinea(db, workspaceId, negocioId)
  if (!base) return null
  const cfg = configPlanPagos(base.configLinea)
  if (!cfg.activo) return null
  const plan = await planAcordado(db, negocioId)
  if (!plan) return null
  const hoy = todayBogotaISO()
  const [{ data: cobros }, { viaje }, { data: contacto }, { data: ws }, cuentas] = await Promise.all([
    db.from('cobros').select('*').eq('negocio_id', negocioId).eq('workspace_id', workspaceId).order('created_at', { ascending: true }),
    leerViajeDelNegocio(db, negocioId),
    base.negocio.contacto_id ? db.from('contactos').select('nombre, telefono, email').eq('id', base.negocio.contacto_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
    cuentasDelNegocio(workspaceId, base.configLinea),
  ])
  const filas = ((cobros ?? []) as Array<Record<string, unknown>>).filter((c) => !c.anulado_at)
  const pendientes = ((base.negocio.metadata?.recibos_viaje ?? {}) as Record<string, { motivo?: string }>)
  const nombreCuenta = new Map(cuentas.map((c) => [c.id, c.nombre]))
  const pagos: PagoDelRiel[] = filas
    .filter((c) => !!c.fecha && Number(c.monto) > 0)
    .map((c) => {
      const marca = primerRecibo(c.siigo_recibo)
      const id = String(c.id)
      return {
        id,
        monto: Number(c.monto),
        fecha: (c.fecha as string | null) ?? null,
        referencia: (c.external_ref as string | null) ?? null,
        cuenta: typeof c.cuenta_recaudo === 'string' ? nombreCuenta.get(c.cuenta_recaudo) ?? c.cuenta_recaudo : null,
        recibo: marca?.numero
          ? { estado: 'emitido' as const, numero: marca.numero }
          : pendientes[id]
            ? { estado: 'pendiente' as const, motivo: pendientes[id].motivo ?? 'El recibo no salió.' }
            : { estado: 'no_aplica' as const },
        created_at: (c.created_at as string | null) ?? null,
      }
    })
  const ct = contacto as { nombre?: string; telefono?: string | null; email?: string | null } | null
  return {
    negocioId,
    workspaceId,
    agencia: ((ws as { name?: string } | null)?.name ?? '').trim() || 'la agencia',
    cliente: { nombre: ct?.nombre?.trim() || base.negocio.nombre || 'el cliente', telefono: ct?.telefono ?? null, correo: ct?.email ?? null },
    riel: rielDeCobro({ total: plan.total, cuotas: plan.cuotas, pagos: filas as never, hoy, fechaSalida: viaje.fechas.inicio, regla: cfg.regla }),
    regla: cfg.regla,
    fechaSalida: viaje.fechas.inicio,
    cuentas,
    pagos,
    hoy,
  }
}

/** El motivo de un recibo que no salió, en palabras (C7: «Recibo pendiente: {motivo}»). */
export function motivoReciboPendiente(r: ResultadoRecibo | { ok: false; motivo: 'apagado' } | { ok: false; motivo: 'excepcion'; mensaje: string }): string | null {
  if (r.ok) return null
  switch (r.motivo) {
    case 'ya_emitido': return null
    case 'apagado': return 'La emisión de recibos de caja todavía no está encendida para esta línea.'
    case 'faltan_datos': return `Faltan datos para el recibo: ${r.faltantes.join(', ')}.`
    case 'sin_valor': return 'El pago no tiene valor.'
    case 'anulado': return 'El pago está anulado.'
    case 'duplicado_en_siigo': return 'Siigo ya tiene un recibo de este cliente por el mismo valor: revísalo antes de emitir otro.'
    case 'espera_factura': return 'El recibo sale cuando se facture.'
    case 'abono_a_mano': return 'El abono quedó para hacerlo a mano en Siigo.'
    case 'error': return /credencial|configur|vault|token/i.test(r.mensaje) ? 'Siigo no está conectado para este espacio.' : `Siigo no respondió: ${r.mensaje}`
    case 'excepcion': return `Siigo no respondió: ${r.mensaje}`
    default: return 'El recibo no salió.'
  }
}

async function anotarPendiente(svc: Db, workspaceId: string, negocioId: string, cobroId: string, motivo: string | null): Promise<void> {
  const { data } = await svc.from('negocios').select('metadata').eq('id', negocioId).eq('workspace_id', workspaceId).maybeSingle()
  const meta = ((data as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>
  const previos = { ...((meta.recibos_viaje ?? {}) as Record<string, unknown>) }
  if (motivo) previos[cobroId] = { motivo, at: new Date().toISOString() }
  else delete previos[cobroId]
  await svc.from('negocios').update({ metadata: { ...meta, recibos_viaje: previos } }).eq('id', negocioId).eq('workspace_id', workspaceId)
}

/**
 * Emite el recibo de caja de un pago del viajero, o lo deja pendiente con su motivo. Nunca lanza:
 * el pago ya quedó registrado y eso no se deshace porque Siigo no respondió.
 */
export async function emitirReciboViaje(args: {
  workspaceId: string
  negocioId: string
  cobroId: string
  staffNombre: string | null
  configLinea: Record<string, unknown>
  /** Inyectable para pruebas: el camino real de Siigo. */
  emitir?: typeof emitirReciboDeCobro
}): Promise<{ numero: string | null; pendiente: string | null }> {
  const svc = createServiceClient()
  let resultado: Parameters<typeof motivoReciboPendiente>[0]
  if (!reciboTotalAutomatico(args.configLinea)) {
    resultado = { ok: false, motivo: 'apagado' }
  } else {
    try {
      const { data: cobro } = await (svc as Db).from('cobros').select('cuenta_recaudo').eq('id', args.cobroId).maybeSingle()
      const cuentaId = (cobro as { cuenta_recaudo?: string | null } | null)?.cuenta_recaudo ?? null
      const cuentas = await cuentasDelNegocio(args.workspaceId, args.configLinea)
      const { data: ws } = await (svc as Db).from('workspaces').select('config_extra').eq('id', args.workspaceId).maybeSingle()
      const cfgWs = ((ws as { config_extra?: Record<string, unknown> } | null)?.config_extra ?? {}) as Record<string, unknown>
      const siigoCfg = (cfgWs.siigo_config ?? null) as Partial<SiigoConfig> | null
      // La forma de pago sale de la cuenta donde entró la plata (adenda Siigo). Con el mapa por
      // cuenta, una cuenta sin mapear NO emite con la forma de otra: queda «falta configurar».
      const forma = siigoCfg
        ? formaDePagoRecibo(siigoCfg, cuentaId, cuentas.find((c) => c.id === cuentaId)?.siigo_payment_id ?? null)
        : { ok: true as const, id: cuentas.find((c) => c.id === cuentaId)?.siigo_payment_id ?? null }
      if (!forma.ok) {
        resultado = { ok: false, motivo: 'faltan_datos', faltantes: [forma.falta] }
      } else {
        const opciones = { concepto: conceptoDelRecibo(args.configLinea), avisarAlCliente: false, formaDePagoId: forma.id }
        if (args.emitir) {
          resultado = await args.emitir(args.workspaceId, args.cobroId, args.staffNombre, opciones)
        } else {
          // Por la capa de proveedor (F5): Siigo hoy, Aliaddo cuando exista. Ausente = Siigo.
          const proveedor = proveedorDeFacturacion(cfgWs)
          resultado = 'error' in proveedor
            ? { ok: false, motivo: 'excepcion', mensaje: proveedor.error }
            : await proveedor.emitirRecibo({ workspaceId: args.workspaceId, cobroId: args.cobroId, staffNombre: args.staffNombre, opciones })
        }
      }
    } catch (e) {
      resultado = { ok: false, motivo: 'excepcion', mensaje: e instanceof Error ? e.message : String(e) }
    }
  }
  const numero = resultado.ok ? resultado.numero : resultado.motivo === 'ya_emitido' ? resultado.numero : null
  const pendiente = numero ? null : motivoReciboPendiente(resultado)
  await anotarPendiente(svc, args.workspaceId, args.negocioId, args.cobroId, pendiente)
  return { numero, pendiente }
}
