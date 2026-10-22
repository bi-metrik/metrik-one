/**
 * Hitos de gestión del viaje (brief del 2026-10-22, «Respuesta de Edgar»). Datos ficticios: nada de
 * viajeros, reservas, proveedores ni precios reales.
 *
 * Calendario de noviembre 2026: lun 2 (Todos los Santos) y lun 16 (Independencia de Cartagena) son
 * festivos en Colombia.
 */
import { describe, expect, it } from 'vitest'
import {
  configHitos,
  hitosDelViaje,
  paisDeLugar,
  validarCierreHito,
  ventanaCheckin,
  CHECKIN_POR_DEFECTO,
  type Hito,
  type ServicioHitos,
  type ViajeHitos,
} from './hitos'
import { armarAgenda, escalablesHoy, hitosVisibles, rangoDe, resumenDelDia } from './agenda'

const EDGAR = 'staff-direccion'
const ALE = 'staff-asesora-a'
const DANI = 'staff-asesora-d'
const CONFIG = { hitos: { activo: true }, aprobaciones: { staff_ids: [EDGAR] } }

function servicio(p: Partial<ServicioHitos> & { id: string; tipo: string }): ServicioHitos {
  return {
    nombre: `Servicio ${p.id}`, estado: 'por_reservar', responsable_staff_id: null,
    fecha_servicio: null, hora_inicio: null, fecha_fin: null, hora_fin: null, tramos: null,
    voucher_ref: null, confirmacion_ref: null, ...p,
  }
}

function viaje(p: Partial<ViajeHitos> = {}): ViajeHitos {
  return {
    id: 'neg-1', nombre: 'P 26 1 — Viaje de prueba', cliente: 'Viajera Ficticia', clienteTelefono: '3000000000',
    estado: 'abierto', etapaNumero: 5, esPrueba: false, salida: '2026-11-09', regreso: '2026-11-14',
    internacional: false, destino: null, confirmadoEl: '2026-10-01', documentosCompletos: false,
    comercialStaffId: ALE, operacionesStaffId: null, aprobadoresStaffIds: [EDGAR],
    catalogo: configHitos(CONFIG), servicios: [], marcas: [], ...p,
  }
}

const vuelo = (tramos: object[], extra: Partial<ServicioHitos> = {}) => servicio({ id: 'vuelo-1', tipo: 'vuelo', tramos, fecha_servicio: (tramos[0] as { fecha: string }).fecha, ...extra })
const tramo = (fecha: string, hora: string | null, origen: string, destino: string, aerolinea: string | null = 'Avianca', numero: string | null = 'AV9999') =>
  ({ fecha, hora_salida: hora, hora_llegada: null, origen, destino, aerolinea, numero_vuelo: numero })

const de = (hs: Hito[], id: string) => hs.filter(h => h.hitoId === id)

describe('check-in: ventana de la aerolínea y fin de semana', () => {
  it('Avianca nacional del lunes 6:10 → hito el sábado 6:10, lo cubre Edgar y entra en su resumen del viernes', () => {
    const hs = hitosDelViaje(viaje({ servicios: [vuelo([tramo('2026-11-09', '06:10', 'BOG', 'CTG')], { responsable_staff_id: ALE })] }), '2026-11-06')
    const [c] = de(hs, 'checkin_vuelo')
    expect(c.fechaObjetivo).toBe('2026-11-07')
    expect(c.horaObjetivo).toBe('06:10')
    expect(c.fechaAviso).toBe('2026-11-07')
    expect(c.clase).toBe('fijo')
    expect(c.cubreDireccion).toBe(true)
    expect(c.responsables).toEqual([EDGAR])
    const viernes = resumenDelDia(hs, EDGAR, '2026-11-06')
    expect(viernes?.texto).toContain('Este fin de semana tienes 1')
    expect(viernes?.texto).toContain('sáb 7 nov 06:10 · check-in')
    expect(viernes?.texto).toContain('sale el lun 9 nov 06:10')
    // La asesora no lo recibe: lo cubre la dirección.
    expect(resumenDelDia(hs, ALE, '2026-11-06')).toBeNull()
  })

  it('el mismo vuelo un jueves se queda con la asesora (cae en martes, hábil)', () => {
    const [c] = de(hitosDelViaje(viaje({ servicios: [vuelo([tramo('2026-11-12', '06:10', 'BOG', 'CTG')], { responsable_staff_id: ALE })] }), '2026-11-06'), 'checkin_vuelo')
    expect(c.fechaObjetivo).toBe('2026-11-10')
    expect(c.responsables).toEqual([ALE])
    expect(c.cubreDireccion).toBe(false)
  })

  it('Avianca a Miami abre a −24 h; LATAM y una aerolínea desconocida a −48 h', () => {
    expect(ventanaCheckin(CHECKIN_POR_DEFECTO, tramo('2026-11-12', '08:00', 'BOG', 'MIA'))).toEqual({ horas: 24, aerolinea: 'avianca' })
    expect(ventanaCheckin(CHECKIN_POR_DEFECTO, tramo('2026-11-12', '08:00', 'Miami', 'Bogotá', 'AVIANCA S.A.'))).toEqual({ horas: 24, aerolinea: 'avianca' })
    expect(ventanaCheckin(CHECKIN_POR_DEFECTO, tramo('2026-11-12', '08:00', 'BOG', 'MIA', 'LATAM Airlines', 'LA4000')).horas).toBe(48)
    expect(ventanaCheckin(CHECKIN_POR_DEFECTO, tramo('2026-11-12', '08:00', 'BOG', 'MIA', 'Aerolínea Inventada', 'ZZ1')).horas).toBe(48)
    // Por el prefijo del número, sin nombre.
    expect(ventanaCheckin(CHECKIN_POR_DEFECTO, tramo('2026-11-12', '08:00', 'BOG', 'YYZ', null, 'AV 204')).horas).toBe(24)
    const [mia] = de(hitosDelViaje(viaje({ internacional: true, servicios: [vuelo([tramo('2026-11-12', '08:00', 'BOG', 'MIA')])] }), '2026-11-01'), 'checkin_vuelo')
    expect([mia.fechaObjetivo, mia.horaObjetivo]).toEqual(['2026-11-11', '08:00'])
    const [latam] = de(hitosDelViaje(viaje({ servicios: [vuelo([tramo('2026-11-12', '08:00', 'BOG', 'MDE', 'LATAM', 'LA1')])] }), '2026-11-01'), 'checkin_vuelo')
    expect([latam.fechaObjetivo, latam.horaObjetivo]).toEqual(['2026-11-10', '08:00'])
  })

  it('vuelo redondo: un hito por tramo, cada uno con su hora', () => {
    const hs = de(hitosDelViaje(viaje({ servicios: [vuelo([tramo('2026-11-10', '06:10', 'BOG', 'ADZ'), tramo('2026-11-14', '18:30', 'ADZ', 'BOG')])] }), '2026-11-01'), 'checkin_vuelo')
    expect(hs).toHaveLength(2)
    expect(hs.map(h => h.titulo)).toEqual(['Check-in y pasabordo · vuelo de ida', 'Check-in y pasabordo · vuelo de regreso'])
    expect(hs.map(h => [h.tramo, h.fechaObjetivo, h.horaObjetivo])).toEqual([[1, '2026-11-08', '06:10'], [2, '2026-11-12', '18:30']])
    expect(new Set(hs.map(h => h.llave)).size).toBe(2)
  })

  it('sin hora del tramo: inicio del día − ventana y «hora por confirmar»', () => {
    const [c] = de(hitosDelViaje(viaje({ servicios: [vuelo([tramo('2026-11-12', null, 'BOG', 'CTG')])] }), '2026-11-01'), 'checkin_vuelo')
    expect(c.fechaObjetivo).toBe('2026-11-10')
    expect(c.horaObjetivo).toBeNull()
    expect(c.horaPorConfirmar).toBe(true)
  })

  it('la tabla de check-in se sobreescribe desde la línea', () => {
    const cat = configHitos({ hitos: { activo: true, checkin: { por_defecto_horas: 36, aerolineas: [{ id: 'x', nombres: ['Avianca'], horas: 12 }] } } })
    expect(ventanaCheckin(cat.checkin, tramo('2026-11-12', '08:00', 'BOG', 'MIA')).horas).toBe(12)
    expect(ventanaCheckin(cat.checkin, tramo('2026-11-12', '08:00', 'BOG', 'MIA', 'Otra', 'OT1')).horas).toBe(36)
  })
})

describe('hitos móviles: se adelantan al hábil anterior', () => {
  const hotel = (fecha: string) => viaje({ servicios: [servicio({ id: 'hotel-1', tipo: 'hotel', fecha_servicio: fecha, responsable_staff_id: DANI })] })

  it('hotel con llegada el domingo: −3 = jueves hábil, se queda el jueves', () => {
    const [h] = de(hitosDelViaje(hotel('2026-11-15'), '2026-11-01'), 'reconfirmar_hotel')
    expect([h.fechaObjetivo, h.fechaAviso, h.clase, h.responsables[0]]).toEqual(['2026-11-12', '2026-11-12', 'movil', DANI])
  })

  it('−3 cae en sábado → se adelanta al viernes', () => {
    const [h] = de(hitosDelViaje(hotel('2026-11-10'), '2026-11-01'), 'reconfirmar_hotel')
    expect([h.fechaObjetivo, h.fechaAviso]).toEqual(['2026-11-07', '2026-11-06'])
  })

  it('−3 cae en el lunes festivo (2 nov, Todos los Santos) → viernes 30 oct', () => {
    const [h] = de(hitosDelViaje(hotel('2026-11-05'), '2026-10-20'), 'reconfirmar_hotel')
    expect([h.fechaObjetivo, h.fechaAviso]).toEqual(['2026-11-02', '2026-10-30'])
  })

  it('con la confirmación del proveedor final ya puesta, el hotel nace hecho', () => {
    const v = viaje({ servicios: [servicio({ id: 'hotel-1', tipo: 'hotel', fecha_servicio: '2026-11-15', confirmacion_ref: 'one://documentos/x.pdf' })] })
    const [h] = de(hitosDelViaje(v, '2026-11-01'), 'reconfirmar_hotel')
    expect([h.estado, h.derivado]).toEqual(['hecho', true])
  })

  it('un viaje confirmado tarde no nace con hitos móviles vencidos de antes de confirmar', () => {
    const v = viaje({ internacional: true, salida: '2026-11-20', confirmadoEl: '2026-11-10' })
    const [r] = de(hitosDelViaje(v, '2026-11-10'), 'requisitos_entrada')
    expect(r.fechaObjetivo).toBe('2026-10-21')
    expect(r.fechaAviso).toBe('2026-11-10')
    expect(r.vencido).toBe(false)
  })
})

describe('pre-registro migratorio (RD y México) y tour', () => {
  it('Punta Cana: pre-registro junto al tramo de ida, el día antes', () => {
    const v = viaje({ internacional: true, servicios: [vuelo([tramo('2026-11-12', '07:00', 'BOG', 'PUJ'), tramo('2026-11-18', '15:00', 'PUJ', 'BOG')])] })
    const pre = de(hitosDelViaje(v, '2026-11-01'), 'preregistro_migratorio')
    expect(pre).toHaveLength(1)
    expect(pre[0].titulo).toBe('Pre-registro migratorio · República Dominicana')
    expect([pre[0].tramo, pre[0].fechaAncla, pre[0].fechaObjetivo, pre[0].clase, pre[0].estado]).toEqual([1, '2026-11-12', '2026-11-11', 'fijo', 'pendiente'])
  })

  it('Cancún: aparece, pero sin plazo verificado («Falta el plazo del pre-registro»)', () => {
    const v = viaje({ internacional: true, servicios: [vuelo([tramo('2026-11-12', '07:00', 'Bogotá', 'Cancún')])] })
    const [pre] = de(hitosDelViaje(v, '2026-11-01'), 'preregistro_migratorio')
    expect(pre.titulo).toBe('Pre-registro migratorio · México')
    expect(pre.estado).toBe('falta_plazo')
    expect(pre.fechaAviso).toBeNull()
  })

  it('sin destino en el tramo, decide el destino del viaje (etapa 1)', () => {
    const v = viaje({ internacional: true, destino: 'Punta Cana', servicios: [vuelo([{ fecha: '2026-11-12', hora_salida: '07:00' }])] })
    expect(de(hitosDelViaje(v, '2026-11-01'), 'preregistro_migratorio')).toHaveLength(1)
  })

  it('viaje nacional: no hay pre-registro', () => {
    const v = viaje({ servicios: [vuelo([tramo('2026-11-12', '07:00', 'BOG', 'CTG'), tramo('2026-11-15', '07:00', 'CTG', 'BOG')])] })
    expect(de(hitosDelViaje(v, '2026-11-01'), 'preregistro_migratorio')).toHaveLength(0)
  })

  it('tour: detalles a −1 (fijo); un «otro» que es un tren no genera hito', () => {
    const v = viaje({ servicios: [
      servicio({ id: 'tour-1', tipo: 'actividad', fecha_servicio: '2026-11-15' }),
      servicio({ id: 'tren-1', tipo: 'otro', nombre: 'Tren de prueba', fecha_servicio: '2026-11-13' }),
    ] })
    const hs = hitosDelViaje(v, '2026-11-01')
    const [t] = de(hs, 'detalles_tour')
    expect([t.fechaObjetivo, t.fechaAviso, t.clase]).toEqual(['2026-11-14', '2026-11-14', 'fijo'])
    expect(hs.filter(h => h.servicioId === 'tren-1')).toHaveLength(0)
    expect(hs.some(h => /tren/i.test(h.hitoId))).toBe(false)
  })
})

describe('cuándo hay hitos', () => {
  const conTodo = (p: Partial<ViajeHitos>) => viaje({ servicios: [servicio({ id: 'hotel-1', tipo: 'hotel', fecha_servicio: '2026-11-15' })], ...p })

  it('viaje en Seguimiento (etapa 3), cancelado o con la línea apagada → sin hitos', () => {
    expect(hitosDelViaje(conTodo({ etapaNumero: 3 }), '2026-11-01')).toEqual([])
    expect(hitosDelViaje(conTodo({ estado: 'cancelado' }), '2026-11-01')).toEqual([])
    expect(hitosDelViaje(conTodo({ catalogo: configHitos({}) }), '2026-11-01')).toEqual([])
    expect(configHitos({ hitos: { activo: 'true' } }).activo).toBe(false)
  })

  it('servicio «No va» → sin hitos de ese servicio', () => {
    const v = viaje({ servicios: [servicio({ id: 'hotel-1', tipo: 'hotel', fecha_servicio: '2026-11-15', estado: 'cancelado' })] })
    expect(hitosDelViaje(v, '2026-11-01').filter(h => h.servicioId)).toEqual([])
  })

  it('sin fecha no se inventa: «falta_fecha»', () => {
    const v = viaje({ servicios: [servicio({ id: 'tour-1', tipo: 'actividad', fecha_servicio: null })] })
    const [t] = de(hitosDelViaje(v, '2026-11-01'), 'detalles_tour')
    expect([t.estado, t.fechaAviso]).toEqual(['falta_fecha', null])
  })

  it('un traslado sin fecha toma el primer tramo; con dos traslados sin fecha, falta la fecha', () => {
    const uno = viaje({ servicios: [vuelo([tramo('2026-11-12', '07:00', 'BOG', 'CTG')]), servicio({ id: 'tr-1', tipo: 'traslado' })] })
    expect(de(hitosDelViaje(uno, '2026-11-01'), 'confirmar_traslado')[0].fechaAncla).toBe('2026-11-12')
    const dos = viaje({ servicios: [vuelo([tramo('2026-11-12', '07:00', 'BOG', 'CTG')]), servicio({ id: 'tr-1', tipo: 'traslado' }), servicio({ id: 'tr-2', tipo: 'traslado' })] })
    expect(de(hitosDelViaje(dos, '2026-11-01'), 'confirmar_traslado').map(h => h.estado)).toEqual(['falta_fecha', 'falta_fecha'])
  })

  it('cambiar la fecha del servicio deja la marca vieja sin efecto: el hito nuevo nace pendiente', () => {
    const marca = { servicio_id: 'hotel-1', tramo: null, hito_id: 'reconfirmar_hotel', fecha_objetivo: '2026-11-15', estado: 'hecho' as const, evidencia_ref: null, nota: 'Llamada', hecho_por: DANI, hecho_at: '2026-11-11T15:00:00Z' }
    const antes = viaje({ servicios: [servicio({ id: 'hotel-1', tipo: 'hotel', fecha_servicio: '2026-11-15' })], marcas: [marca] })
    expect(de(hitosDelViaje(antes, '2026-11-11'), 'reconfirmar_hotel')[0].estado).toBe('hecho')
    const despues = viaje({ servicios: [servicio({ id: 'hotel-1', tipo: 'hotel', fecha_servicio: '2026-11-22' })], marcas: [marca] })
    const [h] = de(hitosDelViaje(despues, '2026-11-11'), 'reconfirmar_hotel')
    expect([h.estado, h.marca, h.fechaAncla]).toEqual(['pendiente', null, '2026-11-22'])
  })

  it('vencido sin remedio: al día siguiente del vuelo es «no_se_hizo»', () => {
    const v = viaje({ servicios: [vuelo([tramo('2026-11-10', '06:10', 'BOG', 'CTG')])] })
    expect(de(hitosDelViaje(v, '2026-11-10'), 'checkin_vuelo')[0].estado).toBe('pendiente')
    expect(de(hitosDelViaje(v, '2026-11-10'), 'checkin_vuelo')[0].vencido).toBe(true)
    expect(de(hitosDelViaje(v, '2026-11-11'), 'checkin_vuelo')[0].estado).toBe('no_se_hizo')
  })

  it('documentos completos: el hito de pedirlos se cierra solo', () => {
    const [d] = de(hitosDelViaje(viaje({ documentosCompletos: true }), '2026-11-01'), 'pedir_documentos')
    expect([d.estado, d.derivado, d.fechaObjetivo, d.responsables]).toEqual(['hecho', true, '2026-10-01', [ALE]])
  })
})

describe('cerrar un hito', () => {
  const v = viaje({ servicios: [vuelo([tramo('2026-11-12', '07:00', 'BOG', 'CTG')]), servicio({ id: 'tour-1', tipo: 'actividad', fecha_servicio: '2026-11-15' })] })
  const hs = hitosDelViaje(v, '2026-11-01')
  const checkin = de(hs, 'checkin_vuelo')[0]
  const tour = de(hs, 'detalles_tour')[0]

  it('«No aplica» sin motivo se rechaza; con motivo pasa', () => {
    expect(validarCierreHito(checkin, { estado: 'no_aplica', nota: '  ', conAdjunto: false })).toEqual({ ok: false, error: 'Escribe por qué no aplica.' })
    expect(validarCierreHito(checkin, { estado: 'no_aplica', nota: 'El cliente hizo su check-in', conAdjunto: false })).toEqual({ ok: true, nota: 'El cliente hizo su check-in' })
  })

  it('el check-in solo se cierra adjuntando el pasabordo (adjuntar = hecho)', () => {
    expect(validarCierreHito(checkin, { estado: 'hecho', nota: null, conAdjunto: false }).ok).toBe(false)
    expect(validarCierreHito(checkin, { estado: 'hecho', nota: null, conAdjunto: true })).toEqual({ ok: true, nota: null })
  })

  it('el tour pide hora y punto de encuentro', () => {
    expect(validarCierreHito(tour, { estado: 'hecho', nota: '', conAdjunto: false })).toEqual({ ok: false, error: 'Escribe hora y punto de encuentro.' })
    expect(validarCierreHito(tour, { estado: 'hecho', nota: '8:00 en el muelle', conAdjunto: false }).ok).toBe(true)
  })
})

describe('agenda: quién ve qué', () => {
  const v = viaje({ servicios: [
    servicio({ id: 'hotel-a', tipo: 'hotel', fecha_servicio: '2026-11-13', responsable_staff_id: ALE }),
    servicio({ id: 'hotel-d', tipo: 'hotel', fecha_servicio: '2026-11-13', responsable_staff_id: DANI }),
    servicio({ id: 'tour-d', tipo: 'actividad', fecha_servicio: '2026-11-11', responsable_staff_id: DANI }),
    servicio({ id: 'hotel-v', tipo: 'hotel', fecha_servicio: '2026-11-12', responsable_staff_id: DANI }),
  ] })
  const todos = hitosDelViaje(v, '2026-11-10')

  it('la asesora no ve los hitos de otra', () => {
    const suyos = hitosVisibles(todos, { staffId: ALE, esDireccion: false })
    expect(suyos.every(h => h.responsables.includes(ALE))).toBe(true)
    expect(suyos.some(h => h.servicioId === 'hotel-d')).toBe(false)
  })

  it('Edgar ve todo, con contador por persona; tocar una persona filtra', () => {
    const nombres = { [ALE]: 'Alejandra', [DANI]: 'Daniela', [EDGAR]: 'Edgar' }
    const visibles = hitosVisibles(todos, { staffId: EDGAR, esDireccion: true })
    const a = armarAgenda({ hitos: visibles, pendientes: [], hoy: '2026-11-10', seleccion: 'hoy', alcance: 'equipo', persona: { staffId: EDGAR, esDireccion: true }, nombres })
    // Hoy (mar 10): reconfirmar los dos hoteles del 13 y los detalles del tour del 11; el hotel del
    // 12 tocaba el lun 9: vencido.
    expect(a.contador.map(c => `${c.nombre} ${c.n}`)).toEqual(['Daniela 3', 'Alejandra 1'])
    expect(a.vencidos).toBe(1)
    expect(a.secciones.map(s => s.titulo)).toEqual(['Vencido', 'Hoy'])
    const soloDani = armarAgenda({ hitos: visibles, pendientes: [], hoy: '2026-11-10', seleccion: 'hoy', alcance: DANI, persona: { staffId: EDGAR, esDireccion: true }, nombres })
    expect(soloDani.secciones.flatMap(s => s.lineas).every(l => l.clase === 'hito' && l.hito.responsables.includes(DANI))).toBe(true)
  })

  it('viaje de prueba: solo a quien lo lleva o lo aprueba', () => {
    const prueba = hitosDelViaje(viaje({ esPrueba: true, servicios: [servicio({ id: 'h', tipo: 'hotel', fecha_servicio: '2026-11-13', responsable_staff_id: ALE })] }), '2026-11-10')
    expect(hitosVisibles(prueba, { staffId: 'otra-direccion', esDireccion: true }, new Map([['neg-1', [EDGAR]]]))).toHaveLength(0)
    expect(hitosVisibles(prueba, { staffId: EDGAR, esDireccion: true }, new Map([['neg-1', [EDGAR]]])).length).toBeGreaterThan(0)
  })

  it('agenda vacía: «Lo próximo» con el siguiente hito', () => {
    const lejos = hitosDelViaje(viaje({ servicios: [vuelo([tramo('2026-11-26', '06:10', 'BOG', 'CTG')], { responsable_staff_id: ALE })] }), '2026-11-10')
    const a = armarAgenda({ hitos: lejos.filter(h => h.hitoId !== 'pedir_documentos'), pendientes: [], hoy: '2026-11-10', seleccion: 'hoy', alcance: 'mio', persona: { staffId: ALE, esDireccion: false }, nombres: {} })
    expect(a.vacia).toBe(true)
    expect(a.proximo).toEqual({ texto: 'check-in de Viajera', fecha: '2026-11-24' })
  })

  it('orden del día: fijos por hora, luego móviles, luego plata', () => {
    const hs = hitosDelViaje(viaje({ servicios: [
      servicio({ id: 'hotel-a', tipo: 'hotel', fecha_servicio: '2026-11-15', responsable_staff_id: ALE }),
      vuelo([tramo('2026-11-14', '18:00', 'BOG', 'CTG')], { id: 'v-tarde', responsable_staff_id: ALE }),
      vuelo([tramo('2026-11-14', '06:00', 'BOG', 'MDE')], { id: 'v-temprano', responsable_staff_id: ALE }),
    ] }), '2026-11-12')
    const plata = { id: 'p1', grupo: 'hoy' as const, fecha: '2026-11-12', texto: 'Paga el traslado: vence hoy.', negocioId: 'neg-1', viaje: 'x', accion: { tipo: 'abrir' as const, label: 'Abrir fila' }, plata: true }
    const a = armarAgenda({ hitos: hs, pendientes: [plata], hoy: '2026-11-12', seleccion: 'hoy', alcance: 'mio', persona: { staffId: ALE, esDireccion: false }, nombres: {} })
    const hoy = a.secciones.find(s => s.titulo === 'Hoy')!
    expect(hoy.lineas.map(l => (l.clase === 'hito' ? `${l.hito.hitoId}:${l.hito.servicioId}` : 'plata'))).toEqual([
      'checkin_vuelo:v-temprano', 'checkin_vuelo:v-tarde', 'reconfirmar_hotel:hotel-a', 'plata',
    ])
  })

  it('rangos: fin de semana con puente festivo y próxima semana', () => {
    expect(rangoDe('finde', '2026-11-12')).toEqual({ desde: '2026-11-14', hasta: '2026-11-16' })
    expect(rangoDe('finde', '2026-11-03')).toEqual({ desde: '2026-11-07', hasta: '2026-11-08' })
    expect(rangoDe('semana', '2026-11-12')).toEqual({ desde: '2026-11-16', hasta: '2026-11-22' })
  })
})

describe('campana', () => {
  it('resumen: «Hoy tienes 3 gestiones: 2 check-in y 1 tour.»', () => {
    const hs = hitosDelViaje(viaje({ servicios: [
      vuelo([tramo('2026-11-14', '06:00', 'BOG', 'CTG'), tramo('2026-11-14', '18:00', 'CTG', 'BOG')], { responsable_staff_id: ALE }),
      servicio({ id: 'tour-1', tipo: 'actividad', fecha_servicio: '2026-11-13', responsable_staff_id: ALE }),
    ] }), '2026-11-12')
    expect(resumenDelDia(hs, ALE, '2026-11-12')?.texto).toBe('Hoy tienes 3 gestiones: 2 check-in y 1 tour.')
  })

  it('el viernes antes del puente cubre sábado, domingo y el lunes festivo', () => {
    const hs = hitosDelViaje(viaje({ servicios: [
      servicio({ id: 'tour-1', tipo: 'actividad', fecha_servicio: '2026-11-17', responsable_staff_id: ALE }),
    ] }), '2026-11-13')
    // Tour el martes 17 → detalles el lunes 16 (festivo, fijo): entra en el resumen del viernes 13.
    expect(resumenDelDia(hs, ALE, '2026-11-13')?.texto).toContain('Este fin de semana tienes 1: lun 16 nov · tour')
  })

  it('escalamiento: vencidos sin marca; ni los hechos ni los «No aplica»', () => {
    const v = viaje({ documentosCompletos: true, servicios: [
      servicio({ id: 'hotel-a', tipo: 'hotel', fecha_servicio: '2026-11-13' }),
      servicio({ id: 'hotel-b', tipo: 'hotel', fecha_servicio: '2026-11-13' }),
    ], marcas: [{ servicio_id: 'hotel-b', tramo: null, hito_id: 'reconfirmar_hotel', fecha_objetivo: '2026-11-13', estado: 'no_aplica', evidencia_ref: null, nota: 'Se canceló', hecho_por: ALE, hecho_at: null }] })
    const esc = escalablesHoy(hitosDelViaje(v, '2026-11-11'), '2026-11-11')
    expect(esc.map(h => h.servicioId)).toEqual(['hotel-a'])
  })
})

describe('lugares', () => {
  it('reconoce códigos IATA y ciudades; lo demás es null', () => {
    expect(paisDeLugar('PUJ')).toBe('DO')
    expect(paisDeLugar('Punta Cana (PUJ)')).toBe('DO')
    expect(paisDeLugar('Cancún')).toBe('MX')
    expect(paisDeLugar('San Juan')).toBe('PR')
    expect(paisDeLugar('Toronto')).toBe('CA')
    expect(paisDeLugar('Cartagena')).toBeNull()
    expect(paisDeLugar(null)).toBeNull()
  })
})
