import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import fs from 'node:fs'
import { renderToBuffer } from '@react-pdf/renderer'
import DeclaracionJuramentadaPDF from './declaracion-juramentada-pdf'
import { fmtCurrency, fechaLarga } from './formato'
import { textoDelPDF } from './texto-del-pdf'

/**
 * La declaración juramentada es el documento que el solicitante firma BAJO
 * JURAMENTO, así que lo que se fija aquí no es el diseño (eso se mira renderizado),
 * sino las afirmaciones que el texto hace o deja de hacer según los datos que
 * existan en el expediente. Se afirma sobre el TEXTO DEL PDF, no sobre las props.
 *
 * Plantilla vigente: la del 2026-10-28 (SOE-033).
 */

const DATOS_BASE = {
  nombre_solicitante: 'ANA MARIA GOMEZ',
  numero_identificacion: '43567890',
  direccion: 'CR 43A # 1 50 APTO 902',
  municipio: 'Medellín',
  marca: 'BYD',
  linea: 'DOLPHIN MINI GS 2026',
  tipo_vehiculo: 'Eléctrico',
  fecha_factura: '2026-03-15',
  proveedor: 'MOTORES Y MAQUINAS S.A.',
  numero_factura: 'FEMM12345',
  valor_unitario_sin_iva: '86380952',
  valor_iva: '4319048',
  numero_caso_upme: 'VEH_GEE20262260',
  fecha_certificado: '2026-05-08',
}

const COPROPIEDAD = {
  nombre_solicitante_2: 'LUIS PEREZ TORO',
  numero_identificacion_2: '71234567',
  direccion_2: 'CL 100 # 8 60',
  municipio_2: 'Bogotá',
}

type DatosDeclaracion = Parameters<typeof DeclaracionJuramentadaPDF>[0]['datos']

/**
 * `renderToBuffer` está tipado contra `DocumentProps`, no contra las props del
 * componente; el escape es el mismo que usa `formulario-actions` al construir el
 * elemento con `createElement`.
 */
function renderDeclaracion(datos: DatosDeclaracion, fechaGeneracion = '2026-10-29T15:00:00.000Z') {
  const el = createElement(DeclaracionJuramentadaPDF, { datos, fechaGeneracion, codigoNegocio: 'V0000' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(el as any)
}

/**
 * El extractor une los trozos con espacios y un renglón puede cortar en cualquier
 * parte, así que se compara SIN espacios. Lo que se busca son frases, no maquetación.
 */
const plano = (t: string) =>
  // Rayas en WinAnsi (0x96 «–», 0x97 «—») leídas como latin1: a su carácter.
  t.replace(/\x96/g, '–').replace(/\x97/g, '—').replace(/[\s ]+/g, '')

async function texto(datos: DatosDeclaracion, fecha?: string) {
  const buf = await renderDeclaracion(datos, fecha)
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  return plano(textoDelPDF(buf))
}

/**
 * Guiones que el documento trae de verdad: «000673-int-0063» aparece dos veces en el
 * encabezado y dos en la cláusula de requisitos. Un guion de más es uno inventado por
 * el motor al cortar el renglón entre dos corridas (ver `B` en el componente). Los
 * datos de prueba no traen guiones a propósito, para que la cuenta sea exacta.
 */
const GUIONES_PROPIOS = 4
const guiones = (t: string) => (t.match(/-/g) ?? []).length

describe('un titular con el certificado UPME completo', () => {
  it('ata la factura y el certificado por número en PRIMERO a CUARTO', async () => {
    const t = await texto(DATOS_BASE)
    expect(t).toContain(plano('certificado por la UPME mediante Certificado Radicado No. VEH_GEE20262260 (factura No. FEMM12345).'))
    expect(t).toContain(plano('Que la factura No. FEMM12345 relacionada en la Relación de Factura adjunta'))
    expect(t).toContain(plano(`Radicado No. VEH_GEE20262260, de fecha ${fechaLarga('2026-05-08')}, habilitando`))
    expect(t).toContain(plano('respecto de la factura No. FEMM12345 y del Certificado UPME No. VEH_GEE20262260.'))
    expect(t).toContain(plano('correspondiente a la factura No. FEMM12345 y al Certificado UPME No. VEH_GEE20262260, no ha sido tratado'))
  }, 30_000)

  it('CUARTO lleva el IVA aproximado al mil; PRIMERO, el IVA exacto', async () => {
    const t = await texto(DATOS_BASE)
    expect(t).toContain(plano(`más IVA de ${fmtCurrency('4319048')}.`))
    expect(t).toContain(plano(`por valor de ${fmtCurrency('4319000')}, (valor aproximado`))
  }, 30_000)

  it('cierra con ciudad y fecha de generación (en Bogotá) y la firma de la plantilla', async () => {
    // 21:30 en Bogotá del 29 de octubre = 02:30 UTC del 30.
    const t = await texto(DATOS_BASE, '2026-10-30T02:30:00.000Z')
    expect(t).toContain(plano('Ciudad y fecha: Medellín, 29 de octubre de 2026'))
    expect(t).toContain(plano('Firma Nombre: ANA MARIA GOMEZ C.C.: 43567890'))
  }, 30_000)

  it('sin marcadores, sin la nota interna, sin valor total y sin guiones inventados', async () => {
    const t = await texto(DATOS_BASE)
    expect(t).not.toContain('[')
    expect(t).not.toMatch(/Notainterna|borrarantes/)
    expect(t).not.toMatch(/valortotal/i)
    expect(guiones(t)).toBe(GUIONES_PROPIOS)
  }, 30_000)
})

describe('red de seguridad UPME', () => {
  it('sin fecha del certificado se cae solo «, de fecha …»', async () => {
    const t = await texto({ ...DATOS_BASE, fecha_certificado: null })
    expect(t).toContain(plano('Certificado Radicado No. VEH_GEE20262260, habilitando'))
    expect(t).not.toContain(plano('de fecha'))
    expect(t).toContain(plano('y del Certificado UPME No. VEH_GEE20262260.'))
    expect(t).not.toContain('[')
  }, 30_000)

  /**
   * El documento se firma bajo juramento: sin radicado no puede afirmar que existe
   * un certificado UPME, ni dejar un marcador visible. Se afirma solo lo que la
   * factura prueba.
   */
  it('sin radicado no menciona la UPME en ninguna cláusula, ni deja hueco ni marcador', async () => {
    const t = await texto({ ...DATOS_BASE, numero_caso_upme: null, fecha_certificado: null })
    expect(t).not.toMatch(/UPME|Radicado/)
    expect(t).not.toContain('[')
    expect(t).not.toMatch(/null|undefined/)
    expect(t).toContain(plano('Que la factura No. FEMM12345 relacionada en la Relación de Factura adjunta corresponde a la adquisición del vehículo descrito en la cláusula anterior.'))
    expect(t).toContain(plano('respecto de la factura No. FEMM12345. CUARTO.'))
    expect(t).toContain(plano('correspondiente a la factura No. FEMM12345, no ha sido tratado'))
    // La segunda frase de PRIMERO se retira entera.
    expect(t).not.toContain(plano('Que la factura relacionada corresponde'))
    expect(guiones(t)).toBe(GUIONES_PROPIOS)
  }, 30_000)

  /** Una fecha suelta sin radicado tampoco resucita la mención al certificado. */
  it('la fecha sin radicado no basta para afirmar que hay certificado', async () => {
    const t = await texto({ ...DATOS_BASE, numero_caso_upme: null })
    expect(t).not.toMatch(/UPME|defecha/)
  }, 30_000)
})

describe('copropiedad', () => {
  it('plural, autorización como QUINTO, requisitos como SEXTO y una firma por titular', async () => {
    const t = await texto({ ...DATOS_BASE, ...COPROPIEDAD })
    expect(t).toContain(plano('Nosotros, ANA MARIA GOMEZ,'))
    expect(t).toContain(plano('y LUIS PEREZ TORO,'))
    expect(t).toContain(plano('manifestamos BAJO LA GRAVEDAD DE JURAMENTO'))
    expect(t).toContain(plano('expedida a nombre de ANA MARIA GOMEZ y LUIS PEREZ TORO,'))
    expect(t).toContain(plano('ni privada, a ninguno de los dos propietarios, respecto de la factura No. FEMM12345 y del Certificado UPME No. VEH_GEE20262260.'))
    expect(t).toContain(plano('no ha sido tratado por ninguno de los propietarios'))
    expect(t).toContain(plano('QUINTO. Que LUIS PEREZ TORO,'))
    expect(t).toContain(plano('SEXTO. Que se cumplen todos los requisitos'))
    expect(t).toContain(plano('Nombre: ANA MARIA GOMEZ C.C.: 43567890'))
    expect(t).toContain(plano('Nombre: LUIS PEREZ TORO C.C.: 71234567'))
    expect(t).not.toContain('[')
    expect(guiones(t)).toBe(GUIONES_PROPIOS)
  }, 30_000)
})

/**
 * Guarda de la regla de puntuación que documenta `B` en el componente.
 *
 * `@react-pdf` imprime un guion inventado cuando una corrida de texto termina y la
 * siguiente empieza con puntuación pegada: se midió `S05 MAX 2027-` en el texto del
 * PDF, con la coma en el renglón siguiente. No lo evita `hyphenationCallback` —el
 * guion no sale de partir una palabra— así que la única defensa es no crear el
 * límite, y eso se ve leyendo la fuente, no renderizando: el defecto solo aparece
 * cuando el renglón corta justo ahí, o sea con unos datos sí y con otros no.
 */
describe('negrita pegada a puntuación', () => {
  it('ningún </B> queda seguido de puntuación literal', () => {
    const fuente = fs.readFileSync(new URL('./declaracion-juramentada-pdf.tsx', import.meta.url), 'utf8')
    // Sin `\s*`: un espacio (o un salto de línea de JSX, que colapsa a espacio)
    // convierte el límite en un punto de corte normal y no imprime guion. Lo que
    // rompe es la puntuación pegada. Las expresiones `{...}` quedan fuera del
    // alcance de esta guarda: su contenido no se puede leer con una expresión regular.
    const pegadas = [...fuente.matchAll(/<\/B>[,.;:)]/g)].map((m) => m[0])
    expect(pegadas, 'la puntuación va DENTRO de la negrita').toEqual([])
  })
})
