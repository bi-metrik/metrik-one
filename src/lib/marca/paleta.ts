/**
 * Paleta "Pino Profundo" en hex literal (decision de marca 2026-09-07).
 *
 * La fuente de verdad de la paleta son las variables CSS de `globals.css`: en
 * pantalla se escribe `text-acento`, `bg-papel`, `var(--tinta)`. Este modulo
 * existe SOLO para las superficies donde una variable CSS no resuelve:
 *
 *   - PDF con @react-pdf/renderer, que no corre en un DOM;
 *   - correo HTML, donde `var()` no es seguro entre clientes;
 *   - atributos de presentacion SVG (`fill`, `stroke`, `stopColor`) y las props
 *     de color de recharts, que terminan en esos atributos;
 *   - `global-error.tsx`, que reemplaza el `<html>` y se activa justo cuando la
 *     hoja de estilos puede no haber cargado.
 *
 * Si el color se puede escribir como clase de Tailwind o como `var(--…)`, NO se
 * importa de aqui: ese camino deja el color fuera del sistema de tokens y es
 * como llegamos a tener el hex de marca regado en 134 archivos.
 */
export const PALETA = {
  /** Pino Profundo — acento de marca. */
  acento: '#0E5C43',
  /** Pino 500 — hover / estado del acento. */
  acentoHover: '#1C7D5E',
  /** Pino 300 — el unico verde legible sobre carbon. */
  acentoClaro: '#6FB89D',
  /**
   * Superficie y borde de chip del acento, PRECALCULADOS.
   *
   * En pantalla estos dos salen de `color-mix()` sobre `--acento`, asi que se
   * mueven solos si el acento cambia. Aqui no se puede: un PDF o un correo
   * necesita el hex ya resuelto. `paleta.test.ts` recalcula la mezcla desde
   * `globals.css` y falla si estas constantes se separan — sin esa prueba, el
   * dia que se mueva el acento la pantalla y el PDF dirian cosas distintas y
   * nadie se enteraria.
   */
  acentoTinte: '#ECF2F0',
  acentoBorde: '#BCD1CA',
  /** Acido — dato vivo, SOLO sobre carbon. */
  datoVivo: '#B8E62D',
  /** Carbon calido — texto principal. */
  tinta: '#191713',
  /** Gris calido — texto de soporte. */
  tintaSuave: '#6E6A62',
  /** Oxido — error, bloqueo, vencido. */
  alerta: '#B3382C',
  /** Ambar quemado — pendiente, por vencer. */
  advertencia: '#B87515',
  /** Papel — fondo de pagina y zonas en reposo. */
  papel: '#F3F1EC',
} as const

export type ColorMarca = (typeof PALETA)[keyof typeof PALETA]

/** Mezcla `hex` con blanco al `pct`% — lo mismo que hace color-mix en srgb. */
function sobreBlanco(hex: string, pct: number): string {
  const p = pct / 100
  const canal = (i: number) =>
    Math.round(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * p + 255 * (1 - p))
  return '#' + [0, 1, 2].map((i) => canal(i).toString(16).padStart(2, '0')).join('').toUpperCase()
}

/**
 * Rampa del acento para rankings: `pasos` tonos del mas profundo al mas palido.
 *
 * ⚠️ Se DERIVA del acento en vez de escribirse a mano, y esa no es una
 * preferencia de estilo. La rampa anterior era la escala emerald de Tailwind
 * escrita tono por tono; al tokenizar, cuatro de sus ocho tonos cayeron en el
 * mismo token y las cuatro primeras posiciones del ranking quedaron del mismo
 * color — un grafico que dejaba de distinguir lo que existe para distinguir.
 * Derivandola, la cantidad de pasos la pide quien la usa y siempre salen
 * distintos.
 *
 * El piso es 12% y no 0: por debajo de eso los ultimos puestos se confunden con
 * el fondo blanco de la tarjeta.
 */
export function rampaAcento(pasos: number): string[] {
  if (pasos <= 1) return [PALETA.acento]
  const TOPE = 100
  const PISO = 12
  return Array.from({ length: pasos }, (_, i) =>
    sobreBlanco(PALETA.acento, TOPE - ((TOPE - PISO) * i) / (pasos - 1))
  )
}

/**
 * Colores de marca por defecto de un workspace que no eligio los suyos.
 *
 * ⚠️ Esto NO es un token de estilo: son los valores que se GUARDAN en
 * `workspaces.color_primario` / `color_secundario`, y por eso viven como hex y
 * no como `var(--…)`.
 */
export const BRANDING_POR_DEFECTO = {
  primario: PALETA.acento,
  secundario: PALETA.tinta,
} as const

/**
 * Los valores que han servido de "sin personalizar" a lo largo del tiempo.
 *
 * ⚠️ La lista es historica a proposito y NO se poda. Los workspaces que
 * guardaron su marca antes del rediseno tienen `#10B981` escrito en la base:
 * comparar solo contra el default de hoy los contaria como personalizados, que
 * es justo lo contrario de lo que significan. Mientras no exista una migracion
 * de datos que los mueva, los dos valores conviven.
 */
export const BRANDING_SIN_PERSONALIZAR: readonly string[] = [
  BRANDING_POR_DEFECTO.primario,
  '#10B981', // Verde Metrica, default hasta el rediseno del 2026-09-07
]

/** `true` si el color guardado es uno de los defaults, o sea nadie lo eligio. */
export function esBrandingPorDefecto(color: string | null | undefined): boolean {
  if (!color) return true
  return BRANDING_SIN_PERSONALIZAR.some((c) => c.toLowerCase() === color.toLowerCase())
}
