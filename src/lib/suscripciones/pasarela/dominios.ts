/**
 * Dominios desde los que una pasarela sirve sus enlaces de pago. Es lo único de cada pasarela que la
 * pantalla del cliente necesita saber (para no pintar un botón de pago hacia otro sitio), y vive
 * aparte del adaptador porque ese módulo usa `node:crypto` y este lo importa también el navegador.
 *
 * Agregar una pasarela = agregar su fila. Cambiar de pasarela no toca la pantalla.
 */
export const DOMINIOS_ENLACE_PAGO: Readonly<Record<string, readonly string[]>> = {
  bold: ['bold.co'],
}

/** Todos los dominios aceptados, sin importar la pasarela. */
export const TODOS_LOS_DOMINIOS_DE_PAGO: readonly string[] = Object.values(DOMINIOS_ENLACE_PAGO).flat()

/**
 * Cómo se le nombra al cliente la fuente de un pago. Un pago que entró por una pasarela en línea se
 * llama «Pago en línea», sin el nombre del proveedor: la pasarela puede cambiar y el cliente no tiene
 * por qué enterarse. Las demás fuentes (transferencia, consignación…) se muestran como están.
 */
export function etiquetaFuentePago(fuente: string | null | undefined): string | null {
  if (!fuente) return null
  return Object.hasOwn(DOMINIOS_ENLACE_PAGO, fuente.trim().toLowerCase()) ? 'Pago en línea' : fuente
}
