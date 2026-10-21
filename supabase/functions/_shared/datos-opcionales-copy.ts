// ============================================================
// Lo que el aviso al cliente lee de un bloque, y cómo nombra el caso al pie.
//
// ── Por qué existe (SOE-021, 2026-10-20) ───────────────────────────────────
//
// `notificar-etapa` resuelve los datos opcionales del copy (`campos_copy`) leyendo
// `negocio_bloques.data.campos[campo].value`, que es la forma de los bloques de
// formulario. Pero no todos los bloques guardan así: el bloque
// `radicado_de_certificacion` de SOENA guarda el dato PLANO,
// `data.radicado_certificacion = "VEH_GEE2026178166"`. Con la lectura de antes, el
// `{radicado}` de la etapa Certificación nunca se resolvía.
//
// La regla: si el bloque tiene `campos[campo]`, manda eso (los bloques de formulario
// no cambian). Solo si NO lo tiene, se cae a `data[campo]` cuando es texto.
//
// El pie del correo decía «Radicado: V0583», pero ese es el código del negocio, no
// un radicado. Junto al radicado de la UPME confundía: ahora dice «Caso:».
//
// Módulo PURO: sin red, sin Deno, sin base. Lo prueba `datos-opcionales-copy.test.ts`.
// ============================================================

/** El valor de un campo del bloque, recortado; `''` si no hay. */
export function valorDelCampo(data: unknown, campo: string): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  const campos = d.campos && typeof d.campos === 'object' ? (d.campos as Record<string, unknown>) : undefined;
  if (campos && campo in campos) {
    const v = (campos[campo] as { value?: unknown } | null | undefined)?.value;
    return typeof v === 'string' ? v.trim() : '';
  }
  const plano = d[campo];
  return typeof plano === 'string' ? plano.trim() : '';
}

/** La línea del pie que nombra el caso. Vacía si el negocio no tiene código. */
export function lineaCasoHtml(
  codigo: string | null | undefined,
  escapar: (s: string) => string,
): string {
  if (!codigo) return '';
  return `<p style="margin:0 0 22px;font-size:13px;color:#6B7280">Caso: <strong style="color:#1A1A1A">${escapar(codigo)}</strong></p>`;
}
