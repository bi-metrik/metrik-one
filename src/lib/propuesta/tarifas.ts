/**
 * Tarifas fijas por plan y por ruta de la propuesta económica.
 *
 * Antes la propuesta tenía UN precio (`servicios.precio_estandar` × IVA) y el comercial
 * armaba cada plan tecleando un % de descuento. Con tarifas, el servicio declara:
 *
 *   - el valor fijo de cada plan (con IVA, como lo maneja el cliente);
 *   - el % que se cobra según la ruta del negocio (lo que declara «Servicio contratado»);
 *   - las casillas plan × ruta que «no se ofrecen».
 *
 * El valor de una casilla NO se guarda: se calcula, `valor del plan × % de la ruta`. Así
 * cambiar el % de una ruta mueve sus dos casillas a la vez y no hay una tercera verdad.
 *
 * Las tarifas se versionan (`servicio_tarifas_versiones`, inmutable). Cada versión trae su
 * vigencia (`vigente_desde`) y aplica a los negocios CREADOS desde ese día. El negocio
 * guarda en su propuesta con qué versión se armó (`data.tarifa`), y desde ahí ya no
 * cambia de versión aunque se publique otra.
 *
 * Puro: no toca DB ni red. Fuera de los archivos `'use server'` porque ahí todo export
 * tiene que ser async.
 */

export type PlanN = 1 | 2

export interface PlanTarifa {
  n: PlanN
  nombre: string
  /** Valor fijo del plan en la ruta de 100 %, con IVA. */
  valor: number
}

export interface RutaTarifa {
  /** El valor que declara el negocio (p. ej. `solo_upme`). */
  valor: string
  nombre: string
  /** % del valor del plan que se cobra en esta ruta (100 = completo). */
  pct: number
}

export interface CasillaNoOfrecida {
  plan: PlanN
  ruta: string
}

export interface TarifaVersion {
  id: string
  servicio_id: string
  version: number
  /** 'YYYY-MM-DD'. Aplica a los negocios creados ese día o después. */
  vigente_desde: string
  planes: PlanTarifa[]
  rutas: RutaTarifa[]
  no_ofrece: CasillaNoOfrecida[]
  /** Tope de descuento del comercial sobre el valor de cada casilla. */
  cap_descuento_pct: number
  creado_por: string | null
  created_at: string
  nota: string | null
}

export interface Casilla {
  plan: PlanN
  ruta: string
  /** El plan se ofrece para esta ruta (existe la ruta y la casilla no está marcada). */
  ofrece: boolean
  /** `valor del plan × % de la ruta`. `null` si la ruta o el plan no están en la versión. */
  valor: number | null
}

/** Lo que el negocio guarda en `data.tarifa` al armar su primera versión con tarifas. */
export interface TarifaCongelada {
  version_id: string
  version: number
  vigente_desde: string
  cap_descuento_pct: number
}

export const PLANES: PlanN[] = [1, 2]

/**
 * De dónde sale la ruta del negocio: la respuesta de «¿Qué contrató el cliente?». Es el
 * mismo bloque que la propuesta ya exige antes de emitir (`requiere_bloques`) y que decide
 * la tarifa UPME; las opciones de su campo son las rutas que Configuración ofrece tarifar.
 */
export const RUTA_BLOQUE_SLUG = 'servicio_contratado'
export const RUTA_CAMPO = 'servicio'

export function valorCasilla(v: Pick<TarifaVersion, 'planes' | 'rutas' | 'no_ofrece'>, plan: PlanN, ruta: string | null | undefined): Casilla {
  const p = v.planes.find(x => x.n === plan)
  const r = ruta ? v.rutas.find(x => x.valor === ruta) : undefined
  const valor = p && r ? Math.round((p.valor * r.pct) / 100) : null
  const marcada = v.no_ofrece.some(c => c.plan === plan && c.ruta === ruta)
  return {
    plan,
    ruta: ruta ?? '',
    ofrece: valor != null && valor > 0 && !marcada,
    valor,
  }
}

export function casillasDeRuta(
  v: Pick<TarifaVersion, 'planes' | 'rutas' | 'no_ofrece'>,
  ruta: string | null | undefined,
): Record<PlanN, Casilla> {
  return { 1: valorCasilla(v, 1, ruta), 2: valorCasilla(v, 2, ruta) }
}

/**
 * La versión que rige un negocio creado el día `fechaISO` ('YYYY-MM-DD', Bogotá): la de
 * `vigente_desde` más reciente que no sea posterior a esa fecha. A igual vigencia gana la
 * versión más alta (la última que se guardó). `null` si ninguna estaba vigente: el negocio
 * se arma con el esquema anterior.
 */
export function versionVigenteEn(versiones: TarifaVersion[], fechaISO: string): TarifaVersion | null {
  let mejor: TarifaVersion | null = null
  for (const v of versiones) {
    if (v.vigente_desde > fechaISO) continue
    if (
      !mejor
      || v.vigente_desde > mejor.vigente_desde
      || (v.vigente_desde === mejor.vigente_desde && v.version > mejor.version)
    ) {
      mejor = v
    }
  }
  return mejor
}

export type MotivoEsquemaAnterior =
  | 'sin_tarifas'          // el servicio no tiene ninguna versión de tarifas
  | 'creado_antes'         // el negocio se creó antes de la primera vigencia
  | 'emitida_antes'        // la propuesta ya tenía versiones emitidas con el esquema anterior
  | 'version_desconocida' // `data.tarifa` apunta a una versión que no está (no debería pasar)

export type EsquemaPropuesta =
  | { esquema: 'tarifas'; version: TarifaVersion; congelada: boolean }
  | { esquema: 'anterior'; motivo: MotivoEsquemaAnterior }

/**
 * Con qué esquema se arma la propuesta de un negocio.
 *
 * Orden, y cada paso protege algo distinto:
 *  1. Si la propuesta ya se armó con tarifas (`data.tarifa`), esa versión manda para
 *     siempre: el valor de un negocio no cambia porque alguien publique otra versión.
 *  2. Si la propuesta ya tiene versiones emitidas SIN tarifa, sigue con el esquema
 *     anterior. Es el caso de los negocios creados el día del cambio cuya propuesta ya
 *     salió con precio estándar + descuento: pasarlos solos al esquema nuevo les cambiaría
 *     el valor de un documento que el cliente ya recibió.
 *  3. Si no, rige la versión vigente el día en que se creó el negocio.
 */
export function decidirEsquema(input: {
  versiones: TarifaVersion[]
  /** `data.tarifa` del bloque, si existe. */
  congelada: Partial<TarifaCongelada> | null | undefined
  /** Cuántas versiones (PDF) tiene ya la propuesta. */
  versionesEmitidas: number
  /** Día de creación del negocio en Bogotá, 'YYYY-MM-DD'. */
  creadoEl: string
}): EsquemaPropuesta {
  if (input.congelada?.version_id) {
    const v = input.versiones.find(x => x.id === input.congelada!.version_id)
    return v ? { esquema: 'tarifas', version: v, congelada: true } : { esquema: 'anterior', motivo: 'version_desconocida' }
  }
  if (input.versiones.length === 0) return { esquema: 'anterior', motivo: 'sin_tarifas' }
  if (input.versionesEmitidas > 0) return { esquema: 'anterior', motivo: 'emitida_antes' }
  const v = versionVigenteEn(input.versiones, input.creadoEl)
  return v ? { esquema: 'tarifas', version: v, congelada: false } : { esquema: 'anterior', motivo: 'creado_antes' }
}

export function congelar(v: TarifaVersion): TarifaCongelada {
  return {
    version_id: v.id,
    version: v.version,
    vigente_desde: v.vigente_desde,
    cap_descuento_pct: v.cap_descuento_pct,
  }
}

/** Valor de un plan con el descuento del comercial aplicado sobre su casilla. */
export function valorConDescuento(base: number, descuentoPct: number): number {
  return Math.round(base * (1 - descuentoPct / 100))
}

// ── Validación de una versión nueva (lo que llega del editor) ───────────────

export interface TarifaNueva {
  planes: PlanTarifa[]
  rutas: RutaTarifa[]
  no_ofrece: CasillaNoOfrecida[]
  cap_descuento_pct: number
  vigente_desde: string
  nota?: string | null
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * Normaliza y valida lo que llega del editor. Devuelve el texto del primer problema o la
 * tarifa limpia. `hoyISO` es el día de hoy en Bogotá: una versión nueva no puede regir
 * hacia atrás, porque cambiaría el valor de negocios ya creados que todavía no han
 * emitido su propuesta, sin que nadie lo haya decidido para ellos.
 */
export function validarTarifaNueva(
  input: TarifaNueva,
  hoyISO: string,
): { error: string } | { tarifa: TarifaNueva } {
  const planes: PlanTarifa[] = []
  for (const n of PLANES) {
    const p = (input.planes ?? []).find(x => x?.n === n)
    if (!p) return { error: `Falta el valor del Plan ${n}` }
    const valor = Number(p.valor)
    if (!Number.isFinite(valor) || valor <= 0) return { error: `El valor del Plan ${n} debe ser mayor que cero` }
    const nombre = String(p.nombre ?? '').trim() || `Plan ${n}`
    planes.push({ n, nombre, valor: Math.round(valor) })
  }

  const rutas: RutaTarifa[] = []
  for (const r of input.rutas ?? []) {
    const valor = String(r?.valor ?? '').trim()
    if (!valor) return { error: 'Hay una ruta sin identificador' }
    if (rutas.some(x => x.valor === valor)) return { error: `La ruta «${valor}» está repetida` }
    const pct = Number(r.pct)
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return { error: `El % de la ruta «${String(r.nombre || valor)}» debe estar entre 1 y 100` }
    }
    rutas.push({ valor, nombre: String(r.nombre ?? '').trim() || valor, pct: Math.round(pct * 100) / 100 })
  }
  if (rutas.length === 0) return { error: 'Declara al menos una ruta' }

  const no_ofrece: CasillaNoOfrecida[] = []
  for (const c of input.no_ofrece ?? []) {
    if ((c?.plan !== 1 && c?.plan !== 2) || !rutas.some(r => r.valor === c.ruta)) continue
    if (no_ofrece.some(x => x.plan === c.plan && x.ruta === c.ruta)) continue
    no_ofrece.push({ plan: c.plan, ruta: c.ruta })
  }
  for (const r of rutas) {
    if (PLANES.every(n => no_ofrece.some(c => c.plan === n && c.ruta === r.valor))) {
      return { error: `La ruta «${r.nombre}» quedaría sin ningún plan: ofrece al menos uno` }
    }
  }

  const cap = Number(input.cap_descuento_pct)
  if (!Number.isFinite(cap) || cap < 0 || cap > 100) return { error: 'El descuento máximo debe estar entre 0 y 100 %' }

  const vigente = String(input.vigente_desde ?? '')
  if (!FECHA.test(vigente)) return { error: 'La fecha de vigencia no es válida' }
  if (vigente < hoyISO) return { error: 'La vigencia no puede ser anterior a hoy: cambiaría negocios ya creados' }

  const nota = String(input.nota ?? '').trim().slice(0, 280) || null
  return { tarifa: { planes, rutas, no_ofrece, cap_descuento_pct: cap, vigente_desde: vigente, nota } }
}
