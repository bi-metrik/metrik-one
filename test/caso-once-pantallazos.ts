// ============================================================
// Los 11 «pantallazos» del caso fijo de San Andrés (tabla §1 de los criterios de Vera), como
// LECTURAS listas para la bandeja: las arma el formulario «✎ Escríbelo a mano» (`lecturaManual`),
// que produce la misma lectura que un pantallazo y entra por el mismo «Aceptar».
//
// Mismos servicios, fechas, pasajeros y costos por pasajero que `caso-san-andres.ts` (dato de C0,
// anonimizado, que no se toca). Los hoteles van por persona y por noche, así que su total puede
// diferir en unos pesos del de C0 (175.585 ÷ 2 noches no es entero): estas pruebas comparan
// estructura y conteos, no el precio de C0.
//
// Vive en `test/` (fuera de `src/`) para que vitest no lo recoja como suite.
// ============================================================

import { lecturaManual, type EntradaManual } from '../src/lib/cotizaciones/ingreso-manual'
import { ranuraPorSlug } from '../src/lib/cotizaciones/ranuras-pantallazo'
import type { TipoRanura } from '../src/lib/cotizaciones/ranuras-cotizacion'
import type { LecturaCasilla } from '../src/lib/cotizaciones/tarifa-pasajero'

const SLUG: Record<TipoRanura, string> = { vuelo: 'vuelo_detalle', hotel: 'hotel_detalle', traslado: 'traslado_detalle', actividad: 'actividad_detalle', otro: 'otro_detalle' }

export interface Pantallazo {
  /** El id de la fila en la bandeja (y la llave de «Aceptar»). */
  id: string
  tipo: TipoRanura
  lectura: LecturaCasilla
  pistas: { lugar: string | null; origen: string | null; destino: string | null }
}

const VIAJE = { adultos: 6, ninos: 1, infantes: 1 }

function vuelo(o: { aerolinea: string; origen: string; destino: string; ida: string; regreso: string; numero: string; numeroRegreso: string; tarifa: string; netos: [number, number | null, number | null] }) {
  return {
    tipo: 'vuelo' as const,
    datos: {
      aerolinea: o.aerolinea, origen: o.origen, destino: o.destino, ida: o.ida, horaSalida: '', horaLlegada: '', numero: o.numero, tarifa: o.tarifa,
      regreso: o.regreso, horaSalidaRegreso: '', horaLlegadaRegreso: '', numeroRegreso: o.numeroRegreso, ...VIAJE,
      netoAdulto: o.netos[0], netoNino: o.netos[1], netoInfante: o.netos[2], fuente: '',
    },
  }
}

function hotel(nombre: string, ciudad: string, entrada: string, salida: string, habitacion: string, netos: [number, number, number]) {
  return {
    tipo: 'hotel' as const,
    datos: {
      hotel: nombre, ciudad, entrada, salida, habitacion, regimen: 'Alojamiento y desayuno', incluye: '', ...VIAJE,
      netoAdulto: netos[0], netoNino: netos[1], netoInfante: netos[2], edadDesde: null, edadHasta: null, fuente: '',
    },
  }
}

function traslado(ruta: string, fecha: string) {
  return {
    tipo: 'traslado' as const,
    datos: {
      ruta, fecha, ...VIAJE, cobro: 'por_persona' as const, precio: 'in_out' as const, neto: 60_000, netoNino: 60_000, netoInfante: 0,
      idaYRegreso: true, fuente: '',
    },
  }
}

function actividad(nombre: string, ciudad: string, fecha: string, pax: { adultos: number; ninos: number; infantes: number }, netos: [number, number | null, number | null], opcional = false) {
  return {
    tipo: 'actividad' as const,
    datos: { nombre, ciudad, fecha, ...pax, netoAdulto: netos[0], netoNino: netos[1], netoInfante: netos[2], opcional, fuente: '' },
  }
}

/** Una lectura como la deja «✎ Escríbelo a mano», con la fecha fija. */
export function leer(entrada: EntradaManual): LecturaCasilla {
  const r = lecturaManual({
    ranura: ranuraPorSlug(SLUG[entrada.tipo])!,
    entrada,
    leidaEn: '2026-10-12T14:30:00.000Z',
    hoy: '2026-10-12',
    fuenteOpcional: true,
  })
  if (!r.ok) throw new Error(`${entrada.tipo}: ${JSON.stringify(r.errores)}`)
  return r.lectura
}

const p = (id: string, entrada: EntradaManual, pistas: Partial<Pantallazo['pistas']> = {}): Pantallazo => ({
  id, tipo: entrada.tipo, lectura: leer(entrada), pistas: { lugar: null, origen: null, destino: null, ...pistas },
})

export const AVIANCA = vuelo({ aerolinea: 'Avianca', origen: 'Bogotá BOG', destino: 'San Andrés ADZ', ida: '2026-11-23', regreso: '2026-11-28', numero: 'AV 9782', numeroRegreso: 'AV 9779', tarifa: 'Classic', netos: [924_637, 649_137, 11_337] })
export const SATENA = vuelo({ aerolinea: 'SATENA', origen: 'San Andrés ADZ', destino: 'Providencia PVA', ida: '2026-11-23', regreso: '2026-11-25', numero: '8814', numeroRegreso: '8833', tarifa: 'Econo', netos: [447_000, 447_000, 163_196] })

/** Los 11, en el orden en que se pegan. */
export function onceDelCasoFijo(o: { buceoOpcional?: boolean } = {}): Pantallazo[] {
  return [
    p('cap-caso-01', AVIANCA, { origen: 'Bogotá', destino: 'San Andrés' }),
    p('cap-caso-02', SATENA, { origen: 'San Andrés', destino: 'Providencia' }),
    p('cap-caso-03', hotel('Posada Enilda', 'Providencia', '2026-11-23', '2026-11-25', '3 habitaciones dobles', [87_792, 87_794, 0]), { lugar: 'Providencia' }),
    p('cap-caso-04', hotel('Cabañas Agua Dulce', 'Providencia', '2026-11-23', '2026-11-25', '2 cuádruples', [290_000, 290_000, 146_419]), { lugar: 'Providencia' }),
    p('cap-caso-05', hotel('Verde Mar', 'San Andrés', '2026-11-25', '2026-11-28', '2 cuádruples', [238_000, 238_000, 238_000]), { lugar: 'San Andrés' }),
    p('cap-caso-06', hotel('Lord Pierre', 'San Andrés', '2026-11-25', '2026-11-28', '2 cuádruples', [267_500, 267_500, 267_500]), { lugar: 'San Andrés' }),
    p('cap-caso-07', traslado('Aeropuerto - hotel - aeropuerto Providencia', '2026-11-23'), { lugar: 'Providencia' }),
    p('cap-caso-08', traslado('Aeropuerto - hotel - aeropuerto San Andrés', '2026-11-25'), { lugar: 'San Andrés' }),
    p('cap-caso-09', actividad('Cayo Cangrejo · lancha compartida', 'Providencia', '2026-11-24', VIAJE, [90_000, 90_000, 90_000]), { lugar: 'Providencia' }),
    p('cap-caso-10', actividad('Cayo Cangrejo · lancha privada', 'Providencia', '2026-11-24', VIAJE, [175_000, 175_000, 175_000]), { lugar: 'Providencia' }),
    p('cap-caso-11', actividad('Buceo de bautismo', 'San Andrés', '2026-11-26', { adultos: 2, ninos: 0, infantes: 0 }, [540_000, null, null], o.buceoOpcional), { lugar: 'San Andrés' }),
  ]
}
