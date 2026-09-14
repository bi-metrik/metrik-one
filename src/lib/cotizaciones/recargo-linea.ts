/**
 * El RECARGO FIJO: el valor que Edgar le suma a un tiquete y hoy hace de memoria.
 *
 * Regla 2 de la reunión del 2026-09-14. Tres cosas se pidieron juntas y las tres
 * importan lo mismo: un valor por defecto **configurable**, que se aplique **solo
 * donde corresponde**, y que **cualquiera lo pueda editar a mano en la cotización**.
 * La tercera no es un extra: un valor por defecto que no se deja cambiar se vuelve un
 * estorbo, y la gente cotiza por fuera del sistema — que es el problema que este
 * frente viene a quitar, no a mover de lugar.
 *
 * ## Es INGRESO, no costo. Y de eso depende la cascada
 *
 * Mirando cómo suma `calcularCascada`: un costo entra a `costoDirecto`, recibe su
 * parte de los administrativos y **después se le aplica el margen**. Un recargo de
 * $100.000 tratado como costo saldría cobrado en $117.647 con `sobre_venta` al 15%, y
 * además inflaría el denominador contra el que se mide el margen: el mismo recargo
 * bajaría el margen que la pantalla enseña.
 *
 * Como ingreso, el recargo es una línea **sin costo y con precio escrito a mano**
 * (`precio_manual = true`). La cascada ya sabe qué hacer con eso: `costoLinea <= 0`
 * manda el precio guardado tal cual. Suma al precio, no al costo, y el margen sube
 * exactamente lo que el recargo vale. Es lo que hace la hoja de Alejandra: neta +
 * fee = lo que paga el pasajero.
 *
 * ⚠️ **Pregunta abierta para Mauricio, escrita aquí y no resuelta en el código:** si
 * algún día el recargo corresponde a algo que Trappvel PAGA (un fee de GDS, una tasa
 * del consolidador), entonces es costo y su sitio es un rubro de la línea de vuelo,
 * no una línea propia. Hoy no hay evidencia de que se pague nada: en la hoja el fee
 * aparece sumado al precio del pasajero y nunca como egreso. Es la misma confusión que
 * ya costó con `comision_proveedor`.
 *
 * ## Qué NO decide este archivo
 *
 * **El monto y el criterio de «internacional» son decisión de Trappvel, no del
 * código.** Aquí solo vive el mecanismo: dónde está el valor por defecto, cuándo se
 * OFRECE, y cómo se ve que alguien lo cambió. Quién aprieta el botón decide si a ESTE
 * vuelo le corresponde — que es justo lo que un `if (esInternacional)` escrito por
 * nosotros haría mal, porque «internacional» todavía no está definido por nadie.
 *
 * ## Dónde vive el valor por defecto
 *
 * En `lineas_negocio.config_extra.recargo`, al lado de `margen` y por la misma razón
 * (ver el encabezado de `convencion-margen.ts`): la pregunta «¿cuánto se le suma a un
 * tiquete?» es de la LÍNEA, no de la empresa. Se edita desde Mi Negocio → Margen y
 * recargo, **sin tocar código y sin SQL**.
 */

import { ranuraDeGrupo } from './ranuras-pantallazo'

/** Lo que la línea declara sobre el recargo, ya resuelto. */
export interface PoliticaRecargo {
  /** `false` = no se ofrece en ninguna cotización de esta línea. */
  activo: boolean
  /** Cómo se llama la línea que se crea. Es también cómo se la reconoce después. */
  etiqueta: string
  /** El valor por defecto, en pesos. */
  valor: number
  /** Ranuras a las que aplica (slugs de `ranuras-pantallazo`). */
  aplicaA: string[]
}

/**
 * Lo que rige cuando la línea no declara nada: **nada**.
 *
 * `activo: false` a propósito. Un recargo que aparece solo en un workspace que no lo
 * pidió es una línea de más en una cotización que sale a un cliente. Encenderlo es una
 * decisión y se toma en una pantalla.
 */
export const RECARGO_POR_DEFECTO: PoliticaRecargo = {
  activo: false,
  etiqueta: 'Recargo de emisión',
  valor: 0,
  aplicaA: ['vuelo_detalle'],
}

type ConfigExtra = {
  recargo?: {
    activo?: unknown
    etiqueta?: unknown
    valor?: unknown
    aplica_a?: unknown
  } | null
} | null

/**
 * Lee la política de recargo del `config_extra` de una línea.
 *
 * Tolerante como su hermana `politicaMargenDeLinea`: un jsonb con otra forma cae en la
 * política por defecto, que es **apagada**. Un valor mal escrito no puede meterle una
 * línea de precio a una cotización.
 */
export function politicaRecargoDeLinea(configExtra: unknown): PoliticaRecargo {
  const cfg = (configExtra ?? null) as ConfigExtra
  const recargo = cfg && typeof cfg === 'object' ? cfg.recargo : null
  if (!recargo || typeof recargo !== 'object') return RECARGO_POR_DEFECTO

  const valorCrudo = Number(recargo.valor)
  // Un valor negativo NO se corrige a 0: se descarta la configuración entera dejando
  // el recargo apagado. Un «descuento fijo» disfrazado de recargo es otra decisión y
  // tendría que tomarse con ese nombre.
  const valor = Number.isFinite(valorCrudo) && valorCrudo >= 0 ? Math.round(valorCrudo) : 0

  const etiqueta = typeof recargo.etiqueta === 'string' && recargo.etiqueta.trim() !== ''
    ? recargo.etiqueta.trim()
    : RECARGO_POR_DEFECTO.etiqueta

  const aplicaA = Array.isArray(recargo.aplica_a)
    ? recargo.aplica_a.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    : RECARGO_POR_DEFECTO.aplicaA

  return {
    // Un recargo encendido en cero no ofrece nada: obligaría a teclear el monto cada
    // vez, que es exactamente el trabajo que este mecanismo quita.
    activo: recargo.activo === true && valor > 0 && aplicaA.length > 0,
    etiqueta,
    valor,
    aplicaA,
  }
}

// ── Cuándo se ofrece y cómo se ve ────────────────────────────────────────────

/** Lo mínimo que hace falta de una línea de la cotización. */
export interface ItemParaRecargo {
  id: string
  nombre?: string | null
  grupo?: string | null
  precio_venta?: number | null
  cantidad?: number | null
  es_ajuste?: boolean | null
}

/**
 * ¿Esta cotización tiene un componente al que el recargo le corresponde?
 *
 * Se mira la RANURA del grupo, no el nombre de la línea: «Vuelo BOG-MAD» y «Tiquetes»
 * resuelven los dos a `vuelo_detalle` y los dos cuentan. Un ítem sin grupo no cuenta —
 * es el mismo contrato que el pantallazo.
 */
export function recargoCorresponde(items: ItemParaRecargo[], politica: PoliticaRecargo): boolean {
  if (!politica.activo) return false
  return items.some(i => {
    if (i.es_ajuste === true) return false
    const ranura = ranuraDeGrupo(i.grupo)
    return ranura !== null && politica.aplicaA.includes(ranura.slug)
  })
}

/**
 * La línea de recargo que ya está en la cotización, si está.
 *
 * ⚠️ Se reconoce por el NOMBRE, normalizado contra la etiqueta configurada. No hay
 * columna donde marcarla y agregar una sería una migración para un texto. La
 * consecuencia se asume y es visible: si alguien renombra la línea, el sistema deja de
 * reconocerla y vuelve a OFRECER el recargo — ofrecer, no agregar, así que lo peor que
 * pasa es un botón de más que se ignora. Al revés (agregarlo solo) sí sería grave.
 */
export function lineaDeRecargo<T extends ItemParaRecargo>(
  items: T[],
  politica: PoliticaRecargo,
): T | null {
  const buscado = clave(politica.etiqueta)
  return items.find(i => i.es_ajuste !== true && clave(i.nombre ?? '') === buscado) ?? null
}

export type EstadoRecargo =
  /** La línea no lo declara, o no hay a qué aplicarlo. */
  | { estado: 'no_aplica' }
  /** Corresponde y NO está puesto: se ofrece. */
  | { estado: 'falta'; valor: number; etiqueta: string }
  /** Está puesto por el valor vigente. */
  | { estado: 'puesto'; valor: number; etiqueta: string; itemId: string }
  /** Está puesto por OTRO valor: alguien lo cambió, o el vigente se movió después. */
  | { estado: 'distinto'; valorEnLaLinea: number; valorVigente: number; etiqueta: string; itemId: string }

/**
 * En qué estado está el recargo de esta cotización.
 *
 * ⚠️ `distinto` NO dice «editado a mano», aunque ese sea el caso normal. Un recargo
 * puesto en $100.000 aparece como distinto el día que alguien sube el vigente a
 * $150.000, sin que nadie haya tocado la cotización. Afirmar «editado» ahí sería
 * acusar a quien cotizó de algo que no hizo; decir las DOS cifras es cierto siempre y
 * además es lo accionable.
 */
export function estadoDelRecargo(
  items: ItemParaRecargo[],
  politica: PoliticaRecargo,
): EstadoRecargo {
  if (!recargoCorresponde(items, politica)) return { estado: 'no_aplica' }

  const linea = lineaDeRecargo(items, politica)
  if (!linea) return { estado: 'falta', valor: politica.valor, etiqueta: politica.etiqueta }

  const enLaLinea = Math.round((Number(linea.precio_venta) || 0) * (Number(linea.cantidad) || 1))
  if (enLaLinea === politica.valor) {
    return { estado: 'puesto', valor: enLaLinea, etiqueta: politica.etiqueta, itemId: linea.id }
  }
  return {
    estado: 'distinto',
    valorEnLaLinea: enLaLinea,
    valorVigente: politica.valor,
    etiqueta: politica.etiqueta,
    itemId: linea.id,
  }
}

/** Misma normalización que los grupos: sin tildes, minúsculas, sin espacios sobrantes. */
function clave(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}
