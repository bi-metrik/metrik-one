/**
 * La pantalla de los pantallazos por pasajero (diseño §6.1, P1 a P7).
 *
 * ⚠️ Por qué RENDER: el requisito es de texto en pantalla — *«la persona tiene que saber qué
 * pantallazo va en cada casilla sin preguntar»*. Las reglas puras pueden estar perfectas
 * (`tarifa-pasajero.test.ts`) y la pantalla pintar una casilla que no aplica, o pegar en
 * la 2 antes de hora. Solo el render lo mide.
 *
 * ⚠️ `renderToStaticMarkup` mide el PRIMER render, sin eventos: el rechazo de un pantallazo
 * (P5) y el selector de moneda aparecen después de pegar y no se afirman aquí; su texto sale
 * de `validarLecturaEnCasilla`, probado aparte.
 *
 * Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({
  leerCasillaDeItem: async () => ({ ok: true, mensaje: '', alertas: [] }),
  quitarCasillaDeItem: async () => ({ success: true }),
  confirmarMenorNoPaga: async () => ({ success: true }),
  actualizarComposicionDeItem: async () => ({ success: true }),
  confirmarTarifaPorPasajero: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/pantallazo-actions', () => ({
  descartarPropuestaDePantallazo: async () => ({ success: true }),
}))

const { default: TarifaPasajeroItem } = await import('./tarifa-pasajero-item')
const { ranuraPorSlug } = await import('@/lib/cotizaciones/ranuras-pantallazo')

const HOTEL = ranuraPorSlug('hotel_detalle')!
const VUELO = ranuraPorSlug('vuelo_detalle')!

const lectura = (over: Record<string, unknown>) => ({
  moneda: 'COP',
  total: 0,
  aPagarAgencia: null,
  porTipo: [],
  ocupacion: { adultos: null, ninos: null, infantes: null, total: null },
  ocupacionDelItem: false,
  identidad: {},
  notasCliente: [],
  alertas: [],
  campos: [],
  nombre: 'Línea',
  descripcion: '',
  leidaEn: '2026-09-16T12:00:00Z',
  ...over,
})

function pintar(props: Record<string, unknown>) {
  return renderToStaticMarkup(
    React.createElement(TarifaPasajeroItem, {
      itemId: 'item-1',
      ranura: HOTEL,
      composicionViaje: null,
      tarifaPax: null,
      costoUnitarioLinea: 0,
      onCambio: () => {},
      ...props,
    } as Parameters<typeof TarifaPasajeroItem>[0]),
  )
}

/** El texto visible, sin etiquetas: una casilla parte su número y su título en dos nodos. */
const sinEtiquetas = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('las casillas dicen qué pantallazo va en cada una (P1, P2, P3)', () => {
  it('2 adultos, 1 niño y 1 infante: tres casillas numeradas con la búsqueda literal', () => {
    const texto = sinEtiquetas(pintar({ composicionViaje: { adultos: 2, ninos: 1, infantes: 1 } }))
    expect(texto).toContain('1 Grupo completo')
    expect(texto).toContain('Busca en la plataforma: 2 adultos, 1 niño, 1 infante')
    expect(texto).toContain('2 Sin el infante')
    expect(texto).toContain('Busca otra vez el mismo hotel, habitación y fechas con: 2 adultos, 1 niño')
    expect(texto).toContain('3 Solo adultos')
    expect(texto).toContain('Busca otra vez el mismo hotel, habitación y fechas con: 2 adultos')
  })

  it('P1: la 1 se puede pegar; la 2 y la 3 se ven en gris con la razón, sin zona de pegado', () => {
    const html = pintar({ composicionViaje: { adultos: 2, ninos: 1, infantes: 1 } })
    expect(html).toContain('aria-label="Pegar el pantallazo 1: Grupo completo"')
    expect(html).not.toContain('aria-label="Pegar el pantallazo 2')
    expect(html).not.toContain('aria-label="Pegar el pantallazo 3')
    expect(sinEtiquetas(html)).toContain('(Solo si el pantallazo 1 no separa adultos, niños e infantes)')
  })

  it('P2: sin infantes no aparece «sin el infante»; solo adultos, una casilla', () => {
    const conNino = sinEtiquetas(pintar({ composicionViaje: { adultos: 2, ninos: 1, infantes: 0 } }))
    expect(conNino).not.toContain('Sin el infante')
    expect(conNino).toContain('2 Solo adultos')

    const soloAdultos = sinEtiquetas(pintar({ composicionViaje: { adultos: 2, ninos: 0, infantes: 0 } }))
    expect(soloAdultos).not.toContain('Solo adultos')
    expect(soloAdultos).not.toContain('Grupo completo')
    expect(soloAdultos).toContain('Busca en la plataforma: 2 adultos')
  })

  it('P3: nunca siglas', () => {
    const html = pintar({ composicionViaje: { adultos: 2, ninos: 1, infantes: 1 } })
    expect(html).not.toMatch(/\b(ADT|CHD|INF)\b/)
  })

  it('sin composición del viaje, la línea la pide antes de mostrar casillas', () => {
    const texto = sinEtiquetas(pintar({ composicionViaje: null }))
    expect(texto).toContain('Escribe cuántos adultos, niños e infantes cubre esta línea')
    expect(texto).not.toContain('Grupo completo')
  })

  it('la composición propia de la línea manda sobre la del viaje (P7)', () => {
    const texto = sinEtiquetas(pintar({
      composicionViaje: { adultos: 4, ninos: 0, infantes: 0 },
      tarifaPax: { composicion: { adultos: 2, ninos: 1, infantes: 0 } },
    }))
    expect(texto).toContain('Esta línea cubre: 2 adultos, 1 niño')
    expect(texto).toContain('ajustado en esta línea')
    expect(texto).toContain('Cambiar pasajeros de esta línea')
  })
})

describe('lo que encontró el pantallazo 1 (P4, P6)', () => {
  it('un solo total para el grupo: dice qué falta y activa la casilla 2', () => {
    const html = pintar({
      composicionViaje: { adultos: 2, ninos: 1, infantes: 0 },
      tarifaPax: {
        casillas: {
          grupo_completo: lectura({ total: 3780884.17, ocupacion: { adultos: 2, ninos: 1, infantes: 0, total: null }, identidad: { hotel: 'Crown Paradise Club Cancun All Inclusive' } }),
        },
      },
    })
    const texto = sinEtiquetas(html)
    expect(texto).toContain('Este pantallazo tiene un solo total para el grupo. Falta el 2: busca con 2 adultos.')
    expect(html).toContain('aria-label="Pegar el pantallazo 2: Solo adultos"')
    expect(texto).toContain('Leído: $3.780.884')
  })

  it('con precio por tipo: el resultado ya partido y la casilla 2 no se ofrece', () => {
    const html = pintar({
      ranura: VUELO,
      composicionViaje: { adultos: 5, ninos: 1, infantes: 0 },
      tarifaPax: {
        casillas: {
          grupo_completo: lectura({
            total: 11306378,
            porTipo: [
              { tipo: 'adulto', cantidad: 5, subtotal: 9535315 },
              { tipo: 'nino', cantidad: 1, subtotal: 1771063 },
            ],
            ocupacion: { adultos: 5, ninos: 1, infantes: 0, total: 6 },
          }),
        },
      },
    })
    const texto = sinEtiquetas(html)
    expect(texto).toContain('Este pantallazo ya trae el precio de adultos y niños. No hace falta nada más.')
    expect(texto).toContain('Adulto $1.907.063 · Niño $1.771.063')
    expect(texto).toContain('Confirmar y cargar el costo')
    expect(html).not.toContain('aria-label="Pegar el pantallazo 2')
  })

  it('confirmado y vigente: muestra el costo cargado, sin volver a pedir confirmación', () => {
    const texto = sinEtiquetas(pintar({
      ranura: VUELO,
      composicionViaje: { adultos: 2, ninos: 0, infantes: 1 },
      costoUnitarioLinea: 1294351,
      tarifaPax: {
        casillas: {
          grupo_completo: lectura({
            total: 1294351,
            porTipo: [{ tipo: 'adulto', cantidad: 2, subtotal: 1283014 }, { tipo: 'infante', cantidad: 1, subtotal: 11337 }],
            ocupacion: { adultos: 2, ninos: 0, infantes: 1, total: 3 },
          }),
        },
        confirmada: {
          composicion: { adultos: 2, ninos: 0, infantes: 1 },
          costos: [
            { tipo: 'adulto', cantidad: 2, unitarioCOP: 641507, totalCOP: 1283014 },
            { tipo: 'infante', cantidad: 1, unitarioCOP: 11337, totalCOP: 11337 },
          ],
          costoTotalCOP: 1294351,
          moneda: 'COP',
          tasa: null,
          confirmadaEn: '2026-09-16T13:00:00Z',
        },
      },
    }))
    expect(texto).toContain('Costo cargado por pasajero: Adulto $641.507 · Infante $11.337')
    expect(texto).not.toContain('Confirmar y cargar el costo')
    expect(texto).not.toContain('El costo de la línea cambió')
  })
})

describe('el contrato de la ranura sigue antes de pegar', () => {
  it('qué se pide, qué no sirve y que la imagen no se guarda', () => {
    const texto = sinEtiquetas(pintar({ composicionViaje: { adultos: 2, ninos: 0, infantes: 0 } }))
    expect(texto).toContain('Pantallazo de hotel · precio por pasajero')
    expect(texto).toContain('la habitación y el régimen ya seleccionados')
    expect(texto).toContain('La imagen no se guarda')
  })
})
