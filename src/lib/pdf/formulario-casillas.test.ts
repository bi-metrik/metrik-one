import { describe, it, expect } from 'vitest'
import { metaDeCasilla, getCasillasMeta } from './formulario-casillas'
import { TIPO_DOCUMENTO_DIAN } from '@/lib/dian/tipo-documento'

describe('tipo de documento del solicitante (010 y 1668)', () => {
  it('es la casilla 20 en los dos formularios', () => {
    // Estuvo etiquetada como "5" (que es el NIT). El operador ve ese numero en
    // pantalla para cotejar contra el formulario impreso: si no coincide, corrige
    // la casilla equivocada — que es como cuatro casos salieron con "13".
    expect(metaDeCasilla('formulario-010', 'tipo_documento').casilla).toBe('20')
    expect(metaDeCasilla('formulario-1668', 'tipo_documento').casilla).toBe('20')
  })

  it('el codigo que va estampado es NIT = 31, no cedula', () => {
    expect(TIPO_DOCUMENTO_DIAN.nit).toBe('31')
    expect(TIPO_DOCUMENTO_DIAN.cedula_ciudadania).toBe('13')
  })

  it('ninguna casilla del 010 comparte numero con otra de grupo distinto', () => {
    // Guarda contra el error que se acaba de corregir: dos casillas distintas
    // apuntando al mismo numero solo es legitimo cuando son el mismo dato
    // (valor + codigo, ej. municipio/codigo_municipio en la 28).
    const porNumero = new Map<string, Set<string>>()
    for (const c of getCasillasMeta('formulario-010')) {
      if (!c.casilla) continue
      if (!porNumero.has(c.casilla)) porNumero.set(c.casilla, new Set())
      porNumero.get(c.casilla)!.add(c.grupo)
    }
    for (const [casilla, grupos] of porNumero) {
      expect(grupos.size, `casilla ${casilla} repartida entre grupos ${[...grupos].join(', ')}`).toBe(1)
    }
  })
})
