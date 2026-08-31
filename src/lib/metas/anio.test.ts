import { describe, it, expect } from 'vitest'
import {
  aNumero, aTexto, camposDe, filasVacias, filasCambiadas, copiarHaciaAdelante,
  type FilaMetaAnio,
} from './anio'

const EQUIPO = { staffId: null }
const VENDEDOR = { staffId: 'staff-1' }

const fila = (mes: number, over: Partial<FilaMetaAnio> = {}): FilaMetaAnio => ({
  mes, metaLeads: '', metaLeadsCalificados: '', metaNumVentas: '', metaValor: '', ...over,
})

describe('aNumero', () => {
  it('el campo vacío es "sin meta", no cero', () => {
    expect(aNumero('')).toBeNull()
    expect(aNumero('   ')).toBeNull()
    expect(aNumero('0')).toBe(0)
  })

  it('descarta lo que no es un número usable', () => {
    expect(aNumero('abc')).toBeNull()
    expect(aNumero('-5')).toBeNull()
  })

  it('acepta decimales para el valor en pesos', () => {
    expect(aNumero('1500000.50')).toBe(1500000.5)
  })
})

describe('aTexto', () => {
  it('null y undefined vuelven como campo vacío, no como cero', () => {
    expect(aTexto(null)).toBe('')
    expect(aTexto(undefined)).toBe('')
    expect(aTexto(0)).toBe('0')
  })
})

describe('camposDe', () => {
  it('el equipo edita las cuatro metas del embudo', () => {
    expect(camposDe(EQUIPO)).toEqual(['metaLeads', 'metaLeadsCalificados', 'metaNumVentas', 'metaValor'])
  })

  it('un vendedor solo edita ventas y valor: leads y negocios son del workspace', () => {
    expect(camposDe(VENDEDOR)).toEqual(['metaNumVentas', 'metaValor'])
  })
})

describe('filasVacias', () => {
  it('son doce meses, de enero a diciembre', () => {
    const f = filasVacias()
    expect(f).toHaveLength(12)
    expect(f[0].mes).toBe(1)
    expect(f[11].mes).toBe(12)
  })
})

describe('filasCambiadas', () => {
  it('sin ediciones no manda nada a guardar', () => {
    const orig = filasVacias()
    expect(filasCambiadas(orig, orig, EQUIPO)).toEqual([])
  })

  it('devuelve solo el mes editado', () => {
    const orig = filasVacias()
    const act = orig.map((f) => (f.mes === 3 ? { ...f, metaNumVentas: '10' } : f))
    expect(filasCambiadas(orig, act, EQUIPO).map((f) => f.mes)).toEqual([3])
  })

  it('un cambio solo de formato no cuenta como cambio', () => {
    const orig = [fila(1, { metaNumVentas: '7' })]
    const act = [fila(1, { metaNumVentas: '0007' })]
    expect(filasCambiadas(orig, act, EQUIPO)).toEqual([])
  })

  it('borrar el valor cuenta como cambio: limpia la meta', () => {
    const orig = [fila(1, { metaNumVentas: '7' })]
    const act = [fila(1, { metaNumVentas: '' })]
    expect(filasCambiadas(orig, act, EQUIPO)).toHaveLength(1)
  })

  it('con un vendedor elegido ignora los campos de workspace', () => {
    const orig = [fila(1, { metaLeads: '800' })]
    const act = [fila(1, { metaLeads: '999' })]
    expect(filasCambiadas(orig, act, VENDEDOR)).toEqual([])
    expect(filasCambiadas(orig, act, EQUIPO)).toHaveLength(1)
  })

  it('un mes que no estaba cargado cuenta solo si trae algún valor', () => {
    expect(filasCambiadas([], [fila(5)], EQUIPO)).toEqual([])
    expect(filasCambiadas([], [fila(5, { metaValor: '100' })], EQUIPO)).toHaveLength(1)
  })
})

describe('copiarHaciaAdelante', () => {
  it('copia a los meses siguientes y no toca el mes fuente', () => {
    const filas = filasVacias().map((f) => (f.mes === 1 ? { ...f, metaNumVentas: '10' } : f))
    const res = copiarHaciaAdelante(filas, 1, EQUIPO)
    expect(res[0].metaNumVentas).toBe('10')
    expect(res[11].metaNumVentas).toBe('10')
  })

  it('no pisa los meses anteriores: ahí ya se midió a alguien', () => {
    const filas = filasVacias().map((f) =>
      f.mes === 1 ? { ...f, metaNumVentas: '5' } : f.mes === 6 ? { ...f, metaNumVentas: '20' } : f)
    const res = copiarHaciaAdelante(filas, 6, EQUIPO)
    expect(res.find((f) => f.mes === 1)?.metaNumVentas).toBe('5')
    expect(res.find((f) => f.mes === 7)?.metaNumVentas).toBe('20')
  })

  it('con un vendedor elegido no arrastra los campos de workspace', () => {
    const filas = filasVacias().map((f) =>
      f.mes === 1 ? { ...f, metaNumVentas: '10', metaLeads: '800' } : f)
    const res = copiarHaciaAdelante(filas, 1, VENDEDOR)
    expect(res[5].metaNumVentas).toBe('10')
    expect(res[5].metaLeads).toBe('')
  })

  it('copiar desde diciembre no cambia nada', () => {
    const filas = filasVacias().map((f) => (f.mes === 12 ? { ...f, metaNumVentas: '9' } : f))
    expect(copiarHaciaAdelante(filas, 12, EQUIPO)).toEqual(filas)
  })
})
