/**
 * Fuente unica de verdad para el landing post-login.
 *
 * Antes la logica estaba duplicada en middleware, callback de auth y accept-invite,
 * y habia drift: el middleware mandaba compliance -> /riesgos, el callback mandaba
 * los roles no-numbers a /pipeline (ruta legacy eliminada -> 404). Centralizar evita
 * que vuelva a divergir.
 *
 * Funcion pura (sin imports de node/supabase) -> segura para edge runtime (middleware).
 */
export function landingForWorkspace(
  role: string | undefined,
  modules: Record<string, boolean> | null | undefined,
): string {
  if (role === 'contador') return '/revision';

  const mods = modules ?? { business: true };

  // Workspace sin modulo business (ej. ALMA, compliance-only)
  if (!mods.business) {
    // ALMA y similares con consulta de listas (flag dual) -> Listas Restrictivas
    if (mods.compliance_dual_informa) return '/compliance/listas';
    if (mods.compliance) return '/riesgos';
    return '/mi-negocio';
  }

  const ROLES_WITH_NUMBERS = ['owner', 'admin', 'supervisor', 'read_only'];
  if (role && ROLES_WITH_NUMBERS.includes(role)) return '/numeros';
  // Negocios es el modulo principal (pipeline es legacy)
  return '/negocios';
}
