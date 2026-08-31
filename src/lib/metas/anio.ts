// ============================================================
// Metas de un año — qué se edita, qué cambió y qué se guarda
// ============================================================
// Las metas se fijaban mes a mes en un modal que recibía el mes desde el estado
// del tablero pero las CIFRAS desde el servidor, cargadas solo para el mes en
// curso: navegar a otro mes y guardar copiaba las metas de agosto encima de ese
// otro mes. Se arregla de raíz editando el año completo, donde cada fila lleva
// su propio mes y sus propios valores.
//
// Aquí vive lo que no depende de React ni de Supabase: la forma de una fila, la
// normalización de lo tecleado y el diff contra lo cargado. Guardar SOLO lo que
// cambió importa: un guardado que reescribe los 12 meses pisaría metas que otra
// persona acaba de fijar en un mes que aquí ni se tocó.

/** Metas del equipo (staff_id null) o de un vendedor (staff_id). */
export type AlcanceMeta = { staffId: string | null }

/**
 * Una fila de la tabla anual, con los valores como TEXTO.
 *
 * Texto y no número porque el campo vacío tiene significado propio: "sin meta
 * fijada" no es lo mismo que "meta de cero", y un `number` no distingue los dos.
 */
export type FilaMetaAnio = {
  /** 1..12 */
  mes: number
  /** Las dos primeras son del workspace, no del vendedor: solo aplican al equipo. */
  metaLeads: string
  metaLeadsCalificados: string
  metaNumVentas: string
  metaValor: string
}

/**
 * Los cuatro campos editables, en el orden del embudo.
 *
 * NO hay un campo aparte de "negocios cerrados": es el mismo número que
 * `metaNumVentas`. Estaban separados porque cada tablero leía su propia tabla
 * (`config_metas` el de Dirección, `metas_comerciales` el Comercial) y en
 * agosto de 2026 quedaron con el mismo 100 escrito dos veces. Aquí se teclea
 * una vez y el guardado lo deja en los dos sitios, que es lo que impide que las
 * dos pantallas muestren metas distintas.
 */
export const CAMPOS_META = [
  'metaLeads',
  'metaLeadsCalificados',
  'metaNumVentas',
  'metaValor',
] as const

export type CampoMeta = (typeof CAMPOS_META)[number]

/** Los campos que solo tienen sentido para el equipo completo. */
export const CAMPOS_SOLO_EQUIPO: CampoMeta[] = [
  'metaLeads',
  'metaLeadsCalificados',
]

/** Campos editables según el alcance elegido. */
export function camposDe(alcance: AlcanceMeta): CampoMeta[] {
  return alcance.staffId === null
    ? [...CAMPOS_META]
    : CAMPOS_META.filter((c) => !CAMPOS_SOLO_EQUIPO.includes(c))
}

/** Doce filas vacías, de enero a diciembre. */
export function filasVacias(): FilaMetaAnio[] {
  return Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1,
    metaLeads: '',
    metaLeadsCalificados: '',
    metaNumVentas: '',
    metaValor: '',
  }))
}

/**
 * Texto tecleado a número guardable. Vacío o basura → null (limpia la meta).
 *
 * Un negativo se descarta en vez de guardarse: no existe la meta de vender menos
 * que nada, y el campo es `type=number` con `min=0`, que el navegador respeta
 * pero un pegado no.
 */
export function aNumero(texto: string): number | null {
  const limpio = texto.trim()
  if (limpio === '') return null
  const n = Number(limpio)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

/** Número guardado a texto para el campo. `null` vuelve como vacío, no como '0'. */
export function aTexto(valor: number | null | undefined): string {
  return valor === null || valor === undefined ? '' : String(valor)
}

/**
 * Los meses cuyos valores cambiaron respecto a lo cargado.
 *
 * Compara SOLO los campos del alcance: con un vendedor elegido, los tres campos
 * de workspace ni se dibujan, así que su diferencia no puede venir de una
 * edición y marcarla mandaría a guardar un mes que nadie tocó.
 */
export function filasCambiadas(
  originales: FilaMetaAnio[],
  actuales: FilaMetaAnio[],
  alcance: AlcanceMeta,
): FilaMetaAnio[] {
  const campos = camposDe(alcance)
  const porMes = new Map(originales.map((f) => [f.mes, f]))
  return actuales.filter((fila) => {
    const orig = porMes.get(fila.mes)
    if (!orig) return campos.some((c) => aNumero(fila[c]) !== null)
    // Se comparan los NÚMEROS y no el texto: '0007' y '7' son la misma meta, y
    // un guardado por esa diferencia sería ruido.
    return campos.some((c) => aNumero(fila[c]) !== aNumero(orig[c]))
  })
}

/**
 * Copia los valores de un mes hacia los meses siguientes del año.
 *
 * Es la razón de ser de la pantalla: casi siempre la meta se repite y fijarla
 * doce veces a mano era el trabajo que sobraba. Solo copia los campos del
 * alcance, y solo hacia ADELANTE: los meses ya corridos suelen tener su meta
 * real fijada y pisarla borraría historia contra la que ya se midió a alguien.
 */
export function copiarHaciaAdelante(
  filas: FilaMetaAnio[],
  desdeMes: number,
  alcance: AlcanceMeta,
): FilaMetaAnio[] {
  const campos = camposDe(alcance)
  const fuente = filas.find((f) => f.mes === desdeMes)
  if (!fuente) return filas
  return filas.map((f) => {
    if (f.mes <= desdeMes) return f
    const copia = { ...f }
    for (const c of campos) copia[c] = fuente[c]
    return copia
  })
}
