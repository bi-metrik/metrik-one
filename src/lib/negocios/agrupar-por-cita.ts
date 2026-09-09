/**
 * Agrupa la lista de negocios por el DÍA DE LA CITA en la DIAN.
 *
 * ⚠️ POR QUÉ EXISTE
 *
 * Deisy Ramírez, 9-sep-2026, textual: *"se le están perdiendo citas"*. La lista
 * ordena por llegada a la etapa, que mira hacia atrás; una cita es lo contrario,
 * y la que se pierde es la de pasado mañana, no la del mes entrante.
 *
 * ⚠️ EL GRUPO QUE JUSTIFICA TODO ESTO ES EL DE LOS QUE **NO** TIENEN FECHA
 *
 * Medido en producción el 9-sep-2026: 46 negocios abiertos en Notificación, los 46
 * con vía de solicitud registrada y NINGUNO con fecha de cita. Son exactamente los
 * que se pierden —el cliente agendó y nadie reportó la fecha—, así que un orden
 * por cita que solo muestre a los que tienen fecha los dejaría invisibles justo en
 * la pantalla hecha para no perderlos.
 *
 * Y no basta con "los que tienen la fecha vacía": eso mete a los 66 de Propuesta y
 * los 24 de Validación, que ni siquiera van a ir a la DIAN, y ahoga el grupo. El
 * corte es `cita_pendiente`: el negocio YA tiene una instancia del bloque de la
 * cita (llegó al punto donde se pregunta) y sigue sin valor. Lo resuelve el
 * servidor en `getNegociosV2`; aquí solo se lee la bandera.
 */
import { agruparPorDia, etiquetaDia, type GrupoLlegada } from './agrupar-por-dia'
import { diaDeFechaHora } from './fecha-hora-campo'

/**
 * Claves de los grupos que NO son un día. Van en el campo `dia` del grupo porque
 * es lo que la pantalla usa de `key`; no son fechas y no se parsean como tales.
 */
export const GRUPO_CITA_VENCIDA = 'cita-vencida'
export const GRUPO_CITA_ESPERANDO = 'cita-esperando'
export const GRUPO_SIN_CITA = 'sin-cita'

export const ETIQUETA_ESPERANDO = 'Esperando que el cliente reporte la fecha'

type ConCita = {
  /** Valor civil de Bogotá: 'YYYY-MM-DD' o 'YYYY-MM-DDTHH:mm'. */
  fecha_cita?: string | null
  /** Llegó al punto donde se pregunta la fecha y no la tiene. */
  cita_pendiente?: boolean
}

/**
 * Parte la lista en, y en este orden:
 *
 *   1. **Cita vencida** — la fecha ya pasó y el negocio sigue abierto. Va PRIMERO
 *      porque es lo que se está perdiendo: dejarlo al final del orden ascendente
 *      lo escondería debajo de todo lo que sí está por venir.
 *   2. Un grupo por día, del más próximo al más lejano.
 *   3. **Esperando que el cliente reporte la fecha** — sin fecha, con el bloque ya
 *      abierto. Ver el encabezado del módulo.
 *   4. **Sin cita registrada** — el resto. No se descarta: una lista que pierde
 *      filas en silencio es peor que una lista larga, y el conteo del encabezado
 *      de fase tiene que seguir cuadrando con lo que se ve.
 *
 * @param hoy día de hoy en Bogotá, 'YYYY-MM-DD', resuelto por el servidor (leer el
 *   reloj en render rompe la hidratación).
 */
export function agruparPorCita<T extends ConCita>(negocios: T[], hoy: string): GrupoLlegada<T>[] {
  const vencidas: T[] = []
  const proximas: T[] = []
  const esperando: T[] = []
  const sinCita: T[] = []

  for (const n of negocios) {
    const dia = diaDeFechaHora(n.fecha_cita)
    if (!dia) {
      if (n.cita_pendiente) esperando.push(n)
      else sinCita.push(n)
    } else if (dia < hoy) {
      vencidas.push(n)
    } else {
      proximas.push(n)
    }
  }

  const valor = (n: T) => (n.fecha_cita ?? '').trim()
  const grupos: GrupoLlegada<T>[] = []

  if (vencidas.length > 0) {
    grupos.push({
      dia: GRUPO_CITA_VENCIDA,
      etiqueta: 'Cita vencida',
      // Dentro del grupo, la más reciente arriba: la de ayer todavía se puede
      // remontar, la de hace dos meses ya es historia.
      items: [...vencidas].sort((a, b) => valor(b).localeCompare(valor(a))),
    })
  }

  grupos.push(
    ...agruparPorDia(proximas, {
      dia: (n) => diaDeFechaHora(n.fecha_cita),
      // Dentro del día manda la hora: la cita de las 8:00 va antes que la de las
      // 14:00. Un valor heredado de solo día se compara como su medianoche y
      // encabeza el día, que es donde tiene que estar mientras no se sepa la hora.
      orden: valor,
      direccion: 'asc',
      etiqueta: (dia) => etiquetaDia(dia, hoy),
    }),
  )

  if (esperando.length > 0) {
    grupos.push({ dia: GRUPO_CITA_ESPERANDO, etiqueta: ETIQUETA_ESPERANDO, items: [...esperando] })
  }
  if (sinCita.length > 0) {
    grupos.push({ dia: GRUPO_SIN_CITA, etiqueta: 'Sin cita registrada', items: [...sinCita] })
  }
  return grupos
}
