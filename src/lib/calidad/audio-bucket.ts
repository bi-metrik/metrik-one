/**
 * El buzon de paso del audio y la regla de que es un huerfano.
 *
 * Lo usan las tres piezas que tocan el bucket: la que firma la subida, la que
 * transcribe y borra, y el barrido. Vive aparte y no dentro de una ruta para
 * que ninguna de ellas tenga que importar de otra, y para que la regla del
 * huerfano sea UNA y no tres copias que se separan con el tiempo.
 */
export const BUCKET_AUDIO = 'calidad-audio'

/**
 * Cuanto se espera antes de considerar que un audio quedo abandonado.
 *
 * Holgado a proposito: la transcripcion mas larga que el producto admite tarda
 * unos 120 s y el techo de la funcion son 300 s, asi que a las 2 horas no queda
 * nada legitimo en vuelo. Borrar antes seria arriesgarse a quitarle el archivo
 * a una transcripcion que todavia esta corriendo, y eso se veria como un fallo
 * aleatorio e irreproducible del producto.
 */
export const HORAS_GRACIA = 2

/** Lo minimo que necesitamos saber de un objeto para decidir si sobra. */
export interface ObjetoStorage {
  name: string
  created_at?: string | null
}

/**
 * Cuales de estos objetos son huerfanos, dado el reloj de ahora.
 *
 * Un objeto SIN fecha no se borra. Preferimos dejar basura a borrarle el
 * archivo a una transcripcion en curso: lo primero se recoge en la pasada
 * siguiente, lo segundo le rompe la pantalla a alguien y no deja rastro.
 */
export function huerfanos(objetos: ObjetoStorage[], ahora: number): string[] {
  const corte = ahora - HORAS_GRACIA * 60 * 60 * 1000
  return objetos
    .filter((o) => {
      const nacido = o.created_at ? Date.parse(o.created_at) : NaN
      return Number.isFinite(nacido) && nacido < corte
    })
    .map((o) => o.name)
}
