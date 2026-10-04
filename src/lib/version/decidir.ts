/**
 * Decide que hacer con una pestaña que lleva rato abierta.
 *
 * Existe por dos casos medidos en produccion el 2026-08-19. Jessica quedo con
 * una pestaña de un dia: los deploys entraron a las 21:00 UTC y su bundle
 * apuntaba a assets de un deployment ya retirado, asi que al subir un documento
 * la app reventaba entera ("Application error: a client-side exception has
 * occurred"). Daniela tenia una sesion del 3 de agosto — dieciseis dias y varios
 * deploys despues — y lo vivia como "no abre nada".
 *
 * Cambio del 2026-10-03: un deploy normal YA NO es motivo de recarga. Skew
 * Protection le sirve a la pestaña vieja sus assets, sus navegaciones y sus server
 * actions durante 7 dias, y cada recarga forzada era justo la descarga que falla por
 * Telmex/Claro (76 deploys en 7 dias, ~771 KB de JS por recarga). Quedan dos motivos:
 *
 *  - **Epoca**: un PR que rompe compatibilidad con las pestañas viejas sube
 *    `EPOCA` (`./epoca.ts`). Se comporta como antes: recarga si no hay trabajo en
 *    curso, y si lo hay, avisa.
 *  - **Techo de 8 horas** (lo pidio Mauricio): cubre lo que la epoca no ve (token
 *    caducado, estado acumulado). Pero ya no recarga a quien esta leyendo: espera a
 *    la siguiente navegacion interna, o a que la persona vuelva a la pestaña.
 *
 * La decision vive aparte del componente porque el componente no se puede
 * probar (la suite corre en `node`, sin DOM) y esto es lo que hay que blindar:
 * una recarga mal disparada le borra el trabajo a una operadora.
 */

/** Techo de vida de una pestaña. Pasado esto se recarga aunque no haya epoca nueva. */
export const TECHO_EDAD_MS = 8 * 60 * 60 * 1000

export type Accion = 'nada' | 'recargar' | 'avisar'

/** Por que la pestaña deberia recargarse. */
export type Motivo = 'epoca' | 'techo'

/**
 * Cuando se esta decidiendo:
 *  - `intervalo`: la revision periodica (o la que sigue a la respuesta de
 *    `/api/version`). La persona puede estar leyendo: el techo no recarga aqui.
 *  - `volver`: la pestaña acaba de volver a ser visible. Es el momento en que la
 *    persona todavia no esta leyendo nada, y el techo si puede recargar.
 */
export type Momento = 'intervalo' | 'volver'

/**
 * La epoca que llego de `/api/version`, o `null` si no sirve.
 *
 * Solo un entero no negativo cuenta. Si el endpoint falla o devuelve basura, la
 * respuesta correcta es no tocarle la pestaña a nadie: tratar el fallo como "hay
 * epoca nueva" recargaria en bucle a toda la operacion justo cuando algo ya esta roto.
 */
export function leerEpoca(cuerpo: unknown): number | null {
  if (!cuerpo || typeof cuerpo !== 'object') return null
  const epoca = (cuerpo as { epoca?: unknown }).epoca
  if (typeof epoca !== 'number' || !Number.isSafeInteger(epoca) || epoca < 0) return null
  return epoca
}

/**
 * ¿Hay motivo para que esta pestaña se recargue?
 *
 * La epoca manda sobre el techo porque es la que actua sin esperar. Una epoca viva
 * MENOR que la cargada (reversion de un deploy) no es motivo: la pestaña nueva
 * funciona contra el esquema, y recargarla la mandaria al codigo viejo.
 */
export function motivoParaRecargar(args: {
  epocaCargada: number
  epocaViva: number | null | undefined
  edadMs: number
  techoMs?: number
}): Motivo | null {
  const { epocaCargada, epocaViva, edadMs } = args
  const techoMs = args.techoMs ?? TECHO_EDAD_MS

  if (typeof epocaViva === 'number' && epocaViva > epocaCargada) return 'epoca'
  if (edadMs >= techoMs) return 'techo'
  return null
}

/**
 * Que hacer ahora con la pestaña.
 *
 * Recargar sola SOLO cuando no hay nada que perder. `trabajoEnCurso` lo mide el
 * componente contra el DOM real (campo enfocado, formulario sucio, archivo ya
 * escogido); aqui solo se decide con el veredicto.
 *
 *  - Epoca nueva: igual que siempre. Sin trabajo, recarga; con trabajo, avisa. El
 *    aviso no se va: al volver a la pestaña con los campos limpios, recarga sola.
 *  - Techo: nunca recarga a alguien que esta leyendo una pantalla visible. Solo al
 *    volver a la pestaña y sin trabajo; si no, queda pendiente para la siguiente
 *    navegacion interna (`navegarConCargaCompleta`).
 *
 * Sin conexion no se hace nada: recargar sin red cambia una pantalla que
 * funciona a medias por una que no carga.
 */
export function decidirAccion(args: {
  motivo: Motivo | null
  momento: Momento
  trabajoEnCurso: boolean
  enLinea: boolean
}): Accion {
  const { motivo, momento, trabajoEnCurso, enLinea } = args
  if (!motivo || !enLinea) return 'nada'
  if (motivo === 'epoca') return trabajoEnCurso ? 'avisar' : 'recargar'
  return momento === 'volver' && !trabajoEnCurso ? 'recargar' : 'nada'
}

/**
 * ¿La proxima navegacion interna debe ser una carga completa del destino?
 *
 * Es el momento barato para ponerse al dia: la persona ya decidio irse de esta
 * pantalla, asi que no se le borra nada que no fuera a perder igual, y la carga
 * completa reemplaza a la navegacion que de todas formas iba a pedir red. Sin
 * conexion se deja la navegacion normal: una carga completa sin red deja la
 * pantalla en blanco del navegador.
 */
export function navegarConCargaCompleta(args: {
  motivo: Motivo | null
  enLinea: boolean
}): boolean {
  return args.motivo !== null && args.enLinea
}

/**
 * ¿Este click en un `<a>` es una navegacion interna que la app resolveria sin
 * recargar? Solo esas se convierten en carga completa; todo lo demas se deja al
 * navegador tal cual (pestaña nueva, descarga, otro dominio, ancla de la misma
 * pagina, teclas modificadoras).
 */
export function esNavegacionInterna(args: {
  href: string | null
  ubicacion: string
  target: string | null
  descarga: boolean
  boton: number
  modificadora: boolean
  yaPrevenido: boolean
}): URL | null {
  const { href, ubicacion, target, descarga, boton, modificadora, yaPrevenido } = args
  if (!href || yaPrevenido || descarga || boton !== 0 || modificadora) return null
  if (target && target !== '_self') return null

  let destino: URL
  let actual: URL
  try {
    actual = new URL(ubicacion)
    destino = new URL(href, actual)
  } catch {
    return null
  }
  if (destino.protocol !== 'http:' && destino.protocol !== 'https:') return null
  if (destino.origin !== actual.origin) return null
  // Mismo documento, solo cambia el `#`: el navegador hace scroll, no hay nada que cargar.
  if (destino.pathname === actual.pathname && destino.search === actual.search && destino.hash) {
    return null
  }
  return destino
}
