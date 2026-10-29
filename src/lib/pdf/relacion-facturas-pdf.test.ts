import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import fs from 'node:fs'
import { renderToBuffer } from '@react-pdf/renderer'
import RelacionFacturasPDF from './relacion-facturas-pdf'
import { fmtCurrency } from './formato'
import { textoDelPDF } from './texto-del-pdf'

/**
 * Relación de facturas con la plantilla del 2026-10-28 (SOE-033): ficha por factura.
 * Se afirma sobre el TEXTO del PDF renderizado.
 */

const DATOS_BASE = {
  numero_factura: 'FEMM12345',
  // Bancolombia: NIT limpio cuyo último dígito también es un DV válido de los
  // anteriores. Si la ficha adivinara el DV, imprimiría 89090393.
  nit_proveedor: '890903938',
  nombre_proveedor: 'MOTORES Y MAQUINAS S.A.',
  marca: 'BYD',
  linea: 'DOLPHIN MINI GS 2026',
  tipo_vehiculo: 'Eléctrico',
  valor_unitario_sin_iva: '86380952',
  valor_iva: '4319048',
  nombre_solicitante: 'ANA MARIA GOMEZ',
  numero_identificacion: '43567890',
  municipio: 'Medellín',
  email: 'ana@correo.co',
  telefono: '3001234567',
  fecha_factura: '2026-03-05',
  numero_caso_upme: 'VEH_GEE20262260',
  fecha_certificado: '2026-05-08',
}

type DatosRelacion = Parameters<typeof RelacionFacturasPDF>[0]['datos']

function render(datos: DatosRelacion, fechaGeneracion = '2026-10-29T15:00:00.000Z') {
  const el = createElement(RelacionFacturasPDF, { datos, fechaGeneracion, codigoNegocio: 'V0000' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(el as any)
}

/**
 * Ver `plano` en la prueba de la declaración: se compara sin espacios. Además, con
 * Helvetica las rayas viajan en WinAnsi (0x96 «–», 0x97 «—») y el extractor las lee
 * como latin1: se devuelven a su carácter para poder buscar la casilla vacía «—».
 */
const plano = (t: string) =>
  t.replace(/\x96/g, '–').replace(/\x97/g, '—').replace(/[\s ]+/g, '')

async function texto(datos: DatosRelacion, fecha?: string) {
  const buf = await render(datos, fecha)
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  return plano(textoDelPDF(buf))
}

/** Los datos de prueba no traen guiones: cualquiera que aparezca es inventado. */
const guiones = (t: string) => (t.match(/-/g) ?? []).length

describe('un titular con el certificado UPME completo', () => {
  it('encabezado con la fecha de generación en Bogotá y el tipo de vehículo en el asunto', async () => {
    const t = await texto(DATOS_BASE, '2026-10-30T02:30:00.000Z')
    expect(t).toContain(plano('Medellín, 29 de octubre de 2026'))
    expect(t).toContain(plano('Adquisición de vehículo eléctrico)'))
    expect(t).toContain(plano('a la adquisición del vehículo eléctrico, certificado por la UPME:'))
    expect(t).toContain(plano('a los 29 días del mes de octubre de 2026.'))
  }, 30_000)

  it('la ficha trae cada fila de la plantilla con su valor', async () => {
    const t = await texto(DATOS_BASE)
    for (const fila of [
      'FACTURA ELECTRÓNICA No. 1',
      'Tipo de documento Factura electrónica de venta',
      'N.° de factura (incluye prefijo) FEMM12345',
      'Fecha de expedición 05/03/2026',
      'Tarifa de IVA pagada 5 %',
      'NIT del proveedor 890903938',
      'Dígito de verificación (DV) 8',
      'Nombre o razón social MOTORES Y MAQUINAS S.A.',
      'Descripción del bien BYD DOLPHIN MINI GS 2026',
      `Valor antes de IVA (COP) ${fmtCurrency('86380952')}`,
      `IVA pagado (COP) ${fmtCurrency('4319048')}`,
      `Valor IVA solicitado (COP) ${fmtCurrency('4319000')}`,
      'N.° certificado UPME VEH_GEE20262260',
      'Fecha certificado UPME 08/05/2026',
    ]) {
      expect(t, fila).toContain(plano(fila))
    }
  }, 30_000)

  it('tres totales: bienes, IVA pagado e IVA solicitado al mil', async () => {
    const t = await texto(DATOS_BASE)
    expect(t).toContain(plano(
      `TOTAL VALOR BIENES TOTAL IVA PAGADO TOTAL IVA SOLICITADO ${fmtCurrency('86380952')} ${fmtCurrency('4319048')} ${fmtCurrency('4319000')}`,
    ))
  }, 30_000)

  it('firma con nombre, cédula, correo y celular; sin marcadores ni guiones', async () => {
    const t = await texto(DATOS_BASE)
    expect(t).toContain(plano('ANA MARIA GOMEZ C.C. No. 43567890 Correo electrónico: ana@correo.co Celular: 3001234567'))
    expect(t).not.toContain('[')
    expect(t).not.toMatch(/Notainterna/)
    // El NIT ya no sale con guion: base y DV van en casillas separadas.
    expect(guiones(t)).toBe(0)
  }, 30_000)
})

describe('certificado UPME incompleto', () => {
  it('sin fecha del certificado la casilla muestra «—»', async () => {
    const t = await texto({ ...DATOS_BASE, fecha_certificado: null })
    expect(t).toContain(plano('N.° certificado UPME VEH_GEE20262260'))
    expect(t).toContain(plano('Fecha certificado UPME —'))
    expect(t).not.toContain('[')
  }, 30_000)

  it('sin radicado no afirma el certificado: «—» en la ficha y fuera del párrafo inicial', async () => {
    const t = await texto({ ...DATOS_BASE, numero_caso_upme: null, fecha_certificado: '2026-05-08' })
    expect(t).toContain(plano('N.° certificado UPME —'))
    expect(t).toContain(plano('Fecha certificado UPME —'))
    expect(t).not.toContain(plano('certificado por la UPME'))
    expect(t).toContain(plano('a la adquisición del vehículo eléctrico: FACTURA ELECTRÓNICA'))
    expect(t).not.toContain('08/05/2026')
    expect(t).not.toContain('[')
    expect(guiones(t)).toBe(0)
  }, 30_000)

  /** Una config que todavía no declara los campos nuevos sigue generando. */
  it('sin fecha de factura ni certificado (config vieja) genera con «—»', async () => {
    const { fecha_factura: _f, numero_caso_upme: _n, fecha_certificado: _c, ...viejos } = DATOS_BASE
    const t = await texto(viejos)
    expect(t).toContain(plano('Fecha de expedición —'))
  }, 30_000)

  it('sin valores no inventa la tarifa', async () => {
    const t = await texto({ ...DATOS_BASE, valor_iva: null })
    expect(t).toContain(plano('Tarifa de IVA pagada [TARIFA DE IVA]'))
  }, 30_000)
})

describe('copropiedad', () => {
  it('plural y una firma completa por titular', async () => {
    const t = await texto({
      ...DATOS_BASE,
      nombre_solicitante_2: 'LUIS PEREZ TORO',
      numero_identificacion_2: '71234567',
      email_2: 'luis@correo.co',
      telefono_2: '3109876543',
    })
    expect(t).toContain(plano('Nosotros, ANA MARIA GOMEZ, identificado(a) con cédula de ciudadanía No. 43567890 y LUIS PEREZ TORO, identificado(a) con cédula de ciudadanía No. 71234567, en calidad de solicitantes, presentamos'))
    expect(t).toContain(plano('Declaramos que la información'))
    expect(t).toContain(plano('ANA MARIA GOMEZ C.C. No. 43567890 Correo electrónico: ana@correo.co Celular: 3001234567'))
    expect(t).toContain(plano('LUIS PEREZ TORO C.C. No. 71234567 Correo electrónico: luis@correo.co Celular: 3109876543'))
    expect(t).not.toContain('[')
    expect(guiones(t)).toBe(0)
  }, 30_000)
})

/** La misma guarda de la declaración juramentada (ver `B` en el componente). */
describe('negrita pegada a puntuación', () => {
  it('ningún </B> queda seguido de puntuación literal', () => {
    const fuente = fs.readFileSync(new URL('./relacion-facturas-pdf.tsx', import.meta.url), 'utf8')
    const pegadas = [...fuente.matchAll(/<\/B>[,.;:)]/g)].map((m) => m[0])
    expect(pegadas, 'la puntuación va DENTRO de la negrita').toEqual([])
  })
})
