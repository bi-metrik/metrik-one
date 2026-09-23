/**
 * Los productos que tienen entrada de términos: la misma pantalla, las mismas constancias y la misma
 * guarda de la base, con tres diferencias que se declaran aquí y en ningún otro lado.
 *
 *   - `nombre`: cómo se llama el producto en los textos que se firman (la casilla, la declaración y
 *     el aviso de la Política). Esos textos quedan con su huella en cada constancia, así que el de
 *     Valida API NO puede cambiar: lo que ya aceptó 4D SOFT dice «Valida API».
 *   - `exigeAprobacionPorUsuario`: en Valida API cada usuario lee los términos y acepta la Política
 *     antes de usar el módulo (pedido de Mauricio, 2026-09-16). En Valida de los CDA lo que abre el
 *     módulo es la aceptación del contrato por la persona designada; los operadores esperan a que
 *     ella acepte y no firman nada propio (encargo del 2026-09-23).
 *   - `exigeDesignado`: en los CDA el dueño del espacio es, en tres de cuatro, una cuenta genérica
 *     («Oficial de Cumplimiento»), y la cláusula 16.1 de sus términos exige al representante legal o a
 *     un apoderado. Sin una persona designada en el contrato, nadie firma. En Valida API la regla
 *     sigue siendo la del dueño cuando el contrato no designa a nadie.
 *
 * Puro: lo importan la pantalla y el servidor.
 */

export const PRODUCTOS_ENTRADA = {
  valida_api: {
    nombre: 'Valida API',
    ruta: '/valida-api',
    exigeAprobacionPorUsuario: true,
    exigeDesignado: false,
  },
  valida_cda: {
    nombre: 'Valida',
    ruta: '/valida',
    exigeAprobacionPorUsuario: false,
    exigeDesignado: true,
  },
} as const

export type ProductoEntrada = keyof typeof PRODUCTOS_ENTRADA
