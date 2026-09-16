import { createHash } from 'node:crypto'
import { textoAvisoPolitica } from './politica'

/**
 * sha256 hex del aviso de la Política, tal como se guarda en
 * `documentos_aceptaciones_usuario.aviso_texto_sha256`. Separado de `politica.ts` porque usa
 * `node:crypto` y la pantalla importa aquel archivo.
 */
export function huellaAvisoPolitica(): string {
  return createHash('sha256').update(textoAvisoPolitica(), 'utf8').digest('hex')
}
