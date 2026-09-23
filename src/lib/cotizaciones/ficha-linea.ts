/**
 * La FICHA de una línea con pantallazo: cada campo, lo que leyó la IA, lo que corrigió una
 * persona, y cómo se valida una corrección.
 *
 * Brief del 2026-09-22 (`brief-max-2026-09-22-estrellas-y-campos-editables.md`, punto 3).
 * Los datos viven en `correcciones.ts`; aquí está lo que decide la pantalla y la server
 * action, para que las dos digan lo mismo por construcción.
 *
 * Puro: sin red y sin base.
 */

import { parseMontoCop } from '@/lib/negocios/monto-cop'

import type { CampoRanura, DefinicionRanura } from './ranuras-pantallazo'
import {
  aplicarCorrecciones,
  camposCorregibles,
  leidosPorSlug,
  type CorreccionCampo,
  type Correcciones,
} from './correcciones'
import {
  cifraInverosimil,
  monedaDelMonto,
  numeroLeido,
  resumenDeLinea,
  type CampoLeido,
} from './lectura-pantallazo'
import type { CasillasLeidas } from './tarifa-pasajero'
import { horaCorta } from './detalle-viaje'
import { estrellasDesdeTexto } from './estrellas'

// ── Validar lo que escribe una persona ───────────────────────────────────────

/** Tope de un texto corregido. Un campo de la ficha no es un párrafo. */
const MAX_TEXTO = 200

export type ResultadoValidacion = { ok: true; valor: string | null } | { ok: false; error: string }

/**
 * Normaliza lo que escribió una persona en un campo, o dice por qué no se puede guardar.
 *
 * El valor se guarda en la MISMA forma en que lo guarda la lectura (fechas `AAAA-MM-DD`,
 * horas `HH:MM`, booleanos `true`/`false`, estrellas como entero): el documento y la ficha
 * lo leen igual venga de donde venga, y no hay una segunda forma de escribir el mismo dato.
 *
 * Un texto vacío es `null`: la persona deja el campo vacío a propósito.
 */
export function validarCorreccion(def: CampoRanura, entrada: string | null | undefined): ResultadoValidacion {
  const t = (entrada ?? '').trim()
  if (t === '') return { ok: true, valor: null }

  if (def.slug === 'estrellas') {
    const n = estrellasDesdeTexto(t)
    return n === null
      ? { ok: false, error: 'La categoría es un número entero de 1 a 5.' }
      : { ok: true, valor: String(n) }
  }
  if (def.slug.startsWith('hora_')) {
    const h = horaCorta(t)
    return h === null ? { ok: false, error: 'Escribe la hora como 07:45 o 7:45 pm.' } : { ok: true, valor: h }
  }
  if (def.tipo === 'fecha') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
    const d = m ? new Date(`${t}T00:00:00Z`) : null
    const valida = !!m && !!d && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t
    return valida ? { ok: true, valor: t } : { ok: false, error: 'La fecha no es válida.' }
  }
  if (def.tipo === 'boolean') {
    const v = t.toLowerCase()
    if (v === 'true' || v === 'sí' || v === 'si') return { ok: true, valor: 'true' }
    if (v === 'false' || v === 'no') return { ok: true, valor: 'false' }
    return { ok: false, error: 'Elige sí o no.' }
  }
  if (def.tipo === 'numero') {
    const n = Number(t.replace(',', '.'))
    const minimo = def.slug === 'noches' ? 1 : 0
    return Number.isInteger(n) && n >= minimo
      ? { ok: true, valor: String(n) }
      : { ok: false, error: `Escribe un número entero${minimo > 0 ? ' mayor que cero' : ''}.` }
  }
  if (def.tipo === 'currency') {
    // «329,44», «1.234,56», «1,234.56», «50.080» o «329.44»: pasa por el normalizador único
    // de montos, el mismo que lee la lectura del modelo. Si la ficha leyera «50.080» de otra
    // forma, guardaría un número y el documento imprimiría otro.
    const n = parseMontoCop(t)
    return n !== null && n >= 0 ? { ok: true, valor: String(n) } : { ok: false, error: 'Escribe solo el valor, sin símbolo.' }
  }
  if (t.length > MAX_TEXTO) return { ok: false, error: `Máximo ${MAX_TEXTO} caracteres.` }
  return { ok: true, valor: t }
}

// ── Lo que ve la persona ─────────────────────────────────────────────────────

export interface CampoDeFicha {
  slug: string
  label: string
  tipo: CampoRanura['tipo']
  /** Lo que leyó la IA, tal como quedó guardado (con «(del viaje)» si lo puso el ítem). */
  leido: string | null
  /** Lo que se usa: lo corregido si hay corrección, si no lo leído (sin el marcador). */
  vigente: string | null
  /** La corrección de una persona, si la hay. */
  correccion: CorreccionCampo | null
  /**
   * El monto está en pesos y por debajo del piso de verosimilitud (`cifraInverosimil`): la
   * pantalla lo marca «revisa esta cifra». Nunca en un campo que ya corrigió una persona.
   */
  revisarCifra: boolean
}

/**
 * Los montos que la lectura dejó en pesos por debajo del piso de verosimilitud.
 *
 * Ensayo del 2026-09-23: «Impuestos en destino 50.080 COP» se guardó como 50,08 y así llegó al
 * PDF del cliente. El normalizador ya lee bien ese texto, pero el modelo también puede devolver
 * «50,08» a secas, y ahí no hay regla que adivine: lo único honesto es no guardarlo en silencio.
 * Recorre TODOS los montos de la ranura, también los de costo (que no se corrigen en la ficha
 * sino en los rubros), porque la marca tiene que verse donde se ve la cifra.
 *
 * Un monto que corrigió una persona no se marca: la decisión ya la tomó alguien que miró.
 * Sin moneda leída se usa la de la lectura (`monedaLectura`), que es con la que se costea.
 */
export function cifrasPorRevisar(
  ranura: DefinicionRanura,
  campos: { label: string; valor: string }[] | undefined,
  correcciones: Correcciones | null | undefined,
  monedaLectura: string | null = null,
): Set<string> {
  const vigentes = aplicarCorrecciones(leidosPorSlug(ranura, campos), correcciones)
  const out = new Set<string>()
  for (const def of ranura.campos) {
    if (def.tipo !== 'currency' || correcciones?.[def.slug]) continue
    const valor = numeroLeido(vigentes[def.slug] ?? null)
    if (cifraInverosimil(valor, monedaDelMonto(def.slug, s => vigentes[s], monedaLectura))) out.add(def.slug)
  }
  return out
}

/**
 * La ficha de la línea: todos los campos corregibles de la ranura, leídos o no.
 *
 * Se muestran también los que la IA NO leyó: un hueco (la categoría que la captura no
 * mostraba) se llena en el mismo sitio donde se corrige un error.
 */
export function fichaDeLinea(
  ranura: DefinicionRanura,
  campos: { label: string; valor: string }[] | undefined,
  correcciones: Correcciones | null | undefined,
  /** La moneda de la lectura (`LecturaCasilla.moneda`), para los montos que no traen la suya. */
  monedaLectura: string | null = null,
): CampoDeFicha[] {
  const crudo = new Map((campos ?? []).map(c => [c.label, c.valor]))
  const leidos = leidosPorSlug(ranura, campos)
  const vigentes = aplicarCorrecciones(leidos, correcciones)
  const porRevisar = cifrasPorRevisar(ranura, campos, correcciones, monedaLectura)
  return camposCorregibles(ranura).map(def => ({
    slug: def.slug,
    label: def.label,
    tipo: def.tipo,
    leido: crudo.get(def.label) ?? null,
    vigente: vigentes[def.slug] ?? null,
    correccion: correcciones?.[def.slug] ?? null,
    revisarCifra: porRevisar.has(def.slug),
  }))
}

/** Cómo se lee un valor en la ficha: «Sí»/«No» para los booleanos, el resto tal cual. */
export function valorLegible(tipo: CampoRanura['tipo'], valor: string | null): string {
  if (valor === null || valor.trim() === '') return '—'
  if (tipo === 'boolean') return valor === 'true' ? 'Sí' : valor === 'false' ? 'No' : valor
  return valor
}

// ── La descripción de la línea ───────────────────────────────────────────────

/**
 * La descripción que el sistema escribe en `items.descripcion` al confirmar, con lo
 * corregido encima de lo leído.
 *
 * Sin correcciones es EXACTAMENTE la de siempre: la de la casilla 1 más las notas al cliente
 * de todas las casillas. Con correcciones se rearma con `resumenDeLinea` sobre los valores
 * vigentes, para que «Día a día» no diga una hora que la ficha ya corrigió.
 *
 * `respaldo` es la descripción que ya tenía la línea: sin casilla 1, o con una casilla 1 que
 * no dejó descripción, se usa esa de base. Es lo que hacía la confirmación antes.
 */
export function descripcionDeLinea(
  ranura: DefinicionRanura,
  casillas: CasillasLeidas,
  correcciones: Correcciones | null | undefined,
  respaldo: string | null = null,
): string {
  const primera = casillas.grupo_completo
  const hayCorrecciones = Object.keys(correcciones ?? {}).length > 0
  // ⚠️ El cargo que se paga en destino YA NO se copia a la descripción (B2 del brief del
  // 2026-09-23): vive en su propio campo de la opción (`items.cargo_destino_*`) y el documento
  // lo imprime en su tabla, con el de cada tarifa. Tenerlo también como texto era el mismo dato
  // en dos sitios, y el del texto se quedaba viejo al corregir la cifra (así llegó «50,08 COP»
  // al cliente). Las demás notas de la lectura siguen.
  const notasLeidas = [...new Set(Object.values(casillas).flatMap(l => l?.notasCliente ?? []))]
    .filter(n => !ES_NOTA_DE_CARGO_EN_DESTINO.test(n))

  if (!primera || !hayCorrecciones) {
    const base = (primera?.descripcion ?? '').trim() || (respaldo ?? '').trim()
    return [base, ...notasLeidas.filter(n => !base.includes(n))].filter(Boolean).join(' · ')
  }

  const vigentes = aplicarCorrecciones(leidosPorSlug(ranura, primera.campos), correcciones)
  const campos: CampoLeido[] = ranura.campos.map(def => ({
    slug: def.slug,
    label: def.label,
    valor: vigentes[def.slug] ?? null,
    confidence: 1,
    alertaRevision: false,
  }))
  const base = resumenDeLinea(ranura, campos).descripcion.trim() || (respaldo ?? '').trim()
  return [base, ...notasLeidas.filter(n => !base.includes(n))].filter(Boolean).join(' · ')
}

/** La nota del cargo en destino que arma la lectura (`lectura-casilla.ts`). */
const ES_NOTA_DE_CARGO_EN_DESTINO = /impuestos y tasas a pagar en destino/i

export { descripcionReescribible } from './descripcion-sistema'
