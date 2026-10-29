/**
 * H10-1 (QA del 2026-10-29): la versión nueva dice DESDE QUE SE ABRE que ya hay una enviada y
 * qué pasa al enviarla, en vez de enterarse al final con «Ya hay una cotización enviada».
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { AvisoVersionNueva, textoReemplazo } from './aviso-version-nueva'
import { decidirEnvioConOtraEnviada } from '@/lib/cotizaciones/state-machine'

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('H10-1 · aviso de versión nueva', () => {
  it('nombra la enviada y dice que esta la reemplaza', () => {
    const t = texto(renderToStaticMarkup(React.createElement(AvisoVersionNueva, { consecutivo: 'COT-2026-0020' })))
    expect(t).toContain('Ya está enviada la COT-2026-0020')
    expect(t).toContain('queda rechazada y esta sale en su lugar')
  })

  it('la confirmación de envío lo repite', () => {
    expect(textoReemplazo('COT-2026-0020')).toBe(' La COT-2026-0020 queda rechazada: esta la reemplaza.')
    expect(textoReemplazo(null)).toContain('La cotización enviada')
  })
})

describe('H10-1 · decidirEnvioConOtraEnviada', () => {
  const v1 = { id: 'cot-1', consecutivo: 'COT-2026-0020' }
  it('sin otra enviada sale sin reemplazar', () => {
    expect(decidirEnvioConOtraEnviada(null, null)).toEqual({ ok: true, reemplaza: null })
    expect(decidirEnvioConOtraEnviada(null, 'cot-1')).toEqual({ ok: true, reemplaza: null })
  })
  it('con otra enviada solo sale si se nombró ESA', () => {
    expect(decidirEnvioConOtraEnviada(v1, 'cot-1')).toEqual({ ok: true, reemplaza: v1 })
    expect(decidirEnvioConOtraEnviada(v1, null).ok).toBe(false)
    expect(decidirEnvioConOtraEnviada(v1, 'cot-9').ok).toBe(false)
  })
})
