/**
 * Las cinco descargas CSV de las obras en autoservicio (C13): pagos, ingresos, jornadas, obras y
 * retenido. Aquí se arman las filas (columnas con nombre en español, cifras como números) a partir
 * de lo que leyó la ruta; la ruta solo lee y serializa.
 *
 * Todo derivado (fracción y costo del día, utilidad, retenido) sale de las vistas, no se calcula
 * aquí.
 */
import { todayBogotaISO } from '@/lib/dates/bogota'
import { rotuloRubro } from './cierre'
import { horaParaCampo } from './formato'
import { textoFraccion } from './llegadas'

export const TIPOS_CSV = ['pagos', 'ingresos', 'jornadas', 'obras', 'retenido'] as const
export type TipoCsv = (typeof TIPOS_CSV)[number]

export function esTipoCsv(v: unknown): v is TipoCsv {
  return typeof v === 'string' && (TIPOS_CSV as readonly string[]).includes(v)
}

export const ROTULO_CSV: Record<TipoCsv, string> = {
  pagos: 'Pagos',
  ingresos: 'Ingresos',
  jornadas: 'Jornadas',
  obras: 'Obras',
  retenido: 'Retenido',
}

export type Fila = Record<string, string | number>

export interface ObraRef {
  codigo: string | null
  nombre: string | null
  cliente: string | null
}

type Obras = (negocioId: string | null | undefined) => ObraRef | null

const num = (v: unknown) => {
  const x = Number(v ?? 0)
  return Number.isFinite(x) ? x : 0
}
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export function filasPagos(
  gastos: Array<{
    fecha: string | null
    monto: number | null
    descripcion: string | null
    categoria: string | null
    negocio_id: string | null
    numero_transaccion: string | null
    numero_repetido: boolean | null
    rubro: string | null
  }>,
  obra: Obras,
): Fila[] {
  return gastos.map((g) => {
    const o = obra(g.negocio_id)
    return {
      fecha: txt(g.fecha),
      codigo_obra: txt(o?.codigo),
      obra: g.negocio_id ? txt(o?.nombre) : 'Gasto de empresa',
      rubro: g.rubro ? g.rubro : g.categoria ? rotuloRubro(g.categoria) : '',
      categoria_fiscal: txt(g.categoria),
      descripcion: txt(g.descripcion),
      valor: num(g.monto),
      numero_transaccion: txt(g.numero_transaccion),
      numero_repetido: g.numero_repetido ? 'Si' : 'No',
    }
  })
}

export function filasIngresos(
  cobros: Array<{
    fecha: string | null
    monto: number | null
    negocio_id: string | null
    numero_transaccion: string | null
    tipo_cobro: string | null
    notas: string | null
    factura: string | null
  }>,
  obra: Obras,
): Fila[] {
  return cobros.map((c) => {
    const o = obra(c.negocio_id)
    return {
      fecha: txt(c.fecha),
      codigo_obra: txt(o?.codigo),
      obra: txt(o?.nombre),
      cliente: txt(o?.cliente),
      factura: txt(c.factura),
      valor: num(c.monto),
      numero_transaccion: txt(c.numero_transaccion),
      tipo: txt(c.tipo_cobro),
      notas: txt(c.notas),
    }
  })
}

export function filasJornadas(
  jornadas: Array<{
    fecha: string | null
    hora: string | null
    colaborador: string | null
    negocio_id: string | null
    fraccion: number | null
    valor_jornada: number | null
    costo: number | null
  }>,
  obra: Obras,
): Fila[] {
  return jornadas.map((j) => {
    const o = obra(j.negocio_id)
    const fraccion = num(j.fraccion) || 1
    return {
      fecha: txt(j.fecha),
      hora_llegada: horaParaCampo(j.hora),
      colaborador: txt(j.colaborador),
      codigo_obra: txt(o?.codigo),
      obra: txt(o?.nombre),
      jornada: textoFraccion(fraccion),
      fraccion,
      valor_jornada: j.valor_jornada === null || j.valor_jornada === undefined ? '' : num(j.valor_jornada),
      costo: j.costo === null || j.costo === undefined ? '' : num(j.costo),
    }
  })
}

export function filasObras(
  cierres: Array<{
    negocio_id: string | null
    codigo: string | null
    nombre: string | null
    nombre_corto: string | null
    estado: string | null
    vendido: number | null
    gastos_total: number | null
    mano_obra: number | null
    jornadas: number | null
    jornadas_sin_valor: number | null
    utilidad: number | null
    facturado: number | null
    cobrado: number | null
    retenido: number | null
    saldo_facturas: number | null
    por_cobrar: number | null
  }>,
  obra: Obras,
): Fila[] {
  return cierres.map((c) => {
    const vendido = num(c.vendido)
    const utilidad = num(c.utilidad)
    return {
      codigo_obra: txt(c.codigo),
      obra: txt(c.nombre),
      nombre_corto: txt(c.nombre_corto),
      cliente: txt(obra(c.negocio_id)?.cliente),
      estado: txt(c.estado),
      vendido,
      gastado: num(c.gastos_total),
      mano_obra: num(c.mano_obra),
      jornadas: num(c.jornadas),
      jornadas_sin_valor: num(c.jornadas_sin_valor),
      utilidad,
      utilidad_pct: vendido > 0 ? Math.round((utilidad / vendido) * 1000) / 10 : '',
      facturado: num(c.facturado),
      cobrado: num(c.cobrado),
      retenido: num(c.retenido),
      saldo_facturas_abiertas: num(c.saldo_facturas),
      por_cobrar: num(c.por_cobrar),
    }
  })
}

/** Solo facturas PAGADAS: lo retenido es su diferencia total − recibido (no es una retención certificada). */
export function filasRetenido(
  facturas: Array<{
    numero_factura: string | null
    fecha_emision: string | null
    negocio_id: string | null
    monto: number | null
    recibido: number | null
    retenido: number | null
    estado: string | null
    pagada_at: string | null
  }>,
  obra: Obras,
): Fila[] {
  return facturas
    .filter((f) => f.estado === 'pagada')
    .map((f) => {
      const o = obra(f.negocio_id)
      return {
        factura: txt(f.numero_factura),
        fecha_factura: txt(f.fecha_emision),
        codigo_obra: txt(o?.codigo),
        obra: txt(o?.nombre),
        cliente: txt(o?.cliente),
        total: num(f.monto),
        recibido: num(f.recibido),
        retenido: num(f.retenido),
        pagada_el: f.pagada_at ? todayBogotaISO(new Date(f.pagada_at)) : '',
      }
    })
}

/** `obras-pagos-2026-10-21.csv` */
export function nombreArchivoCsv(tipo: TipoCsv, hoy: string): string {
  return `obras-${tipo}-${hoy}.csv`
}
