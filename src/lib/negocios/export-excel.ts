/**
 * Filas del Excel de la tabla de negocios (descarga de autoservicio).
 *
 * Compromiso con SOENA (Acta de Aceptación, cláusula SEXTA numeral 2): «descarga en
 * formato Excel de las tablas de negocios que la plataforma ya presenta en pantalla,
 * con los filtros que el usuario tenga aplicados». Una hoja, una fila por negocio, con
 * la forma del Sheet "2.0 CLIENTES VEHICULO" que el equipo ya usa: primer y segundo
 * pago como columnas, no una hoja de cobros.
 *
 * Este módulo es PURO: recibe lo que ya se leyó (los negocios tal como los ve la lista,
 * el valor de cada uno, la venta, los cobros, los responsables) y devuelve las filas
 * con sus encabezados en español. No sabe de Supabase ni de XLSX; por eso se prueba
 * sin red. La ruta (`api/negocios/export`) lee y serializa.
 *
 * Tres reglas de forma que el spec fija y que aquí se cumplen sin excepción:
 *   - fechas como `Date` (Excel las trata como fecha, no como texto);
 *   - montos como número sin formato;
 *   - booleanos como `Si` / `No`; lo que no se sabe, celda vacía (`null`).
 *
 * ⚠️ Recaudado con IVA. `v_venta_mes_comercial.honorario_recaudado` bajó a base (sin
 * IVA) el 2026-09-02 (`20260902220053`), así que ya no sirve para restarlo del
 * honorario con IVA de la columna 24 sin mezclar. Aquí el recaudado sale de los tramos
 * BRUTOS de `v_cobro_valor` (`a_tramo1 + a_tramo2`), que es la misma imputación con la
 * que la vista decide qué parte de cada pago es honorario, pero antes de descontar el
 * IVA. Así 24 y 30 hablan de lo mismo y el saldo (31) es una resta honesta.
 */

import { bogotaParts } from '@/lib/dates/bogota'
import { etiquetaStage } from '@/lib/negocios/stage-label'
import { marcaCondicionLabel, type MarcaCondicion } from '@/lib/negocios/constants'

// ── Entradas ────────────────────────────────────────────────────────────────

/**
 * Lo que la fila necesita de cada negocio. Es un subconjunto estructural de
 * `NegocioResumen` (la lista), declarado aparte para que las pruebas no tengan que
 * fabricar las ~50 propiedades de la tarjeta.
 */
export type NegocioExportable = {
  id: string
  codigo: string | null
  nombre: string
  empresa_nombre: string | null
  contacto_nombre: string | null
  contacto_telefono: string | null
  cedula: string | null
  stage_actual: 'venta' | 'ejecucion' | 'cobro' | null
  etapa_stage: string | null
  etapa_nombre: string | null
  estado: string | null
  cierre_motivo: 'exitoso' | 'perdido' | 'cancelado' | null
  razon_cierre: string | null
  created_at: string | null
  closed_at: string | null
  origen: string | null
  aliado_nombre: string | null
  es_meta_lead: boolean
  servicio_label: string | null
  seccional_label: string | null
  ciudad_label: string | null
  vehiculo_label: string | null
  radicado: string | null
  numero_factura: string | null
  precio_aprobado: number | null
  precio_estimado: number | null
  horas_habiles_en_etapa: number | null
  etapa_sla_horas: number | null
  sla_exceso_horas: number | null
  reproceso: { tipo: string; ciclo: number; etapa_retorno: string | null } | null
  marcas: MarcaCondicion[]
  pausado: boolean
  pausado_hasta: string | null
  motivo_pausa: string | null
}

/** `v_negocio_valor`: base, IVA, plan y techo de tarifa. */
export type ValorNegocio = {
  negocio_id: string
  valor_base: number | null
  valor_iva: number | null
  plan_pago: number | null
  techo_tarifa: number | null
}

/** `v_venta_mes_comercial`: solo los negocios vendidos tienen fila. */
export type VentaNegocio = {
  negocio_id: string
  fecha_venta: string | null
  caso_completo: boolean | null
}

/** `v_negocio_bonificable`: `bonificable` NULL cuando la línea no declaró umbral. */
export type BonificableNegocio = {
  negocio_id: string
  bonificable: boolean | null
}

/** `v_negocio_comercial`: a qué comercial se atribuye el negocio. */
export type ComercialNegocio = {
  negocio_id: string
  comercial_staff_id: string | null
}

/** `v_cobro_valor`: los tramos brutos (con IVA) de cada cobro. */
export type TramoCobro = {
  negocio_id: string | null
  a_tramo1: number | null
  a_tramo2: number | null
}

/** `cobros`: un pago del cliente. `anulado_at` lleno = no cuenta. */
export type CobroExportable = {
  id: string
  negocio_id: string | null
  monto: number | null
  fecha: string | null
  created_at: string | null
  external_ref: string | null
  anulado_at?: string | null
}

/** `negocio_responsables` con `rol = 'operaciones'`. */
export type ResponsableOperaciones = {
  negocio_id: string
  staff_id: string
}

export type StaffNombre = {
  id: string
  full_name: string | null
}

export type EntradaExcel = {
  /** En el ORDEN en que se quieren las filas (el de la pantalla). */
  negocios: NegocioExportable[]
  valores: ValorNegocio[]
  ventas: VentaNegocio[]
  bonificables: BonificableNegocio[]
  comerciales: ComercialNegocio[]
  tramos: TramoCobro[]
  cobros: CobroExportable[]
  operaciones: ResponsableOperaciones[]
  staff: StaffNombre[]
  /** `https://{slug}.metrikone.co`, sin barra final. */
  baseUrl: string
}

// ── Encabezados (en el orden del spec) ──────────────────────────────────────

export const ENCABEZADOS = [
  // Identidad y estado
  'Codigo',
  'Negocio',
  'Cliente',
  'Cedula / NIT',
  'Telefono',
  'Fase',
  'Etapa',
  'Estado',
  'Cierre',
  'Fecha creacion',
  'Fecha venta',
  'Fecha cierre',
  // Personas y origen
  'Comercial',
  'Operaciones',
  'Origen',
  'Aliado',
  'Lead Meta',
  'Servicio',
  // Caso
  'Seccional DIAN',
  'Ciudad',
  'Vehiculo',
  'Radicado UPME',
  'No. factura',
  // Dinero
  'Honorario con IVA',
  'Precio estimado',
  'Honorario sin IVA',
  'IVA',
  'Plan de pago',
  'Tarifa UPME confirmada',
  'Recaudado honorario',
  'Saldo honorario',
  'Primer pago monto',
  'Primer pago fecha',
  'Primer pago referencia',
  'Segundo pago monto',
  'Segundo pago fecha',
  'Segundo pago referencia',
  'Otros pagos',
  'Caso completo',
  'Bonificable',
  // Operacion
  'Horas habiles en etapa',
  'SLA etapa (horas)',
  'Atraso (horas)',
  'Reproceso',
  'Marcas',
  'Pausado',
  'Pausado hasta',
  'Motivo pausa',
  'Link ONE',
] as const

export type Encabezado = (typeof ENCABEZADOS)[number]

export type CeldaExcel = string | number | Date | null

export type FilaExcel = Record<Encabezado, CeldaExcel>

/** Columnas que llevan solo día (formato `yyyy-mm-dd`). */
export const COLUMNAS_FECHA: readonly Encabezado[] = [
  'Fecha venta',
  'Primer pago fecha',
  'Segundo pago fecha',
]

/** Columnas con día y hora en Bogotá (formato `yyyy-mm-dd hh:mm`). */
export const COLUMNAS_FECHA_HORA: readonly Encabezado[] = [
  'Fecha creacion',
  'Fecha cierre',
  'Pausado hasta',
]

export const COLUMNA_LINK: Encabezado = 'Link ONE'

// ── Helpers ─────────────────────────────────────────────────────────────────

const SI_NO = (v: boolean | null | undefined): 'Si' | 'No' | null =>
  v === null || v === undefined ? null : v ? 'Si' : 'No'

const texto = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

const numero = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Fecha para Excel.
 *
 * SheetJS convierte un `Date` a serial de Excel con los componentes LOCALES del
 * runtime (`getTimezoneOffset`). Si se construye el `Date` con el instante real, la
 * misma fila sale con un día distinto según dónde corra el servidor (Vercel en UTC,
 * el portátil de quien prueba en Bogotá). Por eso el `Date` se arma con la hora de
 * pared de Bogotá puesta en componentes locales: lo que Excel muestra es el día y la
 * hora que ve el equipo, corra donde corra.
 *
 *   - `'YYYY-MM-DD'` (columnas `date`): ese día, a medianoche local. Nunca pasa por
 *     `new Date(iso)`, que lo leería como UTC y en Colombia lo correría un día atrás.
 *   - instante ISO (columnas `timestamptz`): sus componentes en Bogotá.
 *   - vacío o inválido: `null` (celda vacía).
 */
export function fechaExcel(v: string | null | undefined): Date | null {
  const s = (v ?? '').trim()
  if (!s) return null
  const soloDia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (soloDia) {
    const [, y, m, d] = soloDia
    const fecha = new Date(Number(y), Number(m) - 1, Number(d))
    return Number.isNaN(fecha.getTime()) ? null : fecha
  }
  const instante = new Date(s)
  if (Number.isNaN(instante.getTime())) return null
  const p = bogotaParts(instante)
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
}

/**
 * Fase de la fila. Un negocio que ya no está `abierto` (completado, perdido,
 * cancelado) va como «Cerrado» aunque su etapa siga apuntando a la última fase por
 * la que pasó; el resto usa la etiqueta de la fase de su etapa, la misma que pinta
 * la lista. Sin etapa cae al `stage_actual` del negocio.
 */
export function faseDeNegocio(n: Pick<NegocioExportable, 'estado' | 'etapa_stage' | 'stage_actual'>): string | null {
  if (n.estado && n.estado !== 'abierto') return etiquetaStage('cerrado')
  const stage = n.etapa_stage ?? n.stage_actual
  return texto(etiquetaStage(stage))
}

const CIERRE_LABEL: Record<string, string> = {
  exitoso: 'Exitoso',
  perdido: 'Perdido',
  cancelado: 'Cancelado',
}

function cierreDeNegocio(n: Pick<NegocioExportable, 'cierre_motivo' | 'razon_cierre'>): string | null {
  const motivo = n.cierre_motivo ? (CIERRE_LABEL[n.cierre_motivo] ?? n.cierre_motivo) : null
  const razon = texto(n.razon_cierre)
  if (motivo && razon) return `${motivo} — ${razon}`
  return motivo ?? razon
}

/**
 * Los pagos de un negocio en el orden en que entraron: por fecha, y a igual fecha
 * por creación (y por id, para que el orden sea el mismo en cada descarga). Un cobro
 * sin fecha es un pago que todavía no se confirmó: va al final. Los anulados no son
 * pagos y se descartan antes de contar.
 */
export function ordenarPagos(cobros: CobroExportable[]): CobroExportable[] {
  return cobros
    .filter((c) => !c.anulado_at)
    .slice()
    .sort((a, b) => {
      const fa = a.fecha ?? '9999-12-31'
      const fb = b.fecha ?? '9999-12-31'
      if (fa !== fb) return fa < fb ? -1 : 1
      const ca = a.created_at ?? ''
      const cb = b.created_at ?? ''
      if (ca !== cb) return ca < cb ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

const agruparPor = <T>(xs: T[], clave: (x: T) => string | null | undefined): Map<string, T[]> => {
  const m = new Map<string, T[]>()
  for (const x of xs) {
    const k = clave(x)
    if (!k) continue
    const lista = m.get(k)
    if (lista) lista.push(x)
    else m.set(k, [x])
  }
  return m
}

const indexarPor = <T>(xs: T[], clave: (x: T) => string): Map<string, T> => {
  const m = new Map<string, T>()
  for (const x of xs) m.set(clave(x), x)
  return m
}

// ── Armado ──────────────────────────────────────────────────────────────────

/**
 * Una fila por negocio, en el orden de `entrada.negocios`. Todo lo que no se
 * encuentre para un negocio (sin venta, sin valor, sin cobros) queda vacío o en cero
 * según sea una AUSENCIA (vacío) o una CUENTA (cero): «recaudado 0» es un hecho,
 * «bonificable» sin umbral declarado no lo es.
 */
export function armarFilasExcel(entrada: EntradaExcel): FilaExcel[] {
  const valorPor = indexarPor(entrada.valores, (v) => v.negocio_id)
  const ventaPor = indexarPor(entrada.ventas, (v) => v.negocio_id)
  const bonifPor = indexarPor(entrada.bonificables, (b) => b.negocio_id)
  const comercialPor = indexarPor(entrada.comerciales, (c) => c.negocio_id)
  const nombrePor = new Map(entrada.staff.map((s) => [s.id, texto(s.full_name)]))
  const tramosPor = agruparPor(entrada.tramos, (t) => t.negocio_id)
  const cobrosPor = agruparPor(entrada.cobros, (c) => c.negocio_id)
  const operacionesPor = agruparPor(entrada.operaciones, (o) => o.negocio_id)
  const base = entrada.baseUrl.replace(/\/+$/, '')

  return entrada.negocios.map((n) => {
    const valor = valorPor.get(n.id)
    const venta = ventaPor.get(n.id)
    const bonif = bonifPor.get(n.id)
    const comercialId = comercialPor.get(n.id)?.comercial_staff_id ?? null
    const operaciones = (operacionesPor.get(n.id) ?? [])
      .map((o) => nombrePor.get(o.staff_id) ?? null)
      .filter((x): x is string => !!x)

    // Dinero
    const honorario = numero(n.precio_aprobado) ?? numero(n.precio_estimado)
    const esEstimado = n.precio_aprobado == null && n.precio_estimado != null
    const recaudado = (tramosPor.get(n.id) ?? []).reduce(
      (s, t) => s + (numero(t.a_tramo1) ?? 0) + (numero(t.a_tramo2) ?? 0),
      0,
    )
    const saldo = honorario === null ? null : Math.max(0, honorario - recaudado)

    // Pagos: primero, segundo y el resto sumado.
    const pagos = ordenarPagos(cobrosPor.get(n.id) ?? [])
    const [p1, p2] = pagos
    const otros = pagos.slice(2).reduce((s, c) => s + (numero(c.monto) ?? 0), 0)

    return {
      'Codigo': texto(n.codigo),
      'Negocio': texto(n.nombre),
      'Cliente': texto(n.empresa_nombre) ?? texto(n.contacto_nombre),
      'Cedula / NIT': texto(n.cedula),
      'Telefono': texto(n.contacto_telefono),
      'Fase': faseDeNegocio(n),
      'Etapa': texto(n.etapa_nombre),
      'Estado': texto(n.estado),
      'Cierre': cierreDeNegocio(n),
      'Fecha creacion': fechaExcel(n.created_at),
      'Fecha venta': fechaExcel(venta?.fecha_venta),
      'Fecha cierre': fechaExcel(n.closed_at),

      'Comercial': comercialId ? (nombrePor.get(comercialId) ?? null) : null,
      'Operaciones': operaciones.length ? operaciones.join(', ') : null,
      'Origen': texto(n.origen),
      'Aliado': texto(n.aliado_nombre),
      'Lead Meta': SI_NO(n.es_meta_lead),
      'Servicio': texto(n.servicio_label),

      'Seccional DIAN': texto(n.seccional_label),
      'Ciudad': texto(n.ciudad_label),
      'Vehiculo': texto(n.vehiculo_label),
      'Radicado UPME': texto(n.radicado),
      'No. factura': texto(n.numero_factura),

      'Honorario con IVA': honorario,
      'Precio estimado': SI_NO(esEstimado),
      'Honorario sin IVA': numero(valor?.valor_base),
      'IVA': numero(valor?.valor_iva),
      'Plan de pago': numero(valor?.plan_pago),
      'Tarifa UPME confirmada': numero(valor?.techo_tarifa),
      'Recaudado honorario': recaudado,
      'Saldo honorario': saldo,
      'Primer pago monto': p1 ? numero(p1.monto) : null,
      'Primer pago fecha': p1 ? fechaExcel(p1.fecha) : null,
      'Primer pago referencia': p1 ? texto(p1.external_ref) : null,
      'Segundo pago monto': p2 ? numero(p2.monto) : null,
      'Segundo pago fecha': p2 ? fechaExcel(p2.fecha) : null,
      'Segundo pago referencia': p2 ? texto(p2.external_ref) : null,
      'Otros pagos': pagos.length > 2 ? otros : null,
      'Caso completo': SI_NO(venta?.caso_completo),
      'Bonificable': SI_NO(bonif?.bonificable),

      'Horas habiles en etapa': numero(n.horas_habiles_en_etapa),
      'SLA etapa (horas)': numero(n.etapa_sla_horas),
      'Atraso (horas)': numero(n.sla_exceso_horas),
      'Reproceso': SI_NO(n.reproceso !== null),
      'Marcas': n.marcas.length
        ? n.marcas.map((m) => marcaCondicionLabel(m.tipo) ?? m.tipo).join(', ')
        : null,
      'Pausado': SI_NO(n.pausado),
      'Pausado hasta': fechaExcel(n.pausado_hasta),
      'Motivo pausa': texto(n.motivo_pausa),
      'Link ONE': `${base}/negocios/${n.id}`,
    }
  })
}
