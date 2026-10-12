/**
 * «Mis pendientes» por persona y el tablero de margen de la dirección (F6-8, F6-9; Noor §5).
 *
 * Puro: recibe los viajes ya leídos y devuelve la lista de la persona, ordenada por urgencia en tres
 * grupos —Vencido · Hoy · Esta semana—, cada línea con UNA acción. El vacío nunca es una pantalla
 * en blanco: «Nada pendiente hoy. Lo próximo: {hecho} el {fecha}.»
 *
 *   · Comercial (la dueña del negocio): cuotas vencidas o que vencen hoy, paquetes por enviar
 *     (viaja en ≤ 7 días), encuestas sin respuesta, prerreservas que vencen hoy.
 *   · Operaciones: pagos a proveedor que vencen en 3 días o vencidos, servicios sin reservar de
 *     viajes confirmados, pagados sin confirmación del proveedor a 7 días del viaje, y lo que la
 *     dirección no aprobó.
 *   · Dirección: aprobaciones (Aprobar / No aprobar en la línea), cuotas vencidas hace 2 días o
 *     más, cierres por confirmar y viajes que salen con saldo. Más la tarjeta «Margen del mes».
 *
 * Fuera de alcance (Vera §3): X5 (escalar un Seguimiento sin resultado a las 2 semanas) y el «sí»
 * detectado por el bot (X3).
 */

import { cuotasConEstadoViaje, type PagoViajero } from './riel-cobro'
import { estadoDelServicio, valorAPagar, type AprobacionDelServicio, type GastoDelServicio, type EstadoEscrito } from './estado-servicio'
import { leerCierreGuardado, leerPostventa, sumarDias, diasEntre, pesosCierre } from './cierre-viaje'
import { leerPaqueteEnviado } from './entrega'
import { leerPrerreserva } from './confirmacion'
import type { CuotaPlan } from './plan-pagos'

export type Grupo = 'vencido' | 'hoy' | 'semana'

export type Accion =
  | { tipo: 'abrir'; label: string }
  | { tipo: 'aprobar'; label: string; aprobacionId: string; servicioId: string | null }

export interface Pendiente {
  id: string
  grupo: Grupo
  fecha: string
  texto: string
  negocioId: string
  viaje: string
  accion: Accion
}

export interface AprobacionPendiente {
  id: string
  tipo: string
  entidad_tipo: string
  entidad_id: string
  estado: 'solicitada' | 'aprobada' | 'rechazada' | 'caducada'
  motivo: string | null
  detalle: Record<string, unknown> | null
  solicitada_por_nombre: string | null
  decidida_at: string | null
}

export interface ServicioPendiente {
  id: string
  nombre: string
  proveedor_nombre: string | null
  estado: EstadoEscrito
  costo_cotizado: number
  valor_por_pagar: number | null
  confirmacion_ref: string | null
  fecha_limite_pago: string | null
  gastos: Array<GastoDelServicio & { fecha?: string | null }>
  aprobaciones: AprobacionDelServicio[]
}

export interface ViajePendiente {
  id: string
  nombre: string
  cliente: string
  etapaNumero: number | null
  etapaGates: string[]
  esPrueba: boolean
  salida: string | null
  regreso: string | null
  precioAprobado: number
  metadata: Record<string, unknown> | null
  comercialStaffId: string | null
  operacionesStaffId: string | null
  cuotas: CuotaPlan[]
  pagos: PagoViajero[]
  servicios: ServicioPendiente[]
  aprobaciones: AprobacionPendiente[]
}

export interface Persona {
  staffId: string | null
  esDireccion: boolean
  areas: string[]
}

const GRUPO_ORDEN: Record<Grupo, number> = { vencido: 0, hoy: 1, semana: 2 }

function grupoDe(fecha: string, hoy: string): Grupo | null {
  if (fecha < hoy) return 'vencido'
  if (fecha === hoy) return 'hoy'
  if (fecha <= sumarDias(hoy, 7)) return 'semana'
  return null
}

const MOTIVO_APROBACION: Record<string, string> = {
  pago_sin_abono: 'antes del anticipo',
  medio_personal: 'con tarjeta personal',
  desviacion_costo: 'sobre lo cotizado',
  plan_fuera_de_regla: 'plan fuera de la regla',
  enviar_paquete_sin_cobro: 'enviar el paquete sin el 80 %',
  forzar_factura: 'facturar antes de tiempo',
}

function esMio(staffId: string | null, persona: Persona): boolean {
  return !!persona.staffId && staffId === persona.staffId
}

export function pendientesDe(viajes: readonly ViajePendiente[], persona: Persona, hoy: string): Pendiente[] {
  const out: Pendiente[] = []
  const comercial = persona.areas.includes('comercial') || persona.areas.includes('direccion')
  const operaciones = persona.areas.includes('operaciones')
  const add = (p: Omit<Pendiente, 'id'> & { id?: string }) => out.push({ id: p.id ?? `${p.negocioId}:${p.texto}`, ...p })

  for (const v of viajes) {
    // Un viaje de prueba (F8-1) solo le aparece a quien lo lleva (las cuentas de prueba).
    if (v.esPrueba && !esMio(v.comercialStaffId, persona) && !esMio(v.operacionesStaffId, persona)) continue
    const viaje = v.nombre
    const quien = v.cliente.split(/\s+/)[0] || 'El cliente'
    const { cuotas } = cuotasConEstadoViaje(v.cuotas, v.pagos, hoy)
    const pagado = v.pagos.filter(p => p.fecha && !p.anulado_at).reduce((a, p) => a + (Number(p.monto) || 0) + (Number(p.retencion_iva) || 0), 0)
    const saldo = Math.max(0, v.precioAprobado - pagado)
    const deLaComercial = esMio(v.comercialStaffId, persona) || (!v.comercialStaffId && comercial)
    const deOperaciones = esMio(v.operacionesStaffId, persona) || (!v.operacionesStaffId && operaciones)

    // ── Comercial ──
    if (deLaComercial) {
      for (const c of cuotas) {
        if (c.estado !== 'vencida' && c.estado !== 'vence_hoy') continue
        add({ grupo: c.estado === 'vencida' ? 'vencido' : 'hoy', fecha: c.fecha, negocioId: v.id, viaje,
          texto: c.estado === 'vencida' ? `Cuota de ${quien} vencida: faltan ${pesosCierre(c.saldo)}.` : `Hoy vence la cuota de ${quien}: ${pesosCierre(c.saldo)}.`,
          accion: { tipo: 'abrir', label: 'Pegar comprobante' } })
      }
      if (v.salida && !leerPaqueteEnviado(v.metadata) && v.etapaGates.includes('paquete_enviado')) {
        const g = grupoDe(v.salida, hoy)
        if (g && v.salida >= hoy) add({ grupo: g === 'semana' ? 'semana' : 'hoy', fecha: v.salida, negocioId: v.id, viaje,
          texto: `Paquete por enviar: ${quien} viaja el ${v.salida.slice(5).split('-').reverse().join('/')}.`, accion: { tipo: 'abrir', label: 'Ver paquete' } })
      }
      if (v.regreso && leerPostventa(v.metadata).calificacion === null && v.etapaGates.includes('postventa_completa')) {
        const desde = sumarDias(v.regreso, 2)
        if (desde <= hoy) add({ grupo: diasEntre(desde, hoy) >= 3 ? 'vencido' : 'hoy', fecha: desde, negocioId: v.id, viaje,
          texto: `${quien} no ha respondido la encuesta. Escríbele tú.`, accion: { tipo: 'abrir', label: 'Registrar respuesta' } })
      }
      const pre = leerPrerreserva((v.metadata ?? {}).prerreserva)
      if (pre && pre.estado === 'vigente' && pagado === 0 && pre.vence_at.slice(0, 10) <= hoy) {
        add({ grupo: 'hoy', fecha: hoy, negocioId: v.id, viaje,
          texto: `Prerreserva de ${quien} vence hoy a las ${new Date(pre.vence_at).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' })}.`,
          accion: { tipo: 'abrir', label: 'Pegar comprobante' } })
      }
    }

    // ── Operaciones ──
    if (deOperaciones) {
      for (const s of v.servicios) {
        const est = estadoDelServicio(s, s.gastos, s.aprobaciones)
        if (est === 'cancelado') continue
        if ((est === 'por_reservar' || est === 'reservado') && s.fecha_limite_pago && valorAPagar(s) > 0) {
          const g = s.fecha_limite_pago < hoy ? 'vencido' : s.fecha_limite_pago === hoy ? 'hoy' : s.fecha_limite_pago <= sumarDias(hoy, 3) ? 'semana' : null
          if (g) add({ grupo: g, fecha: s.fecha_limite_pago, negocioId: v.id, viaje,
            texto: g === 'vencido' ? `${s.nombre} venció sin pagar.` : g === 'hoy' ? `Paga ${s.nombre}: vence hoy.` : `Paga ${s.nombre}: vence el ${s.fecha_limite_pago.slice(5).split('-').reverse().join('/')}.`,
            accion: { tipo: 'abrir', label: 'Abrir fila' } })
        }
        if (est === 'por_reservar' && (v.etapaNumero ?? 0) >= 5 && !s.fecha_limite_pago) {
          add({ grupo: 'semana', fecha: hoy, negocioId: v.id, viaje, texto: `Reserva ${s.nombre}.`, accion: { tipo: 'abrir', label: 'Abrir fila' } })
        }
        if (est === 'pagado' && v.salida && v.salida >= hoy && v.salida <= sumarDias(hoy, 7)) {
          add({ grupo: 'semana', fecha: v.salida, negocioId: v.id, viaje, texto: `Confirma ${s.nombre} con el proveedor final.`, accion: { tipo: 'abrir', label: 'Abrir fila' } })
        }
      }
      for (const a of v.aprobaciones) {
        if (a.estado !== 'rechazada' || a.entidad_tipo !== 'servicio' || !a.decidida_at) continue
        if (diasEntre(a.decidida_at.slice(0, 10), hoy) > 7) continue
        const s = v.servicios.find(x => x.id === a.entidad_id)
        add({ grupo: 'hoy', fecha: a.decidida_at.slice(0, 10), negocioId: v.id, viaje,
          texto: `No aprobó ${s?.nombre ?? 'el pago'}: ${a.motivo ?? 'sin motivo'}.`, accion: { tipo: 'abrir', label: 'Abrir fila' } })
      }
    }

    // ── Dirección ──
    if (persona.esDireccion) {
      for (const a of v.aprobaciones) {
        if (a.estado !== 'solicitada') continue
        const s = a.entidad_tipo === 'servicio' ? v.servicios.find(x => x.id === a.entidad_id) : null
        const monto = typeof a.detalle?.monto === 'number' ? ` ${pesosCierre(a.detalle.monto as number)}` : ''
        const que = s ? `pagar${monto} a ${s.proveedor_nombre?.trim() || s.nombre}` : 'aprobar el plan de pagos'
        add({ id: `apr:${a.id}`, grupo: 'hoy', fecha: hoy, negocioId: v.id, viaje,
          texto: `${a.solicitada_por_nombre ?? 'El equipo'} pide ${que}: ${MOTIVO_APROBACION[a.tipo] ?? a.tipo}.`,
          accion: { tipo: 'aprobar', label: 'Aprobar', aprobacionId: a.id, servicioId: s?.id ?? null } })
      }
      for (const c of cuotas) {
        if (c.estado === 'vencida' && diasEntre(c.fecha, hoy) >= 2) {
          add({ grupo: 'vencido', fecha: c.fecha, negocioId: v.id, viaje,
            texto: `Cuota vencida: ${v.cliente} · ${pesosCierre(c.saldo)} · hace ${diasEntre(c.fecha, hoy)} días.`, accion: { tipo: 'abrir', label: 'Abrir' } })
        }
      }
      if (v.etapaGates.includes('margen_confirmado') && !leerCierreGuardado(v.metadata).confirmado) {
        const desde = v.regreso ? sumarDias(v.regreso, 1) : hoy
        add({ grupo: v.regreso && diasEntre(desde, hoy) >= 5 ? 'vencido' : 'hoy', fecha: desde, negocioId: v.id, viaje,
          texto: `Cierre por confirmar: ${viaje}.`, accion: { tipo: 'abrir', label: 'Confirmar cierre' } })
      }
      if (v.salida && saldo > 0 && v.salida >= hoy && v.salida <= sumarDias(hoy, 7)) {
        add({ grupo: v.salida === hoy ? 'hoy' : 'semana', fecha: v.salida, negocioId: v.id, viaje,
          texto: `${v.cliente} viaja ${v.salida === hoy ? 'hoy' : `el ${v.salida.slice(5).split('-').reverse().join('/')}`} con saldo de ${pesosCierre(saldo)}.`, accion: { tipo: 'abrir', label: 'Abrir' } })
      }
    }
  }
  const unicos = new Map(out.map(p => [p.id, p]))
  return [...unicos.values()].sort((a, b) => GRUPO_ORDEN[a.grupo] - GRUPO_ORDEN[b.grupo] || (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))
}

/** El próximo hecho, para el vacío: «Lo próximo: cuota de Carolina el vie 30 oct». */
export function loProximo(viajes: readonly ViajePendiente[], hoy: string): { texto: string; fecha: string } | null {
  let mejor: { texto: string; fecha: string } | null = null
  const cand = (texto: string, fecha: string | null) => {
    if (!fecha || fecha <= sumarDias(hoy, 7)) return
    if (!mejor || fecha < mejor.fecha) mejor = { texto, fecha }
  }
  for (const v of viajes) {
    if (v.esPrueba) continue
    const quien = v.cliente.split(/\s+/)[0] || 'el cliente'
    const { cuotas } = cuotasConEstadoViaje(v.cuotas, v.pagos, hoy)
    for (const c of cuotas) if (c.estado !== 'pagada') cand(`cuota de ${quien}`, c.fecha)
    cand(`viaje de ${quien}`, v.salida)
    for (const s of v.servicios) cand(`pago de ${s.nombre}`, s.fecha_limite_pago)
  }
  return mejor
}

// ── Tablero de margen de la dirección (F6-8) ─────────────────────────────────

export interface CierreTablero {
  negocioId: string
  nombre: string
  esPrueba: boolean
  /** `YYYY-MM` de la confirmación. */
  mes: string
  margenReal: number
  ingresoNeto: number
  margenCotizado: number
  servicios: Array<{ proveedor: string; cotizado: number; real: number }>
  gastosProveedor: Array<{ monto: number; titular: string | null }>
}

export interface Tablero {
  meses: Array<{ mes: string; viajes: number; margenReal: number; ingresoNeto: number; pctReal: number | null; margenCotizado: number; pctCotizado: number | null }>
  viajes: Array<{ negocioId: string; nombre: string; mes: string; margenReal: number; pctReal: number | null; margenCotizado: number }>
  proveedores: Array<{ proveedor: string; desviacion: number }>
  pctTarjetasPersonales: number | null
}

const pct1 = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null)

/** Excluye `es_prueba`. Sale de los cierres confirmados: cuadra con su suma por construcción. */
export function tableroDeMargen(cierres: readonly CierreTablero[]): Tablero {
  const reales = cierres.filter(c => !c.esPrueba)
  const porMes = new Map<string, Tablero['meses'][number]>()
  for (const c of reales) {
    const m = porMes.get(c.mes) ?? { mes: c.mes, viajes: 0, margenReal: 0, ingresoNeto: 0, pctReal: null, margenCotizado: 0, pctCotizado: null }
    m.viajes++
    m.margenReal += c.margenReal
    m.ingresoNeto += c.ingresoNeto
    m.margenCotizado += c.margenCotizado
    porMes.set(c.mes, m)
  }
  const meses = [...porMes.values()].sort((a, b) => (a.mes < b.mes ? 1 : -1)).map(m => ({ ...m, pctReal: pct1(m.margenReal, m.ingresoNeto), pctCotizado: pct1(m.margenCotizado, m.ingresoNeto) }))
  const prov = new Map<string, number>()
  for (const c of reales) for (const s of c.servicios) prov.set(s.proveedor, (prov.get(s.proveedor) ?? 0) + (s.real - s.cotizado))
  const gastos = reales.flatMap(c => c.gastosProveedor)
  const total = gastos.reduce((a, g) => a + g.monto, 0)
  const personal = gastos.filter(g => g.titular === 'personal').reduce((a, g) => a + g.monto, 0)
  return {
    meses,
    viajes: reales.map(c => ({ negocioId: c.negocioId, nombre: c.nombre, mes: c.mes, margenReal: c.margenReal, pctReal: pct1(c.margenReal, c.ingresoNeto), margenCotizado: c.margenCotizado })),
    proveedores: [...prov.entries()].map(([proveedor, desviacion]) => ({ proveedor, desviacion })).filter(p => p.desviacion !== 0).sort((a, b) => b.desviacion - a.desviacion),
    pctTarjetasPersonales: pct1(personal, total),
  }
}
