import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { padresDeArchivoDrive, usaCredencialesDriveGlobales } from '@/lib/google-drive'

/**
 * ¿Se puede operar (descargar, borrar) este id de Drive en nombre de este workspace?
 *
 * El id sale de `negocio_bloques.data` (`drive_file_id`, o el que trae `drive_url`), que tiene
 * más de un escritor. Con Drive PROPIO no hay riesgo nuevo: las credenciales del workspace
 * solo alcanzan lo suyo. Sin Drive propio, la llamada va con las credenciales GLOBALES de
 * MeTRIK, que guardan archivos de varios clientes: con el id de un archivo ajeno se leía o se
 * borraba lo de otro. Ahí se exige que el archivo cuelgue de una carpeta del workspace: la
 * carpeta del negocio o la raíz de Drive del workspace.
 *
 * La carpeta raíz NO cuenta como archivo operable: se piden ancestros ESTRICTOS. Borrar
 * "el archivo anterior" con el id de la carpeta del negocio se llevaría la carpeta entera.
 *
 * Nunca lanza: si no se puede comprobar, la respuesta es no.
 */

const MAX_NIVELES = 12

/** Puro: sube por los padres hasta dar con una raíz. Lo prueba `drive-del-workspace.test.ts`. */
export async function desciendeDeAlgunaRaiz(
  fileId: string,
  raices: ReadonlySet<string>,
  padresDe: (id: string) => Promise<string[] | null>,
  maxNiveles = MAX_NIVELES,
): Promise<boolean> {
  if (raices.size === 0) return false
  const vistos = new Set<string>([fileId])
  let frontera = [fileId]
  for (let nivel = 0; nivel < maxNiveles && frontera.length > 0; nivel++) {
    const siguiente: string[] = []
    for (const id of frontera) {
      const padres = await padresDe(id)
      for (const p of padres ?? []) {
        if (raices.has(p)) return true
        if (!vistos.has(p)) {
          vistos.add(p)
          siguiente.push(p)
        }
      }
    }
    frontera = siguiente
  }
  return false
}

function idCarpeta(url: string | null | undefined): string | null {
  return url?.match(/folders\/([-\w]+)/)?.[1] ?? null
}

export async function archivoDriveOperable(params: {
  fileId: string
  workspaceId: string
  negocioId?: string | null
}): Promise<boolean> {
  const { fileId, workspaceId, negocioId } = params
  try {
    if (!(await usaCredencialesDriveGlobales(workspaceId))) return true

    const svc = createServiceClient()
    const raices = new Set<string>()
    const { data: ws, error: errWs } = await svc
      .from('workspaces')
      .select('drive_folder_id')
      .eq('id', workspaceId)
      .maybeSingle()
    if (errWs) throw new Error(errWs.message)
    const raizWs = (ws as { drive_folder_id?: string | null } | null)?.drive_folder_id
    if (raizWs) raices.add(raizWs)

    if (negocioId) {
      const { data: neg, error: errNeg } = await svc
        .from('negocios')
        .select('carpeta_url')
        .eq('id', negocioId)
        .eq('workspace_id', workspaceId)
        .maybeSingle()
      if (errNeg) throw new Error(errNeg.message)
      const carpeta = idCarpeta((neg as { carpeta_url?: string | null } | null)?.carpeta_url)
      if (carpeta) raices.add(carpeta)
    }

    if (raices.has(fileId)) return false
    return await desciendeDeAlgunaRaiz(fileId, raices, (id) => padresDeArchivoDrive(id, workspaceId))
  } catch (err) {
    console.warn(
      '[drive-del-workspace] no se pudo comprobar a quién pertenece el archivo; no se opera:',
      err instanceof Error ? err.message : err,
    )
    return false
  }
}
