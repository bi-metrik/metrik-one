/**
 * La salida del motor de extracción de tarifarios (esquema 0.2), revisada y resumida (Mauricio,
 * 2026-10-19). PURO.
 *
 * El motor (hoy corre desde la torre, fuera de ONE) lee TODOS los archivos de un proveedor y
 * devuelve un JSON con:
 *   · `expediente`: qué hizo con cada archivo (usar, unir, complemento, descartar, vencido sin
 *     reemplazo, excluir bancario) y `pedir_actualizacion` (lo que hay que pedirle al proveedor);
 *   · `tarifario`: temporadas, planes, tarifas (costos SIN IVA), impuestos, canal, condiciones;
 *   · `datos_ficha`: dirección, barrio, ciudad, web, RNT, habitaciones, páginas con fotos.
 *
 * ONE lo guarda tal cual (`proveedor_extracciones`, server-only) y muestra un resumen en la ficha.
 * Aquí se revisa la forma mínima (para no guardar cualquier JSON) y se arma el resumen. No se
 * interpreta el precio: eso lo hará el cotizador cuando lea tarifas de aquí.
 */
import type { TarifaCanal } from './tipos'

export const ESQUEMAS_CONOCIDOS = ['0.2'] as const
const BYTES_MAXIMOS = 3_000_000

type Obj = Record<string, unknown>

const esObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export interface ExtraccionRevisada {
  esquemaVersion: string
  expediente: Obj
  tarifario: Obj | null
  datosFicha: Obj | null
  /** Los nombres de los archivos que leyó (del expediente). */
  archivos: string[]
}

/** El JSON del motor (texto u objeto), revisado. */
export function revisarExtraccion(entrada: unknown): { ok: true; extraccion: ExtraccionRevisada } | { ok: false; error: string } {
  let d: unknown = entrada
  if (typeof entrada === 'string') {
    if (entrada.length > BYTES_MAXIMOS) return { ok: false, error: 'El archivo pesa más de 3 MB: no parece una extracción.' }
    try {
      d = JSON.parse(entrada)
    } catch {
      return { ok: false, error: 'El archivo no es un JSON válido.' }
    }
  }
  if (!esObj(d)) return { ok: false, error: 'El archivo no es una extracción del motor.' }
  const version = texto(d.esquema_version)
  if (!version) return { ok: false, error: 'Falta `esquema_version`: no parece una extracción del motor.' }
  if (!(ESQUEMAS_CONOCIDOS as readonly string[]).includes(version)) return { ok: false, error: `ONE todavía no conoce el esquema ${version} (conoce ${ESQUEMAS_CONOCIDOS.join(', ')}).` }
  if (!esObj(d.expediente)) return { ok: false, error: 'Falta el `expediente` de la extracción.' }
  if (d.tarifario !== undefined && d.tarifario !== null && !esObj(d.tarifario)) return { ok: false, error: 'El `tarifario` de la extracción no tiene la forma esperada.' }
  if (d.datos_ficha !== undefined && d.datos_ficha !== null && !esObj(d.datos_ficha)) return { ok: false, error: 'Los `datos_ficha` de la extracción no tienen la forma esperada.' }
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
      tarifario: esObj(d.tarifario) ? d.tarifario : null,
      datosFicha: esObj(d.datos_ficha) ? d.datos_ficha : null,
      archivos,
    },
  }
}

export interface ResumenExtraccion {
  tarifas: number
  temporadas: number
  moneda: string | null
  canal: string | null
  vigencia: { desde: string | null; hasta: string | null }
  ivaDeclarado: boolean | null
  ivaIncluido: boolean | null
  /** Lo que el motor dice que hay que pedirle al proveedor. */
  pedir: string[]
  advertencias: number
  /** Archivos por decisión: «usar: 2, vencido_sin_reemplazo: 1». */
  decisiones: Record<string, number>
}

export function resumenExtraccion(e: Pick<ExtraccionRevisada, 'expediente' | 'tarifario'>): ResumenExtraccion {
  const t = e.tarifario ?? {}
  const imp = esObj(t.impuestos) ? t.impuestos : {}
  const vig = esObj(t.vigencia) ? t.vigencia : {}
  const decisiones: Record<string, number> = {}
  for (const a of lista(e.expediente.archivos)) {
    const dec = esObj(a) ? texto(a.decision) : null
    if (dec) decisiones[dec] = (decisiones[dec] ?? 0) + 1
  }
  return {
    tarifas: lista(t.tarifas).length,
    temporadas: lista(t.temporadas).length,
    moneda: texto(t.moneda),
    canal: texto(t.canal),
    vigencia: { desde: texto(vig.desde), hasta: texto(vig.hasta) },
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
