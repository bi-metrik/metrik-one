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
    campana: acc.sinRastro ? acc.campana : (f.campana ?? acc.campana),
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

function agrupar(filas: FilaMarketing[]): CampanaAgregada[] {
  const mapa = new Map<string, CampanaAgregada>()
  for (const f of filas) {
    // ⚠️ La llave es el `campaign_id`, NUNCA el nombre. Meta ya renombro una campana
    // viva de SOENA; agrupar por nombre la partiria en dos filas con la mitad del
    // gasto cada una el dia que la vuelvan a renombrar.
    const k = f.campaignId ?? '__sin_rastro__'
    mapa.set(k, acumular(mapa.get(k) ?? vacia(f.campaignId), f))
  }
  return [...mapa.values()].map(c => ({
    ...c,
    campana: c.campana || (c.campaignId ?? 'Sin campaña'),
  }))
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
