/**
 * Catálogo de segmentos de consulta (R1).
 *
 * Tipos y helpers puros, compartidos entre server actions y cliente. Vive fuera
 * de los archivos `'use server'` porque esos solo pueden exportar funciones async.
 *
 * El `universo` de cada segmento es el mismo eje de la segmentación SARLAFT
 * (`src/lib/valida/segmentacion-presets.ts`): el segmento es la etiqueta operativa
 * que el cliente configura, el universo es el eje estable del que cuelga.
 */

import type { UniversoSegmentacion } from '@/lib/valida/segmentacion-presets';

export type { UniversoSegmentacion };

export type ComplianceSegmento = {
  id: string;
  nombre: string;
  universo: UniversoSegmentacion;
  activo: boolean;
  orden: number;
};

/**
 * Quién configura el catálogo: el oficial de cumplimiento.
 *
 * Misma regla que el resto de la configuración de compliance en este módulo
 * (solo owner/admin editan riesgos, causas y controles). Los operadores eligen
 * segmento al consultar y ven el historial, pero no tocan el catálogo.
 */
export const ROLES_OFICIAL_CUMPLIMIENTO: readonly string[] = ['owner', 'admin'];

export function puedeConfigurarSegmentos(role: string | null | undefined): boolean {
  return !!role && ROLES_OFICIAL_CUMPLIMIENTO.includes(role);
}

export const SEGMENTO_NOMBRE_MAX = 80;

/**
 * Clave de comparación de nombres: sin tildes, sin mayúsculas, sin espacios
 * dobles. Es lo que permite que la columna del Excel diga "empleado", "Empleado"
 * o "EMPLEADO " y resuelva contra el mismo segmento del catálogo.
 *
 * OJO: la unicidad en base de datos es sobre el nombre literal, no sobre esta
 * clave. `crearSegmento` compara con esta clave antes de insertar para que no
 * convivan "Empleado" y "empleados " y la resolución del Excel se vuelva
 * ambigua en silencio.
 */
export function claveSegmento(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Etiqueta de un segmento que ya no está en el catálogo activo. */
export const SEGMENTO_SIN_ASIGNAR = 'Sin segmento';

/** Valor centinela del filtro de historial para "consultas sin segmento". */
export const FILTRO_SIN_SEGMENTO = 'sin_segmento';

/**
 * Cómo se muestra el segmento de una consulta en pantalla.
 *
 * Distingue tres estados que NO son lo mismo y que antes se habrían visto igual:
 * - con segmento vigente → el nombre
 * - sin segmento (consulta anterior al catálogo) → "Sin segmento"
 * - con segmento_id que ya no resuelve → lo dice, en vez de mentir con un guion
 */
export function etiquetaSegmento(
  segmentoId: string | null,
  segmentoNombre: string | null,
): { texto: string; huerfano: boolean } {
  if (!segmentoId) return { texto: SEGMENTO_SIN_ASIGNAR, huerfano: false };
  if (!segmentoNombre) return { texto: 'Segmento no encontrado', huerfano: true };
  return { texto: segmentoNombre, huerfano: false };
}
