// Helpers de URL para Valida. No es 'use server' — puede usarse desde client.
export function buildPDFUrl(consulta_id: string): string {
  return `/api/compliance/valida-reporte/${consulta_id}`;
}
