/**
 * El lenguaje visual del prototipo de la tarjeta y la bandeja de Trappvel
 * (`proyectos/trappvel/clarity/docs/diseno/prototipo-tarjeta-2026-09-24/index.html`), en clases
 * de Tailwind. Un solo sitio para que la bandeja y la tarjeta se vean iguales.
 *
 * Los colores son los tokens del prototipo, que son los de Pino Profundo (`globals.css`: papel,
 * tinta, tinta suave, acento, alerta) más los bordes y superficies del prototipo. La tipografía
 * es la de la app, la misma del prototipo (Schibsted Grotesk).
 */

export const C = {
  papel: '#F3F1EC',
  sup: '#FFFFFF',
  sup2: '#F8F7F3',
  sup3: '#EEEBE4',
  tinta: '#191713',
  suave: '#6E6A62',
  borde: '#E2DED5',
  bordeFuerte: '#CFCAC0',
  acento: '#0E5C43',
  acentoTinte: '#EAF1EE',
  adv: '#9A5F0C',
  advFondo: '#FBF1E2',
  advBorde: '#E9C98F',
  alerta: '#B3382C',
} as const

/** `.btn` */
export const BTN =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#CFCAC0] bg-white px-3 py-1.5 text-[13px] font-semibold leading-[1.3] text-[#191713] hover:bg-[#EEEBE4] disabled:cursor-not-allowed disabled:opacity-45'

/**
 * `.btn` ELEGIDO (Hotel / Traslado, Va / No va): acento y tinte (D6 de Noor, 2026-09-28).
 *
 * ⚠️ No se arma como `${BTN} border-[#0E5C43] …`: con dos clases del mismo color en la misma
 * etiqueta gana la que Tailwind escribe DESPUÉS en el CSS, no la que va después en el texto, y
 * ahí ganaban el borde gris y la tinta de `BTN` (brief del 2026-10-01, punto 6: el elegido
 * «apenas se distingue»). Por eso es una cadena propia, sin los colores de `BTN`.
 */
export const BTN_ELEGIDO =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#0E5C43] bg-[#EAF1EE] px-3 py-1.5 text-[13px] font-semibold leading-[1.3] text-[#0E5C43] shadow-[inset_0_0_0_1px_#0E5C43] disabled:cursor-not-allowed disabled:opacity-45'

/** `.btn.prim` */
export const BTN_PRIM =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#191713] bg-[#191713] px-3 py-1.5 text-[13px] font-semibold leading-[1.3] text-[#F3F1EC] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45'

/** `.link` */
export const LINK = 'cursor-pointer border-0 bg-transparent p-0 font-semibold text-[#0E5C43] underline underline-offset-2'

/** `.btn-x` */
export const BTN_X = 'rounded-md border-0 bg-transparent p-1 leading-none text-[#6E6A62] hover:bg-[#EEEBE4] hover:text-[#191713]'

/** `.campo input` */
export const INPUT =
  'w-full min-w-0 rounded-[7px] border border-[#CFCAC0] bg-white px-2 py-1.5 text-sm text-[#191713] disabled:bg-[#F8F7F3]'

/** `.campo.dudoso input` */
export const INPUT_DUDOSO = 'w-full min-w-0 rounded-[7px] border border-[#E9C98F] bg-[#FBF1E2] px-2 py-1.5 text-sm text-[#191713]'

/** `.spin` */
export const SPIN =
  'mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#CFCAC0] border-t-[#0E5C43] align-[-2px] motion-reduce:animate-none'
