import { describe, it, expect } from 'vitest'
import { siguienteOrdenPorDefecto, siguienteEtapaPorDefecto, type EtapaFlujo } from './flujo'

// Etapas de SOENA (linea GIT EV/HEV) tal como estan en produccion. Se usan las reales
// porque son las que destaparon el problema: hay un hueco en el orden 3, y las etapas
// de la fase de IVA (16, 17, 18) van ANTES que 13, 14 y 15 en el proceso real.
const SOENA: EtapaFlujo[] = [
  { orden: 1, routing: { default_etapa_orden: 4 } },   // Validacion
  { orden: 2, routing: { default_etapa_orden: 4 } },   // Inclusion
  // (no existe el orden 3: quedo el hueco al fusionar Espera en Inclusion)
  { orden: 4, routing: null },                          // Propuesta
  { orden: 5, routing: null },                          // Negociacion
  { orden: 6, routing: { default_etapa_orden: 7 } },   // Documentacion
  { orden: 7, routing: null },                          // Cargue
  { orden: 8, routing: null },                          // Pago UPME
  { orden: 9, routing: null },                          // Certificacion
  { orden: 10, routing: null },                         // Precobro
  { orden: 11, routing: { default_etapa_orden: 12 } }, // Cobro
  { orden: 12, routing: { default_etapa_orden: 15 } }, // Entrega
  { orden: 13, routing: null },                         // Generacion
  { orden: 14, routing: { default_etapa_orden: 15 } }, // Envio
  { orden: 15, routing: { default_etapa_orden: 15 } }, // Facturacion (cierra)
  { orden: 16, routing: { default_etapa_orden: 17 } }, // Cita
  { orden: 17, routing: { default_etapa_orden: 18 } }, // Notificacion
  { orden: 18, routing: { default_etapa_orden: 13 } }, // Anexos
]

const etapa = (orden: number): EtapaFlujo => {
  const e = SOENA.find(x => x.orden === orden)
  if (!e) throw new Error(`etapa ${orden} no existe en el fixture`)
  return e
}

describe('siguienteOrdenPorDefecto', () => {
  it('respeta el destino declarado en el routing', () => {
    expect(siguienteOrdenPorDefecto(etapa(1), SOENA)).toBe(4)
    expect(siguienteOrdenPorDefecto(etapa(12), SOENA)).toBe(15)
    expect(siguienteOrdenPorDefecto(etapa(18), SOENA)).toBe(13)
  })

  it('sin routing, sigue la siguiente por orden ascendente', () => {
    expect(siguienteOrdenPorDefecto(etapa(4), SOENA)).toBe(5)
    expect(siguienteOrdenPorDefecto(etapa(9), SOENA)).toBe(10)
  })

  // La regresion concreta: `orden + 1` fallaba aqui porque el 3 no existe.
  it('salta los huecos del orden en vez de asumir contiguidad', () => {
    const sinRouting: EtapaFlujo[] = [
      { orden: 2, routing: null },
      { orden: 4, routing: null },
    ]
    expect(siguienteOrdenPorDefecto(sinRouting[0], sinRouting)).toBe(4)
  })

  // Facturacion se apunta a si misma: asi se declara una etapa de cierre.
  it('una etapa que se apunta a si misma termina el flujo', () => {
    expect(siguienteOrdenPorDefecto(etapa(15), SOENA)).toBeNull()
  })

  it('la ultima etapa sin routing tambien termina el flujo', () => {
    const solas: EtapaFlujo[] = [{ orden: 1, routing: null }]
    expect(siguienteOrdenPorDefecto(solas[0], solas)).toBeNull()
  })

  it('no se confunde si las etapas llegan desordenadas', () => {
    const desordenadas = [...SOENA].reverse()
    expect(siguienteOrdenPorDefecto(etapa(4), desordenadas)).toBe(5)
  })
})

describe('el camino principal termina en el cierre, no lo atraviesa', () => {
  // Es la regresion que reporto Mauricio: el diagrama dibujaba
  // Facturacion -> Cita -> ... porque asumia `orden + 1` desde el cierre.
  it('recorre el flujo de SOENA y para en Facturacion', () => {
    const recorrido: number[] = []
    let cur: EtapaFlujo | null = etapa(1)
    while (cur && recorrido.length < 50) {
      recorrido.push(cur.orden)
      cur = siguienteEtapaPorDefecto(cur, SOENA)
    }
    expect(recorrido).toEqual([1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15])
    // Ni la Cita ni la fase de IVA cuelgan del camino principal: son una rama.
    expect(recorrido).not.toContain(16)
    expect(recorrido).not.toContain(13)
  })

  it('la rama de la fase de IVA vuelve a Facturacion', () => {
    const recorrido: number[] = []
    let cur: EtapaFlujo | null = etapa(16) // entra por Cita
    while (cur && recorrido.length < 50) {
      recorrido.push(cur.orden)
      if (cur.orden === 15) break // llego al cierre
      cur = siguienteEtapaPorDefecto(cur, SOENA)
    }
    expect(recorrido).toEqual([16, 17, 18, 13, 14, 15])
  })
})
