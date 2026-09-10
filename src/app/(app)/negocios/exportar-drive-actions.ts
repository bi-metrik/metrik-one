'use server'

/**
 * Publica la tabla de negocios como hoja NATIVA de Google Sheets en el Drive del
 * workspace.
 *
 * UN solo archivo, actualizado en sitio: el enlace no cambia nunca, así que quien lo
 * tenga guardado ve el dato de hoy sin que nadie le mande nada. El `file_id` vive en
 * `workspaces.config_extra.drive_export_negocios.file_id`.
 *
 * Quién puede: exactamente lo mismo que la descarga a Excel — `puedeDescargarNegocios`
 * (owner / admin / supervisor), la misma función que gatea `POST /api/negocios/export` y
 * que decide si la lista pinta el botón. Ni más ni menos: son la misma información, en
 * el mismo formato, para la misma gente; lo único que cambia es dónde queda.
 *
 * El libro lo arma `construirExportNegocios`, la misma función que usa la descarga. No
 * hay una segunda vía de generación que pueda divergir.
 *
 * ⚠️ NOTA DE ARCHIVO: este módulo `'use server'` exporta solo funciones async. Exportar
 * una constante, o re-exportar un tipo importado (`export type { X } from …`), anula los
 * exports del módulo en el build de producción sin que `tsc` diga nada — ya tumbó el
 * detalle de negocio una vez (PR #452). Los tipos de abajo se DECLARAN aquí.
 */

import { getWorkspace } from '@/lib/actions/get-workspace'
import { puedeDescargarNegocios } from '@/lib/roles'
import { createServiceClient } from '@/lib/supabase/server'
import { construirExportNegocios } from '@/lib/negocios/construir-export-negocios'
import { leerIdsExport, MAX_IDS_EXPORT } from '@/lib/negocios/ids-export'
import {
  correosPendientes,
  decidirAccionArchivo,
  leerConfigExportDrive,
  nombreArchivoDrive,
} from '@/lib/negocios/export-drive'
import {
  compartirArchivoComoLector,
  crearHojaGoogleDesdeXlsx,
  listarPermisosArchivo,
  moverArchivoAPapelera,
  obtenerFichaArchivo,
  reemplazarHojaGoogleDesdeXlsx,
} from '@/lib/google-drive'

const PREFIJO = '[negocios-export-drive]'

/**
 * Las dos RPC del reclamo no están en `database.ts` porque ese archivo se genera desde
 * la base y la migración que las crea (`20260910120000`) todavía no está aplicada. Es
 * el mismo cast puntual que el repo ya usa para las vistas del dinero y para
 * `kyc_expediente_ref`; se quita cuando se regeneren los tipos.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (c: unknown): any => c

export type ResultadoSubidaDrive =
  | {
      ok: true
      /** Enlace a la hoja. Es lo que el usuario necesita ver. */
      url: string
      /** `true` si el archivo se creó en este clic; `false` si se actualizó. */
      creado: boolean
      /** Cuántas filas quedaron en la hoja. */
      filas: number
      /** A quiénes se les acaba de dar acceso en este clic. */
      compartidoCon: string[]
      /**
       * Advertencia legible cuando el archivo SÍ subió pero algo secundario falló
       * (típicamente un correo de la config que Drive rechazó). Nunca convierte una
       * subida buena en un error.
       */
      aviso?: string
    }
  | { ok: false; error: string }

/**
 * Sube el Excel de los negocios pedidos a Drive y devuelve el enlace.
 *
 * @param ids  ids de los negocios que la lista tiene a la vista, en su orden
 */
export async function subirExportNegociosADrive(ids: unknown): Promise<ResultadoSubidaDrive> {
  // ── 0. Puerta: idéntica a la de la descarga ──
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }
  if (!puedeDescargarNegocios(role)) return { ok: false, error: 'Sin permisos' }

  const idsLimpios = leerIdsExport({ ids })
  if (!idsLimpios) {
    return { ok: false, error: `Se esperaba entre 1 y ${MAX_IDS_EXPORT} negocios.` }
  }

  try {
    // ── 1. Config del workspace: carpeta destino, file_id y correos ──
    //
    // Con el cliente de SERVICIO: `config_extra` es server-only (ahí viven credenciales
    // de Siigo y de Drive) y no se expone al cliente autenticado. El `.eq('id', …)`
    // acota a este workspace, que es lo único que el service client no hace solo.
    const svc = createServiceClient()
    const { data: ws, error: wsErr } = await svc
      .from('workspaces')
      .select('name, slug, drive_folder_id, config_extra')
      .eq('id', workspaceId)
      .single()

    if (wsErr || !ws) {
      throw new Error(`workspace: ${wsErr?.message ?? 'no encontrado'}`)
    }

    const carpeta = (ws as { drive_folder_id: string | null }).drive_folder_id
    if (!carpeta) {
      return {
        ok: false,
        error:
          'Este espacio todavía no tiene carpeta de Google Drive configurada. ' +
          'Escríbele a MéTRIK para conectarla.',
      }
    }

    // El orden de la lista ES la precedencia. Hoy solo el workspace; el día que una
    // línea necesite su propio archivo, entra de primera y nada más cambia.
    const cfg = leerConfigExportDrive([
      (ws as { config_extra: Record<string, unknown> | null }).config_extra,
    ])

    // ── 2. ¿El archivo guardado todavía sirve? ──
    //
    // Se pregunta ANTES de escribir. Un `file_id` que apunta a un archivo borrado o en
    // la papelera devuelve 404 en el update PARA SIEMPRE: sin este paso el botón
    // quedaría roto de forma permanente y solo se arreglaría editando la config a mano.
    const ficha = cfg.fileId ? await obtenerFichaArchivo(cfg.fileId, workspaceId) : null
    const plan = decidirAccionArchivo(cfg.fileId, ficha)

    // ── 3. El libro. La MISMA función que la descarga ──
    const { buffer, filas } = await construirExportNegocios(supabase, workspaceId, idsLimpios)

    let fileId: string
    let url: string
    let creado = false

    if (plan.accion === 'actualizar') {
      const r = await reemplazarHojaGoogleDesdeXlsx(plan.fileId, buffer, workspaceId)
      fileId = r.fileId
      url = r.webViewLink
    } else {
      // El id roto se suelta comparando contra el que se leyó: si otra persona ya
      // reclamó uno sano en el medio, no se toca.
      if (plan.soltarFileId) {
        console.warn(
          `${PREFIJO} el archivo guardado ya no sirve (${plan.motivo}), se crea otro`,
        )
        await rpc(svc).rpc('soltar_export_negocios_file_id', {
          p_workspace_id: workspaceId,
          p_file_id: plan.soltarFileId,
        })
      }

      const nombre = nombreArchivoDrive((ws as { name: string | null }).name ?? '')
      const creadoEnDrive = await crearHojaGoogleDesdeXlsx(buffer, nombre, carpeta, workspaceId)

      // ── Aquí se cierra la carrera ──
      // El reclamo es un `update … where la clave sigue vacía`: gana exactamente uno.
      // Si el que gana no soy yo, mi archivo sobra y se va a la papelera; el enlace que
      // devuelvo es el del ganador, así que las dos personas terminan mirando el mismo
      // documento aunque hayan oprimido el botón en el mismo segundo.
      const { data: ganador, error: rpcErr } = await rpc(svc).rpc(
        'reclamar_export_negocios_file_id',
        { p_workspace_id: workspaceId, p_file_id: creadoEnDrive.fileId },
      )
      if (rpcErr) throw new Error(`reclamar file_id: ${rpcErr.message}`)

      if (typeof ganador === 'string' && ganador !== creadoEnDrive.fileId) {
        await moverArchivoAPapelera(creadoEnDrive.fileId, workspaceId).catch((e) =>
          console.error(`${PREFIJO} no se pudo enviar a papelera el archivo perdedor`, e),
        )
        const r = await reemplazarHojaGoogleDesdeXlsx(ganador, buffer, workspaceId)
        fileId = r.fileId
        url = r.webViewLink
      } else {
        fileId = creadoEnDrive.fileId
        url = creadoEnDrive.webViewLink
        creado = true
      }
    }

    // ── 4. Compartir. DESPUÉS de subir, y nunca al revés ──
    //
    // El archivo ya está y el usuario ya tiene su enlace: si compartir falla (un correo
    // mal escrito en la config, un dominio que Drive rechaza), sale como aviso, no como
    // error. Al revés, un carácter de más en `compartir_con` dejaría a todo el mundo sin
    // el dato.
    //
    // Lista vacía o ausente → no se comparte nada y no pasa nada. Es el estado de hoy:
    // encenderlo es escribir los correos en la config, no desplegar código.
    let compartidoCon: string[] = []
    let aviso: string | undefined
    if (cfg.correos.length > 0) {
      try {
        const yaTienen = await listarPermisosArchivo(fileId, workspaceId)
        const pendientes = correosPendientes(cfg.correos, yaTienen)
        for (const correo of pendientes) {
          await compartirArchivoComoLector(fileId, correo, workspaceId)
          compartidoCon.push(correo)
        }
      } catch (e) {
        console.error(`${PREFIJO} no se pudo compartir`, e)
        aviso =
          'El archivo se subió, pero no se pudo dar acceso a alguna de las personas ' +
          'configuradas. Revisa los correos en la configuración del espacio.'
        compartidoCon = []
      }
    }

    return { ok: true, url, creado, filas, compartidoCon, aviso }
  } catch (e) {
    console.error(`${PREFIJO} no se pudo publicar en Drive`, e)
    const detalle = e instanceof Error ? e.message : ''
    return {
      ok: false,
      error: detalle.startsWith('Error ')
        ? detalle
        : 'No se pudo subir el archivo a Drive. Inténtalo de nuevo.',
    }
  }
}
