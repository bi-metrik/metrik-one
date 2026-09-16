import { createHash } from 'node:crypto'
import { textoAvisoPolitica } from './politica'

/**
 * Huellas sha256 hex de los textos que se leen al aceptar, tal como se guardan en
 * `documentos_aceptaciones_usuario.aviso_texto_sha256`. Separado de `politica.ts` y `entrada.ts`
 * porque usa `node:crypto` y la pantalla importa aquellos archivos.
 */
export function huellaTexto(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}

/** La huella del aviso de la Política. */
export function huellaAvisoPolitica(): string {
  return huellaTexto(textoAvisoPolitica())
}
