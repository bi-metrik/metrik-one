import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import fs from 'node:fs'
import { renderToBuffer } from '@react-pdf/renderer'
import DeclaracionJuramentadaPDF, { clausulaSegundo } from './declaracion-juramentada-pdf'
import { fmtCurrency, fechaLarga } from './formato'

/**
 * La declaración juramentada es el documento que el solicitante firma BAJO
 * JURAMENTO, así que lo que se fija aquí no es el diseño (eso se mira renderizado),
 * sino las afirmaciones que el texto hace o deja de hacer según los datos que
 * existan en el expediente.
 */

const DATOS_BASE = {
  nombre_solicitante: 'ANA MARIA GOMEZ',
  numero_identificacion: '43567890',
  direccion: 'CR 43A # 1-50 APTO 902',
  municipio: 'Medellín',
  marca: 'BYD',
  linea: 'DOLPHIN MINI GS 2026',
  tipo_vehiculo: 'Eléctrico',
  fecha_factura: '2026-03-15',
  proveedor: 'MOTORES Y MAQUINAS S.A.',
  numero_factura: 'FEMM12345',
  valor_unitario_sin_iva: '86380952',
  valor_iva: '16412381',
  numero_caso_upme: 'VEH_GEE20262260',
  fecha_certificado: '2026-05-08',
}

describe('cláusula SEGUNDO — degradación sin certificado UPME', () => {
  it('con radicado y fecha imprime el texto íntegro de la plantilla', () => {
    const t = clausulaSegundo('VEH_GEE20262260', '8 de mayo de 2026')
    expect(t).toContain('Certificado Radicado No. VEH_GEE20262260')
    expect(t).toContain(', de fecha 8 de mayo de 2026,')
    expect(t).toContain('habilitando los incentivos de la Ley 1715 de 2014')
  })

  it('con radicado y SIN fecha se cae solo el trozo de la fecha', () => {
    const t = clausulaSegundo('VEH_GEE20262260', null)
    expect(t).toContain('Certificado Radicado No. VEH_GEE20262260, habilitando')
    expect(t).not.toContain('de fecha')
  })

  /**
   * El caso «solo IVA»: se salta la etapa de Certificación, así que no hay
   * radicado. La cláusula NO puede afirmar que existe un certificado UPME que el
   * expediente no tiene, ni dejar un marcador visible en un documento que va a la
   * DIAN. Se afirma únicamente lo que la factura prueba.
   */
  it('sin radicado no menciona la UPME, y no deja hueco ni marcador', () => {
    const t = clausulaSegundo(null, null)
    expect(t).not.toMatch(/UPME|Radicado|Ley 1715/)
    expect(t).not.toMatch(/\[|null|undefined|—/)
    expect(t).toBe('Que la factura relacionada en la Relación de Factura adjunta corresponde a la adquisición del vehículo descrito en la cláusula anterior.')
  })

  /** Una fecha suelta sin radicado tampoco resucita la mención al certificado. */
  it('la fecha sin radicado no basta para afirmar que hay certificado', () => {
    expect(clausulaSegundo(null, '8 de mayo de 2026')).not.toContain('UPME')
  })
})

describe('formatos del documento', () => {
  it('la moneda va en pesos sin decimales', () => {
    // El separador que mete Intl es un espacio DURO (U+00A0), no uno normal.
    expect(fmtCurrency('86380952')).toBe('$\u00a086.380.952')
  })

  it('sin valor devuelve el marcador que se le pase, no "NaN"', () => {
    expect(fmtCurrency(null, '[VALOR ANTES DE IVA]')).toBe('[VALOR ANTES DE IVA]')
  })

  /**
   * `new Date('2026-03-15')` es medianoche UTC: leída en Bogotá (UTC-5) retrocede
   * al 14. Una fecha de adquisición corrida un día contradice la factura adjunta.
   */
  it('la fecha larga NO se corre de día por zona horaria', () => {
    expect(fechaLarga('2026-03-15')).toBe('15 de marzo de 2026')
    expect(fechaLarga('2026-01-01')).toBe('1 de enero de 2026')
  })

  it('lo que no viene en ISO se devuelve tal cual, nunca "Invalid Date"', () => {
    expect(fechaLarga('15/03/2026')).toBe('15/03/2026')
    expect(fechaLarga(null, '[FECHA DE ADQUISICIÓN]')).toBe('[FECHA DE ADQUISICIÓN]')
  })
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

/**
 * Guarda de render: el componente es JSX puro sin pruebas de tipo en tiempo de
 * ejecución, y un `<Text>` mal anidado revienta solo al generar el PDF —es decir,
 * en producción, cuando el operador le da al botón. Estas dos llamadas son lo único
 * que ejercita el árbol completo en CI.
 */
type DatosDeclaracion = Parameters<typeof DeclaracionJuramentadaPDF>[0]['datos']

/**
 * `renderToBuffer` está tipado contra `DocumentProps`, no contra las props del
 * componente; el escape es el mismo que usa `formulario-actions` al construir el
 * elemento con `createElement`.
 */
function renderDeclaracion(datos: DatosDeclaracion) {
  const el = createElement(DeclaracionJuramentadaPDF, {
    datos, fechaGeneracion: '2026-09-07', codigoNegocio: 'V0000',
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(el as any)
}

describe('render', () => {
  it('un titular genera un PDF válido', async () => {
    const buf = await renderDeclaracion(DATOS_BASE)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  }, 30_000)

  it('copropiedad y caso solo IVA también generan PDF válido', async () => {
    const buf = await renderDeclaracion({
      ...DATOS_BASE,
      numero_caso_upme: null,
      fecha_certificado: null,
      nombre_solicitante_2: 'LUIS PEREZ TORO',
      numero_identificacion_2: '71234567',
      direccion_2: 'CL 100 # 8-60',
      municipio_2: 'Bogotá',
    })
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  }, 30_000)
})
