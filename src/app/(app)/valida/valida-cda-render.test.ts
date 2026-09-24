/**
 * Lo que un CDA VE en `/valida` con los términos de suscripción de METRIK IA S.A.S., renderizado.
 *
 * Prueba de render a propósito: las reglas (`puerta.ts`, `pago-pendiente.ts`) pueden estar bien y el
 * JSX pintar otra cosa. Se fija:
 *   - la persona designada ve los términos como texto, la Política, su firma y UNA casilla que nace
 *     apagada; los textos nombran «Valida», no «Valida API»;
 *   - un operador ve un aviso con el nombre de quien falta, sin casilla, sin firma y sin el aviso de
 *     la Política (no acepta nada);
 *   - los avisos de plazo y mora que ven todos, y la franja que lleva a Suscripción.
 *
 * El pago y la pestaña Pagos se mudaron a `/suscripcion` (ver `suscripcion-render.test.ts`).
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
const { AvisoMora, AvisoPlazoTerminos, FranjaSuscripcion, PausaPorMora } = await import('./avisos-cda')
const { PestanaTerminos } = await import('@/components/terminos/pestana-terminos')

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

describe('los avisos que ven todos (plazo y mora)', () => {
  it('el plazo dice hasta cuándo y, a la designada, le ofrece aceptar', () => {
    const html = renderToStaticMarkup(
      React.createElement(AvisoPlazoTerminos, { plazoHasta: '2026-09-30', puedeAceptar: true, designadoNombre: 'Alba' }),
    )
    expect(texto(html)).toContain('El servicio de Valida se suspenderá al terminar el 30-sep')
    expect(texto(html)).not.toContain('Pídele')
    expect(html).toContain('href="/valida?terminos=1"')
  })

  it('a un operador le nombra a la designada y no le ofrece aceptar', () => {
    const html = renderToStaticMarkup(
      React.createElement(AvisoPlazoTerminos, { plazoHasta: '2026-09-30', puedeAceptar: false, designadoNombre: 'Alba' }),
    )
    expect(texto(html)).toContain('El servicio de Valida se suspenderá al terminar el 30-sep')
    expect(texto(html)).toContain('La persona designada es Alba. Pídele que ingrese a Valida y los acepte.')
    expect(html).not.toContain('terminos=1')
  })

  it('sin nombre de la designada, igual le pide al operador que la busque', () => {
    const html = renderToStaticMarkup(
      React.createElement(AvisoPlazoTerminos, { plazoHasta: '2026-09-30', puedeAceptar: false, designadoNombre: null }),
    )
    expect(texto(html)).toContain('Pídele a la persona designada que ingrese a Valida y los acepte.')
    expect(html).not.toContain('terminos=1')
  })

  it('la mora dice la fecha de corte y no dice montos', () => {
    const t = texto(
      renderToStaticMarkup(
        React.createElement(AvisoMora, { mora: { estado: 'en_mora', vencio: '2026-09-30', corteDesde: '2026-10-31' } }),
      ),
    )
    expect(t).toContain('vencido desde el 30-sep')
    expect(t).toContain('Valida se pausa desde el 31-oct')
    expect(t).not.toMatch(/\$/)
  })

  it('la pausa manda a Suscripción a quien puede pagar', () => {
    const mora = { estado: 'suspendido' as const, vencio: '2026-09-30', corteDesde: '2026-10-31' }
    const html = renderToStaticMarkup(React.createElement(PausaPorMora, { mora, vePagos: true }))
    expect(texto(html)).toContain('En Suscripción está la cuota vencida')
    expect(html).toContain('href="/suscripcion?tab=pagos"')
    expect(texto(renderToStaticMarkup(React.createElement(PausaPorMora, { mora, vePagos: false })))).toContain(
      'La persona designada por tu empresa puede ver y pagar',
    )
  })
})

describe('la franja que lleva a Suscripción', () => {
  it('una línea con el aviso y «Pagar», que lleva a /suscripcion', () => {
    const html = renderToStaticMarkup(React.createElement(FranjaSuscripcion, { texto: 'Tu cuota vence el 30-sep' }))
    expect(texto(html)).toBe('Tu cuota vence el 30-sep Pagar')
    expect(html).toContain('href="/suscripcion"')
  })
})

describe('la pestaña Términos del CDA habla de la empresa, no de «ti»', () => {
  it('dice quién aceptó en nombre de la empresa', () => {
    const t = texto(
      renderToStaticMarkup(
        React.createElement(PestanaTerminos, {
          alcance: 'empresa',
          carga: {
            estado: 'ok',
            datos: [
              {
                estado: 'verificado',
                documentoId: DOCUMENTO.documentoId,
                titulo: DOCUMENTO.titulo,
                version: 'v1.1',
                textoMd: DOCUMENTO.textoMd,
                aprobadoAt: '2026-09-25T14:00:00Z',
                contrato: { aceptadoAt: '2026-09-25T14:00:00Z', aceptadoPor: 'Alba Yurany Rosas Escandón', canal: 'modulo' },
              },
            ],
          },
        }),
      ),
    )
    expect(t).toContain('Aceptados en nombre de tu empresa el')
    expect(t).toContain('por Alba Yurany Rosas Escandón')
    expect(t).not.toContain('Aprobado por ti')
    expect(t).toContain('CIENTO CINCUENTA MIL PESOS')
  })
})
