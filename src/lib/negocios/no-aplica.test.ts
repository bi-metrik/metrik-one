/**
 * El aviso de «este caso no aplica»: la regla y el panel que lo pinta.
 *
 * Por qué hay prueba de RENDER además de la pura: la regla puede estar perfecta y el
 * panel no pintar nada (o pintar el título y comerse el «qué hacer»), y las pruebas puras
 * siguen verdes. Es el mismo precedente de `recaudo-cambiado-banner.test.ts`.
 *
 * VISTO FALLAR (medido el 2026-09-18, una mutación a la vez):
 *  - `reglasNoAplica` devolviendo `crudo` sin filtrar → **1 roja** (entran reglas sin
 *    título ni condición, que el aviso pintaría a medias);
 *  - `avisoNoAplica` sin el `try/catch` → **1 roja**: el evaluador que revienta tumbaría
 *    la ficha entera en vez de callar;
 *  - `avisoNoAplica` recorriendo las reglas al revés → **1 roja**;
 *  - el panel devolviendo `null` siempre → **3 rojas**.
 * Ninguna quedó huérfana; la suite volvió a verde tras restaurar.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { avisoNoAplica, reglasNoAplica, type ReglaNoAplica } from './no-aplica'
import { AvisoNoAplicaPanel } from '@/app/(app)/negocios/[id]/aviso-no-aplica'

const JURIDICA: ReglaNoAplica = {
  condition: {
    field: 'tipo_persona',
    value: 'juridica',
    source_bloque_slug: 'tipo_de_solicitante',
    source_etapa_orden: 1,
  },
  titulo: 'Este caso no aplica para devolución de IVA',
  mensaje: 'La devolución solo aplica a personas naturales.',
  que_hacer: 'Ciérralo como perdido con la razón que corresponda.',
}

describe('reglasNoAplica', () => {
  it('una línea que no declara nada no produce avisos', () => {
    expect(reglasNoAplica(null)).toEqual([])
    expect(reglasNoAplica({})).toEqual([])
    expect(reglasNoAplica({ no_aplica: 'juridica' })).toEqual([])
  })

  it('descarta las reglas incompletas en vez de pintarlas a medias', () => {
    const reglas = reglasNoAplica({
      no_aplica: [
        JURIDICA,
        { condition: { field: 'x' }, titulo: '', mensaje: 'sin titulo' },
        { titulo: 'sin condicion', mensaje: 'no se puede evaluar' },
        { condition: { field: 'y' }, titulo: 'sin mensaje' },
        'basura',
      ],
    })
    expect(reglas).toHaveLength(1)
    expect(reglas[0].titulo).toBe(JURIDICA.titulo)
  })
})

describe('avisoNoAplica', () => {
  it('sin reglas no pregunta nada', async () => {
    let llamadas = 0
    const r = await avisoNoAplica([], async () => { llamadas++; return true })
    expect(r).toBeNull()
    expect(llamadas).toBe(0)
  })

  it('devuelve la primera que se cumple, no la última', async () => {
    const segunda: ReglaNoAplica = { ...JURIDICA, titulo: 'Segunda razón' }
    const r = await avisoNoAplica([JURIDICA, segunda], async () => true)
    expect(r?.titulo).toBe(JURIDICA.titulo)
  })

  it('si ninguna se cumple, no hay aviso', async () => {
    expect(await avisoNoAplica([JURIDICA], async () => false)).toBeNull()
  })

  it('un evaluador que revienta NO inventa un «no aplica»', async () => {
    const r = await avisoNoAplica([JURIDICA], async () => { throw new Error('la RPC falló') })
    expect(r).toBeNull()
  })

  it('el «qué hacer» vacío viaja como null, no como cadena', async () => {
    const sinQueHacer: ReglaNoAplica = { ...JURIDICA, que_hacer: '   ' }
    const r = await avisoNoAplica([sinQueHacer], async () => true)
    expect(r?.que_hacer).toBeNull()
  })
})

describe('el panel', () => {
  const pinta = (aviso: Awaited<ReturnType<typeof avisoNoAplica>>) =>
    renderToStaticMarkup(createElement(AvisoNoAplicaPanel, { aviso }))

  it('sin aviso no pinta nada', () => {
    expect(pinta(null)).toBe('')
  })

  it('pinta el titular, el porqué y el qué hacer', async () => {
    const aviso = await avisoNoAplica([JURIDICA], async () => true)
    const html = pinta(aviso)
    expect(html).toContain('Este caso no aplica para devolución de IVA')
    expect(html).toContain('solo aplica a personas naturales')
    expect(html).toContain('Ciérralo como perdido')
  })

  it('sin «qué hacer» no deja un párrafo vacío', async () => {
    const aviso = await avisoNoAplica([{ ...JURIDICA, que_hacer: undefined }], async () => true)
    const html = pinta(aviso)
    expect(html).toContain('Este caso no aplica')
    // El nodo del qué hacer sale del árbol: sin esto quedaría un bloque en blanco.
    expect(html).not.toContain('font-medium text-[#78350F]')
  })
})
