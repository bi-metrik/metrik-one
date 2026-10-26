/**
 * El remitente de TODO correo de cobro de MéTRIK: cuentas de cobro, enlace automático de pago de
 * cuotas y el cobro tras la prueba de Valida.
 *
 * Una sola constante para que los tres no vuelvan a separarse: hasta el 2026-10-26 el enlace
 * automático y el cobro de prueba seguían saliendo de `facturacion@metrikone.co` (el dominio del
 * plan Free de Resend) mientras la cuenta de cobro ya salía de `metrik.com.co` (#1295).
 * `metrik.com.co` está verificado en Resend (plan Pro).
 *
 * Módulo puro: lo importan el servidor de Next y las pruebas sin cargar Drive ni Resend.
 */
export const FROM_FACTURACION = 'MéTRIK · Facturación <facturacion@metrik.com.co>'
