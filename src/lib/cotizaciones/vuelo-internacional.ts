/**
 * ¿Este vuelo es internacional? La pregunta que decide si le toca el recargo.
 *
 * Brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-22-margen-y-recargo-configurables.md`.
 * Edgar puede decir que el recargo aplica a TODOS los vuelos o solo a los
 * internacionales, y «internacional» no estaba definido por nadie. La regla:
 *
 *  > **Un vuelo es internacional si el origen o el destino está fuera de Colombia.**
 *  > Si alguno de los dos no se reconoce, se trata como internacional **y se avisa**.
 *
 * ## Por qué el lado dudoso es «internacional»
 *
 * El recargo nunca se agrega solo: se OFRECE con un botón (`recargo-linea.ts`). Tratar
 * un lugar que no se reconoce como internacional pone un botón de más, con el aviso de
 * por qué, y quien cotiza lo ignora. Tratarlo como nacional quita el botón **sin decir
 * nada**, y el recargo se pierde en silencio en un viaje al que sí le tocaba.
 *
 * ## De dónde salen el origen y el destino
 *
 * De la lectura del pantallazo (`ranuras-pantallazo.ts`, campos `origen` y `destino` de
 * `vuelo_detalle`). Medido el 2026-09-22 en las líneas de Trappvel, el texto llega en
 * cuatro formas: solo el código (`CUC`), ciudad y código (`Bogotá BOG`,
 * `San Andrés Isla ADZ`), solo la ciudad (`Bogotá`, `San Andrés Isla`) y ciudad con
 * código de otro país (`Orlando MCO`). Por eso se mira primero el código IATA y, si no
 * hay uno que se reconozca, el nombre de la ciudad.
 *
 * ## Lo que NO hace
 *
 * - No mira las escalas. La regla habla de origen y destino; una escala en Panamá de
 *   un Bogotá–San Andrés no lo vuelve internacional.
 * - No trae la lista mundial de aeropuertos. Trae los de Colombia, completa hasta donde
 *   hay vuelos comerciales, y los del exterior a los que una agencia colombiana vende
 *   de verdad. Un código que no está en ninguna de las dos es el caso «no se reconoce»:
 *   cuenta como internacional y se avisa, que es justo lo que protege de una lectura que
 *   trajo `BOQ` en vez de `BOG`.
 */

export type DondeQueda = 'colombia' | 'exterior' | 'desconocido'

export interface LugarLeido {
  donde: DondeQueda
  /** El texto tal como llegó, para poder nombrarlo en el aviso. */
  texto: string
}

/**
 * Aeropuertos de Colombia con vuelos comerciales, por código IATA.
 *
 * ⚠️ Una entrada mal puesta aquí es el error caro: un aeropuerto del exterior tomado
 * por colombiano le quita el recargo a un viaje internacional sin avisar. Ante la duda,
 * un código NO se agrega: fuera de la lista cae en «no se reconoce», que avisa.
 */
const AEROPUERTOS_COLOMBIA: Record<string, string> = {
  BOG: 'Bogotá',
  MDE: 'Medellín (Rionegro)',
  EOH: 'Medellín (Olaya Herrera)',
  CLO: 'Cali',
  CTG: 'Cartagena',
  BAQ: 'Barranquilla',
  SMR: 'Santa Marta',
  ADZ: 'San Andrés',
  PVA: 'Providencia',
  PEI: 'Pereira',
  AXM: 'Armenia',
  MZL: 'Manizales',
  CUC: 'Cúcuta',
  BGA: 'Bucaramanga',
  LET: 'Leticia',
  VVC: 'Villavicencio',
  NVA: 'Neiva',
  PSO: 'Pasto',
  PPN: 'Popayán',
  MTR: 'Montería',
  VUP: 'Valledupar',
  RCH: 'Riohacha',
  IBE: 'Ibagué',
  EYP: 'Yopal',
  AUC: 'Arauca',
  UIB: 'Quibdó',
  APO: 'Apartadó (Carepa)',
  TCO: 'Tumaco',
  FLA: 'Florencia',
  PUU: 'Puerto Asís',
  CZU: 'Corozal (Sincelejo)',
  EJA: 'Barrancabermeja',
  NQU: 'Nuquí',
  BSC: 'Bahía Solano',
  GPI: 'Guapi',
  IPI: 'Ipiales',
  MVP: 'Mitú',
  PCR: 'Puerto Carreño',
  PDA: 'Puerto Inírida',
  SJE: 'San José del Guaviare',
  CPB: 'Capurganá',
  LQM: 'Puerto Leguízamo',
  OCV: 'Ocaña',
  TME: 'Tame',
  CAQ: 'Caucasia',
  RVE: 'Saravena',
}

/**
 * Aeropuertos del exterior que se reconocen: los destinos y conexiones de una agencia
 * colombiana. Solo sirven para NO avisar; si falta uno, el vuelo igual cuenta como
 * internacional.
 *
 * ⚠️ Quedan fuera a propósito los códigos que en mayúsculas se confunden con una
 * palabra de un nombre de ciudad: `SAN` (San Diego) en «SAN ANDRÉS», `LAS` (Las Vegas)
 * en «ISLA DE LAS…», `DEL` (Delhi), `SAL` (San Salvador). Un «SAN ANDRÉS ISLA» escrito en
 * mayúsculas no puede volverse un vuelo a San Diego.
 */
const AEROPUERTOS_EXTERIOR = new Set([
  // Norteamérica
  'MIA', 'MCO', 'FLL', 'TPA', 'JFK', 'EWR', 'LGA', 'BOS', 'IAD', 'ATL', 'ORD', 'IAH', 'DFW',
  'LAX', 'SFO', 'YYZ', 'YUL',
  // México, Centroamérica y el Caribe
  'CUN', 'MEX', 'GDL', 'SJD', 'PVR', 'PTY', 'SJO', 'LIR', 'GUA', 'SDQ', 'PUJ', 'HAV', 'VRA',
  'MBJ', 'AUA', 'CUR', 'BON', 'SXM', 'SJU', 'NAS',
  // Suramérica
  'UIO', 'GYE', 'GPS', 'LIM', 'CUZ', 'SCL', 'EZE', 'AEP', 'GRU', 'GIG', 'MVD', 'CCS', 'ASU',
  'VVI', 'LPB',
  // Europa
  'MAD', 'BCN', 'LIS', 'OPO', 'CDG', 'ORY', 'FCO', 'MXP', 'VCE', 'AMS', 'FRA', 'MUC', 'LHR',
  'LGW', 'ZRH', 'IST', 'ATH', 'DUB', 'BRU', 'VIE', 'PRG',
  // Otros
  'DXB', 'DOH', 'TLV', 'NRT', 'HND', 'ICN', 'BKK', 'SIN', 'SYD',
])

/**
 * Ciudades de Colombia por nombre, para cuando la lectura no trajo el código.
 *
 * ⚠️ Quedan fuera los nombres que también son de otro lugar: «Armenia» (el país),
 * «Florencia» (Italia), «Cartagena» (España), «Providencia» (Chile). Escritos solos no
 * alcanzan para decir que el vuelo es nacional; con su código (`AXM`, `FLA`, `CTG`,
 * `PVA`) sí se reconocen.
 */
const CIUDADES_COLOMBIA = [
  'bogota', 'medellin', 'rionegro', 'cali', 'barranquilla', 'santa marta', 'san andres',
  'pereira', 'manizales', 'cucuta', 'bucaramanga', 'leticia', 'villavicencio', 'neiva',
  'pasto', 'popayan', 'monteria', 'valledupar', 'riohacha', 'ibague', 'yopal', 'quibdo',
  'apartado', 'carepa', 'tumaco', 'puerto asis', 'sincelejo', 'barrancabermeja', 'nuqui',
  'bahia solano', 'guapi', 'ipiales', 'mitu', 'puerto carreno', 'inirida',
  'san jose del guaviare', 'capurgana', 'ocana',
]

/** Ciudades del exterior por nombre. Igual que los códigos: solo evitan el aviso. */
const CIUDADES_EXTERIOR = [
  'miami', 'orlando', 'fort lauderdale', 'nueva york', 'new york', 'los angeles',
  'las vegas', 'cancun', 'ciudad de mexico', 'guadalajara', 'los cabos', 'puerto vallarta',
  'panama', 'san jose de costa rica', 'punta cana', 'santo domingo', 'la habana', 'aruba',
  'curazao', 'quito', 'guayaquil', 'lima', 'cusco', 'santiago de chile', 'buenos aires',
  'sao paulo', 'rio de janeiro', 'montevideo', 'madrid', 'barcelona', 'lisboa', 'paris',
  'roma', 'milan', 'venecia', 'amsterdam', 'londres', 'estambul', 'dubai',
]

/** Sin tildes, minúsculas, espacios simples. Misma idea que la clave de los grupos. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** ¿El texto contiene ese nombre como palabras completas? «cali» no está en «california». */
function contieneNombre(textoNormalizado: string, nombre: string): boolean {
  return ` ${textoNormalizado} `.includes(` ${nombre} `)
}

/**
 * Dónde queda un origen o un destino leído del pantallazo.
 *
 * Orden: 1) un código IATA que se reconozca; 2) el nombre de la ciudad; 3) nada, y
 * entonces `desconocido`. Un código de Colombia y uno del exterior en el mismo texto
 * dan `exterior`: con la duda se ofrece, no se quita.
 */
export function dondeQueda(texto: string | null | undefined): LugarLeido {
  const crudo = (texto ?? '').trim()
  if (crudo === '') return { donde: 'desconocido', texto: '' }

  // Los códigos se buscan SOLO entre las palabras de tres letras en mayúsculas del
  // texto original: «Cali» no es un código, «CLO» sí.
  const codigos = crudo.match(/\b[A-Z]{3}\b/g) ?? []
  let hayColombia = false
  let hayExterior = false
  for (const c of codigos) {
    if (c in AEROPUERTOS_COLOMBIA) hayColombia = true
    else if (AEROPUERTOS_EXTERIOR.has(c)) hayExterior = true
  }
  if (hayExterior) return { donde: 'exterior', texto: crudo }
  if (hayColombia) return { donde: 'colombia', texto: crudo }

  const n = normalizar(crudo)
  if (CIUDADES_EXTERIOR.some(c => contieneNombre(n, c))) return { donde: 'exterior', texto: crudo }
  if (CIUDADES_COLOMBIA.some(c => contieneNombre(n, c))) return { donde: 'colombia', texto: crudo }

  return { donde: 'desconocido', texto: crudo }
}

export interface AlcanceDelVuelo {
  internacional: boolean
  /**
   * Los lugares que no se reconocieron, tal como llegaron. Vacío = la decisión es
   * firme. Con algo aquí, el vuelo se trató como internacional y hay que decirlo.
   */
  sinReconocer: string[]
}

/**
 * ¿Un vuelo con este origen y este destino es internacional?
 *
 * Nacional solo si los DOS quedan en Colombia. Un lado vacío o que no se reconoce cuenta
 * como internacional y se nombra en `sinReconocer` («sin origen» si no llegó nada).
 */
export function alcanceDelVuelo(origen: string | null | undefined, destino: string | null | undefined): AlcanceDelVuelo {
  const lados = [
    { lugar: dondeQueda(origen), cual: 'origen' },
    { lugar: dondeQueda(destino), cual: 'destino' },
  ]
  const sinReconocer = lados
    .filter(l => l.lugar.donde === 'desconocido')
    .map(l => l.lugar.texto === '' ? `sin ${l.cual}` : l.lugar.texto)
  const internacional = lados.some(l => l.lugar.donde !== 'colombia')
  return { internacional, sinReconocer }
}
