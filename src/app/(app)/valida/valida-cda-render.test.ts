/**
 * Lo que un CDA VE en `/valida` con los términos de suscripción de METRIK IA S.A.S., renderizado.
 *
 * Prueba de render a propósito: las reglas (`puerta.ts`, `pago-pendiente.ts`) pueden estar bien y el
 * JSX pintar otra cosa. Se fija:
 *   - la persona designada ve los términos como texto, la Política, su firma y UNA casilla que nace
 *     apagada; los textos nombran «Valida», no «Valida API»;
 *   - un operador ve un aviso con el nombre de quien falta, sin casilla, sin firma y sin el aviso de
 *     la Política (no acepta nada);
 *   - el pago: monto, período, vencimiento y un botón «Pagar» que abre el enlace de Bold en otra
 *     pestaña; sin enlace, dice que llega; vencido, lo dice; al día, lo dice; sin lectura, lo dice.
 *
 * Se queda en `.ts`: `vitest.config.ts` solo recoge `*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))
// Las acciones arrastran `server-only` y el cliente de Supabase; la pantalla solo necesita sus referencias.
vi.mock('@/lib/valida-api/acciones', () => ({ aprobarEntradaValidaApi: async () => ({ ok: true, yaEstaba: false }) }))
vi.mock('@/lib/valida-cda/acciones', () => ({ aprobarEntradaValidaCda: async () => ({ ok: true, yaEstaba: false }) }))

const { TerminosCda } = await import('./terminos-cda')
const { PagoPendienteCard } = await import('./pago-pendiente-card')

function texto(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const DOCUMENTO = {
  documentoId: '33333333-3333-4333-8333-333333333333',
  slug: 'terminos-suscripcion-valida-cda',
  titulo: 'Términos de Suscripción VALIDA · Licencia CDA',
  version: 'v1.1',
  textoMd: '# TÉRMINOS DE SUSCRIPCIÓN VALIDA · LICENCIA CDA v1.1\n\n2.1. **Precio.** CIENTO CINCUENTA MIL PESOS ($150.000) mensuales.',
}
const POR_FIRMAR = {
  documentoId: DOCUMENTO.documentoId,
  titulo: DOCUMENTO.titulo,
  version: 'v1.1',
  pdfSha256: 'a'.repeat(64),
  empresaNombre: 'CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA',
  empresaNit: '900156521-0',
}
const AVISO = 'Al continuar, autoriza a METRIK IA S.A.S. a tratar su correo, dirección IP y navegador para darle acceso al módulo Valida y proteger la cuenta, conforme a la Política de Tratamiento de Datos Personales v1.5.'

type Entrada = Parameters<typeof TerminosCda>[0]['entrada']
const pintar = (contrato: Entrada['contrato']) =>
  renderToStaticMarkup(
    React.createElement(TerminosCda, {
      entrada: { estado: 'pendiente', documentos: [DOCUMENTO], contrato, conflicto: false },
      aviso: AVISO,
      politicaUrl: 'https://valida.metrik.com.co/recursos/privacidad',
      politicaTitulo: 'Política de Tratamiento de Datos Personales v1.5',
    }),
  )

describe('la persona designada acepta en la misma pantalla', () => {
  const html = pintar({ estado: 'pendiente', puede: true, empresas: [POR_FIRMAR.empresaNombre], porFirmar: [POR_FIRMAR] })
  const t = texto(html)

  it('lee los términos como texto, con su centinela al final', () => {
    expect(t).toContain('CIENTO CINCUENTA MIL PESOS ($150.000) mensuales.')
    expect(html).toContain('data-fin-terminos')
  })

  it('firma como designada, con nombre, cédula y calidad', () => {
    expect(t).toContain('La empresa te designó para aceptar estos términos en su nombre.')
    expect(t).not.toContain('Eres el dueño de este espacio')
    expect(html).toContain('name="nombre"')
    expect(html).toContain('name="cedula"')
  })

  it('una sola casilla, apagada hasta leer, que nombra Valida y no Valida API', () => {
    expect(html.match(/type="checkbox"/g)).toHaveLength(1)
    expect(/<input[^>]*type="checkbox"[^>]*>/.exec(html)?.[0]).toMatch(/disabled/)
    expect(t).toContain('y los acepto para mi uso de Valida.')
    expect(t).not.toContain('Valida API')
    expect(t).toContain('tengo facultades para obligar a CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA')
  })
})

describe('un operador espera a la persona designada', () => {
  const html = pintar({ estado: 'pendiente', puede: false, razon: 'no_designado', designadoNombre: 'Alba Yurany Rosas Escandón' })
  const t = texto(html)

  it('sabe a quién espera y que no puede consultar mientras tanto', () => {
    expect(t).toContain('Alba Yurany Rosas Escandón, la persona que la empresa designó para aceptar estos términos, todavía no los ha aceptado.')
    expect(t).toContain('Mientras tanto no se pueden hacer consultas desde este espacio.')
    // No tiene nada propio que aprobar: no se le promete «tu propia aprobación».
    expect(t).not.toContain('propia aprobación')
  })

  it('no ve casilla, ni firma, ni el aviso de la Política', () => {
    expect(html).not.toContain('type="checkbox"')
    expect(html).not.toContain('name="cedula"')
    expect(t).not.toContain('Al continuar, autoriza')
  })

  it('sin persona designada, lo dice y pide escribir', () => {
    const t2 = texto(pintar({ estado: 'pendiente', puede: false, razon: 'sin_designado' }))
    expect(t2).toContain('MeTRIK todavía no tiene registrada la persona que acepta estos términos por la empresa.')
  })

  it('los textos propios no llevan guion largo', () => {
    expect(t).not.toMatch(/[—–]/)
  })
})

describe('el próximo pago', () => {
  const LINK = 'https://checkout.bold.co/payment/LNK_PRUEBA'
  const pendiente = (extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      React.createElement(PagoPendienteCard, {
        lectura: {
          estado: 'ok',
          pago: {
            estado: 'pendiente',
            numero: 1,
            concepto: 'Licencia VALIDA · Starter — periodo del 23/09/2026 al 22/10/2026',
            fechaVencimiento: '2026-09-30',
            monto: 150000,
            abonado: 0,
            saldo: 150000,
            vencida: false,
            enlacePago: LINK,
            enlaceVencido: false,
            ...extra,
          },
        },
      }),
    )

  it('monto, período, vencimiento y que no lleva IVA', () => {
    const t = texto(pendiente())
    expect(t).toContain('$150.000')
    expect(t).toContain('periodo del 23/09/2026 al 22/10/2026')
    expect(t).toContain('Vence el 30/09/2026')
    expect(t).toContain('Sin IVA')
    expect(t).toContain('numeral 21 del artículo 476')
  })

  it('el botón «Pagar» abre el enlace de Bold en otra pestaña, sin pasar la página de origen', () => {
    const html = pendiente()
    const boton = /<a[^>]*>Pagar<\/a>/.exec(html)?.[0] ?? ''
    expect(boton).toContain(`href="${LINK}"`)
    expect(boton).toContain('target="_blank"')
    expect(boton).toContain('rel="noopener noreferrer"')
  })

  it('sin enlace no hay botón: dice que llega', () => {
    const html = pendiente({ enlacePago: null })
    expect(html).not.toMatch(/>Pagar</)
    expect(texto(html)).toContain('MeTRIK te enviará el enlace de pago de esta cuota antes de su vencimiento.')
  })

  it('con el enlace vencido tampoco: dice que venció', () => {
    const t = texto(pendiente({ enlacePago: null, enlaceVencido: true }))
    expect(t).toContain('El enlace de pago de esta cuota venció.')
  })

  it('una cuota vencida lo dice, y un abono parcial también', () => {
    const t = texto(pendiente({ vencida: true, abonado: 50000, saldo: 100000 }))
    expect(t).toContain('Pago vencido')
    expect(t).toContain('Venció el 30/09/2026')
    expect(t).toContain('$100.000')
    expect(t).toContain('Ya abonaste $50.000 de $150.000.')
  })

  it('al día lo dice; sin cuotas no inventa nada; sin lectura lo dice', () => {
    const alDia = renderToStaticMarkup(
      React.createElement(PagoPendienteCard, { lectura: { estado: 'ok', pago: { estado: 'al_dia', cuotasPagadas: 1 } } }),
    )
    expect(texto(alDia)).toContain('Tu suscripción a Valida está al día.')
    const sinCuotas = renderToStaticMarkup(
      React.createElement(PagoPendienteCard, { lectura: { estado: 'ok', pago: { estado: 'sin_cuotas' } } }),
    )
    expect(sinCuotas).toBe('')
    const caida = renderToStaticMarkup(
      React.createElement(PagoPendienteCard, { lectura: { estado: 'no_disponible', motivo: 'base' } }),
    )
    expect(texto(caida)).toContain('No se pudo cargar tu próximo pago')
  })
})
