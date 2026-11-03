import { describe, it, expect } from 'vitest'
import { MENSAJE_GENERICO, MENSAJES_ERROR_VALIDA, ROTULO_NO_COMPLETADA, mensajeErrorValida } from './mensajes-error'
import { celdasFilaResultado, textoSeveridadFila } from './lote'

describe('el error de Valida en llano', () => {
  it('búsqueda incompleta: el texto aprobado, con el código aparte', () => {
    expect(mensajeErrorValida('busqueda_incompleta')).toEqual({
      mensaje:
        'No pudimos revisar todas las listas en este momento. La consulta no se registró ni se cobró; intenta de nuevo.',
      codigo: 'busqueda_incompleta',
    })
  })

  it('ningún mensaje de la tabla es un código', () => {
    for (const [codigo, mensaje] of Object.entries(MENSAJES_ERROR_VALIDA)) {
      expect(mensaje).not.toContain(codigo)
      expect(mensaje).not.toMatch(/\b[a-z]+_[a-z_]+\b/)
    }
  })

  it('un código desconocido, un HTTP o un error de la base caen al genérico, nunca crudos', () => {
    for (const crudo of ['codigo_nuevo_del_motor', 'HTTP 500', 'duplicate key value violates unique constraint', 'fetch failed']) {
      const r = mensajeErrorValida(crudo)
      expect(r.mensaje).toBe(MENSAJE_GENERICO)
      expect(r.codigo).toBe(crudo)
    }
  })

  it('una frase escrita para la persona (puerta de los CDA) pasa tal cual', () => {
    const frase = 'No se pudo verificar la aceptación de los términos de tu empresa. Intenta de nuevo en un momento.'
    expect(mensajeErrorValida(frase)).toEqual({ mensaje: frase, codigo: null })
    expect(mensajeErrorValida('Selecciona un archivo XLSX')).toEqual({ mensaje: 'Selecciona un archivo XLSX', codigo: null })
  })

  it('vacío: genérico sin detalle', () => {
    expect(mensajeErrorValida('')).toEqual({ mensaje: MENSAJE_GENERICO, codigo: null })
    expect(mensajeErrorValida(null)).toEqual({ mensaje: MENSAJE_GENERICO, codigo: null })
  })
})

describe('la fila del XLSX de resultados', () => {
  it('la observación de un error de Valida va en llano, no con el código', () => {
    const celdas = celdasFilaResultado({
      posicion: 1,
      entrada: { tipo: 'natural', nombre: 'Ana Ruiz' },
      estado: 'error',
      severidad: 'error',
      total_matches: 0,
      valida_consulta_id: null,
      resultado_error: 'busqueda_incompleta',
      error_parseo: null,
    })
    expect(celdas[5]).toBe(ROTULO_NO_COMPLETADA)
    expect(celdas[8]).toBe(MENSAJES_ERROR_VALIDA.busqueda_incompleta)
    expect(celdas.join(' ')).not.toContain('busqueda_incompleta')
  })
})

describe('la columna severidad del XLSX del cargue', () => {
  it('una búsqueda incompleta no se rotula «Error» sino para reintentar', () => {
    expect(textoSeveridadFila({ estado: 'error', severidad: 'error', resultado_error: 'busqueda_incompleta' })).toBe(
      ROTULO_NO_COMPLETADA,
    )
  })

  it('CONTROL — lo demás como siempre', () => {
    expect(textoSeveridadFila({ estado: 'error', severidad: 'error', resultado_error: 'valida_tiempo_agotado' })).toBe('Error')
    expect(textoSeveridadFila({ estado: 'hecha', severidad: 'sin_hallazgo', resultado_error: null })).toBe('Sin hallazgo')
    expect(textoSeveridadFila({ estado: 'pendiente', severidad: null, resultado_error: null })).toBe('Sin consultar')
  })
})
