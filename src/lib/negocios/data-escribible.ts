/**
 * Qué claves de `negocio_bloques.data` puede escribir el navegador.
 *
 * `actualizarBloqueData` y `marcarBloqueCompleto` reciben `data` del navegador y la
 * guardaban tal cual (la primera reemplazando, la segunda mezclando), sin mirar el tipo del
 * bloque ni qué claves traía. Eso volvía a `data` un canal de escritura libre, y hay código
 * de servidor que LEE de ahí referencias a archivos y las usa con credenciales que el usuario
 * no tiene:
 *   - `docs[slug]` → `procesarDocumentoNegocio` hacía `fetch(url)` a lo que hubiera (SSRF) y
 *     mandaba el contenido a Gemini;
 *   - `drive_file_id` / `drive_url` → `reprocesarDocumento` descarga ese id y
 *     `procesarDocumento` lo borra, con las credenciales de Drive del workspace o, sin Drive
 *     propio, con las GLOBALES de MeTRIK, que guardan archivos de varios clientes;
 *   - `_ediciones`, `_campo_retirado`, … → la traza de auditoría, que el servidor escribe.
 *
 * Lista BLANCA, no negra: una clave se escribe desde el navegador solo si es un campo que el
 * bloque declara (`config_extra.fields[].slug`) o una de las pocas que los componentes
 * escriben sin declararla (inventario de `BloqueDatos`, `BloqueDatosMultiPago`,
 * `BloqueEquipo` y `BloqueChecklist`). Lo que no está en la lista CONSERVA lo guardado: ni
 * lo que mande el navegador lo pisa, ni un guardado que no lo traiga lo borra.
 *
 * Puro: lo prueba `data-escribible.test.ts` sin dobles.
 */

import { duenoDeReferencia, esReferenciaOne } from '@/lib/almacenamiento/referencia'

type Data = Record<string, unknown>

/**
 * Las que los componentes escriben sin que la config las declare. Si un componente nuevo
 * escribe una clave propia, va aquí; si no, su guardado deja de persistir y se nota.
 */
const CLAVES_DE_COMPONENTE: Record<string, readonly string[]> = {
  // `correo_seccional` lo deriva BloqueDatos de la seccional elegida; `_epayco_desglose`
  // lo trae la consulta de referencia ePayco; `pagos` es la lista de BloqueDatosMultiPago.
  datos: ['correo_seccional', '_epayco_desglose', 'pagos'],
  equipo: ['comercial_id', 'ejecucion_id', 'financiero_id'],
  checklist: ['completado_via'],
}

/**
 * Referencias a archivos y datos de servidor. Nunca se escriben desde el navegador, aunque
 * algún día una config declare un campo con ese nombre.
 */
export const CLAVES_NUNCA_DEL_NAVEGADOR: readonly string[] = [
  'docs',
  'drive_url',
  'drive_file_id',
  'storage_path',
  'archivo_url',
  'file_url',
  'pdf_url',
  'url',
  'carpeta_url',
  'campos',
  'versiones',
  'file_name',
  'mime_type',
  'uploaded_at',
]

interface CampoDeclarado {
  slug?: unknown
  tipo?: unknown
}

function camposDeclarados(configExtra: Data | null | undefined): CampoDeclarado[] {
  const fields = configExtra?.fields
  return Array.isArray(fields) ? (fields as CampoDeclarado[]) : []
}

/** Las claves que el navegador puede escribir en un bloque de este tipo y esta config. */
export function clavesEscribibles(tipo: string | null | undefined, configExtra: Data | null | undefined): Set<string> {
  const claves = new Set<string>(CLAVES_DE_COMPONENTE[tipo ?? ''] ?? [])
  if (tipo === 'datos') {
    for (const f of camposDeclarados(configExtra)) {
      // Lo que empieza por `_` es el espacio de nombres del servidor (`_ediciones`,
      // `_campo_retirado`, `_reconstruido`, …): un campo declarado así no lo abre.
      if (typeof f.slug === 'string' && f.slug.length > 0 && !f.slug.startsWith('_')) claves.add(f.slug)
    }
  }
  for (const k of CLAVES_NUNCA_DEL_NAVEGADOR) claves.delete(k)
  return claves
}

/**
 * Un campo de imagen guarda la referencia `one://` que devuelve `subirImagenClipboard`.
 * Desde el navegador solo entra vacía, la misma que ya estaba, o una referencia de ESTE
 * workspace: nunca una URL arbitraria ni la referencia de un archivo ajeno.
 */
function valorImagenAceptable(valor: unknown, guardado: unknown, workspaceId: string): boolean {
  if (valor === '' || valor === null || valor === undefined) return true
  if (valor === guardado) return true
  return esReferenciaOne(valor) && duenoDeReferencia(valor)?.workspaceId === workspaceId.toLowerCase()
}

export interface EntradaSaneo {
  entrante: Data
  guardada: Data
  tipo: string | null | undefined
  configExtra: Data | null | undefined
  workspaceId: string
  /**
   * `reemplazo`: lo que se guarda es lo que manda el navegador (el autosave de
   * `actualizarBloqueData`); una clave escribible que no viene se borra, como antes.
   * `mezcla`: se parte de lo guardado (`marcarBloqueCompleto`).
   */
  modo: 'reemplazo' | 'mezcla'
}

export function sanearDataDelNavegador({ entrante, guardada, tipo, configExtra, workspaceId, modo }: EntradaSaneo): Data {
  const escribibles = clavesEscribibles(tipo, configExtra)
  const imagenes = new Set(
    tipo === 'datos'
      ? camposDeclarados(configExtra)
          .filter((f) => f.tipo === 'imagen_clipboard' && typeof f.slug === 'string')
          .map((f) => f.slug as string)
      : [],
  )

  const resultado: Data = {}
  // Lo no escribible: siempre lo guardado, en los dos modos.
  for (const [k, v] of Object.entries(guardada)) {
    if (modo === 'mezcla' || !escribibles.has(k)) resultado[k] = v
  }
  for (const [k, v] of Object.entries(entrante)) {
    if (!escribibles.has(k)) continue
    if (imagenes.has(k) && !valorImagenAceptable(v, guardada[k], workspaceId)) {
      // Se conserva lo que había (o nada, si no había).
      if (k in guardada) resultado[k] = guardada[k]
      else delete resultado[k]
      continue
    }
    resultado[k] = v
  }
  return resultado
}
