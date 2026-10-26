import { colorDeAerolinea, siglaAerolinea } from '@/lib/cotizaciones/aerolineas'

/**
 * La pastilla de la aerolínea, la misma que imprime la tabla «Vuelos» del PDF de Trappvel: la
 * sigla tal como viene, el color de su aerolínea y, si tiene secundario, la franja al pie
 * (brief del 2026-10-08). La usan la hoja del cliente y la cabecera de la tarjeta del vuelo.
 *
 * Sin sigla no pinta nada: dos letras inventadas se leerían como un código real.
 */
export default function PastillaAerolinea({ aerolinea, numeroVuelo }: { aerolinea: string | null; numeroVuelo?: string | null }) {
  const sigla = siglaAerolinea(aerolinea, numeroVuelo)
  if (!sigla) return null
  const color = colorDeAerolinea(sigla)
  return (
    <span
      className="relative inline-flex h-[17px] w-[27px] shrink-0 items-center justify-center self-center overflow-hidden rounded-full text-[8.5px] font-bold leading-none"
      style={{ background: color.fondo, color: color.texto, paddingBottom: color.franja ? 3 : 0 }}
      data-pastilla-aerolinea={sigla}
    >
      {sigla}
      {color.franja && <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: color.franja }} aria-hidden />}
    </span>
  )
}
