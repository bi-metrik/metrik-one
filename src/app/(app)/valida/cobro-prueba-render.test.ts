/**
 * La franja ÚNICA de la prueba en `/valida` (2026-10-16): el contador restantes/total, UNA fecha, las
 * acciones y, debajo, la cláusula del cobro con el texto EXACTO de antes (Condiciones 7.1 y 7.3).
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('./cancelar-prueba-acciones', () => ({ cancelarPruebaValida: async () => ({ ok: true, texto: 'x' }) }))

import { FranjaPrueba } from './franja-prueba'
import { textoClausulaCobro } from './cobro-prueba'
import { COBRO_TRAS_PRUEBA } from '@/lib/valida-registro/condiciones-cobro'
import { CONDICIONES_PRUEBA_CON_COBRO } from '@/lib/valida-registro/condiciones'
import { pruebaEnPantalla } from '@/lib/valida-registro/prueba-en-pantalla'
import type { SaldoBolsa } from '@/lib/valida/corte-bolsa'

// Viernes 23 de octubre de 2026, 11:30 a. m. en Bogotá.
const FIN = '2026-10-23T16:30:55.044Z'
const saldo = (n: number, venceEn = FIN): SaldoBolsa => ({ saldo: n, compradas: 10, venceEn, bloqueada: false, motivo: null, esPrueba: true })
const cobro = (estado = 'programado', cobroDesde = FIN) => ({ estado, cobroDesde, puedeCancelar: estado === 'programado' })

function pintar(p: Parameters<typeof pruebaEnPantalla>[0]) {
  const prueba = pruebaEnPantalla(p)
  if (!prueba) return ''
  return renderToStaticMarkup(React.createElement(FranjaPrueba, { saldo: p.saldo, prueba }))
}

const textoDe = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')

describe('la franja de la prueba', () => {
  it('el contador es restantes/total y baja con cada consulta', () => {
    expect(pintar({ saldo: saldo(10), cobro: cobro(), venceConfig: null, puedeCancelar: true })).toContain('data-contador-consultas="10/10"')
    const html = pintar({ saldo: saldo(7), cobro: cobro(), venceConfig: null, puedeCancelar: true })
    expect(html).toContain('data-contador-consultas="7/10"')
    expect(textoDe(html)).toMatch(/7\/10\s*consultas de prueba · hasta el 23 de octubre/)
  })

  it('la cláusula del cobro va debajo con el texto EXACTO de siempre, siempre en el HTML', () => {
    const html = pintar({ saldo: saldo(10), cobro: cobro(), venceConfig: null, puedeCancelar: true })
    const parrafo = /<p id="clausula-cobro-texto"[^>]*>([\s\S]*?)<\/p>/.exec(html)
    expect(parrafo).not.toBeNull()
    const fecha = 'viernes, 23 de octubre de 2026, 11:30 a. m.'
    // El texto de antes de la franja, palabra por palabra (no se cambia sin Emilio).
    const ANTES =
      'Tu prueba gratis termina el viernes, 23 de octubre de 2026, 11:30 a. m. (hora de Colombia). Si no la cancelas antes, después de ese momento se cobran $150.000 por el primer mes a la tarjeta que registraste, y luego cada mes.'
    expect(textoDe(parrafo![1]).replace(/ /g, ' ')).toBe(ANTES)
    expect(textoClausulaCobro(fecha, COBRO_TRAS_PRUEBA.precio).replace(/ /g, ' ')).toBe(ANTES)
    // En el celular el texto completo se esconde con CSS (no se quita) y la fecha y el valor quedan a la vista.
    expect(parrafo![0]).toMatch(/class="hidden sm:block"/)
    const resumen = /<p[^>]*data-resumen-cobro[^>]*>([\s\S]*?)<\/p>/.exec(html)
    expect(textoDe(resumen![1]).replace(/ /g, ' ')).toMatch(/^Primer cobro: \$150\.000 el 23 de oct, 11:30 a\. m\./)
    expect(resumen![0]).toContain('sm:hidden')
  })

  it('la persona dueña ve «Activar plan» y «Cancelar prueba» (el nombre exacto de las Condiciones)', () => {
    const html = pintar({ saldo: saldo(10), cobro: cobro(), venceConfig: null, puedeCancelar: true })
    expect(html).toContain('>Activar plan<')
    expect(html).toContain('>Cancelar prueba<')
    expect(CONDICIONES_PRUEBA_CON_COBRO.texto).toContain(`"${COBRO_TRAS_PRUEBA.botonCancelar}"`)
  })

  it('quien no es la dueña (o «Ver como») ve la cláusula, sin «Cancelar prueba»', () => {
    const html = pintar({ saldo: saldo(10), cobro: cobro(), venceConfig: null, puedeCancelar: false })
    expect(html).toContain('data-texto-clausula')
    expect(html).not.toContain('Cancelar prueba')
  })

  it('UNA sola fecha: con cobro programado manda la del cobro, aunque la bolsa diga otra (preview acelerado)', () => {
    // Preview con VALIDA_COBRO_PRUEBA_MINUTOS: el cobro a los 14 minutos (hoy 16-oct 11:44), la bolsa el 23-oct.
    const html = pintar({ saldo: saldo(10, FIN), cobro: cobro('programado', '2026-10-16T16:44:55.549Z'), venceConfig: FIN, puedeCancelar: true })
    const texto = textoDe(html)
    expect(texto).toContain('hasta el 16 de octubre')
    expect(texto).toContain('16 de octubre de 2026, 11:44')
    expect(texto).not.toMatch(/23 de octubre|23 oct/)
  })

  it('sin tarjeta: contador y fecha de la bolsa, sin cláusula ni «Cancelar prueba»', () => {
    const html = pintar({ saldo: saldo(4), cobro: null, venceConfig: null, puedeCancelar: true })
    expect(textoDe(html)).toMatch(/4\/10\s*consultas de prueba · hasta el 23 de octubre/)
    expect(html).not.toContain('data-clausula-cobro')
    expect(html).not.toContain('Cancelar prueba')
  })

  it('cancelada: dice que no se cobra nada y no ofrece cancelar otra vez', () => {
    const html = pintar({ saldo: saldo(6), cobro: cobro('cancelado'), venceConfig: null, puedeCancelar: true })
    expect(html).toContain('no se cobrará nada')
    expect(html).not.toContain('Cancelar prueba')
    expect(html).not.toContain('data-clausula-cobro')
  })

  it('un cobro ya hecho o en curso cierra la franja de la prueba (la suscripción toma su lugar)', () => {
    for (const estado of ['cobrado', 'cobrando', 'revisar', 'rechazado']) {
      expect(pruebaEnPantalla({ saldo: saldo(3), cobro: cobro(estado), venceConfig: null, puedeCancelar: true }), estado).toBeNull()
    }
    // Una bolsa que no es de prueba (el mes del plan) tampoco es una prueba.
    expect(pruebaEnPantalla({ saldo: { ...saldo(3), esPrueba: false }, cobro: null, venceConfig: null, puedeCancelar: true })).toBeNull()
  })
})
