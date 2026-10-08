import { describe, expect, it } from 'vitest'
import {
  bloquesMd,
  casillasVisibles,
  faltantes,
  filaATexto,
  leerConfigAutorizacion,
  llenar,
  marcadoresDe,
  medioDesdeParam,
  normalizarCasillas,
  puedeAutorizar,
  textoVisible,
  urlAutorizacion,
  TEXTO_MARCADOR,
} from './texto'

const FILA = {
  id: 't1',
  version: 'demo-v1.0',
  mayor: 1,
  menor: 0,
  titulo: 'Autorización',
  cuerpo_md: 'Hola, [NOMBRE_CLIENTE]. [RESPONSABLE] es la responsable. Plataforma de [ENCARGADO]. Escriba a [CANAL_DATOS].',
  detalle_md: null,
  casillas: [
    { clave: 'generales', texto: 'Soy [NOMBRE_CLIENTE] y autorizo a [AGENCIA].' },
    { clave: 'sensibles', texto: 'Sensibles' },
    { clave: 'menores', texto: 'Menores' },
    { clave: 'ofertas', texto: 'Ofertas' },
  ],
  variables: { encargado: 'Persona Encargada Inventada', canal_datos: 'datos@agencia-inventada.co' },
  mensajes: {},
  plantilla_sha256: 'a'.repeat(64),
}

const MARCA = { nombreComercial: 'Agencia Inventada', razonSocial: 'AGENCIA INVENTADA S.A.S.', nit: '900.000.000-1', nombre: 'AGENCIA INVENTADA S.A.S.' }

describe('el texto versionado', () => {
  it('lee la fila y descarta casillas desconocidas o repetidas', () => {
    const t = filaATexto({ ...FILA, casillas: [...FILA.casillas, { clave: 'otra', texto: 'x' }, { clave: 'generales', texto: 'dup' }] })!
    expect(t.casillas.map(c => c.clave)).toEqual(['generales', 'sensibles', 'menores', 'ofertas'])
    expect(t.esMarcador).toBe(false)
  })

  it('sin casilla general no es un texto', () => {
    expect(filaATexto({ ...FILA, casillas: [{ clave: 'sensibles', texto: 's' }] })).toBeNull()
  })

  it('ofertas solo se muestra si el workspace la activa', () => {
    const t = filaATexto(FILA)!
    expect(casillasVisibles(t, { ofertas: false }).map(c => c.clave)).toEqual(['generales', 'sensibles', 'menores'])
    expect(casillasVisibles(t, { ofertas: true }).map(c => c.clave)).toContain('ofertas')
  })

  it('el Encargado sale de la versión, nunca de una constante', () => {
    const t = filaATexto(FILA)!
    const m = marcadoresDe(t, MARCA, { nombreCliente: 'MAURICIO MORENO' })
    expect(m.encargado).toBe('Persona Encargada Inventada')
    expect(m.responsable).toBe('AGENCIA INVENTADA S.A.S., NIT 900.000.000-1')
    expect(m.nombreCliente).toBe('Mauricio Moreno')
    expect(llenar(t.cuerpoMd, m)).not.toContain('MéTRIK IA')
  })

  it('sin Encargado declarado, el texto queda incompleto y no se puede autorizar', () => {
    const t = filaATexto({ ...FILA, variables: { canal_datos: 'x@y.co' } })!
    const m = marcadoresDe(t, MARCA, { nombreCliente: 'Ana' })
    const r = puedeAutorizar(t, m, casillasVisibles(t, { ofertas: false }))
    expect(r).toEqual({ ok: false, motivo: 'incompleto', faltan: ['ENCARGADO'] })
  })

  it('un dato pendiente ⟦…⟧ también impide autorizar, aunque esté en el detalle', () => {
    expect(faltantes('Domicilio ⟦DIRECCIÓN DE LA AGENCIA⟧')).toEqual(['DIRECCIÓN DE LA AGENCIA'])
    const t = filaATexto({ ...FILA, detalle_md: 'Vigente desde ⟦FECHA⟧' })!
    const m = marcadoresDe(t, MARCA, { nombreCliente: 'Ana' })
    expect(puedeAutorizar(t, m, t.casillas)).toEqual({ ok: false, motivo: 'incompleto', faltan: ['FECHA'] })
  })

  it('el marcador nunca se puede autorizar', () => {
    const m = marcadoresDe(TEXTO_MARCADOR, MARCA, { nombreCliente: 'Ana' })
    expect(puedeAutorizar(TEXTO_MARCADOR, m, TEXTO_MARCADOR.casillas)).toMatchObject({ ok: false, motivo: 'marcador' })
    expect(TEXTO_MARCADOR.titulo).toContain('MARCADOR')
  })

  it('la huella cambia si cambia una casilla visible', () => {
    const t = filaATexto(FILA)!
    const m = marcadoresDe(t, MARCA, { nombreCliente: 'Ana' })
    const sin = textoVisible(t, m, casillasVisibles(t, { ofertas: false }))
    const con = textoVisible(t, m, casillasVisibles(t, { ofertas: true }))
    expect(sin).not.toBe(con)
    expect(sin).toContain('Soy Ana y autorizo a Agencia Inventada.')
    expect(sin).toContain('Versión demo-v1.0')
  })

  it('una casilla no mostrada no se acepta aunque venga marcada', () => {
    const t = filaATexto(FILA)!
    const vis = casillasVisibles(t, { ofertas: false })
    expect(normalizarCasillas({ generales: true, ofertas: true, sensibles: 'on' }, vis)).toEqual({
      generales: true, sensibles: true, menores: false, ofertas: null,
    })
  })
})

describe('configuración y url', () => {
  it('todo apagado por defecto; solo `true` literal enciende', () => {
    expect(leerConfigAutorizacion(null).correoAlCrear).toBe(false)
    expect(leerConfigAutorizacion({ autorizacion_datos: { correo_al_crear: 'true' } }).correoAlCrear).toBe(false)
    expect(leerConfigAutorizacion({ autorizacion_datos: { correo_al_crear: true, dias_enlace: 1000 } })).toMatchObject({ correoAlCrear: true, diasEnlace: 60 })
  })

  it('el medio sale del parámetro de la URL', () => {
    expect(medioDesdeParam('c')).toBe('correo')
    expect(medioDesdeParam('w')).toBe('whatsapp_reenviado')
    expect(medioDesdeParam(undefined)).toBe('otro')
    expect(urlAutorizacion('agencia', 'metrikone.co', 'T'.repeat(43), 'whatsapp_reenviado')).toBe(`https://agencia.metrikone.co/autorizacion/${'T'.repeat(43)}?m=w`)
  })
})

describe('markdown mínimo', () => {
  it('párrafos, títulos, listas y negrita, sin HTML', () => {
    const b = bloquesMd('## Título\n\n**Quién.** Texto <b>x</b>\n\n- uno\n- dos\n\n<small>Versión v1</small>')
    expect(b.map(x => x.tipo)).toEqual(['titulo', 'parrafo', 'lista', 'nota'])
    expect(b[1]).toEqual({ tipo: 'parrafo', segmentos: [{ texto: 'Quién.', negrita: true }, { texto: ' Texto x', negrita: false }] })
  })
})
