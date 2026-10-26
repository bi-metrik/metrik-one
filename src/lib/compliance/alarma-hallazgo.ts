/**
 * La alarma de hallazgo del oficial de cumplimiento: reglas puras.
 *
 * Qué resuelve (diagnóstico Noor + Lucía 2026-10-20, P1 aprobado por Mauricio,
 * `proyectos/afi/alma/docs/entrada/2026-10-20_alarmas-oficial-diagnostico-to-be.md`):
 *
 *   - Hasta aquí solo el barrido avisaba. Una consulta manual o masiva con
 *     hallazgo no le llegaba a nadie: en ALMA, 15 hallazgos sin decidir y cero
 *     notificaciones en la historia del workspace. La oficial se enteraba solo
 *     si entraba a Liberaciones.
 *   - La campana se apagaba al hacer clic. La alarma quedaba atada a la
 *     LECTURA, no a la DECISIÓN: abrirla equivalía a "resuelto".
 *
 * El modelo: una alarma por contraparte, identificada por `grupo_clave`
 * (mecanismo de notificaciones de equipo, migr. 20260727000004). Tres consultas
 * al mismo proveedor son un solo caso. La alarma solo se cierra cuando el
 * oficial registra una decisión sobre esa contraparte.
 *
 * Vive fuera de `'use server'` porque la campana (cliente) también la necesita.
 */

import { claveContraparte } from './liberaciones';

export const TIPO_ALARMA_HALLAZGO = 'compliance_hallazgo';

export const PREFIJO_ALARMA_HALLAZGO = 'compliance_hallazgo:';

/** La identidad de la alarma: la de la contraparte. null si no hay documento. */
export function grupoClaveHallazgo(
  documentoTipo: string | null | undefined,
  documentoNumero: string | null | undefined,
): string | null {
  const clave = claveContraparte(documentoTipo, documentoNumero);
  return clave ? `${PREFIJO_ALARMA_HALLAZGO}${clave}` : null;
}

/**
 * ¿Esta notificación se cierra solo decidiendo?
 *
 * Se decide por la clave y no por el `tipo`: los avisos del barrido
 * (`compliance_delta_contraparte`) también llevan esta clave y también se
 * cierran decidiendo. Un hallazgo consultado solo por nombre no tiene clave
 * (no hay sobre qué decidir en la bandeja) y se comporta como un aviso normal.
 */
export function seCierraDecidiendo(grupoClave: string | null | undefined): boolean {
  return typeof grupoClave === 'string' && grupoClave.startsWith(PREFIJO_ALARMA_HALLAZGO);
}

export const RUTA_LIBERACIONES = '/compliance/liberaciones';

/** El enlace que abre la ficha de ESA contraparte, no la bandeja entera. */
export function enlaceContraparte(clave: string | null | undefined): string {
  return clave ? `${RUTA_LIBERACIONES}?c=${encodeURIComponent(clave)}` : RUTA_LIBERACIONES;
}

/** El texto de la campana y de cada renglón del correo. */
export function contenidoAlarmaHallazgo(input: {
  nombre: string | null | undefined;
  documentoTipo: string | null | undefined;
  documentoNumero: string | null | undefined;
  totalMatches: number;
  /** Rótulo de triage de la coincidencia más exigente (ver `rotuloTriage`). */
  rotulo: string | null;
}): string {
  const doc = input.documentoNumero
    ? `${input.documentoTipo ?? ''} ${input.documentoNumero}`.trim()
    : null;
  const quien = input.nombre?.trim() || doc || 'Una contraparte';
  const n = input.totalMatches;
  const coincidencias = n === 1 ? '1 coincidencia' : `${n} coincidencias`;
  const tipo = input.rotulo ? ` (${input.rotulo})` : '';
  if (!doc) {
    return `${quien} salió con ${coincidencias}${tipo} en una consulta solo por nombre. Para decidir hay que volver a consultarla con documento.`;
  }
  return `${quien} salió con ${coincidencias}${tipo}. Queda pendiente tu decisión.`;
}
