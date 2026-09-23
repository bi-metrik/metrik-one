/**
 * Periodos de una suscripción y el cobro de una licencia adicional (cláusula 2.3). Puro: todas las
 * fechas son 'YYYY-MM-DD' de Bogotá y entran por parámetro.
 *
 * ## El periodo
 *
 * Una suscripción corre por periodos que empiezan el día del mes en que empezó el contrato
 * (`vigente_desde`): los CDA arrancaron el 23-sep-2026, así que cada periodo va del 23 al 22 del mes
 * siguiente. El periodo que contiene un día es el que empezó el último día de inicio anterior o igual
 * a él. Un día de inicio que el mes no tiene (29, 30, 31 en febrero) se corre al último día del mes.
 *
 * ## El cobro de una licencia adicional (decisión de Mauricio, 2026-09-23)
 *
 * Acceso inmediato; se cobra en la SIGUIENTE cuota: la prorrata de los días que quedan del periodo en
 * curso (contando el día de la compra, porque ese día ya usa la licencia) más el valor completo de
 * cada periodo siguiente, cada uno en la cuota de su periodo.
 *
 * Lo que no se puede tocar no se toca: una cuota que ya tiene un cobro vivo (con o sin enlace de
 * pago) o que ya recibió plata es `modificable: false`. El emisor de cuentas no valida pagos, y una
 * cuota ya cobrada que cambia de monto se volvería a cobrar. El cargo de un periodo cuya cuota no se
 * puede tocar, y la prorrata del periodo en curso, se corren a la primera cuota modificable
 * posterior al periodo en curso. Sin ninguna, la compra no se registra: quedaría una deuda que
 * ninguna cuota cobra.
 *
 * Los periodos más allá de la última cuota del plan no se cargan aquí: los cobra la cuota que se cree
 * para ellos (ver `cuotaDeRenovacion` pendiente en el reporte del PR).
 *
 * ## Retirar una licencia adicional
 *
 * Deja de cobrarse desde el periodo siguiente: se anulan los cargos de periodos posteriores al que
 * contiene la fecha del retiro, solo en cuotas modificables. Los de cuotas ya cobradas se quedan.
 */

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/

function partes(iso: string): [number, number, number] {
  const m = FECHA.exec(iso)
  if (!m) throw new Error(`fecha inválida: ${iso}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function iso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
}

function diasDelMes(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** El día de inicio en un mes dado, corrido al último día si el mes no lo tiene. */
function inicioEnMes(y: number, m: number, diaInicio: number): string {
  // Normaliza año/mes (m puede venir en 0 o 13).
  const base = new Date(Date.UTC(y, m - 1, 1))
  const yy = base.getUTCFullYear()
  const mm = base.getUTCMonth() + 1
  return iso(yy, mm, Math.min(diaInicio, diasDelMes(yy, mm)))
}

/** Días entre dos fechas, contando las dos. */
export function diasEntre(desde: string, hasta: string): number {
  const [y1, m1, d1] = partes(desde)
  const [y2, m2, d2] = partes(hasta)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1
}

export function sumarDiasISO(fecha: string, dias: number): string {
  const [y, m, d] = partes(fecha)
  return iso(y, m, d + dias)
}

export interface Periodo {
  /** Primer día del periodo, inclusive. */
  desde: string
  /** Último día del periodo, inclusive. */
  hasta: string
  /** Días del periodo: 28 a 31. */
  dias: number
}

/** El día del mes en que empiezan los periodos: el del inicio del contrato. */
export function diaInicioDeContrato(vigenteDesde: string): number {
  return partes(vigenteDesde)[2]
}

/** El periodo que contiene `fecha`, con periodos que empiezan el `diaInicio` de cada mes. */
export function periodoDe(fecha: string, diaInicio: number): Periodo {
  if (!Number.isInteger(diaInicio) || diaInicio < 1 || diaInicio > 31) {
    throw new Error(`día de inicio inválido: ${diaInicio}`)
  }
  const [y, m] = partes(fecha)
  const inicioEsteMes = inicioEnMes(y, m, diaInicio)
  const desde = fecha >= inicioEsteMes ? inicioEsteMes : inicioEnMes(y, m - 1, diaInicio)
  const [yd, md] = partes(desde)
  const siguiente = inicioEnMes(yd, md + 1, diaInicio)
  const hasta = sumarDiasISO(siguiente, -1)
  return { desde, hasta, dias: diasEntre(desde, hasta) }
}

/** El periodo que sigue a otro. */
export function periodoSiguiente(p: Periodo, diaInicio: number): Periodo {
  return periodoDe(sumarDiasISO(p.hasta, 1), diaInicio)
}

export interface Prorrata {
  periodo: Periodo
  /** Días que quedan del periodo, contando el de la compra. */
  dias: number
  monto: number
}

/**
 * Lo que vale una licencia desde `fecha` hasta el final de su periodo. Redondeo al peso: la cuota
 * se cobra en pesos. Comprada el primer día del periodo vale el periodo entero; el último, un día.
 */
export function prorrata(fecha: string, diaInicio: number, valorMensual: number): Prorrata {
  if (!Number.isFinite(valorMensual) || valorMensual <= 0) throw new Error('valor mensual inválido')
  const periodo = periodoDe(fecha, diaInicio)
  const dias = diasEntre(fecha, periodo.hasta)
  return { periodo, dias, monto: Math.round((valorMensual * dias) / periodo.dias) }
}

// ── El periodo de una cuota ─────────────────────────────────────────────────────────────

const PERIODO_EN_CONCEPTO = /periodo del (\d{2})\/(\d{2})\/(\d{4}) al (\d{2})\/(\d{2})\/(\d{4})/i

/**
 * El periodo que paga una cuota. Lo dice su concepto («… periodo del 23/09/2026 al 22/10/2026») y,
 * sin él, el periodo que contiene su vencimiento (las cuotas de los CDA vencen dentro del periodo
 * que pagan: la del 23-sep al 22-oct vence el 30-sep).
 */
export function periodoDeCuota(
  cuota: { concepto: string | null; fechaVencimiento: string },
  diaInicio: number,
): Periodo {
  const m = cuota.concepto ? PERIODO_EN_CONCEPTO.exec(cuota.concepto) : null
  if (m) {
    const desde = `${m[3]}-${m[2]}-${m[1]}`
    const hasta = `${m[6]}-${m[5]}-${m[4]}`
    if (FECHA.test(desde) && FECHA.test(hasta) && desde <= hasta) {
      return { desde, hasta, dias: diasEntre(desde, hasta) }
    }
  }
  return periodoDe(cuota.fechaVencimiento, diaInicio)
}

// ── Asignar los cargos de una compra ───────────────────────────────────────────────────

export interface CuotaDelPlan {
  id: string
  numero: number
  monto: number
  concepto: string | null
  fechaVencimiento: string
  /** Sin cobro vivo atado y sin plata recibida: su monto se puede cambiar. */
  modificable: boolean
}

export type TipoCargo = 'prorrata' | 'periodo'

/** Un cargo de UNA licencia adicional sobre una cuota. */
export interface Cargo {
  cuotaId: string
  cuotaNumero: number
  tipo: TipoCargo
  /** El periodo que paga el cargo (no necesariamente el de la cuota que lo lleva). */
  periodoDesde: string
  periodoHasta: string
  /** Días cobrados y días del periodo (iguales en un periodo completo). */
  dias: number
  diasPeriodo: number
  monto: number
}

export type AsignacionCompra =
  | { ok: true; prorrata: Prorrata; cargos: Cargo[]; primeraCuota: { id: string; numero: number; periodo: Periodo } }
  | { ok: false; motivo: 'sin_cuota_modificable' }

/**
 * Los cargos de UNA licencia adicional comprada el día `fecha`. Ver el encabezado.
 */
export function asignarCargosCompra(p: {
  fecha: string
  diaInicio: number
  valorMensual: number
  cuotas: readonly CuotaDelPlan[]
}): AsignacionCompra {
  const pr = prorrata(p.fecha, p.diaInicio, p.valorMensual)
  const conPeriodo = [...p.cuotas]
    .map((c) => ({ c, periodo: periodoDeCuota(c, p.diaInicio) }))
    // Solo las cuotas de periodos posteriores al de la compra: la del periodo en curso no lleva nada.
    .filter((x) => x.periodo.desde > pr.periodo.hasta)
    .sort((a, b) => a.periodo.desde.localeCompare(b.periodo.desde) || a.c.numero - b.c.numero)

  const primera = conPeriodo.find((x) => x.c.modificable)
  if (!primera) return { ok: false, motivo: 'sin_cuota_modificable' }

  const cargos: Cargo[] = []
  // Lo que todavía no tiene cuota que lo lleve: la prorrata y los periodos de cuotas intocables.
  let pendientes: Omit<Cargo, 'cuotaId' | 'cuotaNumero'>[] = []
  if (pr.monto > 0) {
    pendientes.push({
      tipo: 'prorrata',
      periodoDesde: p.fecha,
      periodoHasta: pr.periodo.hasta,
      dias: pr.dias,
      diasPeriodo: pr.periodo.dias,
      monto: pr.monto,
    })
  }

  for (const { c, periodo } of conPeriodo) {
    const propio = {
      tipo: 'periodo' as const,
      periodoDesde: periodo.desde,
      periodoHasta: periodo.hasta,
      dias: periodo.dias,
      diasPeriodo: periodo.dias,
      monto: p.valorMensual,
    }
    if (!c.modificable) {
      pendientes.push(propio)
      continue
    }
    for (const x of [...pendientes, propio]) cargos.push({ ...x, cuotaId: c.id, cuotaNumero: c.numero })
    pendientes = []
  }
  // Un cargo que quedó después de la última cuota modificable (sus cuotas ya estaban cobradas) no
  // tiene dónde ir: se cobró ya en esas cuotas o lo cobrará la de renovación. No se inventa.

  return {
    ok: true,
    prorrata: pr,
    cargos,
    primeraCuota: { id: primera.c.id, numero: primera.c.numero, periodo: primera.periodo },
  }
}

/** Cuánto suma cada cuota por los cargos. */
export function sumaPorCuota(cargos: readonly Pick<Cargo, 'cuotaId' | 'monto'>[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of cargos) m.set(c.cuotaId, (m.get(c.cuotaId) ?? 0) + c.monto)
  return m
}

// ── Retirar una licencia adicional ─────────────────────────────────────────────────────

export interface CargoVivo extends Cargo {
  id: string
}

/**
 * Los cargos que se anulan al retirar la licencia el día `fecha`: los de periodos posteriores al que
 * contiene ese día, en cuotas que todavía se pueden tocar.
 */
export function cargosALiberar(p: {
  fecha: string
  diaInicio: number
  cargos: readonly CargoVivo[]
  cuotasModificables: ReadonlySet<string>
}): { anular: CargoVivo[]; seQuedan: CargoVivo[]; periodoRetiro: Periodo } {
  const periodoRetiro = periodoDe(p.fecha, p.diaInicio)
  const anular: CargoVivo[] = []
  const seQuedan: CargoVivo[] = []
  for (const c of p.cargos) {
    const posterior = c.periodoDesde > periodoRetiro.hasta
    if (posterior && p.cuotasModificables.has(c.cuotaId)) anular.push(c)
    else seQuedan.push(c)
  }
  return { anular, seQuedan, periodoRetiro }
}

// ── El concepto de la cuota con el desglose ─────────────────────────────────────────────

const MARCA_DESGLOSE = ' · Incluye: '

/** El concepto de la cuota sin el desglose de licencias que este módulo le agregó. */
export function conceptoBase(concepto: string | null): string | null {
  if (concepto === null) return null
  const i = concepto.indexOf(MARCA_DESGLOSE)
  return i === -1 ? concepto : concepto.slice(0, i)
}

function fechaCorta(isoFecha: string): string {
  const [y, m, d] = partes(isoFecha)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

function pesos(n: number): string {
  // Sin `toLocaleString`: el separador depende del ICU del runtime, y este texto se guarda.
  return `$${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

/**
 * El concepto de una cuota con TODOS sus cargos vivos, agrupados por tipo y periodo. Determinista:
 * con los mismos cargos, el mismo texto. Sin cargos, el concepto base tal cual.
 */
export function conceptoConDesglose(base: string | null, cargos: readonly Omit<Cargo, 'cuotaId' | 'cuotaNumero'>[]): string | null {
  if (cargos.length === 0) return base
  const grupos = new Map<string, { tipo: TipoCargo; desde: string; hasta: string; dias: number; diasPeriodo: number; n: number; total: number }>()
  for (const c of cargos) {
    const k = `${c.tipo}|${c.periodoDesde}|${c.periodoHasta}|${c.dias}|${c.diasPeriodo}`
    const g = grupos.get(k)
    if (g) {
      g.n += 1
      g.total += c.monto
    } else {
      grupos.set(k, { tipo: c.tipo, desde: c.periodoDesde, hasta: c.periodoHasta, dias: c.dias, diasPeriodo: c.diasPeriodo, n: 1, total: c.monto })
    }
  }
  const partesTexto = [...grupos.values()]
    .sort((a, b) => a.desde.localeCompare(b.desde) || (a.tipo === 'prorrata' ? -1 : 1))
    .map((g) => {
      const quien = g.n === 1 ? '1 usuario adicional' : `${g.n} usuarios adicionales`
      return g.tipo === 'prorrata'
        ? `${quien}, prorrata del ${fechaCorta(g.desde)} al ${fechaCorta(g.hasta)} (${g.dias} de ${g.diasPeriodo} días) ${pesos(g.total)}`
        : `${quien}, periodo del ${fechaCorta(g.desde)} al ${fechaCorta(g.hasta)} ${pesos(g.total)}`
    })
  return `${base ?? 'Cuota'}${MARCA_DESGLOSE}${partesTexto.join('; ')}`
}
