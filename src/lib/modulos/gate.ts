/**
 * Gate por ruta: una pantalla de un módulo apagado no abre.
 *
 * Hasta esta entrega el módulo se gateaba solo en el menú (`app-shell.tsx`). `/negocios`
 * no miraba `modules`, así que un workspace con un solo módulo (un CDA con Valida) podía
 * teclear la URL y abrir pantallas y acciones de Clarity sobre sus propios datos. RLS impide
 * ver otro workspace; esto cierra lo que RLS no ve.
 *
 * ## Dónde se hace cumplir, y por qué NO en el layout
 *
 * En el middleware (`src/middleware.ts`), no en `src/app/(app)/layout.tsx` como decía la
 * spec. En una navegación con `<Link>` Next solo renderiza los segmentos que cambian: el
 * layout compartido NO vuelve a correr. Medido el 2026-09-15 con Next 16.1.6 en una app
 * mínima: de `/a` a `/b` por `<Link>` el layout siguió pintando la ruta vieja y no se
 * ejecutó; el middleware sí corrió en cada navegación y su redirect llevó a la ruta
 * permitida sin renderizar la página bloqueada. Un gate en el layout solo habría cerrado la
 * URL tecleada, no el enlace de una notificación o del buscador.
 *
 * Funciones puras, sin imports de servidor: las usan el middleware (edge) y el AppShell.
 */

import { landingForWorkspace } from '@/lib/auth/landing'
import {
  IDS_MODULO,
  MODULOS,
  RUTAS_COMUNES,
  RUTAS_POR_FUNCION,
  RUTAS_VITRINA,
  type IdModulo,
} from './catalogo'

export interface ContextoGate {
  /** `workspaces.modules` tal como viene de la base (el AppShell lo tipa con llaves opcionales). */
  modules: Record<string, boolean | undefined> | null | undefined
  /** `workspaces.config_extra.modo_vitrina === true`. */
  modoVitrina: boolean
  /**
   * El soporte de MeTRIK pasa el gate, pero SOLO en su propio espacio: se arma con
   * `soportePasaGate`, nunca con `profiles.platform_admin` a secas.
   */
  platformAdmin: boolean
  /** Rol del perfil. Solo importa para el aterrizaje y para el contador. */
  role?: string | null
}

/**
 * ¿La persona de la sesión es soporte de MeTRIK que pasa el gate por módulo?
 *
 * Solo cuando está en su propio espacio. Visitando el de un cliente (`workspace_id` distinto de
 * `home_workspace_id`, el mismo criterio de `isAway` en `getPlatformAdminState`) ve y abre lo que
 * ese cliente tiene contratado, ni más ni menos.
 *
 * Por qué: hasta el 2026-09-16 el platform admin pasaba siempre, y en `4d-soft` (solo Valida API)
 * el menú le ofrecía Directorio y Tableros, que son de Clarity, Sustenta y Llamadas. Juan
 * Guillermo no las veía; Mauricio sí, y revisaba un menú que el cliente no tiene. En su propio
 * espacio (metrik) conserva el paso: ahí usa herramientas que metrik no tiene como módulo (la
 * Validación de Sustenta), y cortarlas no lo pidió nadie.
 *
 * Un `home_workspace_id` nulo cuenta como «en casa», igual que `isAway`.
 */
export function soportePasaGate(perfil: {
  platformAdmin: boolean | null | undefined
  workspaceId: string | null | undefined
  homeWorkspaceId: string | null | undefined
}): boolean {
  if (perfil.platformAdmin !== true) return false
  const visitante = perfil.homeWorkspaceId != null && perfil.workspaceId !== perfil.homeWorkspaceId
  return !visitante
}

/** `/negocios` cubre `/negocios` y `/negocios/...`, pero no `/negocios-x`. */
function coincide(pathname: string, prefijo: string): boolean {
  return pathname === prefijo || pathname.startsWith(`${prefijo}/`)
}

/**
 * Mismo default que el layout, el AppShell y el aterrizaje: un workspace sin `modules`
 * es Clarity. Separarse de ese default aquí apagaría a quien hoy entra.
 */
function modulesEfectivos(modules: ContextoGate['modules']): Record<string, boolean | undefined> {
  return modules ?? { business: true }
}

/** Los módulos a los que pertenece la ruta, en el orden del catálogo. */
export function modulosDeRuta(pathname: string): IdModulo[] {
  return IDS_MODULO.filter((id) => MODULOS[id].rutas.some((r) => coincide(pathname, r)))
}

export function esRutaComun(pathname: string): boolean {
  return RUTAS_COMUNES.some((r) => coincide(pathname, r))
}

/**
 * ¿La ruta está sujeta al gate? Solo las que pertenecen a algún módulo y no son comunes.
 * Todo lo demás (`/api`, `/auth`, `/login`, rutas públicas) pasa sin consultar la base.
 */
export function rutaGateada(pathname: string): boolean {
  return !esRutaComun(pathname) && modulosDeRuta(pathname).length > 0
}

export function moduloActivo(id: IdModulo, modules: ContextoGate['modules']): boolean {
  return modulesEfectivos(modules)[MODULOS[id].clave] === true
}

/**
 * ¿El espacio usa ONE solo con Valida? Se razona por MÓDULO encendido (las llaves de función no
 * cuentan): un CDA tiene `valida_consulta` y nada más.
 */
export function soloValida(modules: ContextoGate['modules']): boolean {
  const m = modulesEfectivos(modules)
  const encendidos = IDS_MODULO.filter((id) => m[MODULOS[id].clave] === true)
  return encendidos.length === 1 && encendidos[0] === 'valida'
}

/**
 * Las vitrinas que abre `modo_vitrina` en ESTE espacio. «Números» sale de un espacio que usa ONE
 * solo con Valida (decisión del 2026-09-23, sección Suscripción de los CDA): mostraba cifras de un
 * negocio que el CDA no lleva en ONE. Tableros se queda.
 */
export function vitrinasDelEspacio(modules: ContextoGate['modules']): readonly string[] {
  return soloValida(modules) ? RUTAS_VITRINA.filter((r) => r !== '/numeros') : RUTAS_VITRINA
}

export function rutaPermitida(pathname: string, ctx: ContextoGate): boolean {
  if (!rutaGateada(pathname)) return true
  if (ctx.platformAdmin) return true

  const modules = modulesEfectivos(ctx.modules)
  if (modulosDeRuta(pathname).some((id) => moduloActivo(id, modules))) return true
  if (RUTAS_POR_FUNCION.some((f) => coincide(pathname, f.ruta) && modules[f.funcion] === true)) return true
  if (ctx.modoVitrina && vitrinasDelEspacio(modules).some((r) => coincide(pathname, r))) return true
  return false
}

/**
 * A dónde mandar a quien pidió una ruta bloqueada, o `null` si la ruta se permite.
 *
 * El destino es el aterrizaje de siempre (`landingForWorkspace`, el mismo de `/` y del
 * login), que ya sabe llevar a cada rol a su pantalla. Si ese aterrizaje también estuviera
 * bloqueado (una combinación de llaves que hoy no existe en ningún workspace), cae al
 * inicio del primer módulo encendido y, sin ninguno, a `/mi-negocio`, que es común. El
 * destino nunca es otra ruta bloqueada: el gate no se redirige a sí mismo en bucle.
 */
export function destinoSiBloqueada(pathname: string, ctx: ContextoGate): string | null {
  // El contador ya está confinado a `/revision` por su propio guard del middleware. Si el
  // gate además lo sacara de ahí, los dos se lo pasarían de uno a otro para siempre.
  if (ctx.role === 'contador') return null
  if (rutaPermitida(pathname, ctx)) return null

  // El aterrizaje solo mira si cada llave es verdadera: una llave `undefined` vale lo mismo que ausente.
  const aterrizaje = landingForWorkspace(
    ctx.role ?? undefined,
    ctx.modules as Record<string, boolean> | null | undefined,
    ctx.modoVitrina,
  )
  if (rutaPermitida(aterrizaje, ctx) && !coincide(pathname, aterrizaje)) return aterrizaje

  const primero = IDS_MODULO.find(
    (id) => moduloActivo(id, ctx.modules) && rutaPermitida(MODULOS[id].inicio, ctx),
  )
  return primero ? MODULOS[primero].inicio : '/mi-negocio'
}
