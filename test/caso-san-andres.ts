// ============================================================
// El CASO FIJO de la cotización integrada (Trappvel): San Andrés y Providencia, ANONIMIZADO.
//
// Fuente: `vera-criterios-aceptacion-cotizacion-integrada-2026-10-12.md` §1 («El caso fijo»),
// con la forma de COT-2026-0025 pero sin una sola persona: el negocio, la agencia, el NIT y
// la asesora son inventados. No es un volcado de producción, está escrito a mano.
//
//   · Del 23 al 28 de noviembre de 2026, 5 noches. 6 adultos, 1 niño y 1 infante.
//   · Margen 15 %, convención `sobre_venta`, mínimo 5 %, aviso 10 %.
//   · Los 11 pantallazos YA ACEPTADOS, en el orden en que se pegaron (`orden` 1 a 11):
//     8 servicios, 3 con opciones (hotel Providencia, hotel San Andrés, Cayo Cangrejo).
//   · Las tres tarifas como las propone ONE (decisión A del diseño):
//       Económica   = la más barata de cada servicio. Coincide con la Recomendada, así que
//                     NO va en la propuesta (decisión C).
//       Recomendada = la primera pegada de cada servicio. Va (decisión E).
//       Premium     = la más cara de cada servicio. Va.
//     Cada tarifa nombra TAMBIÉN su opción de Cayo Cangrejo, que es una ranura no combinable:
//     esa escritura solo la hace el flujo nuevo (hoy `cambiarOpcionDeItinerario` la rechaza),
//     y la lectura de hoy ya la respeta (`itemsDelItinerario`).
//
// Costo de la Recomendada (primera pegada de cada servicio, todo Incluido): $19.081.590.
// Los PRECIOS no se escriben aquí: los calcula `recalcularTotales` de `origin/main` y quedan
// en el fixture de igualdad (`igualdad-servidor.fixture.json`).
//
// ⚠️ Este archivo es DATO congelado. No se arma con los helpers de lectura o confirmación
// (que van a cambiar en C1–C6): si cambiara la forma en que se arma, cambiaría la entrada de
// la prueba de igualdad y la prueba dejaría de probar lo que dice.
//
// Vive en `test/` (fuera de `src/`) para que vitest no lo recoja como suite.
// ============================================================

import type { Fila } from './igualdad-servidor-doble'

export const WS_TRAPPVEL = 'ws-agencia-prueba'
export const LINEA_VIAJE = 'linea-viaje'
export const NEG_SAN_ANDRES = 'neg-san-andres'
export const COT_SAN_ANDRES = 'cot-san-andres'

export const COMPOSICION = { adultos: 6, ninos: 1, infantes: 1 }
export const FECHAS = { inicio: '2026-11-23', fin: '2026-11-28' }
export const DESTINO = 'San Andrés y Providencia'
const CONFIRMADA_EN = '2026-10-12T14:00:00.000Z'
const LEIDA_EN = '2026-10-12T13:55:00.000Z'

type Tipo = 'adulto' | 'nino' | 'infante'
type Costos = [Tipo, number, number][] // tipo, cantidad, unitario

/** La tarifa por pasajero confirmada, como la deja «Aceptar»: costos por tipo en COP. */
function confirmada(costos: Costos, composicion = COMPOSICION) {
  const filas = costos.map(([tipo, cantidad, unitario]) => ({
    tipo, cantidad, unitarioCOP: unitario, totalCOP: cantidad * unitario,
  }))
  return {
    composicion,
    costos: filas,
    costoTotalCOP: filas.reduce((a, f) => a + f.totalCOP, 0),
    moneda: 'COP',
    tasa: null,
    confirmadaEn: CONFIRMADA_EN,
  }
}

const campos = (pares: Record<string, string>) => Object.entries(pares).map(([label, valor]) => ({ label, valor }))

/** Lo leído del pantallazo (la casilla del grupo completo). */
function casilla(nombre: string, total: number, pares: Record<string, string>) {
  return { grupo_completo: { nombre, total, moneda: 'COP', leidaEn: LEIDA_EN, campos: campos(pares) } }
}

const equipaje = (bodega: boolean) => ({
  personal: true, mano: true, bodega,
  piezas: { personal: { cantidad: 1, pesoKg: null }, mano: { cantidad: 1, pesoKg: 10 }, bodega: { cantidad: bodega ? 1 : 0, pesoKg: bodega ? 23 : null } },
})
const tramo = (sentido: 'ida' | 'regreso', origen: string, destino: string, fecha: string, salida: string, llegada: string, numero: string, bodega: boolean) => ({
  sentido, origen, destino, fecha, salida, llegada, numero, escala: null, directo: true, equipaje: equipaje(bodega),
})

/** Una línea del caso: costo confirmado en un rubro y la tarifa por pasajero que lo explica. */
function linea(id: string, orden: number, grupo: string, nombre: string, costos: Costos, extra: Fila = {}, composicion = COMPOSICION): { item: Fila; rubro: Fila } {
  const tarifa = confirmada(costos, composicion)
  const costo = tarifa.costoTotalCOP
  return {
    item: {
      id, cotizacion_id: COT_SAN_ANDRES, nombre, descripcion: null, grupo, opcion_de: null, orden,
      es_ajuste: false, cantidad: 1, subtotal: costo, descuento_porcentaje: 0, margen_porcentaje: null,
      precio_venta: 0, precio_manual: false, unidad: null, tramos: null, dia_relativo: null,
      entra_al_precio: true, mostrar_en_sugeridos: true, base_iva: null,
      cargo_destino_valor: null, cargo_destino_moneda: null,
      ...extra,
      tarifa_pax: { composicion: composicion === COMPOSICION ? null : composicion, ...(extra.tarifa_pax as Fila ?? {}), confirmada: tarifa },
    },
    rubro: {
      id: `r-${id}`, item_id: id, tipo: 'servicios_prof', descripcion: nombre, cantidad: 1, unidad: 'servicio',
      valor_unitario: costo, valor_total: costo, sugerido: false,
    },
  }
}

const hotel = (nombre: string, ciudad: string, entrada: string, salida: string, noches: string, habitacion: string, total: number) =>
  casilla(nombre, total, { Hotel: nombre, Ciudad: ciudad, 'Check-in': entrada, 'Check-out': salida, Noches: noches, Habitación: habitacion, Régimen: 'Alojamiento y desayuno' })

// Los 11 pantallazos, en el orden en que se pegan (tabla §1 de los criterios de Vera).
export const LINEAS_CASO_FIJO = [
  // 1 · Avianca BOG ⇄ ADZ, AV 9782 y AV 9779: $6.208.296.
  linea('v-avianca', 1, 'vuelo: Vuelo Bogotá ⇄ San Andrés', 'AVIANCA BOGOTÁ ⇄ SAN ANDRÉS', [['adulto', 6, 924_637], ['nino', 1, 649_137], ['infante', 1, 11_337]], {
    tarifa_pax: { casillas: casilla('Avianca Bogotá ⇄ San Andrés', 6_208_296, { Aerolínea: 'Avianca', Origen: 'Bogotá BOG', Destino: 'San Andrés ADZ', Escalas: '0', Tarifa: 'Classic' }) },
    tramos: [
      tramo('ida', 'Bogotá BOG', 'San Andrés ADZ', '2026-11-23', '06:50', '09:00', 'AV 9782', true),
      tramo('regreso', 'San Andrés ADZ', 'Bogotá BOG', '2026-11-28', '18:45', '20:55', 'AV 9779', true),
    ],
  }),
  // 2 · SATENA ADZ ⇄ PVA, 8814 y 8833: $3.292.196. Servicio nuevo, nunca opción de Avianca.
  linea('v-satena', 2, 'vuelo 2: Vuelo San Andrés ⇄ Providencia', 'SATENA SAN ANDRÉS ⇄ PROVIDENCIA', [['adulto', 6, 447_000], ['nino', 1, 447_000], ['infante', 1, 163_196]], {
    tarifa_pax: { casillas: casilla('SATENA San Andrés ⇄ Providencia', 3_292_196, { Aerolínea: 'SATENA', Origen: 'San Andrés ADZ', Destino: 'Providencia PVA', Escalas: '0', Tarifa: 'Econo' }) },
    tramos: [
      tramo('ida', 'San Andrés ADZ', 'Providencia PVA', '2026-11-23', '11:40', '12:17', '8814', true),
      tramo('regreso', 'Providencia PVA', 'San Andrés ADZ', '2026-11-25', '10:30', '11:06', '8833', true),
    ],
  }),
  // 3 · Posada Enilda, Providencia, 3 habitaciones dobles: $1.229.098. Cubre a los 8.
  linea('h-posada', 3, 'hotel: Hotel en Providencia', 'POSADA ENILDA · PROVIDENCIA', [['adulto', 6, 175_585], ['nino', 1, 175_588], ['infante', 1, 0]], {
    tarifa_pax: { casillas: hotel('Posada Enilda', 'Providencia', '2026-11-23', '2026-11-25', '2', '3 habitaciones dobles', 1_229_098) },
  }),
  // 4 · Cabañas Agua Dulce, Providencia, 2 cuádruples: $4.352.838. Opción del hotel 3.
  linea('h-agua-dulce', 4, 'hotel: Hotel en Providencia', 'CABAÑAS AGUA DULCE · PROVIDENCIA', [['adulto', 6, 580_000], ['nino', 1, 580_000], ['infante', 1, 292_838]], {
    tarifa_pax: { casillas: hotel('Cabañas Agua Dulce', 'Providencia', '2026-11-23', '2026-11-25', '2', '2 cuádruples', 4_352_838) },
  }),
  // 5 · Verde Mar, San Andrés: $5.712.000.
  linea('h-verde-mar', 5, 'hotel 2: Hotel en San Andrés', 'VERDE MAR · SAN ANDRÉS', [['adulto', 6, 714_000], ['nino', 1, 714_000], ['infante', 1, 714_000]], {
    tarifa_pax: { casillas: hotel('Verde Mar', 'San Andrés', '2026-11-25', '2026-11-28', '3', '2 cuádruples', 5_712_000) },
  }),
  // 6 · Lord Pierre, San Andrés: $6.420.000. Opción del hotel 5.
  linea('h-lord-pierre', 6, 'hotel 2: Hotel en San Andrés', 'LORD PIERRE · SAN ANDRÉS', [['adulto', 6, 802_500], ['nino', 1, 802_500], ['infante', 1, 802_500]], {
    tarifa_pax: { casillas: hotel('Lord Pierre', 'San Andrés', '2026-11-25', '2026-11-28', '3', '2 cuádruples', 6_420_000) },
  }),
  // 7 · Traslado Providencia, 23 nov: $420.000.
  linea('t-providencia', 7, 'traslado: Traslado en Providencia', 'AEROPUERTO - HOTEL - AEROPUERTO PROVIDENCIA', [['adulto', 6, 60_000], ['nino', 1, 60_000], ['infante', 1, 0]]),
  // 8 · Traslado San Andrés, 25 nov: $420.000. Servicio nuevo, nunca opción del traslado 7.
  linea('t-san-andres', 8, 'traslado 2: Traslado en San Andrés', 'AEROPUERTO - HOTEL - AEROPUERTO SAN ANDRÉS', [['adulto', 6, 60_000], ['nino', 1, 60_000], ['infante', 1, 0]]),
  // 9 · Cayo Cangrejo, lancha compartida, 24 nov (Día 2): $720.000.
  linea('a-cayo-compartida', 9, 'actividad: Cayo Cangrejo', 'CAYO CANGREJO · LANCHA COMPARTIDA', [['adulto', 6, 90_000], ['nino', 1, 90_000], ['infante', 1, 90_000]], { dia_relativo: 2 }),
  // 10 · Cayo Cangrejo, lancha privada: $1.400.000. Opción de la 9.
  linea('a-cayo-privada', 10, 'actividad: Cayo Cangrejo', 'CAYO CANGREJO · LANCHA PRIVADA', [['adulto', 6, 175_000], ['nino', 1, 175_000], ['infante', 1, 175_000]], { dia_relativo: 2 }),
  // 11 · Buceo de bautismo, 26 nov (Día 4), 2 adultos: $1.080.000. Servicio nuevo.
  linea('a-buceo', 11, 'actividad 2: Buceo de bautismo', 'BUCEO DE BAUTISMO', [['adulto', 2, 540_000]], { dia_relativo: 4 }, { adultos: 2, ninos: 0, infantes: 0 }),
]

/** Las tres tarifas como las propone ONE, y lo que elige cada una por servicio con opciones. */
export const TARIFAS_CASO_FIJO: { fila: Fila; seleccion: string[] }[] = [
  {
    fila: { id: 'tf-economica', nombre: 'Económica', orden: 1, va_en_propuesta: false, es_principal: false, motivo_codigo: null, motivo_texto: null },
    seleccion: ['h-posada', 'h-verde-mar', 'a-cayo-compartida'],
  },
  {
    fila: { id: 'tf-recomendada', nombre: 'Recomendada', orden: 2, va_en_propuesta: true, es_principal: false, motivo_codigo: null, motivo_texto: null },
    seleccion: ['h-posada', 'h-verde-mar', 'a-cayo-compartida'],
  },
  {
    fila: { id: 'tf-premium', nombre: 'Premium', orden: 3, va_en_propuesta: true, es_principal: false, motivo_codigo: null, motivo_texto: null },
    seleccion: ['h-agua-dulce', 'h-lord-pierre', 'a-cayo-privada'],
  },
]

/** Costo de la Recomendada que fija el criterio §1 de Vera. */
export const COSTO_RECOMENDADA = 19_081_590

/**
 * Las tablas del caso fijo, listas para el doble.
 *
 * `flujoNuevo` agrega lo que SOLO escribe el flujo por pasos (criterio N2): un segundo
 * traslado en San Andrés elegido por la Premium (traslado elegido por tarifa) y el traslado
 * de Providencia como Opcional (`entra_al_precio = false`, `mostrar_en_sugeridos = true`).
 */
export function tablasCasoSanAndres(opts: {
  flujoNuevo?: boolean
  configWorkspace?: Fila
} = {}): Record<string, Fila[]> {
  const lineas = LINEAS_CASO_FIJO.map(l => ({ item: structuredClone(l.item), rubro: structuredClone(l.rubro) }))
  const tarifas = structuredClone(TARIFAS_CASO_FIJO)
  if (opts.flujoNuevo) {
    const providencia = lineas.find(l => l.item.id === 't-providencia')!
    providencia.item.entra_al_precio = false
    providencia.item.mostrar_en_sugeridos = true
    lineas.push(linea('t-san-andres-privado', 12, 'traslado 2: Traslado en San Andrés', 'TRASLADO PRIVADO SAN ANDRÉS', [['adulto', 6, 80_000], ['nino', 1, 80_000], ['infante', 1, 80_000]]))
    for (const t of tarifas) t.seleccion.push(t.fila.nombre === 'Premium' ? 't-san-andres-privado' : 't-san-andres')
  }

  return {
    cotizaciones: [{
      id: COT_SAN_ANDRES, workspace_id: WS_TRAPPVEL, negocio_id: NEG_SAN_ANDRES, oportunidad_id: null,
      codigo: 'COT-2026-0901', consecutivo: 'COT-2026-0901', modo: 'detallada',
      descripcion: 'Viaje San Andrés y Providencia', estado: 'borrador', valor_total: 0, costo_total: 0,
      margen_porcentaje: 15, margen_default_pct: 15, convencion_margen: 'sobre_venta',
      descuento_porcentaje: 0, descuento_valor: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null,
      piso_margen_pct: 5, aviso_margen_pct: 10, fecha_envio: null, fecha_validez: '2026-10-27',
      condiciones_pago: '80 % para reservar y 20 % 30 días antes del viaje', notas: null, lugar_entrega: null,
      documento_cliente: null, terminos_condiciones: 'Tarifas sujetas a disponibilidad al momento de reservar.',
      tarifa_aceptada_id: null,
    }],
    items: lineas.map(l => l.item),
    rubros: lineas.map(l => l.rubro),
    item_adicionales: [],
    cotizacion_itinerarios: tarifas.map(t => ({ ...t.fila, workspace_id: WS_TRAPPVEL, cotizacion_id: COT_SAN_ANDRES })),
    itinerario_opciones: tarifas.flatMap(t => t.seleccion.map(item_id => ({ itinerario_id: t.fila.id, item_id }))),
    negocios: [{
      id: NEG_SAN_ANDRES, workspace_id: WS_TRAPPVEL, linea_id: LINEA_VIAJE, nombre: 'FAMILIA DE PRUEBA · SAN ANDRÉS',
      codigo: 'P 26 9', carpeta_url: null, empresa_id: null, precio_aprobado: null, etapa_actual_id: 'e-cotizacion',
    }],
    // El viaje lo declara la etapa 1 (`viaje-negocio.ts`); el doble devuelve la fila entera, así
    // que van las columnas ya proyectadas que pide el `select` con alias.
    negocio_bloques: [{
      id: 'nb-viaje', negocio_id: NEG_SAN_ANDRES, bloque_config_id: 'bc-viaje', estado: 'completo',
      adultos: 6, ninos: 1, infantes: 1, fecha_salida: FECHAS.inicio, fecha_regreso: FECHAS.fin,
      destino: DESTINO, presentacion_destino: null, nivel_detalle: 'normal',
      data: { adultos: 6, ninos: 1, infantes: 1, fecha_salida: FECHAS.inicio, fecha_regreso: FECHAS.fin, destino: DESTINO, nivel_detalle: 'normal' },
    }],
    lineas_negocio: [{
      id: LINEA_VIAJE, workspace_id: WS_TRAPPVEL,
      config_extra: { margen: { piso_pct: 5, aviso_pct: 10, convencion: 'sobre_venta', default_pct: 15 } },
    }],
    etapas_negocio: [
      { id: 'e-solicitud', linea_id: LINEA_VIAJE, orden: 1, config_extra: {} },
      { id: 'e-cotizacion', linea_id: LINEA_VIAJE, orden: 2, config_extra: { gates: ['margen_sobre_piso'] } },
    ],
    bloque_configs: [{ id: 'bc-cot', etapa_id: 'e-cotizacion', workspace_id: WS_TRAPPVEL, estado: 'editable', config_extra: {}, tipo: 'cotizacion' }],
    cotizacion_excepciones_margen: [],
    cotizacion_ranuras: [],
    activity_log: [],
    decisiones_combinacion: [],
    cobros: [],
    profiles: [{ id: 'p-asesora', workspace_id: WS_TRAPPVEL, role: 'operator', full_name: 'Asesora de Prueba', platform_admin: false }],
    staff: [{ id: 's-asesora', workspace_id: WS_TRAPPVEL, full_name: 'Asesora de Prueba', position: 'Asesora' }],
    workspaces: [{
      id: WS_TRAPPVEL, name: 'Agencia de Prueba', slug: 'agencia-prueba', logo_url: null, color_primario: null,
      cotizacion_template_slug: 'trappvel', config_extra: opts.configWorkspace ?? {},
    }],
    empresas: [],
    fiscal_profiles: [{
      workspace_id: WS_TRAPPVEL, person_type: 'persona_juridica', tax_regime: 'ordinario', iva_responsible: true,
      is_declarante: true, self_withholder: false, ica_rate: null, ica_city: null, is_complete: true,
      nit: '900000001', razon_social: 'AGENCIA DE PRUEBA S.A.S',
    }],
  }
}
