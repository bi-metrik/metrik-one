/**
 * Lo que la pantalla del módulo Valida API PROMETE, renderizado.
 *
 * Prueba de render a propósito: las reglas puras (`reglas.ts`, `mapeo.ts`) pueden estar bien y el
 * JSX pintar otra cosa. Aquí se fija lo que un cliente ve:
 *
 *   - la llave en claro aparece con su aviso de «única vez» y un botón de copiar;
 *   - la entrada muestra los términos COMO TEXTO, el aviso de la Política y una sola casilla que
 *     nace sin marcar y deshabilitada (hasta leer hasta el final), con el botón «Acepto» apagado;
 *   - si Valida no responde, la pestaña dice «no disponible» y NO pinta una lista vacía;
 *   - quien no opera llaves no ve la pestaña de llaves.
 *
 * Se queda en `.ts`: `vitest.config.ts` solo recoge `*.test.ts`, y renombrarlo a `.tsx` lo sacaría
 * de la suite en silencio.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))
// Las acciones arrastran `server-only` y el cliente de Supabase; la pantalla solo necesita sus
// referencias para los botones.
vi.mock('@/lib/valida-api/acciones', () => ({
  aprobarEntradaValidaApi: async () => ({ ok: true, yaEstaba: false }),
  generarLlaveValidaApi: async () => ({ ok: false, error: 'x' }),
  revocarLlaveValidaApi: async () => ({ ok: false, error: 'x' }),
}))

const { EntradaValidaApi, LlaveUnaVez, PestanaDocumentos, ValidaApiCliente } = await import('./valida-api-cliente')

const LLAVE = 'vld_live_1a2b3c4d5e6f_ESTA_ES_LA_LLAVE_EN_CLARO'

function texto(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const NO_DISPONIBLE = { estado: 'no_disponible' as const, motivo: 'red' as const }
const DOCS_VACIOS = { estado: 'ok' as const, datos: { contractuales: [], politica: [] } }

describe('la llave en claro, una sola vez', () => {
  const html = renderToStaticMarkup(
    React.createElement(LlaveUnaVez, {
      llave: {
        keyId: 'k1',
        keyPrefix: 'vld_live_1a2b',
        nombre: 'ERP',
        llave: LLAVE,
        regenerada: false,
        anteriorDejaDeAutenticarEn: null,
      },
      onCerrar: () => {},
    }),
  )
  const t = texto(html)

  it('muestra la llave completa', () => {
    expect(t).toContain(LLAVE)
  })

  it('dice que no se vuelve a ver', () => {
    expect(t).toMatch(/única vez que vas a ver esta llave/)
    expect(t).toMatch(/no podrá mostrártela de nuevo/)
  })

  it('ofrece copiarla', () => {
    expect(t).toContain('Copiar')
  })
})

describe('si Valida no responde, la pestaña lo dice', () => {
  it('Llaves: «no disponible», no «todavía no hay llaves»', () => {
    const t = texto(
      renderToStaticMarkup(
        React.createElement(ValidaApiCliente, {
          resumen: NO_DISPONIBLE,
          llaves: NO_DISPONIBLE,
          documentos: DOCS_VACIOS,
          pagos: null,
          operaLlaves: true,
          vePagos: false,
        }),
      ),
    )
    expect(t).toContain('No disponible en este momento')
    expect(t).not.toContain('Todavía no hay llaves')
    // El resto del módulo sigue ahí.
    expect(t).toContain('Documentos')
    expect(t).toContain('Ayuda')
  })

  it('Consumo: quien no opera llaves entra a consumo, y ve «no disponible»', () => {
    const t = texto(
      renderToStaticMarkup(
        React.createElement(ValidaApiCliente, {
          resumen: NO_DISPONIBLE,
          llaves: null,
          documentos: DOCS_VACIOS,
          pagos: null,
          operaLlaves: false,
          vePagos: false,
        }),
      ),
    )
    expect(t).toContain('No disponible en este momento')
    expect(t).not.toContain('consultas disponibles')
  })
})

describe('pestañas por rol', () => {
  it('sin permiso de llaves ni de pagos, esas pestañas no aparecen', () => {
    const html = renderToStaticMarkup(
      React.createElement(ValidaApiCliente, {
        resumen: NO_DISPONIBLE,
        llaves: null,
        documentos: DOCS_VACIOS,
        pagos: null,
        operaLlaves: false,
        vePagos: false,
      }),
    )
    const pestanas = [...html.matchAll(/role="tab"[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]+)</g)].map((m) => m[1].trim())
    expect(pestanas).not.toContain('Llaves')
    expect(pestanas).not.toContain('Pagos')
    expect(pestanas).toEqual(['Consumo', 'Suscripción', 'Documentos', 'Ayuda'])
  })

  it('la bolsa vigente se pinta con su saldo cuando Valida responde', () => {
    const t = texto(
      renderToStaticMarkup(
        React.createElement(ValidaApiCliente, {
          resumen: {
            estado: 'ok',
            datos: {
              cliente_id: '8c211c68-6c25-4beb-b364-c91c284d6379',
              consumo: {
                modalidad: 'bolsa',
                bolsa: {
                  bolsa_id: 'b1',
                  secuencia: 1,
                  estado: 'vigente',
                  bloqueada: false,
                  activada_en: '2026-09-15T00:00:00Z',
                  vence_en: '2027-03-15T00:00:00Z',
                  dias_para_vencer: 180,
                  consultas_compradas: 20000,
                  consumidas: 6,
                  saldo: 19994,
                  precio_total: 1400000,
                  pago_referencia: 'bold-TXRRP7Q95ZJ',
                },
              },
              bolsa_en_espera: null,
              bolsas: [],
              renovacion: { estado: 'sin_suscripcion' },
            },
          },
          llaves: null,
          documentos: DOCS_VACIOS,
          pagos: null,
          operaLlaves: false,
          vePagos: false,
        }),
      ),
    )
    expect(t).toContain('19.994')
    expect(t).toContain('consultas disponibles')
  })
})

describe('la entrada: términos vivos, Política y una sola aprobación', () => {
  const DOCUMENTO = {
    documentoId: '00000000-0000-4000-8000-0000000000e2',
    slug: 'terminos-uso-valida',
    titulo: 'Términos de Uso de VALIDA',
    version: 'v1.1',
    textoMd: '# TÉRMINOS DE USO\n\n**EL PROVEEDOR:** METRIK IA S.A.S.\n\n3.1. Las credenciales se entregan únicamente después de la aceptación.',
  }
  const POR_FIRMAR = {
    documentoId: DOCUMENTO.documentoId,
    titulo: DOCUMENTO.titulo,
    version: 'v1.1',
    pdfSha256: 'f'.repeat(64),
    empresaNombre: '4D SOFT S.A.S.',
    empresaNit: '901220269-6',
  }
  type Contrato = Parameters<typeof EntradaValidaApi>[0]['entrada']['contrato']
  const entrada = (contrato: Contrato, conflicto = false) =>
    renderToStaticMarkup(
      React.createElement(EntradaValidaApi, {
        entrada: { estado: 'pendiente', documentos: [DOCUMENTO], contrato, conflicto },
        aviso: 'Al continuar, autoriza a METRIK IA S.A.S. a tratar su correo ... v1.5.',
        politicaUrl: 'https://valida.metrik.com.co/recursos/privacidad',
        politicaTitulo: 'Política de Tratamiento de Datos Personales v1.5',
      }),
    )
  const casilla = (html: string) => /<input[^>]*type="checkbox"[^>]*>/.exec(html)?.[0] ?? ''
  const botonAcepto = (html: string) => /<button[^>]*>Acepto<\/button>/.exec(html)?.[0] ?? ''

  it('los términos se leen ahí mismo, como texto, en un contenedor con scroll y su centinela al final', () => {
    const html = entrada({ estado: 'aceptado' })
    const t = texto(html)
    expect(t).toContain('TÉRMINOS DE USO')
    expect(t).toContain('3.1. Las credenciales se entregan únicamente después de la aceptación.')
    expect(html).toContain('<strong class="font-semibold">EL PROVEEDOR:</strong>')
    expect(html).toMatch(/data-terminos="true" class="[^"]*overflow-y-auto/)
    // El centinela va DENTRO del contenedor, después del texto.
    const contenedor = html.slice(html.indexOf('data-terminos'))
    expect(contenedor.indexOf('data-fin-terminos')).toBeGreaterThan(contenedor.indexOf('3.1. Las credenciales'))
    // Nada de «leer en otra pestaña» para los términos: no hay enlace al PDF.
    expect(html).not.toContain('/api/valida-api/archivo/documento/')
  })

  it('el aviso de la Política va en la misma vista, con el enlace a la versión completa', () => {
    const html = entrada({ estado: 'aceptado' })
    expect(texto(html)).toContain('Al continuar, autoriza a METRIK IA S.A.S.')
    expect(html).toContain('href="https://valida.metrik.com.co/recursos/privacidad"')
  })

  it('una sola casilla SIN marcar y deshabilitada hasta leer, un solo botón «Acepto» apagado', () => {
    const html = entrada({ estado: 'aceptado' })
    expect(html.match(/type="checkbox"/g)).toHaveLength(1)
    expect(casilla(html)).not.toMatch(/checked=""/)
    expect(casilla(html)).toMatch(/disabled/)
    expect(botonAcepto(html)).toMatch(/disabled/)
    expect(texto(html)).toContain('Lee hasta el final para poder aceptar.')
    expect(texto(html)).toContain('Leí hasta el final «Términos de Uso de VALIDA» (v1.1)')
    // Sin firma pendiente, no se piden datos personales.
    expect(html).not.toContain('name="cedula"')
  })

  it('el dueño con el contrato pendiente firma en la misma pantalla: nombre, cédula, calidad', () => {
    const html = entrada({ estado: 'pendiente', puede: true, empresas: ['4D SOFT S.A.S.'], porFirmar: [POR_FIRMAR] })
    expect(html).toContain('name="nombre"')
    expect(html).toContain('name="cedula"')
    expect(texto(html)).toContain('Representante legal')
    expect(texto(html)).toContain('Apoderado')
    expect(html.match(/type="checkbox"/g)).toHaveLength(1)
    expect(casilla(html)).toMatch(/disabled/)
    expect(botonAcepto(html)).toMatch(/disabled/)
    expect(texto(html)).toContain('tengo facultades para obligar a 4D SOFT S.A.S.')
  })

  it('quien no es dueño ve los términos y el aviso, pero no puede aprobar', () => {
    const html = entrada({ estado: 'pendiente', puede: false, razon: 'no_owner' })
    expect(texto(html)).toContain('3.1. Las credenciales se entregan')
    expect(texto(html)).toContain('Al continuar, autoriza a METRIK IA S.A.S.')
    expect(texto(html)).toContain('El dueño del espacio, que es quien puede obligar a la empresa, todavía no ha aceptado')
    expect(html).not.toContain('type="checkbox"')
    expect(botonAcepto(html)).toBe('')
    expect(html).not.toContain('name="cedula"')
  })

  it('el soporte de MeTRIK ve que el contrato no le toca', () => {
    const html = entrada({ estado: 'pendiente', puede: false, razon: 'soporte' })
    expect(texto(html)).toContain('como soporte de MeTRIK')
    expect(html).not.toContain('type="checkbox"')
  })

  it('con un conflicto de constancias no se ofrece aprobar', () => {
    const html = entrada({ estado: 'aceptado' }, true)
    expect(texto(html)).toContain('mismo nombre y versión')
    expect(html).not.toContain('type="checkbox"')
  })

  it('los textos propios no llevan guion largo', () => {
    const html = entrada({ estado: 'pendiente', puede: true, empresas: ['4D SOFT S.A.S.'], porFirmar: [POR_FIRMAR] })
    expect(texto(html)).not.toMatch(/[—–]/)
  })
})

describe('Documentos, como archivo', () => {
  const DOCUMENTO = {
    documentoId: '00000000-0000-4000-8000-0000000000e2',
    titulo: 'Términos de Uso de VALIDA',
    textoMd: '# Términos de Uso',
    pdfSha256: 'f'.repeat(64),
  }

  it('la pestaña Documentos nombra la calidad en español y el canal del módulo', () => {
    const html = renderToStaticMarkup(
      React.createElement(PestanaDocumentos, {
        carga: {
          estado: 'ok',
          datos: {
            contractuales: [
              {
                documentoId: DOCUMENTO.documentoId,
                slug: 'terminos-uso-valida',
                titulo: DOCUMENTO.titulo,
                version: 'v1.1',
                textoMd: DOCUMENTO.textoMd,
                pdfSha256: DOCUMENTO.pdfSha256,
                vigenteDesde: '2026-09-17',
                vigenteHasta: null,
                aceptadoAt: '2026-09-17T15:00:00Z',
                aceptadoPor: 'Johann Manuel Valbuena Alfonso',
                aceptadoCalidad: 'representante_legal',
                aceptadoCanal: 'modulo',
              },
            ],
            politica: [],
          },
        },
      }),
    )
    const t = texto(html)
    expect(t).toContain('en calidad de representante legal')
    expect(t).toContain('en este módulo')
    expect(t).not.toContain('representante_legal')
  })
})
