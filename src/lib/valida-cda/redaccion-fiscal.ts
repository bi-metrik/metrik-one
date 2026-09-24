/**
 * Cómo se nombra ante el CDA lo que paga. Redacción de Felipe (tributario), 2026-09-24.
 *
 * VALIDA se factura SIN IVA como servicio de computación en la nube (art. 476 num. 21 ET; regla
 * `cerebro/reglas/exclusion-iva-nube-exige-autodiagnostico.md`). Llamarlo «licencia» puede leerse
 * como licenciamiento de software, que está gravado: por eso ningún texto que ve el CDA dice
 * «licencia» del servicio ni de sus cupos de usuario. Los identificadores internos (`valida-cda-licencia`,
 * `parametros.licencias`, `licencias_adicionales`) no cambian: no los ve nadie.
 *
 * Los mismos textos van en los datos (`sql/valida-cda/2026-09-24_licencia-a-suscripcion.sql`):
 * si se cambia uno aquí, se cambia allá.
 */

/** Nombre del plan: encabezado de /suscripcion, concepto de cobro y de factura. */
export const PLAN_CDA = 'Suscripción VALIDA · Plan CDA — servicio de computación en la nube (SaaS)'

/** La nota de IVA, en la tarjeta de pago y en la pestaña Pagos. */
export const NOTA_IVA_CDA = 'Servicio excluido de IVA (art. 476 num. 21 ET, computación en la nube)'
