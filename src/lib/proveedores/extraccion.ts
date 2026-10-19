/**
 * La salida del motor de extracción de tarifarios, revisada y resumida (Mauricio, 2026-10-19). PURO.
 *
 * El motor lee TODOS los archivos de un proveedor y devuelve un JSON con:
 *   · `expediente`: qué hizo con cada archivo (usar, unir, complemento, descartar, vencido sin
 *     reemplazo, excluir bancario…) y `pedir_actualizacion` (lo que hay que pedirle al proveedor);
 *   · `tarifario`: vigencia, temporadas, planes, tarifas (costos SIN IVA), impuestos, canal…;
 *   · `datos_ficha`: dirección, barrio, ciudad, web, RNT, habitaciones, páginas con fotos.
 *
 * Esquemas que ONE conoce:
 *   · 0.2 (instrucción v8 a v11): la moneda es del tarifario.
 *   · 0.3 (instrucción v12 y v13): la moneda es de CADA fila (`tarifas[].moneda`, L41) y la vigencia
 *     dice de dónde salió (`vigencia.fuente`) y si hay que confirmarla al cargar
 *     (`vigencia.requiere_confirmacion`, L40).
 *
 * `revisarExtraccion` porta del validador de la torre (`herramientas/validar.py`) los chequeos que
 * no necesitan el PDF: datos prohibidos (correo, número de cuenta), decisiones válidas del
 * expediente, filas 0.3 sin moneda, L48 (temporada vencida con un rango por venir) y L60 (el total
 * del grupo cae a menos del 70 % al subir de escalón de pax). Lo que no frena va en `avisos`.
 */
import type { TarifaCanal } from './tipos'
import { hoyBogota } from './vigencia'

export const ESQUEMAS_CONOCIDOS = ['0.2', '0.3'] as const
export const MONEDAS = ['COP', 'USD', 'EUR', 'MXN'] as const
export type Moneda = (typeof MONEDAS)[number]
export const esMoneda = (m: unknown): m is Moneda => typeof m === 'string' && (MONEDAS as readonly string[]).includes(m)

/** Las decisiones del expediente que escribe la instrucción (Paso 0). */
export const DECISIONES = ['usar', 'unir', 'complemento', 'descartar_reemplazado', 'vencido_sin_reemplazo', 'excluir_bancario', 'no_sirve', 'duplicado', 'sin_leer'] as const
export const FUENTES_VIGENCIA = ['contenido', 'nombre_archivo', 'ninguna'] as const
export type FuenteVigencia = (typeof FUENTES_VIGENCIA)[number]

const BYTES_MAXIMOS = 3_000_000

type Obj = Record<string, unknown>

const esObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

// ── Datos que nunca se guardan (L11, L25): del validador de la torre, tal cual ──
const CORREO = /[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_-]+\.[a-z]{2,}/iu
const CUENTA = /cuenta\s+(de\s+)?(ahorros|corriente)\s*(n[oº°.]*\s*)?[:#]?\s*\d{5,}/i
const CELULAR = /(\+?57[\s-]?)?3\d{2}[\s-]?\d{3}[\s-]?\d{4}/

// ── L60: bases que no se comparan (el total no crece con los pax) ──
const BASES_SIN_ESCALON = new Set(['por_habitacion_noche', 'por_vehiculo_trayecto', 'por_trayecto_total'])

export interface ExtraccionRevisada {
  esquemaVersion: string
  expediente: Obj
  tarifario: Obj | null
  datosFicha: Obj | null
  /** Los nombres de los archivos que leyó (del expediente). */
  archivos: string[]
  /** Lo que no frena pero hay que mirar («posible celular», «vigencia por confirmar al cargar»). */
  avisos: string[]
}

export type RevisionExtraccion = { ok: true; extraccion: ExtraccionRevisada } | { ok: false; error: string; errores: string[] }

const falla = (errores: string[]): { ok: false; error: string; errores: string[] } => ({ ok: false, error: errores.join(' · '), errores })

/**
 * L48: una temporada marcada vencida (`vigente: false`) con algún rango que termina hoy o después.
 * Devuelve los nombres de las temporadas mal marcadas.
 */
export function temporadasMalVencidas(tarifario: Obj | null, hoy: string): string[] {
  const malas: string[] = []
  for (const s of lista(tarifario?.temporadas)) {
    if (!esObj(s) || s.vigente !== false) continue
    if (lista(s.rangos).some((r) => esObj(r) && typeof r.hasta === 'string' && r.hasta >= hoy)) malas.push(texto(s.nombre) ?? texto(s.id) ?? '(sin nombre)')
  }
  return malas
}

/**
 * L60: el total del grupo (precio × pax si es por persona; el precio si es `por_grupo`) puede bajar
 * un poco al subir de escalón, nunca a menos del 70 % del escalón anterior. Exclusiones, como en la
 * torre: solo adulto o sin tipo de pasajero; sin las bases por habitación, vehículo o trayecto; y no
 * se comparan las llaves con dos filas en el mismo escalón (la llave no separa variantes).
 * Devuelve las categorías que fallan.
 */
export function escalonesIncoherentes(tarifas: readonly unknown[]): string[] {
  const grupos = new Map<string, { categoria: unknown; escalones: [number, number][] }>()
  for (const r of tarifas) {
    if (!esObj(r)) continue
    const n = r.pax_min
    const p = r.precio
    if (typeof n !== 'number' || !Number.isInteger(n) || typeof p !== 'number' || !Number.isFinite(p) || p <= 0) continue
    if (typeof r.base_precio === 'string' && BASES_SIN_ESCALON.has(r.base_precio)) continue
    if (r.tipo_pasajero !== undefined && r.tipo_pasajero !== null && r.tipo_pasajero !== 'adulto') continue
    const llave = JSON.stringify([r.establecimiento, r.categoria, r.temporada_id, r.plan, r.ocupacion, r.precio_tipo, r.modalidad].map((v) => v ?? null))
    const g = grupos.get(llave) ?? { categoria: r.categoria ?? null, escalones: [] }
    g.escalones.push([n, r.base_precio === 'por_grupo' ? p : p * n])
    grupos.set(llave, g)
  }
  const malas: string[] = []
  for (const { categoria, escalones } of grupos.values()) {
    if (new Set(escalones.map(([n]) => n)).size < escalones.length) continue
    const v = [...escalones].sort((a, b) => a[0] - b[0] || a[1] - b[1])
    if (v.some((b, i) => i > 0 && b[1] < 0.7 * v[i - 1][1])) malas.push(String(categoria))
  }
  return [...new Set(malas)].sort()
}

/** El JSON del motor (texto u objeto), revisado. `hoy` (YYYY-MM-DD, Bogotá) es para L48. */
export function revisarExtraccion(entrada: unknown, opciones: { hoy?: string } = {}): RevisionExtraccion {
  let d: unknown = entrada
  let crudo: string
  if (typeof entrada === 'string') {
    if (entrada.length > BYTES_MAXIMOS) return falla(['El archivo pesa más de 3 MB: no parece una extracción.'])
    try {
      d = JSON.parse(entrada)
    } catch {
      return falla(['El archivo no es un JSON válido.'])
    }
    crudo = entrada
  } else {
    crudo = JSON.stringify(entrada ?? null) ?? ''
    if (crudo.length > BYTES_MAXIMOS) return falla(['La extracción pesa más de 3 MB.'])
  }
  if (!esObj(d)) return falla(['El archivo no es una extracción del motor.'])
  const version = texto(d.esquema_version)
  if (!version) return falla(['Falta `esquema_version`: no parece una extracción del motor.'])
  if (!(ESQUEMAS_CONOCIDOS as readonly string[]).includes(version)) return falla([`ONE todavía no conoce el esquema ${version} (conoce ${ESQUEMAS_CONOCIDOS.join(', ')}).`])
  if (!esObj(d.expediente)) return falla(['Falta el `expediente` de la extracción.'])
  if (d.tarifario !== undefined && d.tarifario !== null && !esObj(d.tarifario)) return falla(['El `tarifario` de la extracción no tiene la forma esperada.'])
  if (d.datos_ficha !== undefined && d.datos_ficha !== null && !esObj(d.datos_ficha)) return falla(['Los `datos_ficha` de la extracción no tienen la forma esperada.'])

  const hoy = opciones.hoy ?? hoyBogota()
  const t = esObj(d.tarifario) ? d.tarifario : null
  const tarifas = lista(t?.tarifas)
  const errores: string[] = []
  const avisos: string[] = []

  // Datos prohibidos (en todo el JSON, como la torre).
  if (CORREO.test(crudo)) errores.push('La extracción trae un correo: no se guarda.')
  if (CUENTA.test(crudo)) errores.push('La extracción trae un posible número de cuenta: no se guarda.')
  if (CELULAR.test(crudo)) avisos.push('Posible celular en la extracción.')

  // Decisiones del expediente.
  const invalidas = [...new Set(lista(d.expediente.archivos).map((a) => (esObj(a) ? a.decision : undefined)).filter((x) => !(DECISIONES as readonly unknown[]).includes(x)).map((x) => String(x ?? 'vacía')))]
  if (invalidas.length > 0) errores.push(`Decisión inválida en el expediente: ${invalidas.join(', ')}.`)

  // Esquema 0.3: moneda por fila y vigencia con fuente.
  if (version === '0.3') {
    const sinMoneda = tarifas.filter((r) => !esObj(r) || !texto(r.moneda)).length
    if (sinMoneda > 0) errores.push(`${sinMoneda} ${sinMoneda === 1 ? 'fila' : 'filas'} sin moneda (esquema 0.3).`)
    const raras = [...new Set(tarifas.map((r) => (esObj(r) ? texto(r.moneda) : null)).filter((m): m is string => !!m && !esMoneda(m)))]
    if (raras.length > 0) errores.push(`Moneda que ONE no conoce: ${raras.join(', ')} (conoce ${MONEDAS.join(', ')}).`)
    const vig = esObj(t?.vigencia) ? t.vigencia : null
    if (vig) {
      if (vig.fuente !== undefined && vig.fuente !== null && !(FUENTES_VIGENCIA as readonly unknown[]).includes(vig.fuente)) errores.push(`La vigencia dice una fuente que no existe: ${String(vig.fuente)}.`)
      if (vig.requiere_confirmacion !== undefined && vig.requiere_confirmacion !== null && typeof vig.requiere_confirmacion !== 'boolean') errores.push('`vigencia.requiere_confirmacion` tiene que ser sí o no.')
    }
  }
  if (vigenciaPorConfirmar(t)) avisos.push('Vigencia por confirmar al cargar.')

  // L48 y L60.
  const malVencidas = temporadasMalVencidas(t, hoy)
  if (malVencidas.length > 0) errores.push(`Temporada marcada vencida con rangos por venir (L48): ${malVencidas.join(', ')}.`)
  const escalones = escalonesIncoherentes(tarifas)
  if (escalones.length > 0) errores.push(`El total del grupo baja al subir de escalón de pax; revisar la base por grupo o por persona (L60): ${escalones.slice(0, 6).join(', ')}.`)

  if (errores.length > 0) return falla(errores)

  const archivos = lista(d.expediente.archivos)
    .map((a) => (esObj(a) ? texto(a.archivo) : null))
    .filter((a): a is string => !!a)
    .map((a) => a.slice(0, 300))
    .slice(0, 200)
  return {
    ok: true,
    extraccion: {
      esquemaVersion: version,
      expediente: d.expediente,
      tarifario: t,
      datosFicha: esObj(d.datos_ficha) ? d.datos_ficha : null,
      archivos,
      avisos,
    },
  }
}

export interface VigenciaDelMotor {
  desde: string | null
  hasta: string | null
  /** La cita literal que encontró el motor (ayuda para quien confirma). */
  texto: string | null
  fuente: FuenteVigencia | null
  requiereConfirmacion: boolean
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const fecha = (v: unknown): string | null => (typeof v === 'string' && FECHA.test(v.trim()) ? v.trim() : null)

export function vigenciaDelMotor(tarifario: Obj | null | undefined): VigenciaDelMotor {
  const v = esObj(tarifario?.vigencia) ? tarifario.vigencia : {}
  const fuente = (FUENTES_VIGENCIA as readonly unknown[]).includes(v.fuente) ? (v.fuente as FuenteVigencia) : null
  return { desde: fecha(v.desde), hasta: fecha(v.hasta), texto: texto(v.texto), fuente, requiereConfirmacion: v.requiere_confirmacion === true }
}

/**
 * Punto 7 (2026-10-19): la carga no se cierra sin que una persona escriba la vigencia cuando el
 * motor no la fijó (desde o hasta en null) o la marcó para confirmar. No se infiere del nombre del
 * archivo ni de la fecha de carga.
 */
export function vigenciaPorConfirmar(tarifario: Obj | null | undefined): boolean {
  const v = vigenciaDelMotor(tarifario)
  return !v.desde || !v.hasta || v.requiereConfirmacion
}

export interface ResumenExtraccion {
  tarifas: number
  temporadas: number
  moneda: string | null
  /** Las monedas de las filas (esquema 0.3); en 0.2, la del tarifario. */
  monedas: string[]
  /** Los establecimientos distintos de las filas (un PDF de cadena trae varios). */
  establecimientos: string[]
  canal: string | null
  vigencia: VigenciaDelMotor
  ivaDeclarado: boolean | null
  ivaIncluido: boolean | null
  /** Lo que el motor dice que hay que pedirle al proveedor. */
  pedir: string[]
  advertencias: number
  /** Archivos por decisión: «usar: 2, vencido_sin_reemplazo: 1». */
  decisiones: Record<string, number>
}

/** Los establecimientos distintos de las filas, en el orden en que aparecen (sin vacíos). */
export function establecimientosDe(tarifario: Obj | null | undefined): string[] {
  const vistos = new Map<string, string>()
  for (const r of lista(tarifario?.tarifas)) {
    const e = esObj(r) ? texto(r.establecimiento) : null
    if (e && !vistos.has(llaveEstablecimiento(e))) vistos.set(llaveEstablecimiento(e), e)
  }
  return [...vistos.values()]
}

/** Para comparar establecimientos sin tildes, mayúsculas ni espacios de más. */
export function llaveEstablecimiento(e: string): string {
  return e.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function resumenExtraccion(e: Pick<ExtraccionRevisada, 'expediente' | 'tarifario'>): ResumenExtraccion {
  const t = e.tarifario ?? {}
  const imp = esObj(t.impuestos) ? t.impuestos : {}
  const decisiones: Record<string, number> = {}
  for (const a of lista(e.expediente.archivos)) {
    const dec = esObj(a) ? texto(a.decision) : null
    if (dec) decisiones[dec] = (decisiones[dec] ?? 0) + 1
  }
  const monedaTarifario = texto(t.moneda)
  const monedas = [...new Set(lista(t.tarifas).map((r) => (esObj(r) ? texto(r.moneda) : null) ?? monedaTarifario).filter((m): m is string => !!m))].sort()
  return {
    tarifas: lista(t.tarifas).length,
    temporadas: lista(t.temporadas).length,
    moneda: monedaTarifario,
    monedas,
    establecimientos: establecimientosDe(t),
    canal: texto(t.canal),
    vigencia: vigenciaDelMotor(t),
    ivaDeclarado: typeof imp.iva_declarado === 'boolean' ? imp.iva_declarado : null,
    ivaIncluido: typeof imp.iva_incluido === 'boolean' ? imp.iva_incluido : null,
    pedir: lista(e.expediente.pedir_actualizacion).map(texto).filter((x): x is string => !!x).slice(0, 30),
    advertencias: lista(t.advertencias).length,
    decisiones,
  }
}

/**
 * Lo que la extracción le puede proponer a la ficha (la persona decide si lo usa). Conservador: un
 * `iva_declarado: false` del motor quiere decir «el documento no lo dice», no «no cobra IVA», así
 * que no propone nada; un canal «publica» tampoco (hay que preguntar el neto).
 */
export function sugerenciasParaFicha(r: Pick<ResumenExtraccion, 'canal' | 'ivaDeclarado' | 'ivaIncluido'>): { tarifaCanal: TarifaCanal | null; ivaDeclarado: true | null; ivaIncluido: boolean | null } {
  const canal = (r.canal ?? '').toLowerCase()
  const tarifaCanal: TarifaCanal | null = canal.startsWith('neta') ? 'neta' : canal.startsWith('comision') ? 'comisionable' : null
  return {
    tarifaCanal,
    ivaDeclarado: r.ivaDeclarado === true ? true : null,
    ivaIncluido: r.ivaDeclarado === true ? r.ivaIncluido : null,
  }
}
