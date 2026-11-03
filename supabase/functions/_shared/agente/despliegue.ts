// ============================================================
// Con qué código atendió un turno (encargo 2026-10-30, versiones con banco)
// ------------------------------------------------------------
// La traza ya guarda la versión del reglamento (`reglamento: { id, version, huella }`). Lo que faltaba es el código: en
// `wa_one` el reglamento vive en el código y cambia con cada merge a `main`. Supabase pone en cada función desplegada
// `DENO_DEPLOYMENT_ID` = `{project_ref}_{function_id}_{version}` (doc oficial «Environment variables», leída el
// 2026-10-30): la versión del despliegue, que el historial de despliegues de la función cruza con su commit. Fuera de
// Supabase (pruebas, arnés) no existe y la traza va sin él.
// ============================================================

/** La versión del despliegue de esta función, o `null` fuera de Supabase. */
export function despliegue(): string | null {
  try {
    const d = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
    return d?.env.get('DENO_DEPLOYMENT_ID') || null;
  } catch {
    return null; // sin permiso de entorno
  }
}

/** La traza con el despliegue que la produjo; igual si no hay despliegue que poner. */
export function conDespliegue<T extends object>(traza: T): T & { despliegue?: string } {
  const d = despliegue();
  return d ? { ...traza, despliegue: d } : traza;
}
