/**
 * Normalización de nombres de ubicación (país / departamento / municipio).
 *
 * Vive en su propio módulo porque la consumen DOS cosas que no pueden depender
 * una de otra: `divipola.ts` (que importa el catálogo generado) y el generador
 * `scripts/generar-divipola.ts` (que escribe ese catálogo). Si la normalización
 * viviera en `divipola.ts`, el generador importaría el archivo que todavía no ha
 * escrito.
 *
 * La MISMA función normaliza las claves del catálogo y el nombre que llega del
 * RUT. Si se separaran, un cambio en una lado dejaría de encontrar municipios sin
 * ningún error visible.
 */
export function normalizeNombreUbicacion(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tildes y dieresis; la ñ queda en n
    .toLowerCase()
    .replace(/\bd\.?\s*c\.?\b/g, '') // "Bogotá D.C." -> "bogota"
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
