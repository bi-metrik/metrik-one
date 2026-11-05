/**
 * PDFs de prueba de verdad. Los arneses de `documento-actions` usaban `%PDF` o `%PDF-1.4` a secas
 * como archivo, y desde que la carga revisa el archivo antes de leerlo (`revisar-archivo.ts`) eso
 * cuenta como PDF dañado, que es justo lo que es.
 */

/** Un PDF mínimo con UNA página en blanco, escrito a mano (objetos, xref y trailer). */
export const PDF_UNA_PAGINA = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj',
    'trailer << /Root 1 0 R /Size 4 >>',
    '%%EOF',
  ].join('\n'),
)

/** Un PDF bien formado SIN páginas: lo que llegó en V0634 («The document has no pages.»). */
export const PDF_SIN_PAGINAS = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj',
    'trailer << /Root 1 0 R /Size 3 >>',
    '%%EOF',
  ].join('\n'),
)
