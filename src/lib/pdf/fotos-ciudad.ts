/**
 * Banco PROVISIONAL de fotos por ciudad para el documento de viaje de Trappvel.
 *
 * Brief: `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-22-fotos-provisionales.md`.
 *
 * ⚠️ Es provisional a propósito. El banco real (§5 de `propuesta-visual.md`: una tabla por
 * ciudad, curada por Trappvel) sigue sin construirse porque falta decidir QUIÉN aprueba
 * una foto antes de que salga a un cliente. Mientras tanto van estas, elegidas a ojo de
 * Wikimedia Commons el 22-sep y aprobadas por Mauricio como «las fotos estándar».
 *
 * ## El contrato que hace fácil reemplazarlo
 *
 * `fotosDeCiudad(ciudad)` es la ÚNICA puerta. Nadie más conoce la lista, las claves ni
 * dónde viven los archivos. El día que exista el banco real se reescribe esta función (y
 * se vuelve async, porque leerá la base) y lo demás no se entera.
 *
 * Las imágenes viven en `src/lib/pdf/templates/fotos-ciudad/` y no en `public/`: esa
 * carpeta ya la arrastra el empaquetado a toda función de Vercel
 * (`outputFileTracingIncludes` de `next.config.ts`), el mismo camino por el que el
 * formulario 010 lee su PDF base en producción. En `public/` las serviría el CDN, pero la
 * función que renderiza el PDF no las tendría en disco.
 *
 * ## Qué se descartó del pliego de 43 y por qué
 *
 * - `1-providencia-5`: es la Isla de los Leprosos, en el Zulia (Venezuela), no Providencia.
 *   El pliego la contaba como Providencia; con ella fuera, Providencia queda con dos.
 * - `2-bogota-5`: Commons no trae autor legible, y su licencia (BY-SA) obliga a nombrarlo.
 * - `2-san-andres-3` y `2-san-andres-4`: son hoteles concretos (Decameron, Sunrise). Como
 *   foto «de la ciudad» le dirían al cliente que se hospeda ahí.
 * - `2-roma-3` (un campus universitario) y `2-cancun-1` (una torre de aeropuerto): no son
 *   foto de viaje.
 * - El resto no se descartó: quedó fuera porque dos por ciudad alcanzan (portada y una
 *   distinta para el cuerpo). Siguen en el pliego para el banco real.
 */

import fs from 'node:fs'
import path from 'node:path'

/** Una foto del banco, con lo que la licencia obliga a decir de ella. */
export interface FotoCiudad {
  /** La ciudad canónica del banco. Dos textos que nombran la misma ciudad dan la misma. */
  ciudad: string
  /** Ruta absoluta al archivo en disco. @react-pdf la lee con `fs`. */
  ruta: string
  /** Mayúscula sostenida, como en los itinerarios de referencia: `SAN ANDRÉS · JOHNNY CAY`. */
  rotulo: string
  autor: string
  licencia: string
  /** El crédito tal como se imprime: `Felviper (Wikimedia Commons, CC BY-SA 4.0)`. */
  credito: string
}

const CARPETA = path.join(process.cwd(), 'src/lib/pdf/templates/fotos-ciudad')

interface Entrada {
  archivo: string
  rotulo: string
  autor: string
  licencia: string
  /** La página de Commons, para poder volver a la fuente. No se imprime. */
  fuente: string
}

interface CiudadDelBanco {
  /**
   * Todas las formas en que la ciudad puede llegar, YA normalizadas (`claveDeCiudad`).
   * El código IATA del aeropuerto va aquí porque así llega el destino de un vuelo leído
   * del pantallazo: «Providencia PVA».
   */
  claves: string[]
  /** En orden: la primera es la de portada, la segunda la del cuerpo del documento. */
  fotos: Entrada[]
}

/**
 * ⚠️ Una ciudad que dos textos nombran distinto tiene UNA entrada con varias claves, no
 * dos entradas. Dos entradas partirían la ciudad y el documento podría imprimir dos fotos
 * de Providencia creyendo que son de dos ciudades.
 */
const BANCO: Record<string, CiudadDelBanco> = {
  cancun: {
    claves: ['cancun', 'cun'],
    fotos: [
      {
        archivo: 'cancun-1.jpg',
        rotulo: 'CANCÚN · PLAYA DEL CARIBE',
        autor: 'Luka Peternel',
        licencia: 'CC BY-SA 4.0',
        fuente: 'https://commons.wikimedia.org/wiki/File:Cancun-beach-Mexico-2016-Luka-Peternel.jpg',
      },
      {
        archivo: 'cancun-2.jpg',
        rotulo: 'CANCÚN · VISTA AÉREA DE LA COSTA',
        autor: 'dronepicr',
        licencia: 'CC BY 2.0',
        fuente: 'https://commons.wikimedia.org/wiki/File:Cancun_Strand_Luftbild_(21552302623).jpg',
      },
    ],
  },
  'ciudad de mexico': {
    claves: ['ciudad de mexico', 'cdmx', 'mexico df', 'mexico d f', 'mexico city', 'mex'],
    fotos: [
      {
        archivo: 'ciudad-de-mexico-1.jpg',
        rotulo: 'CIUDAD DE MÉXICO · CATEDRAL METROPOLITANA',
        autor: 'ProtoplasmaKid',
        licencia: 'CC BY-SA 4.0',
        fuente: 'https://commons.wikimedia.org/wiki/File:Catedral_Metropolitana_de_la_Ciudad_de_M%C3%A9xico_1.jpg',
      },
      {
        archivo: 'ciudad-de-mexico-2.jpg',
        rotulo: 'CIUDAD DE MÉXICO · BASÍLICA DE GUADALUPE',
        autor: 'Drkgk',
        licencia: 'CC0',
        fuente: 'https://commons.wikimedia.org/wiki/File:Bas%C3%ADlica_de_Santa_Mar%C3%ADa_de_Guadalupe_2018.jpg',
      },
    ],
  },
  madrid: {
    claves: ['madrid', 'mad'],
    fotos: [
      {
        archivo: 'madrid-1.jpg',
        rotulo: 'MADRID · PLAZA MAYOR',
        autor: 'Matt Joseph',
        licencia: 'CC BY-SA 4.0',
        fuente: 'https://commons.wikimedia.org/wiki/File:2026-09-03_-_Plaza_Mayor_in_Madrid_Spain.jpg',
      },
      {
        archivo: 'madrid-2.jpg',
        rotulo: 'MADRID · PALACIO REAL',
        autor: 'Alvesgaspar',
        licencia: 'CC BY-SA 3.0',
        fuente: 'https://commons.wikimedia.org/wiki/File:Madrid_May_2014-35a.jpg',
      },
    ],
  },
  roma: {
    claves: ['roma', 'rome', 'fco', 'cia'],
    fotos: [
      {
        archivo: 'roma-1.jpg',
        rotulo: 'ROMA · COLISEO',
        autor: 'Wilfredor',
        licencia: 'CC0',
        fuente: 'https://commons.wikimedia.org/wiki/File:Colosseum_of_Rome,_Italy.jpg',
      },
      {
        archivo: 'roma-2.jpg',
        rotulo: 'ROMA · FONTANA DI TREVI',
        autor: 'Wilfredor',
        licencia: 'CC0',
        fuente: 'https://commons.wikimedia.org/wiki/File:Fontaine_Trevi_-_Rome.jpg',
      },
    ],
  },
  paris: {
    claves: ['paris', 'cdg', 'ory'],
    fotos: [
      {
        archivo: 'paris-1.jpg',
        rotulo: 'PARÍS · EL SENA DESDE EL PONT D’IÉNA',
        autor: 'DimiTalen',
        licencia: 'CC0',
        fuente: 'https://commons.wikimedia.org/wiki/File:View_up_the_Seine_from_Pont_d%27I%C3%A9na,_Paris,_2016.jpg',
      },
      {
        archivo: 'paris-2.jpg',
        rotulo: 'PARÍS · CAMPOS ELÍSEOS',
        autor: 'Josh Hallett',
        licencia: 'CC BY-SA 2.0',
        fuente: 'https://commons.wikimedia.org/wiki/File:Avenue_des_Champs-%C3%89lys%C3%A9es_July_24,_2009_N1.jpg',
      },
    ],
  },
  bogota: {
    claves: ['bogota', 'bogota d c', 'bogota dc', 'bog'],
    fotos: [
      {
        archivo: 'bogota-1.jpg',
        rotulo: 'BOGOTÁ · MONSERRATE',
        autor: 'Felipe Restrepo Acosta',
        licencia: 'CC BY-SA 4.0',
        fuente: 'https://commons.wikimedia.org/wiki/File:2017_Bogot%C3%A1_Bas%C3%ADlica_del_Se%C3%B1or_Ca%C3%ADdo_de_Monserrate.jpg',
      },
      {
        archivo: 'bogota-2.jpg',
        rotulo: 'BOGOTÁ · PANORÁMICA DE USAQUÉN',
        autor: 'Alejandro Turola',
        licencia: 'CC0',
        fuente: 'https://commons.wikimedia.org/wiki/File:Panor%C3%A1mica_de_Usaquen,_Bogot%C3%A1_D.C.jpg',
      },
    ],
  },
  'san andres': {
    claves: ['san andres', 'san andres islas', 'san andres isla', 'isla de san andres', 'adz'],
    fotos: [
      {
        archivo: 'san-andres-1.jpg',
        rotulo: 'SAN ANDRÉS · JOHNNY CAY',
        autor: 'Jorge Dos Oceanos',
        licencia: 'CC BY-SA 3.0',
        fuente: 'https://commons.wikimedia.org/wiki/File:Johnny_Cay.jpg',
      },
      {
        archivo: 'san-andres-2.jpg',
        rotulo: 'SAN ANDRÉS · EL ACUARIO',
        autor: 'Mr.Jhosimar',
        licencia: 'CC BY-SA 4.0',
        fuente: 'https://commons.wikimedia.org/wiki/File:Acuario_de_San_Andr%C3%A9s_Islas.JPG',
      },
    ],
  },
  providencia: {
    claves: ['providencia', 'isla de providencia', 'providencia isla', 'old providence', 'pva'],
    fotos: [
      {
        archivo: 'providencia-1.jpg',
        rotulo: 'PROVIDENCIA · MCBEAN LAGOON',
        autor: 'Felviper',
        licencia: 'CC BY-SA 4.0',
        fuente: 'https://commons.wikimedia.org/wiki/File:Panorama_Old_Providence_McBean_Lagoon.JPG',
      },
      {
        archivo: 'providencia-2.jpg',
        rotulo: 'PROVIDENCIA · THE PEAK',
        autor: 'Felviper',
        licencia: 'CC BY-SA 4.0',
        fuente: 'https://commons.wikimedia.org/wiki/File:The_Peak_en_Providencia.JPG',
      },
    ],
  },
}

/**
 * La forma única en que se compara el nombre de una ciudad: sin tildes, en minúscula,
 * sin puntuación y con un solo espacio. `San Andrés`, `SAN ANDRES` y `san  andres` dan
 * `san andres`.
 */
export function claveDeCiudad(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const POR_CLAVE: Map<string, string> = new Map(
  Object.entries(BANCO).flatMap(([ciudad, c]) => c.claves.map(k => [k, ciudad] as [string, string])),
)

/**
 * Las claves a probar, en orden, para un texto que puede traer pegado el código IATA:
 * «Providencia PVA» prueba `providencia pva`, luego `providencia`, luego `pva`.
 *
 * ⚠️ El código se separa SOLO si viene en mayúscula, que es como lo escribe la lectura
 * del pantallazo. Quitar a ciegas la última palabra de tres letras le cortaría la ciudad
 * a «La Paz».
 */
function clavesCandidatas(texto: string): string[] {
  const candidatas = [claveDeCiudad(texto)]
  const iata = /^(.*\S)\s+([A-Z]{3})$/.exec(texto.trim())
  if (iata) candidatas.push(claveDeCiudad(iata[1]), claveDeCiudad(iata[2]))
  return candidatas.filter(Boolean)
}

/** La licencia en palabras para el pie de créditos. */
function creditoDe(e: Entrada): string {
  return `${e.autor} (Wikimedia Commons, ${e.licencia})`
}

/**
 * Las fotos del banco para una ciudad, en orden (la primera es la de portada). Vacío si
 * la ciudad no está en el banco.
 *
 * ⚠️ Una foto cuyo archivo no está en disco NO se devuelve. Si el empaquetado algún día
 * deja la carpeta fuera, el documento sale con la portada de marca de siempre en vez de
 * un recuadro vacío donde iba la foto.
 */
export function fotosDeCiudad(ciudad: string): FotoCiudad[] {
  const id = clavesCandidatas(ciudad).map(k => POR_CLAVE.get(k)).find(Boolean)
  if (!id) return []
  return BANCO[id].fotos
    .map(e => ({
      ciudad: id,
      ruta: path.join(CARPETA, e.archivo),
      rotulo: e.rotulo,
      autor: e.autor,
      licencia: e.licencia,
      credito: creditoDe(e),
    }))
    .filter(f => fs.existsSync(f.ruta))
}
