/**
 * La lectura del perfil que usa el middleware para sus tres guards: el del contador (solo
 * `/revision`), el gate por módulo (`gate.ts`) y el de pestaña desincronizada
 * (`tenant/desincronizacion.ts`). Una sola ida a la base por petición, igual que antes de
 * esta entrega: el guard del contador ya leía `profiles` en cada navegación del tenant, y esa
 * misma consulta trae embebidos los módulos del workspace y su slug.
 *
 * Edge-safe: sin `server-only` ni imports de Next.
 */

import { soportePasaGate, type ContextoGate } from './gate'

/**
 * El `!profiles_workspace_id_fkey` no es decorativo: `profiles` tiene DOS llaves hacia
 * `workspaces` (`workspace_id` y `home_workspace_id`, la del platform admin), y sin el hint
 * PostgREST responde 300 por ambigüedad. Verificado el 2026-09-15 contra el PostgREST de
 * producción con esta cadena literal: devuelve `workspace.modules` y
 * `workspace.modo_vitrina`, que es `true` o `null`. `workspace_id` y `home_workspace_id` se
 * agregaron el 2026-09-16 (el soporte de MeTRIK solo pasa el gate en su propio espacio) y la
 * cadena se volvió a verificar igual. El `slug` entró el 2026-09-19 para el guard de pestaña
 * desincronizada: es una columna más del MISMO embed, no una consulta nueva.
 */
export const SELECT_PERFIL_CON_MODULOS =
  'role, platform_admin, workspace_id, home_workspace_id, workspace:workspaces!profiles_workspace_id_fkey(slug, modules, modo_vitrina:config_extra->modo_vitrina)'

/**
 * Lo mínimo: el rol (guard del contador) y el slug del workspace de la sesión (guard de
 * pestaña desincronizada). El `slug` NO cuesta una consulta nueva: es una columna más del
 * embed que ya viajaba, resuelto por PostgREST en el mismo viaje.
 */
export const SELECT_PERFIL_BASE = 'role, workspace:workspaces!profiles_workspace_id_fkey(slug)'

interface RespuestaPerfil {
  data: unknown
  error: { message: string } | null
}

/** Lo único que esto necesita del cliente de Supabase del middleware. */
export interface ClientePerfil {
  from(tabla: 'profiles'): {
    select(columnas: string): {
      eq(columna: 'id', valor: string): { single(): PromiseLike<RespuestaPerfil> }
    }
  }
}

export interface PerfilDeAcceso {
  role: string | null
  /**
   * Slug del workspace que tiene la SESIÓN (`profiles.workspace_id`). `null` si la lectura
   * falló: sin él el guard de desincronización no afirma nada (ver `desincronizacion.ts`).
   */
  slugWorkspace: string | null
  /** `null` cuando no se pidieron módulos o la lectura falló: el gate no se aplica. */
  gate: ContextoGate | null
}

interface FilaPerfil {
  role?: string | null
  platform_admin?: boolean | null
  workspace_id?: string | null
  home_workspace_id?: string | null
  workspace?: {
    slug?: string | null
    modules?: Record<string, boolean> | null
    modo_vitrina?: unknown
  } | null
}

export async function leerPerfilDeAcceso(
  supabase: ClientePerfil,
  userId: string,
  conModulos: boolean,
): Promise<PerfilDeAcceso> {
  const { data, error } = await supabase
    .from('profiles')
    .select(conModulos ? SELECT_PERFIL_CON_MODULOS : SELECT_PERFIL_BASE)
    .eq('id', userId)
    .single()

  if (error || !data) {
    // Si la lectura falla, la ruta pasa sin gate de módulo y se dice en el log. No es la
    // frontera de aislamiento (esa es RLS, que sigue ahí), y cerrar por error dejaría a todo
    // el producto rebotando al aterrizaje por un corte de red. Lo que no puede pasar es que
    // falle en silencio: un hint mal escrito dejaría el gate apagado para siempre sin que
    // nadie lo notara, y por eso se registra.
    if (conModulos) {
      console.error('[gate-modulos] no se pudo leer el perfil; la ruta pasa sin gate de módulo:', error?.message ?? 'sin fila')
    }
    return { role: null, slugWorkspace: null, gate: null }
  }

  const fila = data as FilaPerfil
  const role = fila.role ?? null
  const slugWorkspace = fila.workspace?.slug ?? null
  if (!conModulos) return { role, slugWorkspace, gate: null }

  return {
    role,
    slugWorkspace,
    gate: {
      role,
      platformAdmin: soportePasaGate({
        platformAdmin: fila.platform_admin,
        workspaceId: fila.workspace_id,
        homeWorkspaceId: fila.home_workspace_id,
      }),
      modules: fila.workspace?.modules ?? null,
      modoVitrina: fila.workspace?.modo_vitrina === true,
    },
  }
}
