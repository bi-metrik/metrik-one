/**
 * Lo que un CDA VE en `/valida` con la v1.4 de sus Términos publicada por aviso (cláusula 13.1),
 * renderizado: las reglas pueden estar bien y el JSX pintar otra cosa.
 *
 *   - el aviso, para todos: qué cambia, la vigencia (6-nov), el derecho de la 13.1, el documento
 *     completo y el PDF; la persona designada ve el botón para aceptar, los demás a quién le toca y que
 *     no es obligatorio;
 *   - `?modificacion=1`: la designada acepta con la MISMA entrada de los términos (texto, firma, una
 *     casilla apagada) y un encabezado que no promete abrir nada; los demás solo leen.
 *
 * Se queda en `.ts`: `vitest.config.ts` solo recoge `*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import type { DocumentoContractual } from '@/lib/valida-api/resultados'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))
vi.mock('@/lib/valida-api/acciones', () => ({ aprobarEntradaValidaApi: async () => ({ ok: true, yaEstaba: false }) }))
vi.mock('@/lib/valida-cda/acciones', () => ({ aprobarEntradaValidaCda: async () => ({ ok: true, yaEstaba: false }) }))
vi.mock('@/lib/radar/acciones', () => ({ aprobarEntradaRadar: async () => ({ ok: true, yaEstaba: false }) }))

const { AvisoModificacionTerminos } = await import('./avisos-cda')
const { ModificacionTerminosCda } = await import('./modificacion-terminos-cda')

function texto(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const V14: DocumentoContractual = {
  documentoId: '14141414-1414-4141-8141-141414141414',
  slug: 'terminos-suscripcion-valida-cda',
  titulo: 'Términos de Suscripción al Servicio VALIDA · Plan CDA',
  version: 'v1.4',
  textoMd: '# TÉRMINOS v1.4\n\n## 11. Restricción y suspensión\n\n11.1. **Restricción por mora.** Si una cuota no se paga…',
  pdfSha256: 'd'.repeat(64),
  vigenteDesde: '2026-11-06',
  vigenteHasta: null,
  aceptadoAt: null,
  aceptadoPor: null,
  aceptadoCalidad: null,
  aceptadoCanal: null,
  rigePorAviso: true,
  reemplazaId: '67f3a71c-715b-4fdb-a4bd-a3a8ceb327be',
  publicadaAt: '2026-10-07T15:00:00Z',
}

describe('el aviso en /valida', () => {
  it('a una operadora: qué cambia, la vigencia, el derecho, el documento y el PDF; a quién le toca aceptar', () => {
    const html = renderToStaticMarkup(
      React.createElement(AvisoModificacionTerminos, {
        doc: V14,
        hoy: '2026-10-07',
        puedeAceptar: false,
        designadoNombre: 'Jairo Enrique Peña Bernal',
      }),
    )
    const t = texto(html)
    expect(html).toContain('data-aviso-modificacion-terminos')
    expect(t).toContain('Cambian los Términos de tu suscripción a Valida (versión 1.4)')
    expect(t).toContain('Desde el 6 de noviembre de 2026')
    expect(t).toContain('se restringen las consultas nuevas')
    expect(t).toContain('rige desde el 6 de noviembre de 2026')
    expect(t).toContain('lo acepte o no tu empresa')
    expect(t).toContain('sin penalidad antes del 6 de noviembre de 2026')
    expect(t).toContain('mauricio.moreno@metrik.com.co')
    expect(t).toContain('La persona designada por tu empresa, Jairo Enrique Peña Bernal,')
    expect(t).toContain('Aceptarla no es obligatorio')
    expect(t).toContain('Aviso publicado en la plataforma el 7 de octubre de 2026.')
    expect(t).toContain('Leer el documento completo')
    expect(t).not.toContain('Leer y aceptar')
    expect(html).toContain('href="/valida?modificacion=1"')
    expect(html).toContain(`href="/api/valida/archivo/terminos/${V14.documentoId}"`)
  })

  it('a la persona designada: el botón para leer y aceptar', () => {
    const t = texto(
      renderToStaticMarkup(
        React.createElement(AvisoModificacionTerminos, { doc: V14, hoy: '2026-10-07', puedeAceptar: true, designadoNombre: null }),
      ),
    )
    expect(t).toContain('Leer y aceptar la nueva versión')
    expect(t).not.toContain('Aceptarla no es obligatorio')
  })

  it('desde la vigencia el derecho de la 13.1 ya no se ofrece', () => {
    const t = texto(
      renderToStaticMarkup(
        React.createElement(AvisoModificacionTerminos, { doc: V14, hoy: '2026-11-06', puedeAceptar: false, designadoNombre: null }),
      ),
    )
    expect(t).toContain('rige desde el 6 de noviembre de 2026')
    expect(t).not.toContain('sin penalidad')
  })
})

describe('?modificacion=1', () => {
  const base = {
    documentos: [V14],
    hoy: '2026-10-07',
    designadoNombre: 'Jairo Enrique Peña Bernal',
    aviso: 'Al continuar, autorizas el tratamiento de tus datos.',
    politicaUrl: 'https://metrik.com.co/politica',
    politicaTitulo: 'Política de Datos v1.0',
  }

  it('la persona designada acepta con la misma entrada: texto, firma, casilla apagada, sin prometer «se abre el módulo»', () => {
    const entrada = {
      estado: 'pendiente' as const,
      documentos: [{ documentoId: V14.documentoId, slug: V14.slug, titulo: V14.titulo, version: 'v1.4', textoMd: V14.textoMd }],
      contrato: {
        estado: 'pendiente' as const,
        puede: true as const,
        empresas: ['CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S.'],
        porFirmar: [
          {
            documentoId: V14.documentoId,
            titulo: V14.titulo,
            version: 'v1.4',
            pdfSha256: V14.pdfSha256,
            empresaNombre: 'CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S.',
            empresaNit: '900158425-0',
          },
        ],
      },
      conflicto: false,
    }
    const html = renderToStaticMarkup(React.createElement(ModificacionTerminosCda, { ...base, entrada }))
    const t = texto(html)
    expect(t).toContain('Volver a Valida')
    expect(t).toContain('Aceptar la versión 1.4 de los Términos')
    expect(t).toContain('Aceptarlos es voluntario')
    expect(t).not.toContain('se abre el módulo')
    expect(t).toContain('Restricción por mora.')
    expect(t).toContain('Firma del contrato')
    expect(html).toMatch(/<input type="checkbox"[^>]*disabled/)
    expect(t).toContain('Descargar el PDF (versión 1.4)')
  })

  it('los demás leen el documento y saben a quién le toca, sin casilla ni Política', () => {
    const html = renderToStaticMarkup(React.createElement(ModificacionTerminosCda, { ...base, entrada: null }))
    const t = texto(html)
    expect(html).toContain('data-modificacion-lectura')
    expect(t).toContain('Restricción por mora.')
    expect(t).toContain('Aceptarla no es obligatorio')
    expect(html).not.toContain('type="checkbox"')
    expect(t).not.toContain('Política de Datos')
  })
})
