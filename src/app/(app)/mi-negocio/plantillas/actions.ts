'use server'

/**
 * Acciones de «Plantillas de documentos» (Configuración). Toda acción, también las de
 * lectura, exige que la persona esté en `plantillas_documento_editores` del workspace: la
 * lista es explícita, no un rol. El RLS de las tablas vuelve a exigirlo al escribir.
 *
 * Guardar crea una versión NUEVA (nunca sobreescribe). Activar apunta la fila única de
 * `plantillas_documento_activas` a una versión ya validada. Restaurar = versión nueva igual
 * a la elegida + activarla.
 */
import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { defDe, esTipoPlantilla, type Datos, type TipoPlantilla } from '@/lib/plantillas-documento/catalogo'
import { validarPlantilla, resumenErrores } from '@/lib/plantillas-documento/validar'
import { esEditorDePlantillas, type VersionPlantilla } from '@/lib/plantillas-documento/servidor'
import { buscarNegociosConDocumento, datosDelNegocio, type NegocioParaVista } from '@/lib/plantillas-documento/datos-negocio'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

const SESION = 'Sesión no válida. Recarga la página.'
const FUERA_DE_LA_LISTA = 'No estás en la lista de personas que editan las plantillas de este espacio.'

type Fallo = { ok: false; error: string }

interface Actor {
  supabase: unknown
  workspaceId: string
  userId: string
}

async function actor(): Promise<{ ok: true; actor: Actor } | Fallo> {
  const { supabase, workspaceId, impersonating } = await getWorkspace()
  const { user } = await getCachedUser()
  if (!workspaceId || !user) return { ok: false, error: SESION }
  // «Ver como» no edita: el permiso es de la persona real, y el RLS mira a la persona real.
  if (impersonating) return { ok: false, error: 'En «Ver como» no se editan plantillas.' }
  if (!(await esEditorDePlantillas(supabase, workspaceId, user.id))) return { ok: false, error: FUERA_DE_LA_LISTA }
  return { ok: true, actor: { supabase, workspaceId, userId: user.id } }
}

function tipoValido(tipo: unknown): tipo is TipoPlantilla {
  return esTipoPlantilla(tipo)
}

export interface PantallaPlantilla {
  tipo: TipoPlantilla
  versiones: VersionPlantilla[]
  activaId: string | null
  activadaAt: string | null
  editores: string[]
}

/** Historial, activa y quién edita. */
export async function leerPlantilla(tipo: string): Promise<{ ok: true; pantalla: PantallaPlantilla } | Fallo> {
  if (!tipoValido(tipo)) return { ok: false, error: 'Documento desconocido.' }
  const a = await actor()
  if (!a.ok) return a
  const { supabase, workspaceId } = a.actor
  const [versiones, activa, editores] = await Promise.all([
    db(supabase)
      .from('plantillas_documento_versiones')
      .select('id, tipo, version_n, contenido, nota, creada_por, creada_por_nombre, restaurada_de, created_at')
      .eq('workspace_id', workspaceId)
      .eq('tipo', tipo)
      .order('version_n', { ascending: false })
      .limit(100),
    db(supabase)
      .from('plantillas_documento_activas')
      .select('version_id, activada_at')
      .eq('workspace_id', workspaceId)
      .eq('tipo', tipo)
      .maybeSingle(),
    db(supabase)
      .from('plantillas_documento_editores')
      .select('user_id, profiles(full_name)')
      .eq('workspace_id', workspaceId),
  ])
  if (versiones.error) return { ok: false, error: 'No se pudo leer el historial. Intenta de nuevo.' }
  return {
    ok: true,
    pantalla: {
      tipo,
      versiones: (versiones.data ?? []) as VersionPlantilla[],
      activaId: (activa.data?.version_id as string | undefined) ?? null,
      activadaAt: (activa.data?.activada_at as string | undefined) ?? null,
      editores: ((editores.data ?? []) as Array<{ profiles: { full_name: string | null } | null }>)
        .map((e) => e.profiles?.full_name ?? 'Sin nombre')
        .sort((x, y) => x.localeCompare(y, 'es')),
    },
  }
}

async function nombreDe(supabase: unknown, userId: string): Promise<string | null> {
  const { data } = await db(supabase).from('profiles').select('full_name').eq('id', userId).maybeSingle()
  return (data?.full_name as string | null) ?? null
}

/** Inserta una versión nueva con el número siguiente (un reintento si dos guardan a la vez). */
async function insertarVersion(
  a: Actor,
  tipo: TipoPlantilla,
  contenido: string,
  nota: string | null,
  restauradaDe: string | null,
): Promise<{ ok: true; version: VersionPlantilla } | Fallo> {
  const nombre = await nombreDe(a.supabase, a.userId)
  for (let intento = 0; intento < 2; intento++) {
    const { data: ultima } = await db(a.supabase)
      .from('plantillas_documento_versiones')
      .select('version_n')
      .eq('workspace_id', a.workspaceId)
      .eq('tipo', tipo)
      .order('version_n', { ascending: false })
      .limit(1)
      .maybeSingle()
    const n = ((ultima?.version_n as number | undefined) ?? 0) + 1
    const { data, error } = await db(a.supabase)
      .from('plantillas_documento_versiones')
      .insert({
        workspace_id: a.workspaceId,
        tipo,
        version_n: n,
        contenido,
        nota,
        creada_por: a.userId,
        creada_por_nombre: nombre,
        restaurada_de: restauradaDe,
      })
      .select('id, tipo, version_n, contenido, nota, creada_por, creada_por_nombre, restaurada_de, created_at')
      .single()
    if (!error && data) return { ok: true, version: data as VersionPlantilla }
    if (error?.code !== '23505') {
      console.error('[plantillas] insertar versión:', error)
      return { ok: false, error: 'No se pudo guardar la versión. Intenta de nuevo.' }
    }
  }
  return { ok: false, error: 'Otra persona guardó al mismo tiempo. Vuelve a guardar.' }
}

async function apuntarActiva(a: Actor, tipo: TipoPlantilla, versionId: string): Promise<{ ok: true } | Fallo> {
  const { error } = await db(a.supabase)
    .from('plantillas_documento_activas')
    .upsert(
      { workspace_id: a.workspaceId, tipo, version_id: versionId, activada_por: a.userId, activada_at: new Date().toISOString() },
      { onConflict: 'workspace_id,tipo' },
    )
  if (error) {
    console.error('[plantillas] activar:', error)
    return { ok: false, error: 'No se pudo activar. Intenta de nuevo.' }
  }
  return { ok: true }
}

export type ResultadoGuardar =
  | { ok: true; version: VersionPlantilla; faltantes: string[] }
  | Fallo

/**
 * Guarda el texto como versión nueva (borrador: NO la activa). Rechaza estructura rota y
 * variables o bloques que no están en el catálogo. Los requisitos mínimos que falten se
 * devuelven como aviso: se puede guardar, no activar.
 */
export async function guardarVersionPlantilla(tipo: string, contenido: string, nota?: string | null): Promise<ResultadoGuardar> {
  if (!tipoValido(tipo)) return { ok: false, error: 'Documento desconocido.' }
  if (typeof contenido !== 'string' || !contenido.trim()) return { ok: false, error: 'La plantilla está vacía.' }
  const a = await actor()
  if (!a.ok) return a
  const v = validarPlantilla(tipo, contenido)
  if (v.errores.length > 0) return { ok: false, error: resumenErrores(v.errores) }
  const notaLimpia = nota?.trim().slice(0, 300) || null
  const r = await insertarVersion(a.actor, tipo, contenido, notaLimpia, null)
  if (!r.ok) return r
  revalidatePath('/mi-negocio/plantillas')
  return { ok: true, version: r.version, faltantes: v.faltantes }
}

async function leerVersion(a: Actor, versionId: string): Promise<VersionPlantilla | null> {
  if (typeof versionId !== 'string' || !versionId) return null
  const { data } = await db(a.supabase)
    .from('plantillas_documento_versiones')
    .select('id, tipo, version_n, contenido, nota, creada_por, creada_por_nombre, restaurada_de, created_at')
    .eq('id', versionId)
    .eq('workspace_id', a.workspaceId)
    .maybeSingle()
  return (data as VersionPlantilla | null) ?? null
}

/** Validación completa para activar: sin errores y con todos los requisitos mínimos. */
function bloqueoDeActivacion(tipo: TipoPlantilla, contenido: string): string | null {
  const v = validarPlantilla(tipo, contenido)
  if (v.errores.length > 0) return `La versión tiene errores:\n${resumenErrores(v.errores)}`
  if (v.faltantes.length > 0) {
    return `No se puede activar: a ${defDe(tipo).nombre.toLowerCase()} le falta ${v.faltantes.join(', ')}.`
  }
  return null
}

export async function activarVersionPlantilla(versionId: string): Promise<{ ok: true } | Fallo> {
  const a = await actor()
  if (!a.ok) return a
  const version = await leerVersion(a.actor, versionId)
  if (!version || !tipoValido(version.tipo)) return { ok: false, error: 'No se encontró esa versión.' }
  const bloqueo = bloqueoDeActivacion(version.tipo, version.contenido)
  if (bloqueo) return { ok: false, error: bloqueo }
  const r = await apuntarActiva(a.actor, version.tipo, version.id)
  if (r.ok) revalidatePath('/mi-negocio/plantillas')
  return r
}

/** Crea una versión nueva igual a la elegida y la activa. */
export async function restaurarVersionPlantilla(versionId: string): Promise<{ ok: true; version: VersionPlantilla } | Fallo> {
  const a = await actor()
  if (!a.ok) return a
  const origen = await leerVersion(a.actor, versionId)
  if (!origen || !tipoValido(origen.tipo)) return { ok: false, error: 'No se encontró esa versión.' }
  const bloqueo = bloqueoDeActivacion(origen.tipo, origen.contenido)
  if (bloqueo) return { ok: false, error: bloqueo }
  const nueva = await insertarVersion(a.actor, origen.tipo, origen.contenido, `Restaurada de la versión ${origen.version_n}`, origen.id)
  if (!nueva.ok) return nueva
  const r = await apuntarActiva(a.actor, origen.tipo, nueva.version.id)
  if (!r.ok) return r
  revalidatePath('/mi-negocio/plantillas')
  return { ok: true, version: nueva.version }
}

export async function buscarNegociosParaVista(tipo: string, texto: string): Promise<{ ok: true; negocios: NegocioParaVista[] } | Fallo> {
  if (!tipoValido(tipo)) return { ok: false, error: 'Documento desconocido.' }
  const a = await actor()
  if (!a.ok) return a
  return { ok: true, negocios: await buscarNegociosConDocumento(a.actor.supabase, a.actor.workspaceId, tipo, String(texto ?? '').slice(0, 60)) }
}

/** Datos de un negocio para la vista previa en vivo. Solo lectura. */
export async function datosParaVistaPrevia(
  tipo: string,
  negocioId: string,
): Promise<{ ok: true; datos: Datos; faltantes: string[]; codigo: string } | Fallo> {
  if (!tipoValido(tipo)) return { ok: false, error: 'Documento desconocido.' }
  const a = await actor()
  if (!a.ok) return a
  return datosDelNegocio(a.actor.supabase, a.actor.workspaceId, negocioId, tipo)
}
