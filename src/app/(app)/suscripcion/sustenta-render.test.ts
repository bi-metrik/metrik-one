/**
 * La tarjeta de Sustenta, renderizada (spec de Mateo y Ren, 2026-09-23). Se fija:
 *   - el copy aprobado, los dos CTAs y el descarte, sin precio, sin exclamaciones y sin las palabras
 *     vetadas por el spec;
 *   - la matriz decorativa: 9 celdas en escritorio, 3 en la franja del teléfono, ocultas a los
 *     lectores de pantalla y con solo tokens de ONE (el acento a 15/35/60 %);
 *   - el movimiento: toda clase de animación va detrás de `motion-safe:`, así «reducir movimiento»
 *     deja la matriz quieta y visible;
 *   - la confirmación (recién pedida con el nombre, o previa) y el panel con sus tres vistas y el
 *     «Cómo empezamos».
 *
 * Se queda en `.ts`: `vitest.config.ts` solo recoge `*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))
vi.mock('./acciones', () => ({
  descartarSustenta: async () => ({ ok: true }),
  pedirContactoDeSustenta: async () => ({ ok: true, yaExistia: false, nombre: 'Ana' }),
  registrarEventoSustenta: async () => {},
}))

const { SeccionSustenta, TarjetaSustenta, ConfirmacionSustenta, PanelContenido, PanelSustenta, MatrizDecorativa } = await import(
  './sustenta'
)

function texto(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const VETADAS = /garantizamos|urgente|proceso|premium/i

/** Toda clase de animación u ocultamiento lleva `motion-safe:`: con «reducir movimiento» no aplica. */
function expectSoloMotionSafe(html: string) {
  const clases = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/))
  const animadas = clases.filter((c) => /animate-|fade-in|zoom-in|opacity-0|duration-/.test(c))
  expect(animadas.length).toBeGreaterThan(0)
  for (const c of animadas) expect(c, c).toMatch(/^motion-safe:/)
}
const nada = () => {}

describe('la tarjeta de Sustenta', () => {
  const html = renderToStaticMarkup(
    React.createElement(TarjetaSustenta, { pendiente: false, onDemostracion: nada, onVerComoFunciona: nada, onAhoraNo: nada }),
  )
  const t = texto(html)

  it('dice el copy aprobado, con los dos CTAs y el descarte', () => {
    expect(t).toContain('Recomendado para tu CDA')
    expect(t).toContain('¿Quieres más control sobre tu SARLAFT?')
    expect(t).toContain('Valida revisa las listas. Sustenta sostiene todo tu SARLAFT.')
    expect(t).toContain('conectados a las consultas que tu equipo ya hace en Valida')
    expect(t).toContain('Matriz de riesgos y controles al día, sin hojas de cálculo sueltas.')
    expect(t).toContain('Cada contraparte vinculada con su consulta de listas y su soporte.')
    expect(t).toContain('Evidencia organizada y trazable para el oficial de cumplimiento y la revisión.')
    expect(t).toContain('Quiero una demostración')
    expect(t).toContain('Ver cómo funciona')
    expect(t).toContain('Ahora no')
  })

  it('el CTA primario va antes que el secundario (en el teléfono, arriba)', () => {
    expect(t.indexOf('Quiero una demostración')).toBeLessThan(t.indexOf('Ver cómo funciona'))
  })

  it('sin precio, sin exclamaciones y sin palabras vetadas', () => {
    expect(t).not.toMatch(/\$|\bCOP\b/)
    expect(t).not.toMatch(/[!¡]/)
    expect(t).not.toMatch(VETADAS)
  })

  it('la marca es el lockup de producto «MéTRIK sustenta», no un wordmark improvisado', () => {
    expect(html).toContain('data-metrik-lockup="sustenta"')
    expect(t).toContain('MéTRIK sustenta')
    expect(t).not.toContain('SUSTENTA · de MeTRIK ONE')
    expect(html).not.toContain('data-wordmark-sustenta')
    // «MéTRIK» con é minúscula y tilde: nunca MeTRIK ni METRIK en lo que se ve.
    expect(t).not.toMatch(/MeTRIK|METRIK/)
  })

  it('el orden: distintivo, lockup, gancho y titular, que sigue siendo un encabezado nombrado', () => {
    const orden = ['Recomendado para tu CDA', 'MéTRIK sustenta', '¿Quieres más control sobre tu SARLAFT?', 'Valida revisa las listas.']
    const pos = orden.map((o) => t.indexOf(o))
    expect(pos.every((p) => p >= 0)).toBe(true)
    expect([...pos].sort((a, b) => a - b)).toEqual(pos)
    expect(html).toMatch(/<h2 id="sustenta-titular"/)
    expect(html).toContain('aria-labelledby="sustenta-titular"')
  })

  it('el distintivo es discreto y con tokens de ONE, sin tono de promoción', () => {
    const chip = /<span[^>]*data-distintivo-sustenta[^>]*>/.exec(html)?.[0] ?? ''
    expect(chip).toContain('text-acento')
    expect(chip).toContain('dark:text-acento-claro')
    expect(t).not.toMatch(/promoci[oó]n|oferta|gratis/i)
  })

  it('la matriz es decorativa: 9 celdas en escritorio y una franja de 3 en el teléfono', () => {
    expect((html.match(/data-celda/g) ?? []).length).toBe(9)
    expect(html).toMatch(/aria-hidden="true"[^>]*data-matriz-sustenta|data-matriz-sustenta[^>]*aria-hidden="true"/)
    expect(html).toMatch(/aria-hidden="true"[^>]*data-franja-sustenta|data-franja-sustenta[^>]*aria-hidden="true"/)
    const franja = html.slice(html.indexOf('data-franja-sustenta'))
    expect(franja.slice(0, franja.indexOf('</div>')).match(/<span/g)?.length).toBe(3)
  })

  it('solo tokens de ONE: el acento a 15, 35 y 60 %, y ningún color de la paleta de Tailwind', () => {
    for (const o of [15, 35, 60]) expect(html).toContain(`bg-acento/${o}`)
    expect(html).not.toMatch(/(bg|text|border|from|to|via)-(emerald|green|teal|blue|slate|gray|zinc|amber|red)-\d/)
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i)
    // El degradado no pasa del 6 %.
    expect(html).toMatch(/to-acento\/5\b/)
  })

  it('respeta «reducir movimiento»: antes de entrar en pantalla, lo que la oculta va detrás de motion-safe', () => {
    expectSoloMotionSafe(html)
  })

  it('la animación completa dura menos de 600 ms', () => {
    const retardos = [...html.matchAll(/animation-delay:(\d+)ms/g)].map((m) => Number(m[1]))
    expect(Math.max(...retardos) + 200).toBeLessThanOrEqual(600)
  })

  it('en el teléfono los CTAs van a todo el ancho', () => {
    const botones = [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>(Quiero una demostración|Ver cómo funciona)</g)]
    expect(botones.length).toBe(2)
    for (const b of botones) expect(b[1]).toMatch(/\bw-full\b.*\bsm:w-auto\b/)
  })
})

describe('la matriz, ya en pantalla', () => {
  it('lleva la animación de entrada y no se oculta', () => {
    const html = renderToStaticMarkup(React.createElement(MatrizDecorativa, { visible: true }))
    expect(html).toContain('motion-safe:animate-in')
    expect(html).not.toContain('motion-safe:opacity-0')
    expectSoloMotionSafe(html)
  })
})

describe('la confirmación', () => {
  it('recién pedida: con el nombre y el de Mauricio', () => {
    const t = texto(renderToStaticMarkup(React.createElement(ConfirmacionSustenta, { recien: true, nombre: 'Ana' })))
    expect(t).toContain('Listo, Ana. Mauricio Moreno, de MéTRIK, te escribirá para agendar la demostración.')
    expect(t).not.toMatch(/[!¡]/)
  })

  it('recién pedida sin nombre conocido: no inventa uno', () => {
    const t = texto(renderToStaticMarkup(React.createElement(ConfirmacionSustenta, { recien: true, nombre: null })))
    expect(t).toContain('Listo. Mauricio Moreno, de MéTRIK, te escribirá')
  })

  it('pedida antes (por esta persona o por otra del CDA)', () => {
    const t = texto(renderToStaticMarkup(React.createElement(ConfirmacionSustenta, { recien: false, nombre: 'Ana' })))
    expect(t).toBe('MéTRIK sustenta Ya recibimos tu solicitud. Te escribiremos para agendar la demostración.')
  })

  it('la sección arranca en la confirmación si ya estaba pedida, sin CTAs', () => {
    const html = renderToStaticMarkup(React.createElement(SeccionSustenta, { inicial: 'solicitada' }))
    expect(html).toContain('data-sustenta-solicitada')
    expect(html).toContain('role="status"')
    expect(texto(html)).not.toContain('Quiero una demostración')
    expect(html).not.toContain('data-tarjeta-sustenta')
  })

  it('y en la tarjeta si no', () => {
    const html = renderToStaticMarkup(React.createElement(SeccionSustenta, { inicial: 'oferta' }))
    expect(html).toContain('data-tarjeta-sustenta')
  })
})

describe('el panel «Ver cómo funciona»', () => {
  const html = renderToStaticMarkup(React.createElement(PanelContenido))
  const t = texto(html)

  it('el encabezado del panel usa el mismo lockup', () => {
    const panel = renderToStaticMarkup(React.createElement(PanelSustenta, { onCerrar: () => {}, pie: null }))
    expect(panel).toContain('data-metrik-lockup="sustenta"')
    expect(texto(panel)).toMatch(/^MéTRIK sustenta/)
  })

  it('encabeza con el titular y trae tres vistas ilustradas, una por beneficio', () => {
    expect(t).toContain('Valida revisa las listas. Sustenta sostiene todo tu SARLAFT.')
    expect((html.match(/data-vista-panel/g) ?? []).length).toBe(3)
    expect(t).toContain('Consulta en Valida')
    expect((t.match(/Vista de ejemplo, sin datos de clientes\./g) ?? []).length).toBe(3)
  })

  it('cierra con «Cómo empezamos» en tres pasos', () => {
    expect(t).toContain('Cómo empezamos')
    expect(t).toContain('1 Demostración con tu equipo.')
    expect(t).toContain('2 Configuramos tu matriz y tus segmentos con ustedes.')
    expect(t).toContain('3 Tu equipo opera Sustenta junto a Valida.')
  })

  it('sin precio, sin exclamaciones y sin palabras vetadas', () => {
    expect(t).not.toMatch(/\$/)
    expect(t).not.toMatch(/[!¡]/)
    expect(t).not.toMatch(VETADAS)
  })
})
