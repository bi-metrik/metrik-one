/**
 * La pantalla de aceptación de la v1.5 (anexo A), renderizada: las reglas pueden estar bien y el JSX
 * pintar otra cosa.
 *
 *   - todos ven el resumen con las variables llenas, «Ver los Términos completos», «Descargar PDF», la huella
 *     y «Ahora no, recordármelo»;
 *   - la persona designada acepta con la MISMA entrada de siempre (texto, nombre, cédula, casilla sin marcar
 *     y apagada hasta leer, «Acepto»);
 *   - los demás ven «Esta aceptación la hace …» y ninguna casilla.
 *
 * Se queda en `.ts`: `vitest.config.ts` solo recoge `*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import type { DocumentoContractual } from '@/lib/valida-api/resultados'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), redirect: () => {} }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))
vi.mock('@/lib/valida-api/acciones', () => ({ aprobarEntradaValidaApi: async () => ({ ok: true, yaEstaba: false }) }))
vi.mock('@/lib/valida-cda/acciones', () => ({ aprobarEntradaValidaCda: async () => ({ ok: true, yaEstaba: false }) }))
vi.mock('@/lib/radar/acciones', () => ({ aprobarEntradaRadar: async () => ({ ok: true, yaEstaba: false }) }))
vi.mock('./terminos-v15-acciones', () => ({ posponerTerminosV15: async () => {} }))

const { TerminosV15Cda } = await import('./terminos-v15-cda')
const { datosDelTextoV15, textosPantallaV15 } = await import('@/lib/valida-cda/terminos-v1-5')

function texto(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const TEXTO = [
  '# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.5',
  '**EL CLIENTE**: CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA, NIT 900.156.521-0, domiciliada en …',
  '2.4. **Pago y período.** La fecha de renovación del Cliente es el día 23 de cada mes, que es el día …',
  '12.1. **Plazo.** Hasta el **15 de enero de 2027**, fecha en que vencía el contrato terminado con AFI …',
  '16.4. **Paso desde la versión 1.4.** Desde el **16 de enero de 2027**, o desde el día siguiente al fin del último período pagado si es posterior, …',
].join('\n\n')

const V15: DocumentoContractual = {
  documentoId: '15151515-1515-4151-8151-151515151515',
  slug: 'terminos-suscripcion-valida-cda',
  titulo: 'Términos de Suscripción al Servicio VALIDA · Plan CDA',
  version: 'v1.5',
  textoMd: TEXTO,
  pdfSha256: 'e'.repeat(64),
  vigenteDesde: '2026-12-01',
  vigenteHasta: null,
  aceptadoAt: null,
  aceptadoPor: null,
  aceptadoCalidad: null,
  aceptadoCanal: null,
  rigePorAviso: true,
  reemplazaId: 'a0bf69e7-5c89-48a7-a6a8-e27e68301438',
  publicadaAt: '2026-11-01T05:00:00Z',
}

const textos = textosPantallaV15({
  doc: V15,
  texto: datosDelTextoV15(TEXTO),
  periodos: {
    estado: 'ok',
    periodos: [
      { desde: '2026-10-23', hasta: '2026-11-22', corto: '23-oct al 22-nov', saldo: 150000 },
      { desde: '2026-11-23', hasta: '2026-12-22', corto: '23-nov al 22-dic', saldo: 150000 },
    ],
  },
  fechaExige: '2027-01-16',
})

const base = {
  documentoId: V15.documentoId,
  textos,
  designadoNombre: 'Alba Yurany Rosas Escandón',
  aviso: 'Al continuar, autorizas el tratamiento de tus datos.',
  politicaUrl: 'https://metrik.com.co/politica',
  politicaTitulo: 'Política de Datos v1.0',
}

describe('la pantalla de la v1.5', () => {
  it('a una operadora: el anexo A con sus fechas, quién acepta, y «Ahora no» sin casilla', () => {
    const html = renderToStaticMarkup(React.createElement(TerminosV15Cda, { ...base, entrada: null }))
    const t = texto(html)
    expect(t).toContain('Nuevos Términos de tu suscripción a Valida (versión 1.5)')
    expect(t).toContain('El precio, las consultas ilimitadas y los tres usuarios no cambian.')
    expect(t).toContain('el día 23 de cada mes.')
    expect(t).toContain('a más tardar el 30 de noviembre de 2026 debes tener pagados: 23-oct al 22-nov de 2026 y 23-nov al 22-dic de 2026 ($300.000)')
    expect(t).toContain('Hasta el 5 de diciembre no se restringen tus consultas')
    expect(t).toContain('Esta versión rige de todas formas desde el 1 de diciembre de 2026')
    expect(t).toContain('Hasta el 15 de enero de 2027 METRIK mantiene')
    expect(t).toContain('desde el 16 de enero de 2027 necesitarás haberla aceptado para seguir consultando.')
    expect(t).toContain('Esta aceptación la hace Alba Yurany Rosas Escandón')
    expect(t).toContain(`Huella SHA-256: ${'e'.repeat(64)}`)
    expect(t).toContain('Aviso publicado en la plataforma el 1 de noviembre de 2026.')
    expect(html).toContain('href="/valida?modificacion=1"')
    expect(html).toContain(`href="/api/valida/archivo/terminos/${V15.documentoId}"`)
    expect(t).toContain('Ahora no, recordármelo')
    expect(html).toContain(`name="documento_id" value="${V15.documentoId}"`)
    expect(html).not.toContain('type="checkbox"')
    expect(t).not.toContain('Acepto')
  })

  it('a la persona designada: la entrada de siempre (texto, firma, casilla apagada) y «Ahora no»', () => {
    const entrada = {
      estado: 'pendiente' as const,
      documentos: [{ documentoId: V15.documentoId, slug: V15.slug, titulo: V15.titulo, version: 'v1.5', textoMd: V15.textoMd }],
      contrato: {
        estado: 'pendiente' as const,
        puede: true as const,
        empresas: ['CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA'],
        porFirmar: [
          {
            documentoId: V15.documentoId,
            titulo: V15.titulo,
            version: 'v1.5',
            pdfSha256: V15.pdfSha256,
            empresaNombre: 'CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA',
            empresaNit: '900156521-0',
          },
        ],
      },
      conflicto: false,
    }
    const html = renderToStaticMarkup(React.createElement(TerminosV15Cda, { ...base, entrada }))
    const t = texto(html)
    expect(t).toContain('Aceptar la versión 1.5 de los Términos')
    expect(t).toContain('Firma del contrato')
    expect(t).toContain('Nombre completo')
    expect(t).toContain('Cédula')
    expect(html).toMatch(/<input type="checkbox"[^>]*disabled/)
    expect(html).not.toMatch(/<input type="checkbox"[^>]*checked/)
    expect(t).toContain('Acepto')
    expect(t).not.toContain('Esta aceptación la hace')
    expect(t).toContain('Ahora no, recordármelo')
  })
})
