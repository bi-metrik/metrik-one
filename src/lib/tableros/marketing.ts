/**
 * Las reglas del tablero de marketing, puras y sin base de datos.
 *
 * Viven aparte porque son lo que decide si una campana se ve rentable o no, y eso
 * no se puede probar contra una pantalla. La consulta trae las filas de
 * `v_marketing_campana` con grano (campana, mes) y aqui se arman LAS DOS lentes:
 *
 *   · MES     — de las ventas de ESTE mes, cuantas y cuanto trajo cada campana.
 *               Ordena caja y es la que cuadra contra el Sheet de contabilidad.
 *   · COHORTE — de los leads que trajo ESTA campana, cuantos han cerrado, sin
 *               importar en que mes. Es la unica con la que "que tan rentable es
 *               la campana" tiene respuesta, porque un lead de julio puede cerrar
 *               en septiembre.
 *
 * Las dos salen de las MISMAS filas: la cohorte es la suma de los meses. Eso no es
 * casualidad, lo garantiza la vista — cada lead cuenta en el mes de su primera
 * interaccion, cada venta en el mes de su fecha de venta.
 */

import {
  COLUMNAS_DIRECTIVO,
  columnaDirectivo,
  type ColumnaDirectivo,
} from '@/lib/dian/agrupacion-directivo'

/** Una fila de `v_marketing_campana`: una campana en un mes. */
export interface FilaMarketing {
  /** `null` es la fila "Sin rastro de Meta". */
  campaignId: string | null
  /** El nombre VIGENTE en Meta, o el del payload del lead si aun no se sincronizo. */
  campana: string | null
  /** 'YYYY-MM-01' */
  mes: string
  gasto: number
  leads: number
  formularios: number
  negocios: number
  ventas: number
  honorario: number
  recaudado: number
  primerLead: string | null
  ultimoLead: string | null
  status: string | null
  /** `null` = esta campana-mes nunca se sincronizo con Meta. NO es lo mismo que $0. */
  sincronizadoAt: string | null
}

/** Una fila ya agregada, lista para pintar. */
export interface CampanaAgregada {
  campaignId: string | null
  campana: string
  sinRastro: boolean
  status: string | null
  gasto: number
  /**
   * ⚠️ Falso = el gasto NUNCA se sincronizo. La pantalla tiene que pintar una raya,
   * no un cero: un cero en una columna de dinero afirma "no se invirtio", y aqui lo
   * unico cierto seria "no lo sabemos todavia".
   */
  gastoConocido: boolean
  sincronizadoAt: string | null
  leads: number
  formularios: number
  negocios: number
  ventas: number
  honorario: number
  recaudado: number
  primerLead: string | null
  ultimoLead: string | null
}

const vacia = (campaignId: string | null): CampanaAgregada => ({
  campaignId,
  campana: campaignId === null ? 'Sin rastro de Meta' : '',
  sinRastro: campaignId === null,
  status: null,
  gasto: 0,
  gastoConocido: false,
  sincronizadoAt: null,
  leads: 0,
  formularios: 0,
  negocios: 0,
  ventas: 0,
  honorario: 0,
  recaudado: 0,
  primerLead: null,
  ultimoLead: null,
})

function acumular(acc: CampanaAgregada, f: FilaMarketing): CampanaAgregada {
  return {
    ...acc,
    status: f.status ?? acc.status,
    gasto: acc.gasto + f.gasto,
    gastoConocido: acc.gastoConocido || f.sincronizadoAt !== null,
    sincronizadoAt: maxISO(acc.sincronizadoAt, f.sincronizadoAt),
    leads: acc.leads + f.leads,
    formularios: acc.formularios + f.formularios,
    negocios: acc.negocios + f.negocios,
    ventas: acc.ventas + f.ventas,
    honorario: acc.honorario + f.honorario,
    recaudado: acc.recaudado + f.recaudado,
    primerLead: minISO(acc.primerLead, f.primerLead),
    ultimoLead: maxISO(acc.ultimoLead, f.ultimoLead),
  }
}

function minISO(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a < b ? a : b
}

function maxISO(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

/**
 * Como se llama la campana en la pantalla.
 *
 * ⚠️ Manda el nombre VIGENTE en Meta sobre el del payload del lead. Las filas de un
 * mes que ya se sincronizo traen el de Meta; las de un mes sin sincronizar traen el
 * que el lead guardo cuando entro, que es una foto vieja. Quedarse con el ultimo
 * nombre que se cruce mostraria `CLIENTES POTENCIALES AGO 2026 PLUS` para una campana
 * que Daniela ya renombro a `CLIENTES POTENCIALES AGO ($100)`, y la pantalla tiene que
 * llamarla como ella la llama. Entre varias sincronizadas gana la del mes mas
 * reciente.
 */
function etiqueta(filas: FilaMarketing[]): string | null {
  const conNombre = filas.filter(f => f.campana)
  const fuentes = conNombre.filter(f => f.sincronizadoAt !== null)
  const orden = (fuentes.length > 0 ? fuentes : conNombre)
    .slice()
    .sort((a, b) => b.mes.localeCompare(a.mes))
  return orden[0]?.campana ?? null
}

function agrupar(filas: FilaMarketing[]): CampanaAgregada[] {
  const mapa = new Map<string, FilaMarketing[]>()
  for (const f of filas) {
    // ⚠️ La llave es el `campaign_id`, NUNCA el nombre. Meta ya renombro una campana
    // viva de SOENA; agrupar por nombre la partiria en dos filas con la mitad del
    // gasto cada una el dia que la vuelvan a renombrar.
    const k = f.campaignId ?? '__sin_rastro__'
    mapa.set(k, [...(mapa.get(k) ?? []), f])
  }
  return [...mapa.values()].map(grupo => {
    const agg = grupo.reduce(acumular, vacia(grupo[0].campaignId))
    return {
      ...agg,
      campana: agg.sinRastro
        ? agg.campana
        : (etiqueta(grupo) ?? grupo[0].campaignId ?? 'Sin campaña'),
    }
  })
}

/**
 * Orden de la tabla: por fecha de inicio DESCENDENTE, no por conversion.
 *
 * Ordenar por conversion pondria arriba justo a las campanas que todavia no se
 * pueden juzgar — las recien lanzadas, cuyos leads no han tenido tiempo de cerrar.
 * La fila "Sin rastro" va siempre al final, separada.
 */
function ordenar(filas: CampanaAgregada[]): CampanaAgregada[] {
  return [...filas].sort((a, b) => {
    if (a.sinRastro !== b.sinRastro) return a.sinRastro ? 1 : -1
    return (b.primerLead ?? '').localeCompare(a.primerLead ?? '')
  })
}

/** Lente MES: solo las filas de ese mes. `mes` en formato 'YYYY-MM-01'. */
export function lenteMes(filas: FilaMarketing[], mes: string): CampanaAgregada[] {
  return ordenar(agrupar(filas.filter(f => f.mes === mes)))
}

/** Lente COHORTE: todos los meses sumados por campana. */
export function lenteCohorte(filas: FilaMarketing[]): CampanaAgregada[] {
  return ordenar(agrupar(filas))
}

/** Los meses que tienen algo que mostrar, del mas reciente al mas viejo. */
export function mesesConDatos(filas: FilaMarketing[]): string[] {
  return [...new Set(filas.map(f => f.mes))].sort().reverse()
}

// ── Derivados ────────────────────────────────────────────────────────────────
//
// Todos devuelven `null` cuando el denominador es cero o cuando el gasto no se ha
// sincronizado. Un cero calculado sobre nada no es un dato: es una afirmacion que
// nadie puede sostener.

export const cpl = (c: CampanaAgregada) =>
  c.gastoConocido && c.leads > 0 ? c.gasto / c.leads : null

export const cac = (c: CampanaAgregada) =>
  c.gastoConocido && c.ventas > 0 ? c.gasto / c.ventas : null

export const roas = (c: CampanaAgregada) =>
  c.gastoConocido && c.gasto > 0 ? c.recaudado / c.gasto : null

export const conversion = (c: CampanaAgregada) =>
  c.leads > 0 ? c.ventas / c.leads : null

/** Dias que una cohorte necesita antes de que su conversion signifique algo. */
export const DIAS_MADURACION = 30

/**
 * La cohorte todavia no se puede juzgar.
 *
 * Un lead de hace tres dias no ha tenido tiempo de cerrar: su 0% no es un mal
 * resultado, es una campana sin madurar. La pantalla pinta ese numero en gris con un
 * `title` que lo dice, en vez de dejar que alguien apague una campana por una cifra
 * que todavia no significa nada.
 */
export function cohorteInmadura(ultimoLead: string | null, hoyISO: string): boolean {
  if (!ultimoLead) return false
  const dias = (Date.parse(hoyISO) - Date.parse(ultimoLead)) / 86_400_000
  return dias < DIAS_MADURACION
}

/** Los totales de la tabla. La fila "Sin rastro" NO entra en el gasto ni en los leads. */
export function totales(filas: CampanaAgregada[]) {
  const conCampana = filas.filter(f => !f.sinRastro)
  const sinRastro = filas.find(f => f.sinRastro) ?? null
  const suma = (sel: (c: CampanaAgregada) => number, xs: CampanaAgregada[]) =>
    xs.reduce((s, c) => s + sel(c), 0)

  const recaudadoCampana = suma(c => c.recaudado, conCampana)
  const recaudadoSinRastro = sinRastro?.recaudado ?? 0
  const recaudadoTotal = recaudadoCampana + recaudadoSinRastro

  return {
    gasto: suma(c => c.gasto, conCampana),
    gastoConocido: conCampana.some(c => c.gastoConocido),
    leads: suma(c => c.leads, conCampana),
    formularios: suma(c => c.formularios, conCampana),
    negocios: suma(c => c.negocios, conCampana),
    ventas: suma(c => c.ventas, conCampana),
    ventasSinRastro: sinRastro?.ventas ?? 0,
    honorario: suma(c => c.honorario, conCampana),
    recaudado: recaudadoCampana,
    recaudadoSinRastro,
    recaudadoTotal,
    /**
     * Que parte de la venta del mes trae marketing. Es el numero que falta para leer
     * al derecho el "<20% sobre ventas" de la direccion.
     *
     * ⚠️ Solo mide lo que dejo HUELLA. El resto no es "no vino de marketing": es que
     * no se pudo atribuir.
     */
    parteDeLasVentas: recaudadoTotal > 0 ? recaudadoCampana / recaudadoTotal : null,
  }
}

// ── Ventas por ciudad ────────────────────────────────────────────────────────
//
// El segundo corte que pidio Mauricio el 2026-09-14: "ver en el tablero de marketing
// por cuidades asi como se ve en el tablero directivo".
//
// ⚠️ SOLO las ventas se parten por ciudad. Leads, gasto, CPL, CAC y conversion se
// quedan por campana y no se reparten. La razon es un dato, no una preferencia: la
// ciudad es la seccional DIAN, que llega con el RUT en Documentacion. Medido contra
// produccion el 2026-09-14 en SOENA: de 99 negocios con campana **solo 28 tienen
// seccional, y esos 28 son exactamente las 28 ventas**. Los otros 71 son leads que no
// llegaron a Documentacion. Repartir sus leads o su gasto entre ciudades seria inventar
// una distribucion que nadie midio — la misma razon que ya esta escrita en la pestana
// Direccion.
//
// La agrupacion en seis columnas NO se inventa aqui: sale de `columnaDirectivo`, la
// misma funcion que usa la pestana Direccion. Una segunda copia del criterio dejaria las
// dos pantallas discrepando por un nombre de ciudad.

/**
 * Un negocio de `v_marketing_negocio`, con la ciudad cruda tal como esta en
 * `negocios.metadata`. Sin canonizar: de eso se encarga `columnaDirectivo`.
 */
export interface FilaNegocioMarketing {
  campaignId: string | null
  /** 'YYYY-MM-01' del mes de la venta. `null` = todavia no es venta. */
  mesVenta: string | null
  seccional: string | null
  honorario: number
  recaudado: number
}

/** Una fila de la tabla "Ventas por ciudad": una campana, las seis columnas y su total. */
export interface FilaCiudad {
  campaignId: string | null
  campana: string
  sinRastro: boolean
  /** Las SEIS siempre, aunque valgan cero: una columna que desaparece se lee como que no existe. */
  columnas: Record<ColumnaDirectivo, number>
  total: number
  honorario: number
  recaudado: number
}

const columnasEnCero = (): Record<ColumnaDirectivo, number> =>
  Object.fromEntries(COLUMNAS_DIRECTIVO.map(c => [c, 0])) as Record<ColumnaDirectivo, number>

const LLAVE_SIN_RASTRO = '__sin_rastro__'
const llave = (campaignId: string | null) => campaignId ?? LLAVE_SIN_RASTRO

/**
 * Las ventas de cada campana, repartidas en las seis columnas del tablero directivo.
 *
 * Las filas salen de `campanas` —la lista que YA pinta la tabla de arriba— y en su mismo
 * orden. No es comodidad: asi las dos tablas hablan de las mismas campanas por
 * construccion, y el total de esta no se puede separar del de aquella por un criterio de
 * agrupacion distinto. Es la leccion que costo `v_venta_mes_comercial`.
 *
 * `mes` fija la lente, exactamente igual que en la tabla de campanas: con mes son las
 * ventas de ESE mes; con `null`, todas las de la campana.
 */
export function ventasPorCiudad(
  campanas: CampanaAgregada[],
  negocios: FilaNegocioMarketing[],
  mes: string | null,
): FilaCiudad[] {
  const ventas = negocios.filter(n => n.mesVenta !== null && (mes === null || n.mesVenta === mes))

  type Acumulado = { columnas: Record<ColumnaDirectivo, number>; honorario: number; recaudado: number }
  const acumulado = new Map<string, Acumulado>()
  for (const n of ventas) {
    const k = llave(n.campaignId)
    const acc: Acumulado = acumulado.get(k) ?? { columnas: columnasEnCero(), honorario: 0, recaudado: 0 }
    acc.columnas[columnaDirectivo(n.seccional)] += 1
    acc.honorario += n.honorario
    acc.recaudado += n.recaudado
    acumulado.set(k, acc)
  }

  const fila = (campaignId: string | null, campana: string, sinRastro: boolean): FilaCiudad => {
    const acc = acumulado.get(llave(campaignId))
    const columnas = acc?.columnas ?? columnasEnCero()
    return {
      campaignId,
      campana,
      sinRastro,
      columnas,
      total: COLUMNAS_DIRECTIVO.reduce((s, c) => s + columnas[c], 0),
      honorario: acc?.honorario ?? 0,
      recaudado: acc?.recaudado ?? 0,
    }
  }

  const filas = campanas.map(c => fila(c.campaignId, c.campana, c.sinRastro))

  // Una venta cuya campana no esta en la tabla de arriba NO se descarta: se pinta con su
  // id como nombre. No deberia pasar nunca —la vista crea la fila (campana, mes) en
  // cuanto hay una venta— y justo por eso, si pasa, tiene que verse. Una venta que
  // desaparece de la tabla en silencio es peor que una fila fea.
  const conocidas = new Set(campanas.map(c => llave(c.campaignId)))
  for (const k of acumulado.keys()) {
    if (conocidas.has(k)) continue
    const esSinRastro = k === LLAVE_SIN_RASTRO
    filas.push(fila(esSinRastro ? null : k, esSinRastro ? 'Sin rastro de Meta' : k, esSinRastro))
  }

  return filas
}

/**
 * La fila de totales. Separa las campanas de "Sin rastro" porque la tabla de arriba
 * tambien las separa, y son dos cifras con significados distintos: una es lo que
 * marketing puede reclamar, la otra lo que no se pudo atribuir. `total` es la suma de
 * TODO lo que la tabla dibuja, para que la fila de totales diga de que esta hecha.
 */
export function totalesPorCiudad(filas: FilaCiudad[]) {
  const columnas = columnasEnCero()
  const columnasCampana = columnasEnCero()
  let total = 0
  let campanas = 0
  let sinRastro = 0

  for (const f of filas) {
    for (const c of COLUMNAS_DIRECTIVO) {
      columnas[c] += f.columnas[c]
      if (!f.sinRastro) columnasCampana[c] += f.columnas[c]
    }
    total += f.total
    if (f.sinRastro) sinRastro += f.total
    else campanas += f.total
  }

  return { columnas, columnasCampana, total, campanas, sinRastro }
}

/**
 * Si el panel lateral tiene que acotarse a las VENTAS.
 *
 * Vive aqui, puro, porque la decision es la que hace que la lista que se abre traiga
 * exactamente tantos casos como dice la celda — y eso no se puede comprobar leyendo el
 * encadenado de filtros de una consulta.
 *
 * Tres casos, y el tercero es el que se agrego con la tabla de ciudades:
 *   · con `mes`      — la consulta ya filtra por `mes_venta`, que implica venta.
 *   · sin rastro     — sin acotar serian los ~370 negocios que nunca dejaron huella:
 *                      una lista que no responde ninguna pregunta.
 *   · con `columna`  — una celda de "Ventas por ciudad" cuenta SOLO ventas, tambien en
 *                      cohorte. Sin este corte el panel abriria los leads de la campana
 *                      y mostraria mas casos de los que dice la celda.
 */
export function drillSeAcotaAVentas(args: {
  campaignId: string | null
  mes: string | null
  columna?: ColumnaDirectivo
}): boolean {
  if (args.mes !== null) return false
  return args.campaignId === null || args.columna !== undefined
}
