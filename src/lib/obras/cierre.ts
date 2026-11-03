/**
 * El cierre de una obra (C11): lo que se muestra en la ficha y en el PDF, a partir de una fila de
 * `v_cierre_obra`.
 *
 * Las cifras las calcula la VISTA (vendido, gastado por rubro, mano de obra, utilidad, facturado,
 * cobrado, retenido, por cobrar). Aquí solo se le da forma: el porcentaje de utilidad sobre lo
 * vendido, el rótulo de los rubros que no son de obra y los avisos. Nada de esto se guarda.
 */
import { CATEGORIAS_GASTO, CATEGORIAS_GASTO_VIAJE } from '@/lib/catalogos/constants'
import { negocioCerrado } from '@/lib/negocios/motivo-cierre'
import type { Json } from '@/types/database'

export interface FilaCierreObra {
  negocio_id: string | null
  codigo: string | null
  nombre: string | null
  nombre_corto: string | null
  estado: string | null
  empresa_id: string | null
  vendido: number | null
  gastos_por_rubro: Json | null
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
}

export const COLUMNAS_CIERRE =
  'negocio_id, codigo, nombre, nombre_corto, estado, empresa_id, vendido, gastos_por_rubro, gastos_total, mano_obra, jornadas, jornadas_sin_valor, utilidad, facturado, cobrado, retenido, saldo_facturas, por_cobrar'

export interface RubroDelCierre {
  rubro: string
  total: number
}

export interface ResumenCierre {
  cerrada: boolean
  /** «Utilidad» con la obra cerrada; «Utilidad hasta hoy» mientras anda (Anexo 2.2.6). */
  tituloUtilidad: string
  vendido: number
  rubros: RubroDelCierre[]
  gastosTotal: number
  manoObra: number
  jornadas: number
  jornadasSinValor: number
  utilidad: number
  /** Utilidad sobre lo vendido. `null` si no hay nada vendido. */
  utilidadPct: number | null
  facturado: number
  cobrado: number
  retenido: number
  saldoFacturas: number
  porCobrar: number
  /** Avisos para leer junto a las cifras. */
  avisos: string[]
}

export const AVISO_FALTAN_GASTOS = 'Faltan los gastos que no se han registrado.'

const ROTULO_CATEGORIA = new Map<string, string>(
  [...CATEGORIAS_GASTO, ...CATEGORIAS_GASTO_VIAJE].map((c) => [c.value as string, c.label as string]),
)

/**
 * Un gasto sin rubro de obra se agrupa por su categoría fiscal (`materiales`, `otros`…): la vista
 * devuelve la llave, y aquí se le pone el nombre con el que la ve la persona.
 */
export function rotuloRubro(rubro: string): string {
  return ROTULO_CATEGORIA.get(rubro) ?? rubro
}

/** Lee `gastos_por_rubro` sin confiar en su forma: un elemento raro se salta, no rompe la ficha. */
export function rubrosDeCierre(json: Json | null | undefined): RubroDelCierre[] {
  if (!Array.isArray(json)) return []
  const out: RubroDelCierre[] = []
  for (const x of json) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue
    const o = x as Record<string, Json | undefined>
    const rubro = typeof o.rubro === 'string' && o.rubro.trim() ? o.rubro : 'Sin rubro'
    const total = Number(o.total ?? 0)
    if (!Number.isFinite(total)) continue
    out.push({ rubro: rotuloRubro(rubro), total })
  }
  return out
}

const n = (v: number | null | undefined) => {
  const x = Number(v ?? 0)
  return Number.isFinite(x) ? x : 0
}

function textoSinValor(cantidad: number): string {
  return cantidad === 1
    ? 'Hay 1 llegada sin valor de jornada: el colaborador no tenía valor registrado ese día y su mano de obra no suma.'
    : `Hay ${cantidad} llegadas sin valor de jornada: esos colaboradores no tenían valor registrado ese día y su mano de obra no suma.`
}

export function resumirCierre(fila: FilaCierreObra): ResumenCierre {
  const cerrada = negocioCerrado(fila.estado)
  const vendido = n(fila.vendido)
  const utilidad = n(fila.utilidad)
  const jornadasSinValor = n(fila.jornadas_sin_valor)
  const avisos: string[] = []
  if (!cerrada) avisos.push(AVISO_FALTAN_GASTOS)
  if (jornadasSinValor > 0) avisos.push(textoSinValor(jornadasSinValor))
  return {
    cerrada,
    tituloUtilidad: cerrada ? 'Utilidad' : 'Utilidad hasta hoy',
    vendido,
    rubros: rubrosDeCierre(fila.gastos_por_rubro),
    gastosTotal: n(fila.gastos_total),
    manoObra: n(fila.mano_obra),
    jornadas: n(fila.jornadas),
    jornadasSinValor,
    utilidad,
    utilidadPct: vendido > 0 ? utilidad / vendido : null,
    facturado: n(fila.facturado),
    cobrado: n(fila.cobrado),
    retenido: n(fila.retenido),
    saldoFacturas: n(fila.saldo_facturas),
    porCobrar: n(fila.por_cobrar),
    avisos,
  }
}
