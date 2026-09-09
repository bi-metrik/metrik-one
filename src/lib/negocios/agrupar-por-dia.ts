/**
 * Parte la lista de negocios en grupos por DÍA, con encabezado.
 *
 * Nació para una sola pregunta —"qué cayó hoy en esta etapa"— y hoy sirve a dos,
 * porque la forma es la misma y la respuesta cambia solo en tres cosas: de qué
 * campo sale el día, hacia dónde ordena, y cómo se rotula el grupo sin fecha.
 *
 *   - **Llegada a la etapa** (`agruparPorLlegada`). La lista venía ordenada por
 *     `created_at`, la fecha en que nació el negocio. Al mirar una etapa eso
 *     responde la pregunta equivocada —"cuándo entró este cliente"— cuando lo que
 *     se necesita saber es "qué cayó aquí hoy y qué lleva parado". Mira hacia
 *     ATRÁS: lo más reciente arriba.
 *   - **Cita en la DIAN** (`agruparPorCita`, en `agrupar-por-cita.ts`). Mira hacia
 *     ADELANTE: la cita más próxima arriba, porque lo que se pierde es la de
 *     pasado mañana, no la del mes entrante.
 *
 * El día se calcula en Bogotá, no en UTC: el servidor corre en UTC y después de
 * las 19:00 hora local el instante ya pertenece al día siguiente allá, así que
 * agrupar por la fecha cruda mandaría al grupo "mañana" todo lo que se mueva al
 * final de la tarde.
 */
import { todayBogotaISO, formatFecha } from '@/lib/dates/bogota'

export type GrupoLlegada<T> = {
  /** Dia civil en Bogota, 'YYYY-MM-DD'. Cadena vacia = sin fecha de llegada. */
  dia: string
  /** 'Hoy' | 'Ayer' | 'Mie 20 ago' | 'Mie 20 ago 2025' | 'Sin fecha de llegada'. */
  etiqueta: string
  items: T[]
}

type ConLlegada = { etapa_cambiada_at?: string | null }

/** Dia en Bogota ('YYYY-MM-DD') de un instante ISO. Cadena vacia si no hay o no es fecha. */
export function diaBogotaDe(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : todayBogotaISO(d)
}

/** El dia civil anterior a 'YYYY-MM-DD'. Aritmetica en UTC: no depende del reloj. */
function diaAnterior(dia: string): string {
  const [y, m, d] = dia.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

/** El dia civil siguiente a 'YYYY-MM-DD'. Misma aritmetica que `diaAnterior`. */
function diaSiguiente(dia: string): string {
  const [y, m, d] = dia.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/**
 * Etiqueta del encabezado. "Hoy", "Ayer" y "Mañana" son lo que la gente busca
 * primero; el resto se nombra con el dia de la semana, que es como se habla de la
 * carga ("lo del miercoles"). El ano solo aparece cuando NO es el corriente:
 * ponerlo siempre agrega ruido a la lectura del 99% de los grupos.
 *
 * "Mañana" no estorba a quien mira hacia atras: en una lista de llegadas no hay
 * dias futuros, asi que la rama nunca se toca desde ahi.
 *
 * @param etiquetaSinDia como se rotula el grupo de los que no tienen fecha. Cambia
 *   con la pregunta: "Sin fecha de llegada" no significa lo mismo que
 *   "Esperando que el cliente reporte la fecha".
 */
export function etiquetaDia(dia: string, hoy: string, etiquetaSinDia = 'Sin fecha de llegada'): string {
  if (!dia) return etiquetaSinDia
  if (dia === hoy) return 'Hoy'
  if (dia === diaAnterior(hoy)) return 'Ayer'
  if (dia === diaSiguiente(hoy)) return 'Mañana'
  const mismoAno = dia.slice(0, 4) === hoy.slice(0, 4)
  const texto = formatFecha(dia, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(mismoAno ? {} : { year: 'numeric' }),
  })
  if (!texto) return dia
  // 'es-CO' devuelve "mié, 20 de ago de 2025". En un encabezado corto la coma y
  // los "de" solo estorban; la inicial en mayuscula lo alinea con "Hoy"/"Ayer".
  const limpio = texto.replace(',', '').replace(/ de /g, ' ')
  return limpio.charAt(0).toUpperCase() + limpio.slice(1)
}

/** Como se lee cada item para agrupar y ordenar. */
export type LecturaDia<T> = {
  /** Dia civil 'YYYY-MM-DD' del item. Cadena vacia = sin dia. */
  dia: (item: T) => string
  /**
   * Clave fina para ordenar DENTRO del grupo (el instante, la hora de la cita).
   * Se comparan como cadenas, asi que tiene que ser de ancho fijo y de mayor a
   * menor unidad. Sin esto se ordena por el dia, y todo el grupo empata.
   */
  orden?: (item: T) => string
  /** 'desc' = lo mas reciente arriba (llegada). 'asc' = lo mas proximo arriba (cita). */
  direccion: 'asc' | 'desc'
  /** Encabezado de cada grupo, ya resuelto (normalmente `etiquetaDia`). */
  etiqueta: (dia: string) => string
}

/**
 * Nucleo compartido: parte `items` en grupos por dia y los ordena.
 *
 * Los que no tienen dia van SIEMPRE al final, en los dos sentidos: son residuo de
 * la pregunta que se esta haciendo, no su respuesta. Quien necesite darles otro
 * lugar (la cita los saca a un grupo propio) los aparta antes de llamar aqui.
 *
 * No muta `items`: la lista que llega es la que la pantalla sigue usando para
 * contar y para exportar.
 */
export function agruparPorDia<T>(items: readonly T[], lectura: LecturaDia<T>): GrupoLlegada<T>[] {
  const { dia: diaDe, orden, direccion, etiqueta } = lectura
  const clave = orden ?? diaDe
  const signo = direccion === 'asc' ? 1 : -1

  const porDia = new Map<string, T[]>()
  for (const item of items) {
    const dia = diaDe(item)
    const yaHay = porDia.get(dia)
    if (yaHay) yaHay.push(item)
    else porDia.set(dia, [item])
  }

  const dias = Array.from(porDia.keys()).sort((a, b) => {
    // Los que no tienen fecha van al final: son residuo, no la noticia del dia.
    if (a === '') return 1
    if (b === '') return -1
    return signo * a.localeCompare(b)
  })

  return dias.map((dia) => ({
    dia,
    etiqueta: etiqueta(dia),
    items: [...(porDia.get(dia) ?? [])].sort(
      (x, y) => signo * (clave(x) || '').localeCompare(clave(y) || ''),
    ),
  }))
}

/**
 * @param negocios lista ya filtrada (fase, etapa, busqueda, responsable...)
 * @param hoy      dia de hoy en Bogota, 'YYYY-MM-DD'. Se recibe, no se calcula:
 *                 leer el reloj dentro del render rompe la pureza que exige
 *                 react-hooks y desajusta la hidratacion (servidor UTC vs
 *                 navegador local). Lo resuelve el server component.
 */
export function agruparPorLlegada<T extends ConLlegada>(
  negocios: T[],
  hoy: string,
): GrupoLlegada<T>[] {
  return agruparPorDia(negocios, {
    dia: (n) => diaBogotaDe(n.etapa_cambiada_at),
    orden: (n) => n.etapa_cambiada_at ?? '',
    direccion: 'desc',
    etiqueta: (dia) => etiquetaDia(dia, hoy),
  })
}
