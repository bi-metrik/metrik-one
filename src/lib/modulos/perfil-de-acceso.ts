/**
 * La lectura del perfil que usa el middleware para sus dos guards: el del contador (solo
 * `/revision`) y el gate por módulo (`gate.ts`). Una sola ida a la base por petición, igual
 * que antes de esta entrega: el guard del contador ya leía `profiles` en cada navegación del
 * tenant, y ahora esa misma consulta trae además los módulos del workspace embebidos.
 *
 * Edge-safe: sin `server-only` ni imports de Next.
 */

import type { ContextoGate } from './gate'

/**
 * El `!profiles_workspace_id_fkey` no es decorativo: `profiles` tiene DOS llaves hacia
 * `workspaces` (`workspace_id` y `home_workspace_id`, la del platform admin), y sin el hint
 * PostgREST responde 300 por ambigüedad. Verificado el 2026-09-15 contra el PostgREST de
 * producción con esta cadena literal: devuelve `workspace.modules` y
 * `workspace.modo_vitrina`, que es `true` o `null`.
 */
export const SELECT_PERFIL_CON_MODULOS =
  'role, platform_admin, workspace:workspaces!profiles_workspace_id_fkey(modules, modo_vitrina:config_extra->modo_vitrina)'

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
  /** `null` cuando no se pidieron módulos o la lectura falló: el gate no se aplica. */
  gate: ContextoGate | null
}

interface FilaPerfil {
  role?: string | null
  platform_admin?: boolean | null
  workspace?: { modules?: Record<string, boolean> | null; modo_vitrina?: unknown } | null
}

export async function leerPerfilDeAcceso(
  supabase: ClientePerfil,
  userId: string,
  conModulos: boolean,
): Promise<PerfilDeAcceso> {
  const { data, error } = await supabase
    .from('profiles')
    .select(conModulos ? SELECT_PERFIL_CON_MODULOS : 'role')
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
    return { role: null, gate: null }
  }

  const fila = data as FilaPerfil
  const role = fila.role ?? null
  if (!conModulos) return { role, gate: null }

  return {
    role,
    gate: {
      role,
      platformAdmin: fila.platform_admin === true,
      modules: fila.workspace?.modules ?? null,
      modoVitrina: fila.workspace?.modo_vitrina === true,
    },
  }
}
