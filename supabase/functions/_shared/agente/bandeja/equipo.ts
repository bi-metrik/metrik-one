// ============================================================
// Núcleo conversacional — quién puede llevar un viaje (bandeja de Trappvel, 2026-10-16)
// ------------------------------------------------------------
// Puro: lo usa `puertoBandejaSupabase` (produccion.ts) con las filas de `staff` y la config del workspace.
// ============================================================

import type { MiembroEquipo } from './dominio.ts';

/**
 * El equipo que puede llevar un viaje, desde las filas leídas: staff activo con área comercial, sin el staff de prueba
 * (`config_extra.staff_de_prueba`, ids) salvo que quien escribe sea de prueba (así una cuenta de prueba puede probar el
 * flujo en el workspace real sin aparecerle a las comerciales). Ordenado por nombre. Pura.
 */
export function equipoDesdeFilas(
  filas: ReadonlyArray<{ id: string; full_name: string | null; is_active: boolean | null; areas: string[] }>,
  dePrueba: ReadonlyArray<string>,
  quienEscribe: string | null,
): MiembroEquipo[] {
  const prueba = new Set(dePrueba);
  const escribePrueba = !!quienEscribe && prueba.has(quienEscribe);
  return filas
    .filter((f) => f.is_active === true && f.areas.includes('comercial') && (escribePrueba || !prueba.has(f.id)))
    .map((f) => ({ id: f.id, nombre: String(f.full_name ?? '').trim() || 'Sin nombre', esQuienEscribe: f.id === quienEscribe }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** `config_extra.staff_de_prueba`: los ids del staff de prueba del workspace. Cualquier otra forma, ninguno. Pura. */
export function staffDePrueba(configExtra: unknown): string[] {
  const v = (configExtra as { staff_de_prueba?: unknown } | null)?.staff_de_prueba;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}
