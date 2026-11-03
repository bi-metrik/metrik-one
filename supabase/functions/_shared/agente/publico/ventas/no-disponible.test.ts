import { describe, expect, it } from 'vitest'
import { alternativasA, nombreCorto, noDisponiblesPedidos, preciosDeNoDisponibles, productoParaModelo } from './catalogo-ventas'
import type { ProductoVenta } from './catalogo-ventas'
import { noDisponiblesDeFilas } from './produccion-ventas'
import { comoNoDisponible } from './puertos-ventas'
import { montosDelTexto } from '../precios'

/**
 * El producto que existe en Ferretería pero ya no está activo (3-nov, fin de la campaña de octubre: «Cuéntame más sobre
 * el mp17» terminaba en «No pude revisarlo» o en persona por falla). Catálogo INVENTADO.
 */
const p = (codigo: string, titulo: string, precio: number, o: Partial<ProductoVenta> = {}): ProductoVenta => ({
  publicacionId: `pub-${codigo}`, codigo, sku: `EJ-${codigo}`, titulo, nombre: titulo, marca: 'MarcaEjemplo', categoria: 'Herramientas', etiquetas: [], precio, ficha: [], ...o,
})
const TALADRO = p('MP-17', 'Taladro percutor inalámbrico MarcaEjemplo 20V', 324900)
const OTRO = p('MP-40', 'Taladro percutor inalámbrico MarcaEjemplo 12V', 199900)
const PULIDORA = p('MP-60', 'Pulidora angular MarcaEjemplo 4-1/2"', 133000)

describe('el producto que ya no está disponible', () => {
  it('por código: el agotado con ese código; si hay uno activo con el mismo código, ninguno', () => {
    const nd = [comoNoDisponible(TALADRO)]
    expect(noDisponiblesPedidos(nd, [PULIDORA], { codigo: 'mp17' }).map((x) => x.codigo)).toEqual(['MP-17'])
    expect(noDisponiblesPedidos(nd, [PULIDORA], { buscar: 'Cuéntame más sobre el mp 17' }).map((x) => x.codigo)).toEqual(['MP-17'])
    expect(noDisponiblesPedidos(nd, [TALADRO], { codigo: 'MP-17' })).toEqual([])
    expect(noDisponiblesPedidos(nd, [PULIDORA], { codigo: 'MP-99' })).toEqual([])
  })

  it('por nombre sí; «¿qué tienen?» no nombra un producto', () => {
    const nd = [comoNoDisponible(TALADRO)]
    expect(noDisponiblesPedidos(nd, [], { buscar: 'taladro inalámbrico' }).map((x) => x.codigo)).toEqual(['MP-17'])
    expect(noDisponiblesPedidos(nd, [], { buscar: 'qué tienen' })).toEqual([])
  })

  it('la alternativa es del mismo tipo; si no hay, ninguna', () => {
    const nd = comoNoDisponible(TALADRO)
    expect(alternativasA(nd, [OTRO, PULIDORA]).map((x) => x.codigo)).toEqual(['MP-40'])
    expect(alternativasA(nd, [PULIDORA])).toEqual([])
  })

  it('el nombre para el cliente: código, tipo y marca, sin precio', () => {
    expect(nombreCorto(comoNoDisponible(TALADRO))).toBe('MP-17, taladro percutor inalámbrico MarcaEjemplo')
    expect(comoNoDisponible(TALADRO)).not.toHaveProperty('precio')
  })

  it('el precio del historial de un producto que ya no está activo se ataja; el de uno activo no', () => {
    const historial = [JSON.stringify({ productos: [productoParaModelo(TALADRO), productoParaModelo(PULIDORA)] })]
    expect(preciosDeNoDisponibles(montosDelTexto('El MP-17 vale $324.900.'), historial, [PULIDORA])).toEqual([['MP-17', '324900']])
    expect(preciosDeNoDisponibles(montosDelTexto('La pulidora vale $133.000.'), historial, [PULIDORA])).toEqual([])
    // Si sigue activo, su precio vale.
    expect(preciosDeNoDisponibles(montosDelTexto('El MP-17 vale $324.900.'), historial, [TALADRO, PULIDORA])).toEqual([])
    // Mismo precio que un activo: no se puede saber de cuál habla; pasa.
    expect(preciosDeNoDisponibles(montosDelTexto('$324.900'), historial, [p('MP-70', 'Otra cosa', 324900)])).toEqual([])
  })

  it('las filas de producción: sin precio ni ficha, con su estado', () => {
    const nd = noDisponiblesDeFilas([
      { id: 'a', codigo: 'MP-17', titulo: 'Taladro', estado: 'agotada', etiquetas: ['taladro'], producto: { sku: 'X', nombre: 'Taladro', marca: 'M', categoria: null } },
      { id: 'b', codigo: 'MP-2', titulo: 'Sin producto', estado: 'borrador', producto: null },
    ])
    expect(nd).toEqual([{ publicacionId: 'a', codigo: 'MP-17', estado: 'agotada', sku: 'X', titulo: 'Taladro', nombre: 'Taladro', marca: 'M', categoria: null, etiquetas: ['taladro'] }])
  })
})
