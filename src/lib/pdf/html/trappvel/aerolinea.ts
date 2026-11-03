/**
 * La pastilla de aerolínea de la propuesta HTML: la MISMA simbología que el PDF de react-pdf y
 * que ONE (brief del 2026-10-08, #1082). Los colores salen del catálogo (`aerolineas.ts`); aquí
 * solo se pinta.
 *
 * - La sigla IATA tal como viene (J6 se ve J6), con el color de la aerolínea dueña del código.
 * - El secundario, como franja inferior; gris si el catálogo no la conoce; Spirit, texto negro.
 * - Una pastilla por tramo: un vuelo con escala en otra aerolínea lleva las dos (#1147).
 *
 * Redonda y más chica que las etiquetas de versión (`.tag`, rectangulares y en mayúscula), y va
 * al lado del nombre: las dos simbologías no compiten.
 */
import { aerolineaDeNombre, aerolineaDeSigla, colorDeAerolinea, siglasDeTramos } from '@/lib/cotizaciones/aerolineas'

/** Una pastilla. La sigla viene del prefijo de un número de vuelo o del catálogo: solo [A-Z0-9]. */
export function pastillaAerolinea(sigla: string): string {
  const c = colorDeAerolinea(sigla)
  // La franja va DENTRO del alto de la pastilla, y la sigla se centra encima (como react-pdf).
  const fondo = c.franja ? `linear-gradient(to top,${c.franja} 0 .55mm,${c.fondo} .55mm);padding-bottom:.55mm` : c.fondo
  const s = sigla.replace(/[^A-Z0-9]/gi, '')
  return `<span class="al" data-aerolinea="${s}" style="background:${fondo};color:${c.texto}">${s}</span>`
}

/** Las pastillas de un vuelo, una por aerolínea que opera algún tramo. Vacío sin sigla. */
export function pastillasDeVuelo(aerolinea: string | null | undefined, numero: string | null | undefined): string {
  return siglasDeTramos(aerolinea, numero).map(pastillaAerolinea).join('')
}

/**
 * Las insignias de la tarjeta de vuelo (formato de Edgar del 2026-10-14): el nombre de la
 * aerolínea en versalitas sobre el color de su marca, como «VUELING» en amarillo o «IBERIA» en
 * rojo. Una por aerolínea que opera algún tramo (#1147), con el color del catálogo; sin sigla, la
 * del nombre en el color de una desconocida. Vacío si no hay ni nombre ni sigla.
 */
export function insigniasDeVuelo(aerolinea: string | null | undefined, numero: string | null | undefined): string {
  const siglas = siglasDeTramos(aerolinea, numero)
  const insignia = (texto: string, sigla: string | null) => {
    const c = colorDeAerolinea(sigla)
    const limpio = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    return `<span class="bd" data-aerolinea="${(sigla ?? '').replace(/[^A-Z0-9]/gi, '')}" style="background:${c.fondo};color:${c.texto}">${limpio}</span>`
  }
  if (siglas.length === 0) {
    const nombre = nombreDeAerolinea(aerolinea, numero)
    return nombre ? insignia(nombre, null) : ''
  }
  if (siglas.length === 1) return insignia(nombreDeAerolinea(aerolinea, numero) ?? siglas[0], siglas[0])
  return siglas.map((s) => insignia(aerolineaDeSigla(s)?.nombre ?? s, s)).join('')
}

/**
 * El nombre que va junto a la pastilla. El de la línea, salvo que el número diga que el vuelo
 * lo opera OTRA aerolínea del catálogo (regreso con otra, como en `aerolineaDeFila` de #1147).
 */
export function nombreDeAerolinea(aerolinea: string | null | undefined, numero: string | null | undefined): string | null {
  const primera = aerolineaDeSigla(siglasDeTramos(null, numero)[0])
  const delNombre = aerolineaDeNombre(aerolinea)
  if (primera && delNombre && primera !== delNombre) return primera.nombre
  return aerolinea ?? primera?.nombre ?? null
}
