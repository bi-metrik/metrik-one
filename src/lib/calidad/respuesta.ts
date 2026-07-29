/**
 * Lee una respuesta HTTP sin dar por hecho que la escribimos nosotros.
 *
 * UN `.json()` SOBRE UNA RESPUESTA QUE NO CONTROLAS ES UN FALLO ESPERANDO EL
 * MOMENTO. Cuando la plataforma corta la peticion (cuerpo muy grande, gateway
 * caido, funcion excedida) responde con texto plano o HTML, no con nuestro
 * `{ error }`. El parser lanza un SyntaxError y el `catch` de arriba termina
 * mostrando "Unexpected token 'R'" en la pantalla.
 *
 * Eso paso: un audio de 20 minutos recibio el `413 Request Entity Too Large`
 * de Vercel y la pantalla de auditoria mostro el error del parser en vez del
 * mensaje que habiamos escrito.
 *
 * Regla: el cuerpo se lee como texto y el JSON se intenta. Si no es nuestro,
 * la persona lee un mensaje escrito para ella, no el original de la plataforma.
 */

export interface RespuestaLeida {
  datos: Record<string, unknown>
  /** null si todo salio bien. Si no, el mensaje listo para mostrar. */
  error: string | null
}

/** Mensajes por estado para respuestas que NO son nuestras. */
const AJENOS: Record<number, string> = {
  413: 'El archivo es demasiado pesado para procesarlo. Sube un fragmento más corto.',
  502: 'El servicio no respondió. Vuelve a intentarlo.',
  504: 'El proceso tardó más de lo permitido. Sube un fragmento más corto.',
}

export async function leerRespuesta(res: Response, fallback: string): Promise<RespuestaLeida> {
  const crudo = await res.text()
  let datos: Record<string, unknown> = {}
  let esJson = true
  try {
    datos = crudo ? (JSON.parse(crudo) as Record<string, unknown>) : {}
  } catch {
    esJson = false
  }

  if (res.ok && esJson) return { datos, error: null }
  if (esJson && typeof datos.error === 'string') return { datos, error: datos.error }
  return { datos: {}, error: AJENOS[res.status] ?? fallback }
}
