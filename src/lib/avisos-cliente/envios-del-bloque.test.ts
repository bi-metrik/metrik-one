import { describe, expect, it } from 'vitest'
import { claveDeEnvio, enviosDelBloque, type FilaAvisoCliente } from './envios-del-bloque'

const fila = (p: Partial<FilaAvisoCliente>): FilaAvisoCliente => ({
  id: 'a',
  canal: 'email',
  estado: 'enviado',
  destino: 'cliente@correo.co',
  copia_a: 'comercial@soena.co',
  motivo: null,
  titulo: 'Tu certificado UPME',
  created_at: '2026-10-28T15:00:00Z',
  entregado_at: null,
  queja_at: null,
  bloque_config_id: null,
  ...p,
})

describe('claveDeEnvio', () => {
  it('enviado con acuse es entregado; sin acuse, enviado', () => {
    expect(claveDeEnvio({ estado: 'enviado', entregado_at: '2026-10-28T15:01:00Z' })).toBe('entregado')
    expect(claveDeEnvio({ estado: 'enviado', entregado_at: null })).toBe('enviado')
  })

  it('el rebote manda sobre una entrega previa', () => {
    expect(claveDeEnvio({ estado: 'rebotado', entregado_at: '2026-10-28T15:01:00Z' })).toBe('rebotado')
  })

  it('un estado desconocido no se disfraza de entrega', () => {
    expect(claveDeEnvio({ estado: 'disparado', entregado_at: null })).toBe('otro')
  })
})

describe('enviosDelBloque', () => {
  it('solo correo y solo el aviso de entrada a la etapa, el más reciente primero', () => {
    const r = enviosDelBloque([
      fila({ id: 'viejo', created_at: '2026-10-20T10:00:00Z' }),
      fila({ id: 'wa', canal: 'whatsapp', estado: 'disparado' }),
      fila({ id: 'factura', bloque_config_id: 'b1' }),
      fila({ id: 'nuevo', created_at: '2026-10-28T10:00:00Z' }),
    ])
    expect(r.map(e => e.id)).toEqual(['nuevo', 'viejo'])
  })

  it('incluye los avisos por documento si el bloque lo pide', () => {
    const r = enviosDelBloque([fila({ id: 'factura', bloque_config_id: 'b1' })], { incluir_avisos_de_documento: true })
    expect(r).toHaveLength(1)
  })

  it('un rebote se ve como rebote, sin fecha de entrega y con qué hacer', () => {
    const [e] = enviosDelBloque([fila({ estado: 'rebotado', entregado_at: '2026-10-28T15:01:00Z' })])
    expect(e.etiqueta).toBe('Rebotó')
    expect(e.tono).toBe('problema')
    expect(e.entregadoAt).toBeNull()
    expect(e.explicacion).toMatch(/Corrige el correo del cliente/)
  })

  it('una entrega trae su fecha y la copia oculta', () => {
    const [e] = enviosDelBloque([fila({ entregado_at: '2026-10-28T15:01:00Z' })])
    expect(e).toMatchObject({ clave: 'entregado', tono: 'ok', entregadoAt: '2026-10-28T15:01:00Z', copiaA: 'comercial@soena.co', explicacion: null })
  })

  it('un omitido por falta de correo lo dice en llano', () => {
    const [e] = enviosDelBloque([fila({ estado: 'omitido', destino: null, motivo: 'sin_correo' })])
    expect(e.explicacion).toBe('El cliente no tiene correo registrado.')
  })
})
