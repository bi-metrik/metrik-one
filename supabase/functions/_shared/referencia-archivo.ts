// ============================================================
// Referencias `one://` del lado Deno.
//
// ⚠️ ESTO ES UNA COPIA. La fuente es `src/lib/almacenamiento/referencia.ts`, y no se
// puede importar: las edge functions corren en Deno y no resuelven `@/lib`. Es el mismo
// motivo por el que `email_cliente_negocio` vive en SQL y no en TypeScript.
//
// Lo que impide que las dos se separen en silencio es la prueba de contrato
// `src/lib/almacenamiento/referencia-deno.test.ts`, que LEE este archivo y falla si el
// prefijo o la lista de buckets dejan de coincidir. Si estás cambiando algo aquí,
// cámbialo también allá — la prueba te lo va a decir de todas formas.
//
// Se copia lo MÍNIMO: reconocer una referencia y descomponerla. Nada de rutas, dueños ni
// puertas — de eso no hay un solo consumidor en Deno, y copiarlo sería copiar la
// autorización, que es exactamente lo que no puede vivir en dos sitios.
// ============================================================

export const PREFIJO_REFERENCIA_ONE = 'one://';

export const BUCKETS_ONE = ['ve-documentos', 'gastos-soportes'] as const;
export type BucketOne = (typeof BUCKETS_ONE)[number];

export const BUCKET_DOCUMENTOS_ONE: BucketOne = 've-documentos';
export const BUCKET_SOPORTES_GASTO: BucketOne = 'gastos-soportes';

export function esReferenciaOne(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.startsWith(PREFIJO_REFERENCIA_ONE);
}

export function construirReferenciaOne(bucket: BucketOne, path: string): string {
  return `${PREFIJO_REFERENCIA_ONE}${bucket}/${path}`;
}

/**
 * ¿La ruta puede terminar pidiéndole a Storage otra carpeta? Copia de `rutaConEscape` de la
 * fuente: el parser de URL convierte `%2e%2e`, `.%2E`, `.<TAB>.` y la barra invertida en
 * un salto de carpeta antes de mandar la petición.
 */
function rutaConEscape(path: string): boolean {
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  if (/[\\?#]/.test(path)) return true;
  return path.split('/').some((s) => {
    const conPuntos = s.replace(/%2e/gi, '.');
    return s === '' || conPuntos === '.' || conPuntos === '..';
  });
}

/** Descompone `one://<bucket>/<path>`, con las mismas guardas de forma que la fuente. */
export function parsearReferenciaOne(ref: unknown): { bucket: BucketOne; path: string } | null {
  if (!esReferenciaOne(ref)) return null;
  const resto = ref.slice(PREFIJO_REFERENCIA_ONE.length);
  const corte = resto.indexOf('/');
  if (corte <= 0) return null;
  const bucket = resto.slice(0, corte);
  const path = resto.slice(corte + 1);
  if (!(BUCKETS_ONE as readonly string[]).includes(bucket)) return null;
  if (!path) return null;
  if (rutaConEscape(path)) return null;
  return { bucket: bucket as BucketOne, path };
}
