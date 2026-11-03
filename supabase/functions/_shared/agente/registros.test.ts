import { describe, expect, it } from 'vitest'
import { afirmaRegistroBorrado, anotarRegistrosBorrados, lineasRegistros, propuestaSobreBorrado } from './registros'
import { faltaPreparar } from './adjuntos'
import { escenarioOne } from './one/escenario'
import { escenario } from './escenario'
import { modeloGuionado } from './modelo-guionado'
import { reciboUberSintetico, reciboUberVueltaSintetico } from './arnes/soportes/pdf-minimo'
import type { ArchivoAdjunto, Lector } from './one/lectura-adjunto'
import type { FilaConversacion, LecturaAdjunto, PedidoModelo, RegistroConversacion } from './tipos'

/**
 * «La conversación da la intención; la verdad absoluta la da la base de datos» (Mauricio, 2026-10-21). Caso real del
 * mismo día (repetido): la base no tenía ningún gasto de Impervium y el bot insistió tres veces «G1 $27.000, G2 $6.880 y
 * G3 $20.389 ya están registrados, no los toco», no leyó los dos PDF nuevos que llegaron juntos y, ante «Estos dos
 * cárgalos como gastos nuevos, vuélvelos a cargar» + «Sí», volvió a pedir los montos. Genérico en el núcleo; cada
 * dominio pone la consulta a su tabla. Datos inventados.
 */

const REGS: RegistroConversacion[] = [
  { id: 'a', alias: 'G1', que: 'gasto de $27.000 · V1 26 5', estado: 'borrado', montos: [27000] },
  { id: 'b', alias: 'G2', que: 'gasto de $6.880 · V1 26 5', estado: 'borrado', montos: [6880] },
  { id: 'c', alias: 'G3', que: 'gasto de $20.389 · V1 26 5', estado: 'borrado', montos: [20389] },
]

describe('registros.ts (puro)', () => {
  it('la frase del caso real no sale; decir que ya no están, sí', () => {
    expect(afirmaRegistroBorrado('G1 $27.000, G2 $6.880 y G3 $20.389 ya están registrados, no los toco.', REGS)).toHaveLength(3)
    expect(afirmaRegistroBorrado('El gasto de $27.000 quedó registrado en V1 26 5.', REGS)).toHaveLength(1)
    expect(afirmaRegistroBorrado('G1, G2 y G3 ya no están en ONE: los borraron. ¿Los registro de nuevo?', REGS)).toEqual([])
    expect(afirmaRegistroBorrado('¿Registro el gasto de $6.880 con este recibo?', REGS)).toEqual([])
  })

  it('una cifra que también tiene un registro vigente no se ataja; sin borrados no opina', () => {
    const mixtos: RegistroConversacion[] = [...REGS, { id: 'd', alias: 'G4', que: 'gasto de $6.880', estado: 'vigente', montos: [6880] }]
    expect(afirmaRegistroBorrado('El gasto de $6.880 quedó registrado.', mixtos)).toEqual([])
    expect(afirmaRegistroBorrado('G1 ya está registrado.', [{ ...REGS[0], estado: 'vigente' }])).toEqual([])
    expect(afirmaRegistroBorrado('G1 ya está registrado.', 'error')).toEqual([])
  })

  it('propuestaSobreBorrado: por alias o por id, sin importar mayúsculas ni espacios', () => {
    expect(propuestaSobreBorrado({ gasto: 'g2', monto: 1 }, REGS)?.alias).toBe('G2')
    expect(propuestaSobreBorrado({ gasto: 'c' }, REGS)?.alias).toBe('G3')
    expect(propuestaSobreBorrado({ viaje: 'm1  26 9' }, [{ id: 'v', alias: 'M1 26 9', que: 'viaje', estado: 'borrado' }])?.alias).toBe('M1 26 9')
    expect(propuestaSobreBorrado({ gasto: 'G4' }, REGS)).toBeNull()
  })

  it('lineasRegistros: vigentes, borrados dicho explícito, y «no pude revisar»', () => {
    const l = lineasRegistros(REGS)
    expect(l[0]).toContain('el historial NO prueba que algo exista; esto sí): ninguno sigue en la base.')
    expect(l[1]).toContain('YA NO EXISTEN en la base (los borraron después): G1 (gasto de $27.000 · V1 26 5), G2')
    expect(lineasRegistros([])).toEqual([])
    expect(lineasRegistros(null)).toEqual([])
    expect(lineasRegistros('error')[0]).toContain('no pude revisar la base ahora')
  })

  it('anotarRegistrosBorrados: solo los mensajes del bot del turno que escribió el registro borrado', () => {
    const filas = [
      { id: '1', workspace_id: 'w', phone: 'p', direccion: 'entrante', clase: 'toque', texto: 'Registrar', turno_id: 't1', created_at: '', traza: { tipo: 'toque_propuesta', bot: 'one', ejecucion: { huella: 'h', resultado: 'ejecutada', escrituras: [{ tipo: 'gasto', id: 'a' }] } } },
      { id: '2', workspace_id: 'w', phone: 'p', direccion: 'saliente', clase: 'bot', texto: '✅ Gasto de $27.000 registrado', turno_id: 't1', created_at: '' },
      { id: '3', workspace_id: 'w', phone: 'p', direccion: 'saliente', clase: 'bot', texto: 'otra cosa', turno_id: 't2', created_at: '' },
    ] as FilaConversacion[]
    const out = anotarRegistrosBorrados(filas, REGS)
    expect(out[1].texto).toBe('✅ Gasto de $27.000 registrado [nota del sistema: G1 ya no existe en la base]')
    expect(out[2].texto).toBe('otra cosa')
    expect(filas[1].texto).toBe('✅ Gasto de $27.000 registrado')
  })
})

describe('un adjunto que no se alcanzó a leer se reintenta (hasta 3 veces)', () => {
  it('faltaPreparar: sin leer, o falló por tiempo/descarga con intentos; ilegible no', () => {
    const vacia = (motivo: string): LecturaAdjunto => ({ legible: false, monto: null, fecha: null, comercio: null, nit: null, descripcion: null, motivo })
    expect(faltaPreparar({ tipo: 'documento', id: 'm' })).toBe(true)
    expect(faltaPreparar({ tipo: 'documento', id: 'm', intentos: 1, lectura: vacia('el lector no respondió') })).toBe(true)
    expect(faltaPreparar({ tipo: 'documento', id: 'm', intentos: 3, lectura: vacia('el lector no respondió') })).toBe(false)
    expect(faltaPreparar({ tipo: 'documento', id: 'm', intentos: 1, lectura: { ...vacia(''), motivo: undefined } })).toBe(false)
    expect(faltaPreparar({ tipo: 'documento', id: 'm', lectura: { legible: true, monto: 1, fecha: null, comercio: null, nit: null, descripcion: null } })).toBe(false)
  })

  it('el primer intento falla; en el turno siguiente se lee y el bot propone con el monto leído', async () => {
    let llamadas = 0
    const lector: Lector = async () => (++llamadas === 1 ? null : { legible: true, monto: 6880, fecha: '2026-10-21', comercio: 'Uber', nit: null, descripcion: 'viaje' })
    const vistos: string[] = []
    const modelo = modeloGuionado([
      (p) => { vistos.push(String(p.mensajes[0].parts[0].text)); return { name: 'responder', args: { tema: 'gasto', texto: '¿De qué negocio es?' } } },
      (p) => { vistos.push(String(p.mensajes[0].parts[0].text)); return { name: 'responder', args: { tema: 'gasto', texto: 'ok' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: [], lector })
    await e.documento('recibo-uber.pdf', '', { archivo: { bytes: reciboUberSintetico(), mime: 'application/pdf' } })
    expect(vistos[0]).toContain('no se pudo leer el monto del archivo: el lector no respondió')
    await e.escribe('¿lo leíste?')
    expect(llamadas).toBe(2)
    expect(vistos[1]).toContain('lo que dice el archivo: total $6.880')
  })
})

const NEGOCIOS = [{ id: 'n-v', codigo: 'V1 26 5', nombre: 'Impermeabilización bodega', empresa: 'Vértice Impermeables', contacto: null, etapa: 'ejecucion', valor: 5_000_000 }]
const ETIQUETA = 'V1 26 5 · Vértice Impermeables — Impermeabilización bodega'

/** Lo que la conversación dice que se registró (con su toque y su «✅»), sin que esté en la base. */
function sembrarGastosBorrados(e: Awaited<ReturnType<typeof escenarioOne>>, montos: number[]) {
  montos.forEach((monto, i) => {
    const turno = `semilla-${i + 1}`
    const pesos = `$${monto.toLocaleString('es-CO')}`
    e.semilla([
      { direccion: 'entrante', clase: 'escrito', texto: `gasto de ${monto} al V1 26 5`, turno_id: `${turno}a` },
      { direccion: 'entrante', clase: 'toque', texto: 'Registrar', turno_id: turno, traza: { tipo: 'toque_propuesta', bot: 'one', ejecucion: { huella: `h-${turno}`, accion: 'gasto', resultado: 'ejecutada', lineas: [`✅ Gasto de ${pesos} registrado · ${ETIQUETA}`], escrituras: [{ tipo: 'gasto', id: `borrado-${i + 1}`, monto, negocio: 'V1 26 5', etiqueta: ETIQUETA, soporte: false }] } } },
      { direccion: 'saliente', clase: 'bot', texto: `✅ Gasto de ${pesos} registrado · ${ETIQUETA}`, turno_id: turno },
    ])
  })
}

describe('ONE: el caso real (G1-G3 borrados, dos PDF juntos, «vuélvelos a cargar»)', () => {
  it('los dos PDF se leen, el Estado dice que G1-G3 ya no existen y los gastos nuevos quedan con su soporte', async () => {
    const porNombre: Record<string, LecturaAdjunto> = {
      'recibo-uber.pdf': { legible: true, monto: 6880, fecha: '2026-10-21', comercio: 'Uber', nit: null, descripcion: 'viaje de ida' },
      'recibo-uber-vuelta.pdf': { legible: true, monto: 20389, fecha: '2026-10-21', comercio: 'Uber', nit: null, descripcion: 'viaje de vuelta' },
    }
    const lector: Lector = async (a: ArchivoAdjunto) => porNombre[a.nombre ?? ''] ?? null
    const vistos: string[] = []
    const ver = (p: PedidoModelo) => { vistos.push(String(p.mensajes[0].parts[0].text)) }
    const modelo = modeloGuionado([
      (p) => { ver(p); return { name: 'responder', args: { tema: 'gasto', texto: '¿Qué hago con estos dos recibos?' } } },
      (p) => { ver(p); return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 6880, negocio: 'V1 26 5', categoria: 'transporte', descripcion: 'Uber de ida', soporte: '#10' } } } },
      // Tras el toque, el turno de seguir: el segundo soporte.
      (p) => { ver(p); return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 20389, negocio: 'V1 26 5', categoria: 'transporte', descripcion: 'Uber de vuelta', soporte: '#11' } } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, lector })
    sembrarGastosBorrados(e, [27000, 6880, 20389])
    await e.juntos([{ documento: 'recibo-uber.pdf', archivo: { bytes: reciboUberSintetico(), mime: 'application/pdf', nombre: 'recibo-uber.pdf' } }, { documento: 'recibo-uber-vuelta.pdf', archivo: { bytes: reciboUberVueltaSintetico(), mime: 'application/pdf', nombre: 'recibo-uber-vuelta.pdf' }, despuesMs: 2000 }])
    // Los dos PDF se leyeron antes del primer turno del modelo.
    expect(vistos[0]).toContain('total $6.880')
    expect(vistos[0]).toContain('total $20.389')
    expect(vistos[0]).toContain('YA NO EXISTEN en la base (los borraron después): G1 (gasto de $27.000')
    expect(vistos[0]).toContain('G3 (gasto de $20.389')
    expect(vistos[0]).toContain('(nota del sistema: G1 ya no existe en la base)')
    expect(vistos[0]).toContain('Si el soporte dice el monto, no lo preguntes')
    const t = await e.escribe('Estos dos cárgalos como gastos nuevos, vuélvelos a cargar')
    expect(t[0].texto).toContain('💰 Gasto de $6.880')
    expect(t[0].texto).toContain('📎 Soporte: recibo-uber.pdf')
    const t2 = await e.toca('Registrar')
    expect(t2[0].texto).toContain('💰 Gasto de $20.389')
    await e.toca('Registrar')
    expect(e.puerto.gastos.map((g) => [g.monto, g.soporte])).toEqual([[6880, true], [20389, true]])
  })
})

describe('bandeja: un viaje abierto en la conversación y borrado en la base', () => {
  it('el Estado lo dice, cargar en él lo ataja el núcleo y no se escribe nada', async () => {
    let visto = ''
    const modelo = modeloGuionado([
      (p) => { visto = String(p.mensajes[0].parts[0].text); return { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'G1 26 9' } } } },
      { name: 'responder', args: { tema: 'solicitud', texto: 'G1 26 9 ya no existe en la base: ¿abro un viaje nuevo?' } },
    ])
    const e = await escenario({ modelo, contactos: [{ id: 'c-laura', nombre: 'LAURA GOMEZ', celular: '3205555521' }], viajes: [] })
    e.semilla([
      { direccion: 'entrante', clase: 'toque', texto: 'Sí, ábrelo', turno_id: 'sv', traza: { tipo: 'toque_propuesta', bot: 'bandeja-solicitudes', ejecucion: { huella: 'h', accion: 'viaje_nuevo', resultado: 'ejecutada', nombrados: ['G1 26 9'], escrituras: [{ tipo: 'viaje', id: 'v-borrado', codigo: 'G1 26 9' }] } } },
      { direccion: 'saliente', clase: 'bot', texto: 'Abrí G1 26 9 · San Andrés para LAURA GOMEZ.', turno_id: 'sv' },
    ])
    await e.reenvia('somos 2 adultos')
    const t = await e.escribe('cárgalo en el G1 26 9')
    expect(visto).toContain('YA NO EXISTEN en la base (los borraron después): G1 26 9 (viaje G1 26 9 abierto aquí)')
    expect(visto).toContain('(nota del sistema: G1 26 9 ya no existe en la base)')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['registro_borrado'])
    expect(t[0].texto).toBe('G1 26 9 ya no existe en la base: ¿abro un viaje nuevo?')
    expect(e.puerto.escrituras).toEqual([])
  })
})
