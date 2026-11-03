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

  it('el bot de WhatsApp sin persona', () => {
    expect(textoAvisoAsignacion({ codigo: 'M1 26 4', nombre: 'SAN ANDRÉS', rol: 'comercial', quienAsigna: null, origen: 'bot_whatsapp' }).mensaje)
      .toBe('El bot de WhatsApp te dejó como responsable (comercial) de este negocio.')
  })

  it('la regla por etapa dice la etapa; sin etapa conocida, el texto de siempre; sin rol, sin paréntesis', () => {
    expect(textoAvisoAsignacion({ codigo: null, nombre: 'X', rol: 'operaciones', quienAsigna: null, origen: 'regla_etapa', etapa: 'Cargue' }).mensaje)
      .toBe('Quedaste como responsable (operaciones) de este negocio al entrar a la etapa Cargue.')
    expect(textoAvisoAsignacion({ codigo: null, nombre: 'X', rol: 'operaciones', quienAsigna: null, origen: 'regla_etapa', etapa: ' ' }).mensaje)
      .toBe('Quedaste como responsable (operaciones) de este negocio.')
    expect(textoAvisoAsignacion({ codigo: null, nombre: 'X', rol: null, quienAsigna: null, origen: 'bot_whatsapp' }).mensaje)
      .toBe('El bot de WhatsApp te dejó como responsable de este negocio.')
  })

  it('con persona manda la persona aunque el origen diga otra cosa', () => {
    expect(textoAvisoAsignacion({ codigo: null, nombre: 'X', rol: 'comercial', quienAsigna: 'Edgar Alba', origen: 'persona' }).mensaje)
      .toBe('Edgar Alba te dejó como responsable (comercial) de este negocio.')
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
