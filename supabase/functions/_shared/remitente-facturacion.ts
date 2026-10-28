/**
 * El remitente de TODO correo de cobro de MéTRIK: cuentas de cobro, enlace automático de pago de
 * cuotas, el cobro tras la prueba de Valida y (desde 2026-10-28) la factura de una cuota.
 *
 * Una sola constante para que no vuelvan a separarse: hasta el 2026-10-26 el enlace automático y
 * el cobro de prueba seguían saliendo de `facturacion@metrikone.co` (el dominio del plan Free de
 * Resend) mientras la cuenta de cobro ya salía de `metrik.com.co` (#1295). `metrik.com.co` está
 * verificado en Resend (plan Pro).
 *
 * Vive en `_shared` porque la edge function `enviar-factura-cuota` no alcanza `src/`; Next la
 * re-exporta desde `src/lib/email/remitente-facturacion.ts`. Módulo puro.
 */
export const FROM_FACTURACION = 'MéTRIK · Facturación <facturacion@metrik.com.co>';
