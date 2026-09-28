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
  // Radar SECOP (spec del 2026-09-28, bloque B). Documento propio `terminos-uso-radar@1.0`, que
  // dice lo que protege a MeTRIK: la fuente es pública y puede estar incompleta, el fit es
  // priorización y no un concepto jurídico, presentar la oferta y cumplir los habilitantes es del
  // cliente, y no hay garantía de adjudicación ni comisión sobre lo que se gane.
  //
  //   - `exigeAprobacionPorUsuario: true`, como Valida API: quien mira el Radar decide con él a
  //     qué convocatoria se presenta, así que cada usuario lee los términos. Si fuera false, un
  //     operador vería los puntajes sin haber leído nunca que el fit no es un concepto jurídico,
  //     que es justo la advertencia que el documento existe para dejar por escrito.
  //   - `exigeDesignado: false`: la regla del dueño alcanza. La cláusula 11 del documento cerrado
  //     por el CLO SÍ pide representante legal o apoderado, igual que la 16.1 de los CDA, y aquí se
  //     cumple sin designación: quien acepta declara en qué calidad lo hace y `CALIDADES_ACEPTANTE`
  //     son justo esas dos. Lo que obliga a designar en los CDA es que su dueño es, en tres de
  //     cuatro, una cuenta genérica («Oficial de Cumplimiento»); el primer cliente del Radar (Fabri)
  //     tiene dueño persona, así que exigirlo dejaría el módulo cerrado esperando un dato que nadie
  //     cargó. Si un cliente del Radar llega con dueño genérico, se designa en su contrato y esta
  //     bandera no cambia (la designación manda cuando existe).
  radar_secop: {
    nombre: 'Radar SECOP',
    ruta: '/radar',
    exigeAprobacionPorUsuario: true,
    exigeDesignado: false,
  },
} as const

export type ProductoEntrada = keyof typeof PRODUCTOS_ENTRADA
