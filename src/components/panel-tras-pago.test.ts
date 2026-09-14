/**
 * El panel que aparece tras registrar un pago se VE, y el botón de avanzar solo lo ve
 * quien puede usarlo.
 *
 * Es una prueba de RENDER, y por eso vale la pena: el defecto que este frente cierra es
 * justamente que después de anotar la plata no aparecía nada, y un panel que no se pinta
 * (o que pinta el botón cuando no toca) es indistinguible de eso desde cualquier prueba
 * pura. `ofrecimientoDeAvance` puede decidir perfecto y el JSX ignorarlo; solo esto lo
 * fija. Precedente: `recaudo-cambiado-banner.test.ts`.
 *
 * El panel es presentacional puro, así que no necesita doblar una sola server action.
 * Se renderiza con `renderToStaticMarkup`, que corre en el entorno `node` de vitest sin
 * DOM: alcanza para lo único que se afirma acá, qué texto y qué acciones aparecen.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import PanelTrasPago, { textoDeSaldo } from './panel-tras-pago'
import type { OfrecimientoAvance } from '@/lib/negocios/avance-tras-pago'

/** Lo que la persona lee, sin el marcado de por medio. */
function texto(
  ofrecimiento: OfrecimientoAvance,
  opts: { saldo?: number; etapaLlegada?: string | null } = {},
): string {
  const html = renderToStaticMarkup(
    React.createElement(PanelTrasPago, {
      ofrecimiento,
      saldo: opts.saldo ?? 0,
      etapaLlegada: opts.etapaLlegada ?? null,
      avanzando: false,
      onAvanzar: () => {},
    }),
  )
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** El botón existe como `<button>`, no solo como texto suelto. */
function hayBotonDeAvance(ofrecimiento: OfrecimientoAvance, etapaLlegada: string | null = null): boolean {
  const html = renderToStaticMarkup(
    React.createElement(PanelTrasPago, {
      ofrecimiento, saldo: 0, etapaLlegada, avanzando: false, onAvanzar: () => {},
    }),
  )
  return /<button[^>]*>[\s\S]*?Avanzar de etapa/.test(html)
}

describe('el pago siempre queda confirmado', () => {
  it('lo dice en los cuatro desenlaces, incluso cuando no hay nada que ofrecer', () => {
    for (const o of [
      { tipo: 'avanzar', etapaDestinoNombre: 'Cartera' },
      { tipo: 'retenido', motivos: ['Certificado bancario'] },
      { tipo: 'sin_permiso' },
      { tipo: 'no_aplica' },
    ] as OfrecimientoAvance[]) {
      expect(texto(o)).toContain('Pago registrado')
    }
  })
})

describe('se ofrece el avance', () => {
  const avanzar: OfrecimientoAvance = { tipo: 'avanzar', etapaDestinoNombre: 'Cartera' }

  it('pinta el botón de avanzar', () => {
    expect(hayBotonDeAvance(avanzar)).toBe(true)
  })

  // El destino real lo resuelve el routing del servidor y puede no ser este: por eso va
  // como referencia al lado, y el botón queda neutral. Misma decisión que la ficha (#33).
  it('nombra el destino por defecto como referencia, no en el botón', () => {
    const t = texto(avanzar)
    expect(t).toContain('Sigue en el flujo: Cartera')
    expect(t).toContain('Avanzar de etapa')
    expect(t).not.toContain('Avanzar a Cartera')
  })
})

describe('el caso está retenido', () => {
  const retenido: OfrecimientoAvance = {
    tipo: 'retenido',
    motivos: ['Certificado bancario', 'Aviso del enlace de la DIAN'],
  }

  it('lista los motivos con sus nombres', () => {
    const t = texto(retenido)
    expect(t).toContain('Certificado bancario')
    expect(t).toContain('Aviso del enlace de la DIAN')
  })

  it('NO pinta el botón de avanzar', () => {
    expect(hayBotonDeAvance(retenido)).toBe(false)
  })
})

describe('el área de quien registró el pago no avanza esta etapa', () => {
  const sinPermiso: OfrecimientoAvance = { tipo: 'sin_permiso' }

  // No es un error de la persona: registrar la plata y mover el caso son dos trabajos.
  it('lo explica sin culpar a nadie', () => {
    expect(texto(sinPermiso)).toContain('Esta etapa no la avanza tu área')
  })

  it('NO pinta un botón que el servidor va a rechazar', () => {
    expect(hayBotonDeAvance(sinPermiso)).toBe(false)
  })
})

describe('no hay nada que ofrecer', () => {
  const noAplica: OfrecimientoAvance = { tipo: 'no_aplica' }

  it('se queda en la confirmación del pago, sin botón ni explicaciones de más', () => {
    const t = texto(noAplica)
    expect(t).toContain('Pago registrado')
    expect(t).not.toContain('Avanzar de etapa')
    expect(t).not.toContain('todavía no puede avanzar')
    expect(hayBotonDeAvance(noAplica)).toBe(false)
  })
})

describe('el caso ya avanzó', () => {
  const avanzar: OfrecimientoAvance = { tipo: 'avanzar', etapaDestinoNombre: 'Cartera' }

  // El routing bifurca y el salto por saldo encadena etapas: el destino que el panel
  // anunciaba puede no ser donde el caso aterrizó, y manda el que devolvió el servidor.
  it('nombra la etapa a la que REALMENTE llegó, no la que anunciaba', () => {
    const t = texto(avanzar, { etapaLlegada: 'Anexos' })
    expect(t).toContain('El caso avanzó a Anexos')
    expect(t).not.toContain('Sigue en el flujo: Cartera')
  })

  it('deja de ofrecer el avance, para que no se pueda pedir dos veces', () => {
    expect(hayBotonDeAvance(avanzar, 'Anexos')).toBe(false)
  })
})

describe('en qué quedó la cuenta del cliente', () => {
  // `Intl` de es-CO separa el símbolo con un espacio DURO (U+00A0). Se normaliza acá en
  // vez de escribirlo en el literal: un carácter invisible dentro del archivo no se puede
  // revisar en el PR. (`texto()` no lo necesita porque `\s` de JS ya lo cubre.)
  const sinEspacioDuro = (s: string) => s.replace(/\u00A0/g, ' ')

  it('falta plata', () => {
    expect(sinEspacioDuro(textoDeSaldo(425000))).toBe('Faltan $ 425.000 del honorario.')
  })

  it('sobra plata', () => {
    expect(sinEspacioDuro(textoDeSaldo(-17188))).toBe('Sobran $ 17.188 sobre el valor a recaudar.')
  })

  // ⚠️ "Cuadrado" NO es el cero exacto: es el mismo piso de materialidad con el que el
  // motor juzga a todos sus gates. Sin él, un cliente que redondeó al pagar leería
  // "faltan $120" encima de un caso que el sistema ya da por saldado. Casos reales:
  // V0276 con $120 de más y V0274 con $688.
  it('un residuo de redondeo cuenta como cuadrado, en los dos sentidos', () => {
    expect(textoDeSaldo(0)).toBe('La cuenta del cliente queda cuadrada.')
    expect(textoDeSaldo(120)).toBe('La cuenta del cliente queda cuadrada.')
    expect(textoDeSaldo(-688)).toBe('La cuenta del cliente queda cuadrada.')
    expect(textoDeSaldo(1000)).toBe('La cuenta del cliente queda cuadrada.')
    // Un peso por encima del piso ya se nombra.
    expect(textoDeSaldo(1001)).toContain('Faltan')
  })

  it('el saldo se pinta en el panel, no solo en el helper', () => {
    expect(texto({ tipo: 'no_aplica' }, { saldo: 425000 })).toContain('Faltan $ 425.000 del honorario.')
  })
})
