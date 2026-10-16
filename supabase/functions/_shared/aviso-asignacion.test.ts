import { describe, expect, it } from 'vitest'
import { textoAvisoAsignacion } from './aviso-asignacion'
import { htmlCorreoInterno } from './correo-interno'

describe('el correo del aviso de asignación', () => {
  it('con quien asignó, el código y el rol', () => {
    expect(textoAvisoAsignacion({ codigo: 'M1 26 4', nombre: 'SAN ANDRÉS', rol: 'comercial', quienAsigna: 'Tatiana Ríos' })).toEqual({
      titulo: 'Te asignaron M1 26 4 · SAN ANDRÉS',
      mensaje: 'Tatiana Ríos te dejó como responsable (comercial) de este negocio.',
      etiqueta: 'M1 26 4 — SAN ANDRÉS',
    })
  })

  it('sin quien asigne (automática) ni código ni rol', () => {
    expect(textoAvisoAsignacion({ codigo: null, nombre: ' ', rol: null, quienAsigna: null })).toEqual({
      titulo: 'Te asignaron un negocio',
      mensaje: 'Quedaste como responsable de este negocio.',
      etiqueta: 'un negocio',
    })
  })

  it('la plantilla es la de los avisos de etapa y escapa el texto', () => {
    const html = htmlCorreoInterno({ antetitulo: 'Responsable asignado', titulo: 'Te asignaron <b>X</b>', mensaje: 'A & B', etiqueta: '"M1"', link: 'https://agencia.metrikone.co/negocios/1' })
    expect(html).toContain('Te asignaron &lt;b&gt;X&lt;/b&gt;')
    expect(html).toContain('A &amp; B')
    expect(html).toContain('&quot;M1&quot;')
    expect(html).toContain('href="https://agencia.metrikone.co/negocios/1"')
    expect(html).toContain('Abrir el negocio')
    expect(html).toContain('Enviado por MéTRIK ONE')
  })
})
