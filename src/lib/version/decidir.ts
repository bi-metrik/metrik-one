/**
 * Decide que hacer con una pestaña que lleva rato abierta.
 *
 * Existe por dos casos medidos en produccion el 2026-08-19. Jessica quedo con
 * una pestaña de un dia: los deploys entraron a las 21:00 UTC y su bundle
 * apuntaba a assets de un deployment ya retirado, asi que al subir un documento
 * la app reventaba entera ("Application error: a client-side exception has
 * occurred"). Daniela tenia una sesion del 3 de agosto — dieciseis dias y varios
 * deploys despues — y lo vivia como "no abre nada". Ninguna de las dos tenia
 * forma de enterarse: la app no avisaba cuando quedaba atras.
 *
 * La decision vive aparte del componente porque el componente no se puede
 * probar (la suite corre en `node`, sin DOM) y esto es lo que hay que blindar:
 * una recarga mal disparada le borra el trabajo a una operadora.
 */

/** Techo de vida de una pestaña. Pasado esto se recarga aunque no haya deploy. */
export const TECHO_EDAD_MS = 8 * 60 * 60 * 1000

export type Accion = 'nada' | 'recargar' | 'avisar'

/**
 * ¿El bundle que esta pestaña tiene cargado quedo atras?
 *
 * Dos motivos independientes, y basta uno:
 *
 *  - **Deploy nuevo**: la version viva no es la que se cargo. Es el motivo
 *    preciso — se nota a los minutos de un push, no cuando toque revisar.
 *  - **Edad**: la pestaña paso el techo. Cubre lo que la version no ve (token
 *    caducado, estado acumulado) y es el piso de 8 horas que pidio Mauricio.
 *
 * Una `versionViva` vacia o nula NO cuenta como obsoleta. Si `/api/version`
 * falla o devuelve basura, la respuesta correcta es no tocarle la pestaña a
 * nadie: tratar el fallo como "hay version nueva" recargaria en bucle a toda la
 * operacion justo cuando algo ya esta roto.
 */
export function estaObsoleta(args: {
  versionCargada: string
  versionViva: string | null | undefined
  edadMs: number
  techoMs?: number
}): boolean {
  const { versionCargada, versionViva, edadMs } = args
  const techoMs = args.techoMs ?? TECHO_EDAD_MS

  if (edadMs >= techoMs) return true
  if (!versionViva || !versionCargada) return false
  return versionViva !== versionCargada
}

/**
 * Que hacer con una pestaña obsoleta.
 *
 * Recargar sola SOLO cuando no hay nada que perder. `trabajoEnCurso` lo mide el
 * componente contra el DOM real (campo enfocado, formulario sucio, archivo ya
 * escogido); aqui solo se decide con el veredicto.
 *
 * La asimetria es deliberada: recargarle la pantalla a una operadora a mitad de
 * los campos extraidos de un RUT cuesta mas que dejarla otro rato en la version
 * vieja. El aviso no se va — se reevalua cada vez que la pestaña recupera el
 * foco, asi que apenas guarda y los campos quedan limpios, recarga sola.
 *
 * Sin conexion no se hace nada: recargar sin red cambia una pantalla que
 * funciona a medias por una que no carga.
 */
export function decidirAccion(args: {
  obsoleta: boolean
  trabajoEnCurso: boolean
  enLinea: boolean
}): Accion {
  if (!args.obsoleta) return 'nada'
  if (!args.enLinea) return 'nada'
  return args.trabajoEnCurso ? 'avisar' : 'recargar'
}
