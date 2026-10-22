/**
 * La línea de estado del gate `cotizacion_enviada` en la ficha del negocio (barrido 2026-10-22).
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type React from 'react'
import { lineaEstadoEnvio } from '@/lib/negocios/seguimiento'
import { leerSeguimientoViaje } from './seguimiento-viaje'

function db(opts: { gates: string[]; fechaEnvio: string | null }) {
  return {
    from(tabla: string) {
      const res = tabla === 'negocios'
        ? { data: { etapa_actual_id: 'e3' }, error: null }
        : tabla === 'etapas_negocio'
          ? { data: { config_extra: { gates: opts.gates } }, error: null }
          : { data: opts.fechaEnvio ? [{ fecha_envio: opts.fechaEnvio }] : [], error: null }
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'not', 'order', 'limit']) q[m] = () => q
      q.maybeSingle = () => Promise.resolve(res)
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok)
      return q
    },
  }
}

const pintar = async (opts: { gates: string[]; fechaEnvio: string | null }) => {
  const nodo = await leerSeguimientoViaje(db(opts), { workspaceId: 'w', negocioId: 'n' })
  return nodo ? renderToStaticMarkup(nodo as React.ReactElement) : null
}

describe('línea de estado del envío (gate cotizacion_enviada)', () => {
  it('textos', () => {
    expect(lineaEstadoEnvio('21 oct 2026')).toEqual({ enviada: true, texto: 'Cotización enviada el 21 oct 2026.' })
    expect(lineaEstadoEnvio(null).texto).toBe('Falta enviar la cotización desde «Revisar y enviar».')
  })

  it('en la etapa del gate: dice si salió y cuándo, o qué falta', async () => {
    const enviada = await pintar({ gates: ['cotizacion_enviada'], fechaEnvio: '2026-10-21T15:00:00Z' })
    expect(enviada).toContain('data-seguimiento-envio="enviada"')
    expect(enviada).toMatch(/Cotización enviada el 21 (de )?oct\.? (de )?2026\./)
    const falta = await pintar({ gates: ['cotizacion_enviada'], fechaEnvio: null })
    expect(falta).toContain('Falta enviar la cotización desde «Revisar y enviar».')
  })

  it('en otra etapa no pinta nada', async () => {
    expect(await pintar({ gates: ['saldo_cero'], fechaEnvio: null })).toBeNull()
  })
})
