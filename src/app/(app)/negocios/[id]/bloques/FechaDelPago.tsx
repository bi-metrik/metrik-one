import { formatBogotaFechaCortaAno } from '@/lib/dates/bogota'

/**
 * La fecha del pago bajo cada pago de un bloque de pagos (SOE-013). Mismo formato que
 * `BloqueCobros` («16 sept 2026»). Sin fecha legible no pinta nada. La usan
 * `BloquePagosEpayco` y `BloqueDatosMultiPago`.
 */
export function FechaDelPago({ fecha }: { fecha: string | null }) {
  const texto = formatBogotaFechaCortaAno(fecha) ?? ''
  if (!texto) return null
  return <p className="text-[10px] text-tinta-suave" data-fecha-pago={fecha ?? undefined}>{texto}</p>
}
