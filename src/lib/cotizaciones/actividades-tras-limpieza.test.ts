/**
 * Brief del 2026-10-05, «tres fallas de actividades que dejó ver la prueba de #1023»
 * (`proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-05-actividades-tras-limpieza.md`),
 * con los datos de COT-2026-0021 (`3c114db5…`, P2 26 1: Providencia, 9–13 nov, 2 adultos + 1
 * infante). Lo puro; el recorrido con las acciones y el editor vive en
 * `actividades-tras-limpieza-e2e.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import fixture from './__fixtures__/cot-2026-0013-hoteles.fixture.json'
import { cambiosDeActividad } from './actividad-en-cotizacion'
import { esAvisoResueltoEnActividad } from './actividad-pantallazo'
import { hotelesDeItems } from './detalle-viaje'
import { descripcionVisibleDeLinea, nombreVisibleDeLinea } from './nombre-visible'
import { faltanPorAcomodar, textoFaltanPorAcomodar, type LecturaCasilla } from './tarifa-pasajero'
import { preguntaEliminarOpcion } from './tarjeta-opcion'
import { opcionElegidaDeActividad, ubicarLectura, type LineaParaUbicar } from './ubicar-lectura'
import { textosDeTarjetaHotel } from '@/lib/pdf/cotizacion-trappvel-formato'

const GRUPO = { adultos: 2, ninos: 0, infantes: 1 }
const SIN_PISTAS = { lugar: null, origen: null, destino: null }

/** «Paseo en kayak por el manglar de McBean» de COT-2026-0021: sin ciudad y con fecha abierta. */
const KAYAK = {
  total: 280000,
  moneda: 'COP',
  nombre: 'Paseo en kayak por el manglar de McBean',
  campos: [
    { label: 'Proveedor', valor: 'Civitatis' },
    { label: 'Actividad', valor: 'Paseo en kayak por el manglar de McBean' },
    { label: 'Fecha', valor: 'Fecha abierta' },
    { label: 'Duración', valor: '2 horas' },
    { label: 'Personas', valor: '2' },
    { label: 'Moneda', valor: 'COP' },
    { label: 'Precio', valor: '280000' },
  ],
  alertas: [],
  porTipo: [],
  identidad: { nombre: 'Paseo en kayak por el manglar de McBean' },
  ocupacion: { adultos: null, ninos: null, infantes: null, total: 2 },
  descripcion: 'Fecha: Fecha abierta · Duración: 2 horas · Proveedor: Civitatis',
  notasCliente: [],
} as unknown as LecturaCasilla

/** «Clase de buceo para principiantes»: sin ciudad y sin fecha. */
const BUCEO = {
  ...KAYAK,
  nombre: 'Clase de buceo para principiantes',
  identidad: { nombre: 'Clase de buceo para principiantes' },
} as unknown as LecturaCasilla

describe('punto 1 · una actividad nueva abre su bloque', () => {
  // Así quedó COT-2026-0021 al aceptar el kayak: un bloque de actividad, sin ciudad.
  const conKayak: LineaParaUbicar[] = [
    { id: 'kayak', grupo: 'actividad: Actividad en Providencia', nombre: 'PASEO EN KAYAK POR EL MANGLAR DE MCBEAN', tarifa_pax: { casillas: { grupo_completo: KAYAK } } },
  ]

  it('el buceo sin ciudad, con UN bloque de actividad en la cotización, no entra como «Opción 2» del kayak', () => {
    expect(ubicarLectura({ tipo: 'actividad', lectura: BUCEO, pistas: SIN_PISTAS, lineas: conKayak, grupoViaje: GRUPO })).toEqual({ como: 'nueva' })
  })

  it('tampoco con la misma ciudad que dijo el detector', () => {
    expect(ubicarLectura({ tipo: 'actividad', lectura: BUCEO, pistas: { ...SIN_PISTAS, lugar: 'Providencia' }, lineas: conKayak, grupoViaje: GRUPO }))
      .toEqual({ como: 'nueva' })
  })

  it('«Agregar como otra opción» de la misma actividad SÍ la pone al lado de esa (lo eligió quien cotiza)', () => {
    expect(opcionElegidaDeActividad('actividad', 'kayak', conKayak)).toEqual({ como: 'hermana', grupo: 'actividad: Actividad en Providencia' })
    // Sin id, o con el id de algo que ya no está o no es una actividad, decide `ubicarLectura`.
    expect(opcionElegidaDeActividad('actividad', null, conKayak)).toBeNull()
    expect(opcionElegidaDeActividad('actividad', 'borrador:x', conKayak)).toBeNull()
    expect(opcionElegidaDeActividad('actividad', 'hotel-1', [{ id: 'hotel-1', grupo: 'hotel' }])).toBeNull()
    expect(opcionElegidaDeActividad('hotel', 'kayak', conKayak)).toBeNull()
  })

  describe('lo que no cambia: dos hoteles en la misma ciudad siguen siendo alternativas', () => {
    const lectura = (id: string) => fixture.hoteles.find(h => h.item === id)!.lectura as unknown as LecturaCasilla
    const hotel = (id: string, hotel: string) => ({ ...lectura(id), identidad: { ...lectura(id).identidad, hotel } }) as LecturaCasilla

    it('otro hotel con las mismas fechas: otra opción del mismo bloque', () => {
      const lineas = [{ id: 'h1', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: lectura('efb0a3c3') } } }]
      expect(ubicarLectura({ tipo: 'hotel', lectura: hotel('efb0a3c3', 'Hotel Posada Enilda'), pistas: SIN_PISTAS, lineas, grupoViaje: fixture.grupo }))
        .toEqual({ como: 'hermana', grupo: 'hotel' })
    })

    it('y con la ciudad del detector escrita distinto («Isla de Providencia»), igual', () => {
      const lineas = [{ id: 'h1', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: lectura('efb0a3c3') } } }]
      expect(ubicarLectura({ tipo: 'hotel', lectura: hotel('efb0a3c3', 'Hotel Posada Enilda'), pistas: { ...SIN_PISTAS, lugar: 'Isla de Providencia' }, lineas, grupoViaje: fixture.grupo }))
        .toEqual({ como: 'hermana', grupo: 'hotel' })
    })
  })
})

describe('punto 2 · ningún cambio de estado borra el día', () => {
  it('Incluida → Opcional → Incluida no escribe el día (lo conserva la línea)', () => {
    const aOpcional = cambiosDeActividad({ estado: 'incluida', dia: 2, era: null }, { modo: 'opcional' })
    expect(aOpcional).toEqual({ entra_al_precio: false, mostrar_en_sugeridos: true, noVa: null })
    expect(aOpcional).not.toHaveProperty('dia_relativo')
    expect(cambiosDeActividad({ estado: 'opcional', dia: 2, era: null }, { modo: 'incluida' })).not.toHaveProperty('dia_relativo')
  })

  it('con el check quitado y puesto otra vez, tampoco', () => {
    expect(cambiosDeActividad({ estado: 'opcional', dia: 2, era: null }, { va: false })).not.toHaveProperty('dia_relativo')
    expect(cambiosDeActividad({ estado: 'no_va', dia: 2, era: 'opcional' }, { va: true })).toEqual({ entra_al_precio: false, mostrar_en_sugeridos: true, noVa: null })
  })
})

describe('punto 3 · en una actividad el infante no se acomoda', () => {
  const ADULTOS = { adultos: 2, ninos: 0, infantes: 0 }

  it('«2 adultos» en un viaje 2A+1I: en la actividad no falta nadie; en el hotel y el vuelo falta el infante', () => {
    expect(faltanPorAcomodar(ADULTOS, GRUPO, 'actividad_detalle')).toBeNull()
    expect(faltanPorAcomodar(ADULTOS, GRUPO, 'hotel_detalle')).toEqual({ adultos: 0, ninos: 0, infantes: 1 })
    expect(faltanPorAcomodar(ADULTOS, GRUPO, 'vuelo_detalle')).toEqual({ adultos: 0, ninos: 0, infantes: 1 })
    expect(faltanPorAcomodar(ADULTOS, GRUPO)).toEqual({ adultos: 0, ninos: 0, infantes: 1 })
  })

  it('un adulto que falta en la actividad se sigue diciendo', () => {
    expect(faltanPorAcomodar({ adultos: 1, ninos: 0, infantes: 0 }, GRUPO, 'actividad_detalle')).toEqual({ adultos: 1, ninos: 0, infantes: 0 })
  })

  it('el aviso del infante gratis y el de la ciudad no dejan el bloque por atender; otro faltante sí', () => {
    // Los dos avisos del kayak en COT-2026-0021, tal cual quedaron en la base.
    expect(esAvisoResueltoEnActividad('El pantallazo dice 2 personas: son 2 adultos. El infante no paga en la actividad.')).toBe(true)
    expect(esAvisoResueltoEnActividad('La captura no muestra: ciudad. La línea conserva los datos que ya tiene: complétalos si hace falta.')).toBe(true)
    expect(esAvisoResueltoEnActividad('La captura no muestra: proveedor, ciudad. La línea conserva los datos que ya tiene: complétalos si hace falta.')).toBe(false)
    expect(esAvisoResueltoEnActividad('El precio está en EUR. Escribe la tasa de cambio antes de confirmar: el sistema no inventa una.')).toBe(false)
    expect(esAvisoResueltoEnActividad('El pantallazo dice 3 personas sin separar adultos y menores: se toma 2 adultos y 1 infante. Confírmalo.')).toBe(false)
  })
})

describe('punto 4 · textos', () => {
  it('«Falta 1 infante» en singular; «Faltan» con más de uno', () => {
    expect(textoFaltanPorAcomodar({ adultos: 0, ninos: 0, infantes: 1 })).toBe('Falta 1 infante por acomodar.')
    expect(textoFaltanPorAcomodar({ adultos: 1, ninos: 0, infantes: 1 })).toBe('Faltan 1 adulto y 1 infante por acomodar.')
  })

  it('eliminar una opción que no es hotel no habla de habitaciones', () => {
    expect(preguntaEliminarOpcion('Sirius', { esHotel: true, tieneLectura: true, manual: false }))
      .toBe('¿Eliminas Sirius de este bloque? Sus habitaciones vuelven a la bandeja.')
    expect(preguntaEliminarOpcion('Aeropuerto - hotel', { esHotel: false, tieneLectura: true, manual: true }))
      .toBe('¿Eliminas Aeropuerto - hotel de este bloque? Sus datos vuelven a la bandeja.')
    expect(preguntaEliminarOpcion('Kayak', { esHotel: false, tieneLectura: true, manual: false }))
      .toBe('¿Eliminas Kayak de este bloque? Su pantallazo vuelve a la bandeja.')
    expect(preguntaEliminarOpcion('Opción 2', { esHotel: false, tieneLectura: false, manual: false })).toBe('¿Eliminas Opción 2 de este bloque?')
  })

  it('«Opcionales» del PDF: el nombre y el detalle como se leyeron, no en MAYÚSCULAS', () => {
    // La fila del kayak en COT-2026-0021.
    const kayak = {
      nombre: 'PASEO EN KAYAK POR EL MANGLAR DE MCBEAN',
      descripcion: 'FECHA: FECHA ABIERTA · DURACIÓN: 2 HORAS · PROVEEDOR: CIVITATIS',
      grupo: 'actividad: Actividad en Providencia',
      tarifa_pax: { casillas: { grupo_completo: KAYAK }, descripcionDelSistema: 'FECHA: FECHA ABIERTA · DURACIÓN: 2 HORAS · PROVEEDOR: CIVITATIS' },
    }
    expect(nombreVisibleDeLinea(kayak)).toBe('Paseo en kayak por el manglar de McBean')
    expect(descripcionVisibleDeLinea(kayak)).toBe('Fecha: Fecha abierta · Duración: 2 horas · Proveedor: Civitatis')
    // Lo que escribió una persona se respeta; una línea sin ranura llega idéntica.
    expect(descripcionVisibleDeLinea({ ...kayak, descripcion: 'Salida desde el muelle a las 8' })).toBe('Salida desde el muelle a las 8')
    expect(descripcionVisibleDeLinea({ descripcion: 'TOUR GUIADO', grupo: 'tour', tarifa_pax: null })).toBe('TOUR GUIADO')
    expect(descripcionVisibleDeLinea({ ...kayak, descripcion: null })).toBeNull()
  })

  it('«Acomodación: 2 adultos + 1 infante», no como la escribió la captura', () => {
    // Hotel Sirius de COT-2026-0021: la captura dice «2 Adultos 1 Infante».
    const sirius = {
      total: 3010000,
      moneda: 'COP',
      nombre: 'Hotel Sirius',
      campos: [
        { label: 'Hotel', valor: 'Hotel Sirius' },
        { label: 'Ciudad', valor: 'Providencia' },
        { label: 'Ocupación', valor: '2 Adultos 1 Infante' },
      ],
      alertas: [],
      porTipo: [],
      identidad: { hotel: 'Hotel Sirius' },
      ocupacion: { adultos: 2, ninos: 0, infantes: 1, total: null },
      paraComposicion: GRUPO,
      notasCliente: [],
    } as unknown as LecturaCasilla
    const item = { id: 'sirius', nombre: 'HOTEL SIRIUS · PROVIDENCIA', grupo: 'hotel: Hotel en Providencia', tarifa_pax: { casillas: { grupo_completo: sirius } } }
    const [h] = hotelesDeItems([item])
    expect(h.ocupacion).toBe('2 adultos + 1 infante')
    expect(textosDeTarjetaHotel(h, false).condiciones).toContain('Acomodación: 2 adultos + 1 infante')
    // Corregida a mano en la ficha: se respeta lo que escribió la persona.
    const corregido = { ...item, tarifa_pax: { ...item.tarifa_pax, correcciones: { ocupacion: { valor: '2 adultos y un bebé', por: 'Alejandra', porId: 'p1', en: '2026-10-05T12:00:00Z' } } } }
    expect(hotelesDeItems([corregido])[0].ocupacion).toBe('2 adultos y un bebé')
  })
})
