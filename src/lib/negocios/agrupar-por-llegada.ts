/**
 * Agrupa la lista de negocios por el DIA en que llegaron a la etapa donde estan.
 *
 * Por que existe: la lista venia ordenada por `created_at`, la fecha en que nacio
 * el negocio. Al mirar una etapa eso responde la pregunta equivocada —"cuando
 * entro este cliente"— cuando lo que se necesita saber es "que cayo aqui hoy y
 * que lleva parado". Un negocio que acaba de llegar aparecia enterrado entre los
 * viejos solo por ser antiguo.
 *
 * El dia se calcula en Bogota, no en UTC: el servidor corre en UTC y despues de
 * las 19:00 hora local el instante ya pertenece al dia siguiente alla, asi que
 * agrupar por la fecha cruda mandaria al grupo "manana" todo lo que se mueva al
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

/**
 * Etiqueta del encabezado. "Hoy" y "Ayer" son lo que la gente busca primero; el
 * resto se nombra con el dia de la semana, que es como se habla de la carga
 * ("lo del miercoles"). El ano solo aparece cuando NO es el corriente: ponerlo
 * siempre agrega ruido a la lectura del 99% de los grupos.
 */
export function etiquetaDia(dia: string, hoy: string): string {
  if (!dia) return 'Sin fecha de llegada'
  if (dia === hoy) return 'Hoy'
  if (dia === diaAnterior(hoy)) return 'Ayer'
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
  const porDia = new Map<string, T[]>()
  for (const n of negocios) {
    const dia = diaBogotaDe(n.etapa_cambiada_at)
    const yaHay = porDia.get(dia)
    if (yaHay) yaHay.push(n)
    else porDia.set(dia, [n])
  }

  const dias = Array.from(porDia.keys()).sort((a, b) => {
    // Los que no tienen fecha van al final: son residuo, no la noticia del dia.
    if (a === '') return 1
    if (b === '') return -1
    return b.localeCompare(a)
  })

  return dias.map((dia) => ({
    dia,
    etiqueta: etiquetaDia(dia, hoy),
    items: [...(porDia.get(dia) ?? [])].sort((x, y) =>
      (y.etapa_cambiada_at ?? '').localeCompare(x.etapa_cambiada_at ?? ''),
    ),
  }))
}
