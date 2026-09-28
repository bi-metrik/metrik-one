/**
 * Tableros operativos: una bandeja de trabajo por fase del flujo.
 *
 * Propuesta aprobada por Mauricio el 2026-09-28
 * (`proyectos/metrik/one/docs/2026-09-27_tableros-directores.md`). Tableros deja de ser un
 * reporte y responde "¿qué hago hoy en esta fase?": arriba hasta 3 números de contexto,
 * abajo una lista de pendientes ordenada por urgencia, y cada fila con UN botón que lleva
 * al negocio, la cuota o el gasto exacto. La bandeja vacía es la meta.
 *
 * Se enciende por workspace con `workspaces.config_extra.tableros_operativos = true`
 * (ver `tablerosOperativosActivos`). Los demás workspaces no cambian.
 *
 * Qué NO entra, a propósito:
 *  - Lo que ya hace una máquina. El cron emite las cuentas de cobro y genera el enlace de
 *    pago; `wa-alerts` recuerda los saldos vencidos. Por eso una cuota entra a la bandeja
 *    solo cuando lleva `DIAS_GRACIA_CUOTA` días vencida: los mismos 3 días de gracia que usa
 *    `procesar-planes-cobro` antes de marcarla vencida y avisar al equipo.
 *  - Filas sin una fuente confiable hoy (propuesta enviada sin respuesta, pago sin
 *    conciliar, gasto "fuera de lo normal", entregas con fecha). Se dejaron fuera en vez de
 *    inventar la señal; el detalle está en la descripción del PR.
 *
 * "Sin movimiento" se mide con la última fila de `activity_log` del negocio que tiene
 * AUTOR (una persona hizo algo). Las filas de sistema sin autor (el enlace de pago que
 * genera el cron) no cuentan: que la máquina trabaje no es que el negocio avance. Como
 * `activity_log` es escaso en los negocios viejos, el último movimiento es lo más reciente
 * entre esa fila, la última entrada a la etapa (`etapa_cambiada_at`) y la creación. Nunca
 * `updated_at`: lo mueven los procesos automáticos.
 *
 * Puro: no toca DB, red ni reloj. `hoy` llega de afuera en `YYYY-MM-DD` de Bogotá.
 */

import { todayBogotaISO } from '@/lib/dates/bogota'
import { formatCOP } from '@/lib/cobros/format'
import { vencimientoDeFila, type FilaCartera } from '@/lib/negocios/cartera'
import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'

/** Pasado este tiempo sin movimiento, un negocio necesita seguimiento. */
export const DIAS_SIN_MOVIMIENTO = 7
/** Pasado este tiempo sin movimiento, el negocio está abandonado: se pierde o se reactiva. */
export const DIAS_ABANDONO = 30
/** Días de gracia tras la fecha de una cuota, los mismos del cron de planes de cobro. */
export const DIAS_GRACIA_CUOTA = 3
/** Ventana de lo que está por cobrar. */
export const DIAS_POR_COBRAR = 30
/** Ventana de la tasa de cierre. */
export const DIAS_TASA_CIERRE = 90

/** Lee el flag del workspace. Solo `true` literal lo enciende. */
export function tablerosOperativosActivos(configExtra: unknown): boolean {
  if (!configExtra || typeof configExtra !== 'object') return false
  return (configExtra as Record<string, unknown>).tableros_operativos === true
}

// ── Entrada ─────────────────────────────────────────────────────────────

export interface NegocioBandeja {
  id: string
  codigo: string | null
  nombre: string
  estado: string | null
  /** `etapas_negocio.stage` de la etapa actual: venta, ejecucion, cobro... */
  fase: string | null
  /** Nombre visible de la etapa actual (Contacto, Propuesta...). */
  etapa: string | null
  /** Precio aprobado, o el estimado si todavía no hay aprobado. */
  valor: number | null
  pausado: boolean
  pausadoHasta: string | null
  creadoEn: string
  etapaCambiadaEn: string | null
  /** Última fila de `activity_log` con autor. `null` si nunca hubo. */
  ultimaActividad: string | null
}

export interface CuotaPendiente {
  negocioId: string
  monto: number
  /** `YYYY-MM-DD`. */
  fechaEsperada: string | null
}

export interface FilaCarteraBandeja extends FilaCartera {
  negocio_id: string
}

export interface GastoSinSoporte {
  id: string
  fecha: string
  monto: number
  descripcion: string | null
  categoria: string | null
}

export interface EntradaBandejas {
  negocios: NegocioBandeja[]
  cartera: FilaCarteraBandeja[]
  cuotasPendientes: CuotaPendiente[]
  gastosSinSoporte: GastoSinSoporte[]
  /** Recaudo propio del mes, la misma cifra de /numeros. */
  cobradoMes: number
}

// ── Salida ──────────────────────────────────────────────────────────────

export type FormatoNumero = 'cop' | 'entero' | 'pct'

export interface NumeroContexto {
  etiqueta: string
  /** `null` = no hay con qué calcularlo (se pinta un guion, nunca un cero falso). */
  valor: number | null
  formato: FormatoNumero
  nota?: string
}

export interface FilaBandeja {
  /** Único dentro de la bandeja. */
  clave: string
  titulo: string
  detalle: string
  /** Texto del único botón de la fila. */
  accion: string
  href: string
  /** Rojo = ya se pasó; ámbar = se está pasando. */
  tono: 'rojo' | 'ambar'
}

export interface Bandeja {
  contexto: NumeroContexto[]
  filas: FilaBandeja[]
  /** Lo que se lee cuando la bandeja está vacía. */
  vacia: string
}

export interface Bandejas {
  comercial: Bandeja
  operaciones: Bandeja
  financiero: Bandeja
}

// ── Fechas ──────────────────────────────────────────────────────────────

/** Día de Bogotá de un instante (o la fecha tal cual si ya viene `YYYY-MM-DD`). */
export function diaBogota(valor: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor
  return todayBogotaISO(new Date(valor))
}

/** Días de calendario entre dos fechas `YYYY-MM-DD` (b - a). */
export function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number)
  const [yb, mb, db] = b.split('-').map(Number)
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000)
}

/** Lo más reciente entre la última actividad con autor, la entrada a la etapa y la creación. */
export function ultimoMovimiento(n: NegocioBandeja): string {
  const dias = [n.ultimaActividad, n.etapaCambiadaEn, n.creadoEn]
    .filter((x): x is string => !!x)
    .map(diaBogota)
  return dias.sort().at(-1) as string
}

export function diasSinMovimiento(n: NegocioBandeja, hoy: string): number {
  return Math.max(0, diasEntre(ultimoMovimiento(n), hoy))
}

/** Una pausa vigente es una decisión ya tomada: no hay nada que hacer hoy. */
export function estaPausado(n: NegocioBandeja, hoy: string): boolean {
  if (!n.pausado) return false
  return !(n.pausadoHasta && n.pausadoHasta < hoy)
}

const normalizar = (s: string | null) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

const etiquetaNegocio = (n: { codigo: string | null; nombre: string | null }) =>
  n.codigo ? `${n.codigo} · ${n.nombre ?? 'Sin nombre'}` : (n.nombre ?? 'Sin nombre')

const dias = (d: number) => (d === 1 ? '1 día' : `${d} días`)

const abierto = (n: NegocioBandeja) => n.estado === 'abierto'
const perdido = (n: NegocioBandeja) => n.estado === 'perdido' || n.estado === 'cancelado'

// ── Comercial: Contacto + Propuesta ────────────────────────────────────

export function bandejaComercial(negocios: NegocioBandeja[], hoy: string): Bandeja {
  const enVenta = negocios.filter((n) => abierto(n) && n.fase === 'venta' && !estaPausado(n, hoy))

  const entradasSemana = negocios.filter((n) => {
    const d = diasEntre(diaBogota(n.creadoEn), hoy)
    return d >= 0 && d < 7
  }).length

  const propuestas = enVenta.filter((n) => normalizar(n.etapa) === 'propuesta')
  const valorPropuestas = propuestas.reduce((s, n) => s + (n.valor ?? 0), 0)

  // Cohorte de los creados en la ventana que ya se decidieron: ganado es el que hoy está
  // fuera de venta sin haberse perdido; perdido, el que se perdió. Los que siguen en venta
  // no cuentan todavía, porque no se sabe cómo terminan.
  const cohorte = negocios.filter((n) => {
    const d = diasEntre(diaBogota(n.creadoEn), hoy)
    return d >= 0 && d < DIAS_TASA_CIERRE
  })
  const perdidos = cohorte.filter(perdido).length
  const ganados = cohorte.filter((n) => !perdido(n) && (n.fase !== 'venta' || n.estado === 'completado')).length
  const decididos = ganados + perdidos
  const tasa = decididos > 0 ? (ganados / decididos) * 100 : null

  const filas = enVenta
    .map((n) => ({ n, d: diasSinMovimiento(n, hoy) }))
    .filter(({ d }) => d > DIAS_SIN_MOVIMIENTO)
    .sort((a, b) => b.d - a.d || (b.n.valor ?? 0) - (a.n.valor ?? 0))
    .map(({ n, d }): FilaBandeja => {
      const abandonado = d > DIAS_ABANDONO
      return {
        clave: `negocio-${n.id}`,
        titulo: etiquetaNegocio(n),
        detalle: `${n.etapa ?? 'Venta'} · sin movimiento hace ${dias(d)}`,
        accion: abandonado ? 'Marcar perdido o reactivar' : 'Registrar seguimiento',
        href: `/negocios/${n.id}`,
        tono: abandonado ? 'rojo' : 'ambar',
      }
    })

  return {
    contexto: [
      { etiqueta: 'Entradas de la semana', valor: entradasSemana, formato: 'entero' },
      {
        etiqueta: 'Propuestas abiertas',
        valor: valorPropuestas,
        formato: 'cop',
        nota: propuestas.length === 1 ? '1 propuesta' : `${propuestas.length} propuestas`,
      },
      {
        etiqueta: 'Tasa de cierre a 90 días',
        valor: tasa,
        formato: 'pct',
        nota: decididos > 0 ? `${ganados} de ${decididos} decididos` : 'Ninguno decidido',
      },
    ],
    filas,
    vacia: 'Ningún negocio en venta lleva más de 7 días quieto.',
  }
}

// ── Operaciones: Ejecución ─────────────────────────────────────────────

export function bandejaOperaciones(negocios: NegocioBandeja[], hoy: string): Bandeja {
  const enEjecucion = negocios.filter((n) => abierto(n) && n.fase === 'ejecucion')
  const activos = enEjecucion.filter((n) => !estaPausado(n, hoy))
  const enPausa = enEjecucion.length - activos.length

  const filas = activos
    .map((n) => ({ n, d: diasSinMovimiento(n, hoy) }))
    .filter(({ d }) => d > DIAS_SIN_MOVIMIENTO)
    .sort((a, b) => b.d - a.d || (b.n.valor ?? 0) - (a.n.valor ?? 0))
    .map(({ n, d }): FilaBandeja => ({
      clave: `negocio-${n.id}`,
      titulo: etiquetaNegocio(n),
      detalle: `Sin avance registrado hace ${dias(d)}`,
      accion: 'Actualizar avance',
      href: `/negocios/${n.id}`,
      tono: d > DIAS_ABANDONO ? 'rojo' : 'ambar',
    }))

  return {
    contexto: [
      { etiqueta: 'En ejecución', valor: activos.length, formato: 'entero' },
      { etiqueta: 'Valor en ejecución', valor: activos.reduce((s, n) => s + (n.valor ?? 0), 0), formato: 'cop' },
      { etiqueta: 'En pausa', valor: enPausa, formato: 'entero' },
    ],
    filas,
    vacia: 'Todo lo que está en ejecución tuvo avance esta semana.',
  }
}

// ── Financiero: Cobro + gastos ─────────────────────────────────────────

interface Vencida {
  negocioId: string
  titulo: string
  vencido: number
  dias: number
}

export function bandejaFinanciera(entrada: EntradaBandejas, hoy: string): Bandeja {
  const porId = new Map(entrada.negocios.map((n) => [n.id, n]))

  // 1. Lo vencido según la cartera (la misma cuenta de /numeros y wa-alerts).
  const vencidas: Vencida[] = []
  let vencidoTotal = 0
  const enCartera = new Set<string>()
  for (const f of entrada.cartera) {
    enCartera.add(f.negocio_id)
    if (Number(f.saldo) <= TOLERANCIA_SALDO_COP) continue
    const v = vencimientoDeFila(f)
    if (v.vencido <= TOLERANCIA_SALDO_COP) continue
    vencidoTotal += v.vencido
    vencidas.push({ negocioId: f.negocio_id, titulo: etiquetaNegocio(f), vencido: v.vencido, dias: v.dias })
  }

  // 2. Cuotas vencidas de negocios que la cartera no ve. La vista solo lista negocios con
  //    algún pago (un negocio se vuelve venta con el primer pago), así que la primera cuota
  //    de una suscripción que nunca se pagó no aparece ahí. Aquí sí.
  const huerfanas = new Map<string, { monto: number; masVieja: string }>()
  for (const c of entrada.cuotasPendientes) {
    if (!c.fechaEsperada || c.fechaEsperada > hoy || enCartera.has(c.negocioId)) continue
    const n = porId.get(c.negocioId)
    if (!n || perdido(n)) continue
    const prev = huerfanas.get(c.negocioId)
    huerfanas.set(c.negocioId, {
      monto: (prev?.monto ?? 0) + c.monto,
      masVieja: prev && prev.masVieja < c.fechaEsperada ? prev.masVieja : c.fechaEsperada,
    })
  }
  for (const [negocioId, h] of huerfanas) {
    if (h.monto <= TOLERANCIA_SALDO_COP) continue
    vencidoTotal += h.monto
    const n = porId.get(negocioId)
    vencidas.push({
      negocioId,
      titulo: n ? etiquetaNegocio(n) : 'Negocio',
      vencido: h.monto,
      dias: diasEntre(h.masVieja, hoy),
    })
  }

  const porCobrar = entrada.cuotasPendientes
    .filter((c) => {
      if (!c.fechaEsperada || c.fechaEsperada <= hoy) return false
      const n = porId.get(c.negocioId)
      return !(n && perdido(n)) && diasEntre(hoy, c.fechaEsperada) <= DIAS_POR_COBRAR
    })
    .reduce((s, c) => s + c.monto, 0)

  const filasCobro = vencidas
    .filter((v) => v.dias >= DIAS_GRACIA_CUOTA)
    .sort((a, b) => b.dias - a.dias || b.vencido - a.vencido)
    .map((v): FilaBandeja => ({
      clave: `cobro-${v.negocioId}`,
      titulo: v.titulo,
      detalle: `${formatCOP(v.vencido)} vencido · ${dias(v.dias)} de mora`,
      accion: 'Llamar o registrar pago',
      href: `/negocios/${v.negocioId}`,
      tono: 'rojo',
    }))

  const filasGasto = [...entrada.gastosSinSoporte]
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map((g): FilaBandeja => ({
      clave: `gasto-${g.id}`,
      titulo: `Gasto sin soporte · ${g.descripcion || g.categoria || 'Sin descripción'}`,
      detalle: `${formatCOP(g.monto)} · registrado el ${g.fecha} por WhatsApp, esperando la foto`,
      accion: 'Subir soporte',
      href: `/movimientos?tipo=egresos&mes=${g.fecha.slice(0, 7)}`,
      tono: 'ambar',
    }))

  return {
    contexto: [
      { etiqueta: 'Cobrado del mes', valor: entrada.cobradoMes, formato: 'cop' },
      { etiqueta: 'Vencido', valor: vencidoTotal, formato: 'cop' },
      { etiqueta: 'Por cobrar en 30 días', valor: porCobrar, formato: 'cop' },
    ],
    // Primero la plata que se debe; después el papeleo.
    filas: [...filasCobro, ...filasGasto],
    vacia: 'Nada vencido que el cobro automático no esté atendiendo, y ningún gasto esperando soporte.',
  }
}

export function armarBandejas(entrada: EntradaBandejas, hoy: string): Bandejas {
  return {
    comercial: bandejaComercial(entrada.negocios, hoy),
    operaciones: bandejaOperaciones(entrada.negocios, hoy),
    financiero: bandejaFinanciera(entrada, hoy),
  }
}
