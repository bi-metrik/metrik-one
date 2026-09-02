// ============================================================
// Traer un resultado COMPLETO de PostgREST, por páginas.
//
// PostgREST corta toda respuesta en `max-rows` (1.000 filas en esta instancia) y
// **no avisa**: devuelve 200, sin error, con la lista recortada. Quien la lee no
// puede distinguir "no hay más" de "hay más y no te las mandé".
//
// Ya costó caro. Medido en producción el 2026-09-02, la cola de facturación de
// SOENA pedía 1.115 filas de `negocio_bloques` en una sola consulta: 115 se
// perdían en silencio y con ellas el RUT o el servicio contratado de casos vivos
// —48 negocios aparecían sin identificación, nombre, ciudad, dirección ni correo,
// teniéndolo todo en la base—, y **dos casos ya facturados (V0089 y V0428)
// volvían a la bandeja como facturables**. Emitir una factura electrónica
// aceptada por la DIAN no se deshace.
//
// Peor todavía: **cuáles se pierden depende del plan de la consulta**, así que el
// mismo código deja fuera casos distintos en cada corrida. En dos mediciones
// separadas por minutos el conteo de casos sin servicio declarado pasó de 24 a 23.
// Que hoy sobrevivan las filas que importan es suerte de ordenamiento, no diseño.
//
// Por eso este módulo tiene UNA regla dura: **o devuelve el resultado completo, o
// lanza**. Nunca una lista a medias con cara de estar entera.
//
// Puro respecto de Supabase: recibe una función que construye la página, así que
// se prueba sin red.
// ============================================================

/**
 * Tope del servidor. Pedir más por página NO trae más: PostgREST recorta igual, y
 * entonces una página "incompleta" se leería como "se acabaron las filas".
 * Por eso el tamaño de página se limita a este valor y no se puede subir desde
 * quien llama.
 */
export const TAMANO_PAGINA_POSTGREST = 1000

/**
 * Cuántas filas se está dispuesto a acumular antes de declarar que algo va mal.
 * No es un `LIMIT`: al superarlo se LANZA, porque una consulta de este tipo que
 * devuelve cientos de miles de filas es un filtro que se olvidó, no un dato.
 */
export const TECHO_FILAS_POR_DEFECTO = 100_000

export interface RespuestaPagina<T> {
  data: T[] | null
  error: { message: string } | null
}

export interface OpcionesPaginacion {
  /** Para que el error diga QUÉ consulta falló. Obligatorio a propósito. */
  etiqueta: string
  tamanoPagina?: number
  techoFilas?: number
}

/**
 * Recorre `construirPagina` hasta agotar el resultado y devuelve TODAS las filas.
 *
 * ⚠️ La página que se construya tiene que traer un **orden estable** (`.order('id')`
 * o equivalente). Sin orden, PostgREST no garantiza que la página 2 continúe donde
 * terminó la 1: se repiten filas y se pierden otras, que es el mismo fallo mudo con
 * otro disfraz.
 *
 * El corte es por tamaño de página, no por "vino menos de lo que pedí y me doy por
 * satisfecho": si un lote cae justo en el límite de una página se pide la
 * siguiente, y solo una página corta (o vacía) cierra el recorrido.
 *
 * @throws si la consulta devuelve error, si una página trae más filas de las
 *   pedidas (implementación rota), o si se supera el techo de filas.
 */
export async function traerTodo<T>(
  construirPagina: (desde: number, hasta: number) => PromiseLike<RespuestaPagina<T>>,
  opciones: OpcionesPaginacion,
): Promise<T[]> {
  const { etiqueta } = opciones
  const techo = opciones.techoFilas ?? TECHO_FILAS_POR_DEFECTO
  // Se acota al tope del servidor: pedir 5.000 devolvería 1.000 y el recorrido
  // creería haber terminado. El clamp es la parte que evita reintroducir el bug.
  const tamano = Math.max(
    1,
    Math.min(opciones.tamanoPagina ?? TAMANO_PAGINA_POSTGREST, TAMANO_PAGINA_POSTGREST),
  )

  const todas: T[] = []
  let desde = 0

  for (;;) {
    const { data, error } = await construirPagina(desde, desde + tamano - 1)
    if (error) {
      throw new Error(`[${etiqueta}] la consulta falló en la página desde ${desde}: ${error.message}`)
    }
    const filas = data ?? []
    if (filas.length > tamano) {
      throw new Error(
        `[${etiqueta}] la página desde ${desde} devolvió ${filas.length} filas y se pidieron ${tamano}: ` +
          'la función de página no está respetando el rango.',
      )
    }
    todas.push(...filas)

    // Una página CORTA (o vacía) es la única señal de que se agotó el resultado.
    if (filas.length < tamano) return todas

    if (todas.length > techo) {
      throw new Error(
        `[${etiqueta}] superó el techo de ${techo} filas. Es un filtro que falta, no un dato: ` +
          'se prefiere fallar a devolver una lista incompleta que parezca completa.',
      )
    }
    desde += tamano
  }
}
