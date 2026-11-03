/**
 * La versión 1 dice LO MISMO que el componente @react-pdf de hoy.
 *
 * Se compara el texto extraído del PDF de @react-pdf contra:
 *  - siempre: el texto del HTML que se imprime (lo que Chromium pinta), y
 *  - con `CHROMIUM_EJECUTABLE`: el texto extraído del PDF de Chromium. Con
 *    `PLANTILLAS_PDF_SALIDA=<carpeta>` además deja los PDF de cada caso ahí.
 *
 * Sin espacios: el corte de renglón es de cada motor; las palabras y su orden no.
 */
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { renderToBuffer } from '@react-pdf/renderer'
import { extractText, getDocumentProxy } from 'unpdf'
import DeclaracionJuramentadaPDF from '@/lib/pdf/declaracion-juramentada-pdf'
import RelacionFacturasPDF from '@/lib/pdf/relacion-facturas-pdf'
import { htmlDelDocumento } from './html'
import { validarPlantilla } from './validar'
import { DJ_V1, RELACION_V1 } from './v1'
import type { Datos, TipoPlantilla } from './catalogo'

const FECHA = '2026-10-29T15:00:00.000Z'
const CTX = { fechaGeneracion: FECHA, codigoNegocio: 'V0000' }

const DJ_BASE: Datos = {
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

const REL_BASE: Datos = {
  numero_factura: 'FEMM12345',
  nit_proveedor: '890900608',
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
  fecha_factura: '2026-03-15',
  numero_caso_upme: 'VEH_GEE20262260',
  fecha_certificado: '2026-05-08',
}

const COPROP_DJ: Datos = {
  nombre_solicitante_2: 'LUIS PEREZ TORO',
  numero_identificacion_2: '71234567',
  direccion_2: 'CL 100 # 8 60',
  municipio_2: 'Bogotá',
}
const COPROP_REL: Datos = {
  nombre_solicitante_2: 'LUIS PEREZ TORO',
  numero_identificacion_2: '71234567',
  email_2: 'luis@correo.co',
  telefono_2: '3109876543',
}

export const CASOS: Record<string, { dj: Datos; rel: Datos }> = {
  completo: { dj: DJ_BASE, rel: REL_BASE },
  'sin-fecha-certificado': { dj: { ...DJ_BASE, fecha_certificado: null }, rel: { ...REL_BASE, fecha_certificado: null } },
  'sin-radicado': {
    dj: { ...DJ_BASE, numero_caso_upme: null, fecha_certificado: null },
    rel: { ...REL_BASE, numero_caso_upme: null, fecha_certificado: null },
  },
  'dos-titulares': { dj: { ...DJ_BASE, ...COPROP_DJ }, rel: { ...REL_BASE, ...COPROP_REL } },
}

async function pdfReact(tipo: TipoPlantilla, datos: Datos): Promise<Buffer> {
  const Comp = (tipo === 'declaracion-juramentada' ? DeclaracionJuramentadaPDF : RelacionFacturasPDF) as unknown as (
    p: { datos: Datos; fechaGeneracion: string; codigoNegocio: string },
  ) => null
  const el = createElement(Comp, { datos, fechaGeneracion: FECHA, codigoNegocio: 'V0000' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Buffer.from(await renderToBuffer(el as any))
}

async function textoPdf(buf: Buffer): Promise<{ texto: string; paginas: number }> {
  const doc = await getDocumentProxy(new Uint8Array(buf))
  const { text, totalPages } = await extractText(doc, { mergePages: true })
  return { texto: text as string, paginas: totalPages }
}

/** Texto visible del HTML: lo que Chromium pinta (sin `<head>`). */
function textoHtml(html: string): string {
  const cuerpo = html.slice(html.indexOf('<body>'))
  return cuerpo
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

const plano = (s: string) => s.normalize('NFC').replace(/[\s  ]+/g, '')

const PLANTILLA: Record<TipoPlantilla, string> = {
  'declaracion-juramentada': DJ_V1,
  'relacion-facturas': RELACION_V1,
}

describe('la versión 1 es válida', () => {
  for (const tipo of ['declaracion-juramentada', 'relacion-facturas'] as TipoPlantilla[]) {
    it(`${tipo}: sin errores y con todos los requisitos`, () => {
      const v = validarPlantilla(tipo, PLANTILLA[tipo])
      expect(v.errores).toEqual([])
      expect(v.faltantes).toEqual([])
    })
  }
})

describe('la versión 1 dice lo mismo que el componente @react-pdf', () => {
  for (const [caso, datos] of Object.entries(CASOS)) {
    for (const tipo of ['declaracion-juramentada', 'relacion-facturas'] as TipoPlantilla[]) {
      const d = tipo === 'declaracion-juramentada' ? datos.dj : datos.rel
      it(`${tipo} · ${caso}`, async () => {
        const referencia = plano((await textoPdf(await pdfReact(tipo, d))).texto)
        const r = htmlDelDocumento(tipo, PLANTILLA[tipo], d, CTX)
        expect(r.errores).toEqual([])
        expect(plano(textoHtml(r.html))).toBe(referencia)
      }, 30_000)
    }
  }
})

const CHROMIUM = process.env.CHROMIUM_EJECUTABLE
describe.skipIf(!CHROMIUM)('con Chromium: el PDF de la versión 1 dice lo mismo', () => {
  const salida = process.env.PLANTILLAS_PDF_SALIDA
  for (const [caso, datos] of Object.entries(CASOS)) {
    for (const tipo of ['declaracion-juramentada', 'relacion-facturas'] as TipoPlantilla[]) {
      const d = tipo === 'declaracion-juramentada' ? datos.dj : datos.rel
      it(`${tipo} · ${caso}`, async () => {
        const { imprimirPlantilla } = await import('./imprimir')
        const react = await pdfReact(tipo, d)
        const ref = await textoPdf(react)
        const r = await imprimirPlantilla(tipo, PLANTILLA[tipo], d, CTX)
        if (!r.ok) throw new Error(r.error)
        const nuevo = await textoPdf(r.pdf)
        expect(plano(nuevo.texto)).toBe(plano(ref.texto))
        expect(r.medidas.peticionesBloqueadas).toEqual([])
        if (salida) {
          fs.mkdirSync(salida, { recursive: true })
          fs.writeFileSync(path.join(salida, `${tipo}-${caso}-chromium.pdf`), r.pdf)
          fs.writeFileSync(path.join(salida, `${tipo}-${caso}-react-pdf.pdf`), react)
          fs.appendFileSync(
            path.join(salida, 'paginas.txt'),
            `${tipo}\t${caso}\tchromium=${nuevo.paginas}\treact-pdf=${ref.paginas}\trender_ms=${r.medidas.totalMs}\n`,
          )
        }
        // Medido el 2026-10-29: igual en todos los casos salvo la DJ con dos titulares, que en
        // Chromium cabe en 1 hoja (en @react-pdf las firmas saltaban a la 2). Nunca más hojas.
        expect(nuevo.paginas).toBeLessThanOrEqual(ref.paginas)
      }, 60_000)
    }
  }
})
