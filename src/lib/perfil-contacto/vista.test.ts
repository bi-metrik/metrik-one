/**
 * La vista del perfil del contacto (ficha del directorio y bloque «Ficha del cliente» del viaje).
 * Puro, más un render del bloque de solo lectura del viaje: lo sugerido no se ve ahí.
 * Datos inventados.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { agruparPerfil, hechoDeFila, lineaOrigen, puedeEditarPerfil, puedeVerPerfil, validarHechoManual, type HechoPerfilVista } from './vista'
import PerfilConfirmado from '@/components/perfil-contacto/perfil-confirmado'

const h = (p: Partial<HechoPerfilVista> & Pick<HechoPerfilVista, 'id' | 'texto'>): HechoPerfilVista => ({
  dimension: 'preferencias', estado: 'confirmado', origen: 'bot_explicito', creadoAt: '2026-10-12T15:00:00Z', confirmadoAt: '2026-10-12T15:00:00Z', ...p,
})

describe('hechoDeFila', () => {
  it('lee la fila de la tabla y descarta lo que no tiene la forma (otra dimensión, descartado)', () => {
    expect(hechoDeFila({ id: 'a', dimension: 'preferencias', texto: 'le gusta el vino', estado: 'sugerido', origen_tipo: 'bot_conversacion', created_at: '2026-10-12T15:00:00Z', confirmado_at: null }))
      .toEqual({ id: 'a', dimension: 'preferencias', texto: 'le gusta el vino', estado: 'sugerido', origen: 'bot_conversacion', creadoAt: '2026-10-12T15:00:00Z', confirmadoAt: null })
    expect(hechoDeFila({ id: 'b', dimension: 'gustos', texto: 'x', estado: 'confirmado' })).toBeNull()
    expect(hechoDeFila({ id: 'c', dimension: 'otro', texto: 'x', estado: 'descartado' })).toBeNull()
  })
})

describe('agruparPerfil', () => {
  it('por dimensión, en el orden del vocabulario; dentro, lo sugerido primero', () => {
    const g = agruparPerfil([
      h({ id: '1', texto: 'le gusta el vino', creadoAt: '2026-10-01' }),
      h({ id: '2', texto: 'viaja con la esposa', dimension: 'nucleo_viaje' }),
      h({ id: '3', texto: 'prefiere hoteles pequeños', estado: 'sugerido', creadoAt: '2026-10-05' }),
    ])
    expect(g.map((x) => [x.titulo, x.hechos.map((y) => y.id)])).toEqual([['Con quién viaja', ['2']], ['Preferencias', ['3', '1']]])
  })
})

describe('lineaOrigen', () => {
  it('dice de dónde salió y cuándo', () => {
    // La fecha la escribe `formatFecha` (Intl es-CO: «12 de oct de 2026»).
    expect(lineaOrigen(h({ id: '1', texto: 'x' }))).toMatch(/^por el bot · 12 (de )?oct\.?( de)? 2026$/)
    expect(lineaOrigen(h({ id: '2', texto: 'x', estado: 'sugerido', origen: 'bot_conversacion', confirmadoAt: null }))).toMatch(/^de una conversación con el bot · sugerido el 12 (de )?oct\.?( de)? 2026$/)
    expect(lineaOrigen(h({ id: '3', texto: 'x', origen: 'manual' }))).toMatch(/^a mano · /)
  })
})

describe('validarHechoManual', () => {
  it('dimensión del vocabulario y texto que cabe', () => {
    expect(validarHechoManual('preferencias', '  le gusta   el vino ')).toEqual({ ok: true, dimension: 'preferencias', texto: 'le gusta el vino' })
    expect(validarHechoManual('gustos', 'x')).toMatchObject({ ok: false })
    expect(validarHechoManual('otro', '   ')).toMatchObject({ ok: false })
    expect(validarHechoManual('otro', 'x'.repeat(281))).toMatchObject({ ok: false })
  })
})

describe('permisos: los mismos de la autorización (#1138)', () => {
  it('ver: todos menos contador; escribir: owner/admin/supervisor y el operator responsable', () => {
    expect(['owner', 'admin', 'supervisor', 'operator', 'read_only'].every((r) => puedeVerPerfil(r))).toBe(true)
    expect(puedeVerPerfil('contador')).toBe(false)
    expect(puedeEditarPerfil('supervisor', false)).toBe(true)
    expect(puedeEditarPerfil('operator', false)).toBe(false)
    expect(puedeEditarPerfil('operator', true)).toBe(true)
    expect(puedeEditarPerfil('read_only', true)).toBe(false)
  })
})

describe('PerfilConfirmado (bloque del viaje, solo lectura)', () => {
  const pintar = (hechos: HechoPerfilVista[]) => renderToStaticMarkup(React.createElement(PerfilConfirmado, { hechos }))
  it('muestra lo confirmado agrupado y NO lo sugerido', () => {
    const html = pintar([
      h({ id: '1', texto: 'le gusta la comida italiana' }),
      h({ id: '2', texto: 'siempre viaja con la mamá', dimension: 'nucleo_viaje' }),
      h({ id: '3', texto: 'quizá prefiere playa', estado: 'sugerido' }),
    ])
    expect(html).toContain('Perfil del cliente')
    expect(html).toContain('le gusta la comida italiana')
    expect(html).toContain('Con quién viaja')
    expect(html).not.toContain('quizá prefiere playa')
  })
  it('sin nada confirmado no pinta nada', () => {
    expect(pintar([])).toBe('')
    expect(pintar([h({ id: '3', texto: 'x', estado: 'sugerido' })])).toBe('')
  })
})
