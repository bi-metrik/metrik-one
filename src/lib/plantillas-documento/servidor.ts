/**
 * Lecturas de las plantillas editables. Reciben el cliente: el de la sesión (RLS por
 * workspace) en la app, el de servicio en los scripts de cargue.
 *
 * Las tablas aún no están en `database.ts`, de ahí el `db()`.
 */
import { esTipoPlantilla, type TipoPlantilla } from './catalogo'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

/** PostgREST (PGRST205) y Postgres (42P01): la relación no existe. */
const TABLA_AUSENTE = new Set(['PGRST205', '42P01'])

export interface VersionPlantilla {
  id: string
  tipo: TipoPlantilla
  version_n: number
  contenido: string
  nota: string | null
  creada_por: string | null
  creada_por_nombre: string | null
  restaurada_de: string | null
  created_at: string
}

export interface ActivaPlantilla {
  version_id: string
  activada_por: string | null
  activada_at: string
}

/** ¿El template de un bloque de formulario puede tener plantilla editable? */
export function admitePlantillaEditable(template: string): template is TipoPlantilla {
  return esTipoPlantilla(template)
}

/**
 * La versión activa del workspace para ese documento, o null (= formato de fábrica).
 *
 * Un fallo de lectura se PROPAGA: tratarlo como «no hay activa» imprimiría en silencio
 * el formato viejo en un espacio que activó otro texto.
 */
export async function leerVersionActiva(
  cliente: unknown,
  workspaceId: string,
  tipo: TipoPlantilla,
): Promise<VersionPlantilla | null> {
  const { data: activa, error } = await db(cliente)
    .from('plantillas_documento_activas')
    .select('version_id')
    .eq('workspace_id', workspaceId)
    .eq('tipo', tipo)
    .maybeSingle()
  // Tabla que todavía no existe (código desplegado antes que la migración): nadie pudo
  // activar nada, así que el formato de fábrica es lo correcto.
  if (error && TABLA_AUSENTE.has(String(error.code))) return null
  if (error) throw new Error(`plantillas_documento_activas: ${error.code ?? error.message ?? 'error'}`)
  if (!activa?.version_id) return null
  const { data: version, error: e2 } = await db(cliente)
    .from('plantillas_documento_versiones')
    .select('id, tipo, version_n, contenido, nota, creada_por, creada_por_nombre, restaurada_de, created_at')
    .eq('id', activa.version_id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (e2) throw new Error(`plantillas_documento_versiones: ${e2.code ?? e2.message ?? 'error'}`)
  if (!version) throw new Error('La versión activa de la plantilla no se pudo leer.')
  return version as VersionPlantilla
}

export async function esEditorDePlantillas(cliente: unknown, workspaceId: string, userId: string): Promise<boolean> {
  const { data, error } = await db(cliente)
    .from('plantillas_documento_editores')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return false
  return Boolean(data)
}
