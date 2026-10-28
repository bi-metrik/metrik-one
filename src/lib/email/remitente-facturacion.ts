/**
 * El remitente de los correos de cobro y facturación. La constante vive en
 * `supabase/functions/_shared/remitente-facturacion.ts` porque también la usa la edge function
 * `enviar-factura-cuota` (que no alcanza `src/`): una sola fuente para Next y Deno.
 */
export { FROM_FACTURACION } from '../../../supabase/functions/_shared/remitente-facturacion.ts'
