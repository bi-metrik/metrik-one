/**
 * La ciudad leída de una actividad que en realidad es un lugar del nombre del tour (brief del
 * 2026-10-05, «la ciudad de una actividad no sale del nombre del tour», C3 de #976 sobre
 * COT-2026-0020).
 *
 * «Tour en lancha por la bahía de Manzanillo», sin ciudad en el pantallazo, volvió del lector
 * con `Ciudad: Manzanillo` y el bloque nació «Actividad en Manzanillo». Manzanillo es la bahía
 * del tour, no la ciudad donde se presta.
 *
 * Se corrige en dos capas:
 *
 *  1. El lector (`ranuras-pantallazo.ts`, campo `ciudad` de la actividad): la ciudad solo si se
 *     ve escrita como ciudad o destino; un lugar dentro del nombre de la actividad no lo es.
 *  2. Aquí, después de leer, de forma determinista: la ciudad leída se descarta cuando es un
 *     accidente geográfico que aparece en el nombre del tour. Sin ella, el bloque usa la ciudad
 *     del viaje (`lugarDeBloqueNuevo`), que es el lado seguro.
 *
 * La regla es angosta a propósito: «Tour por San Andrés» con «Ciudad: San Andrés» se queda con
 * San Andrés. Solo se descarta la ciudad que está en el nombre Y va pegada a una bahía, playa,
 * cayo, isla, parque…: lo que el brief nombra como «un lugar dentro del nombre del tour».
 *
 * ⚠️ No se descarta una ciudad solo porque su nombre empiece por un accidente: Punta Cana,
 * Bahía Solano, Isla Mujeres, Cayo Coco o Playa del Carmen son destinos de verdad.
 *
 * Puro y sin dependencias: lo usan la lectura (`lectura-pantallazo.ts`) y el nombre del bloque
 * (`actividad-pantallazo.ts`).
 */

/** Accidentes y lugares que nombran una excursión, no una ciudad. Sin tildes y en minúscula. */
const LUGARES_DE_TOUR = [
  'bahia', 'bay', 'playa', 'playas', 'beach', 'cayo', 'cayos', 'cay', 'key', 'isla', 'islas', 'islote', 'island',
  'parque', 'park', 'laguna', 'lagoon', 'lago', 'lake', 'rio', 'river', 'cerro', 'volcan', 'punta', 'cascada',
  'cascadas', 'reserva', 'arrecife', 'reef', 'manglar', 'manglares', 'mirador', 'ensenada', 'peninsula', 'acuario',
]

/** Sin tildes, en minúscula, solo letras y números separados por un espacio. */
function normal(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const CONECTORES = new Set(['de', 'del', 'la', 'las', 'el', 'los'])

/**
 * ¿La ciudad leída es un lugar del nombre de la actividad? `true` = se descarta.
 *
 *  · la ciudad tiene que aparecer, con palabras completas, dentro del nombre;
 *  · y el nombre la pega a un accidente: antes («bahía de Manzanillo», «isla de la Piedra») o
 *    después («Manzanillo Bay», «Crab Cay» leído como «Crab»).
 */
export function ciudadEsLugarDelNombre(ciudad: string | null | undefined, nombre: string | null | undefined): boolean {
  const c = normal(ciudad ?? '')
  const n = normal(nombre ?? '')
  if (!c || !n) return false
  const palabrasN = n.split(' ')
  const palabrasC = c.split(' ')
  const lugar = (p: string | undefined) => !!p && LUGARES_DE_TOUR.includes(p)

  for (let i = 0; i + palabrasC.length <= palabrasN.length; i++) {
    if (palabrasC.some((p, k) => palabrasN[i + k] !== p)) continue
    // Hacia atrás, saltando «de», «la»…: «bahía de Manzanillo», «isla de la Piedra».
    let j = i - 1
    while (j >= 0 && CONECTORES.has(palabrasN[j]!)) j--
    if (lugar(palabrasN[j])) return true
    // Hacia adelante: «Manzanillo Bay».
    if (lugar(palabrasN[i + palabrasC.length])) return true
  }
  return false
}
