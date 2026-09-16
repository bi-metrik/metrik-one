/**
 * Lo que la pantalla del módulo Valida API PROMETE, renderizado.
 *
 * Prueba de render a propósito: las reglas puras (`reglas.ts`, `mapeo.ts`) pueden estar bien y el
 * JSX pintar otra cosa. Aquí se fija lo que un cliente ve:
 *
 *   - la llave en claro aparece con su aviso de «única vez» y un botón de copiar;
 *   - la casilla de la Política nace SIN marcar y el botón de continuar, deshabilitado;
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
  aceptarPoliticaValidaApi: async () => ({ ok: true }),
  generarLlaveValidaApi: async () => ({ ok: false, error: 'x' }),
  revocarLlaveValidaApi: async () => ({ ok: false, error: 'x' }),
}))

const { AceptarPolitica, LlaveUnaVez, ValidaApiCliente } = await import('./valida-api-cliente')

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

describe('Política de Datos en el primer ingreso', () => {
  const html = renderToStaticMarkup(
    React.createElement(AceptarPolitica, {
      aviso: 'Al continuar, autoriza a METRIK IA S.A.S. ... v1.5.',
      politicaUrl: 'https://valida.metrik.com.co/recursos/privacidad',
      politicaTitulo: 'Política de Tratamiento de Datos Personales v1.5',
    }),
  )

  it('la casilla nace sin marcar y el botón deshabilitado', () => {
    const casilla = /<input[^>]*type="checkbox"[^>]*>/.exec(html)?.[0] ?? ''
    expect(casilla).not.toBe('')
    expect(casilla).not.toMatch(/checked/)
    const boton = /<button[^>]*>Continuar<\/button>/.exec(html)?.[0] ?? ''
    expect(boton).toMatch(/disabled/)
  })

  it('muestra el aviso completo que se registra y el enlace a la Política', () => {
    expect(texto(html)).toContain('Al continuar, autoriza a METRIK IA S.A.S.')
    expect(html).toContain('href="https://valida.metrik.com.co/recursos/privacidad"')
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
