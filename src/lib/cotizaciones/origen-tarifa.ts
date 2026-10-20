/**
 * De dónde salió el precio de una línea cuando la persona eligió tarifas del tarifario extraído de
 * su proveedor (`oferta-tarifas.ts`, Mauricio 2026-10-19). Vive en `items.tarifa_pax.tarifaExtraida`
 * y se puede consultar por SQL (cuántas líneas tienen precio de tarifa extraída, de pantallazo o a
 * mano). PURO y sin dependencias de valor: lo importa `tarifa-pasajero.ts` al leer la tarifa.
 */
import type { LecturaCasilla, TipoPasajero } from './tarifa-pasajero'

type Obj = Record<string, unknown>
const esObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const entero = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null)
const TIPOS: readonly TipoPasajero[] = ['adulto', 'nino', 'infante']

/** De dónde salió el precio de la línea: se guarda en `items.tarifa_pax.tarifaExtraida`. */
export interface OrigenTarifaExtraida {
  extraccion_id: string
  proveedor_id: string
  /** El proveedor que tiene la extracción (el de la cadena, si la ficha toma su tarifario). */
  tarifario_de_id: string | null
  filas: { indice_fila: number; cantidad: number; noches: number | null; tipo: TipoPasajero | null }[]
  noPagan: TipoPasajero[]
  canal: 'neta' | 'comisionable' | 'publica' | 'sin_dato'
  comision_pct: number | null
  iva_incluido: boolean
  iva_pct: number
  moneda: string
  archivo: string | null
  /** El `leidaEn` de la lectura que escribió: si la casilla 1 cambia (otro pantallazo), deja de valer. */
  leidaEn: string
  por: string | null
  porId: string | null
}

export function leerOrigenTarifaExtraida(raw: unknown): OrigenTarifaExtraida | null {
  if (!esObj(raw)) return null
  if (typeof raw.extraccion_id !== 'string' || typeof raw.proveedor_id !== 'string' || typeof raw.leidaEn !== 'string') return null
  const filas = lista(raw.filas)
    .filter(esObj)
    .filter((f) => (entero(f.indice_fila) ?? -1) >= 0)
    .map((f) => ({
      indice_fila: f.indice_fila as number,
      cantidad: entero(f.cantidad) ?? 1,
      noches: entero(f.noches),
      tipo: TIPOS.includes(f.tipo as TipoPasajero) ? (f.tipo as TipoPasajero) : null,
    }))
  if (filas.length === 0) return null
  const canal = raw.canal === 'neta' || raw.canal === 'comisionable' || raw.canal === 'publica' ? raw.canal : 'sin_dato'
  return {
    extraccion_id: raw.extraccion_id,
    proveedor_id: raw.proveedor_id,
    tarifario_de_id: typeof raw.tarifario_de_id === 'string' ? raw.tarifario_de_id : null,
    filas,
    noPagan: lista(raw.noPagan).filter((t): t is TipoPasajero => TIPOS.includes(t as TipoPasajero)),
    canal,
    comision_pct: typeof raw.comision_pct === 'number' ? raw.comision_pct : null,
    iva_incluido: raw.iva_incluido === true,
    iva_pct: typeof raw.iva_pct === 'number' ? raw.iva_pct : 19,
    moneda: typeof raw.moneda === 'string' ? raw.moneda : 'COP',
    archivo: typeof raw.archivo === 'string' ? raw.archivo : null,
    leidaEn: raw.leidaEn,
    por: typeof raw.por === 'string' ? raw.por : null,
    porId: typeof raw.porId === 'string' ? raw.porId : null,
  }
}

/** ¿El origen sigue describiendo la casilla 1? Un pantallazo pegado después lo deja sin valor. */
export function origenVigente(origen: OrigenTarifaExtraida | null | undefined, casilla1: Pick<LecturaCasilla, 'origen' | 'leidaEn'> | null | undefined): origen is OrigenTarifaExtraida {
  return !!origen && !!casilla1 && casilla1.origen === 'tarifario' && casilla1.leidaEn === origen.leidaEn
}
