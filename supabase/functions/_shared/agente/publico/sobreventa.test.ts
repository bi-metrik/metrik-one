import { describe, expect, it } from 'vitest'
import { frasesDeSobreventa } from './sobreventa'
import { preciosSinHerramienta } from './precios'
import { condicionesVigentes, experiencias, zonaDe } from './catalogo'
import { dominioPublico, fichaParaModelo, lineaPreferenciaMesa } from './dominio'
import { reglamentoSabor } from './escenario'
import { REGLAMENTO_SABOR } from './reglamento-sabor'
import { conDosCondiciones, conZonaYMesaPedida, sinRegla } from './arnes/fichas-prueba'
import { recortarResultado, tokens } from '../contexto'
import type { ContextoDominio } from '../tipos'
import type { FilaPublica } from './tipos'

/**
 * Los candados contra la sobreventa (§8.3 y §8.4) y la ficha de función ampliada. La semilla de Sabor trae los datos del
 * kickoff del 22-oct (§8.5: `elige_mesa: no`, sin zonas, solo la preventa); los candados que esos datos dejan dormidos se
 * prueban con las fichas de prueba del arnés (`arnes/fichas-prueba.ts`). Datos [EJEMPLO] inventados.
 */

const AHORA = Date.parse('2026-10-23T15:00:00Z')
/** Dentro de la semana de preventa [EJEMPLO] (16 al 22 de octubre). */
const EN_PREVENTA = Date.parse('2026-10-20T15:00:00Z')
const ctx = (filas: FilaPublica[] = []): ContextoDominio => ({ workspaceId: 'w', phone: '77:1', remitente: { nombre: 'el cliente', rol: 'cliente' }, conversacion: filas, resultadosPrevios: [] })
const RESERVA = { experiencia: 'ejemplo-cena-1', funcion: 'f-ej-1', personas: 2, nombre: 'Ana Pérez', cedula: '52123456', telefono: '3001234567' }
const SI = { tipo: 'general' as const, respuesta: 'si' as const, mensaje_id: '1', mensaje_texto: 'Sí', texto_clave: 'rf.autorizacion', texto_version: 'v', texto_huella: 'h', at: '2026-10-23T14:00:00.000Z' }
const filasConSi: FilaPublica[] = [
  { id: 'a', workspace_id: 'w', phone: '77:1', direccion: 'entrante', clase: 'toque', texto: 'Sí', canal: 'instagram', created_at: '2026-10-23T14:00:00.000Z', traza: { tipo: 'sin_turno', bot: 'b', autorizacion: SI } },
  { id: 'b', workspace_id: 'w', phone: '77:1', direccion: 'entrante', clase: 'escrito', texto: 'Ana Pérez, cc 52123456, cel 3001234567', canal: 'instagram', created_at: '2026-10-23T14:05:00.000Z' },
]

describe('frases de sobreventa (§8.4)', () => {
  it('frena confirmación, escasez, condiciones sumadas y 2x1 o % que no están en la ficha', () => {
    expect(frasesDeSobreventa('¡Listo, ya quedó reservado!', [])).toHaveLength(1)
    expect(frasesDeSobreventa('Tu reserva está confirmada.', [])).toHaveLength(1)
    expect(frasesDeSobreventa('Tu mesa es la 4, frente a la pantalla.', [])).toHaveLength(1)
    expect(frasesDeSobreventa('Te guardé el puesto para el sábado.', [])).toHaveLength(1)
    expect(frasesDeSobreventa('Apúrate, quedan pocos y se está agotando.', [])).toHaveLength(2)
    expect(frasesDeSobreventa('Sí, puedes sumar los dos descuentos.', [])).toHaveLength(1)
    expect(frasesDeSobreventa('Sí, hay 2x1 los jueves.', [])).toHaveLength(1)
    expect(frasesDeSobreventa('Tienes 30% de descuento.', [])).toHaveLength(1)
  })
  it('deja pasar las negaciones y lo que la ficha sí trae', () => {
    expect(frasesDeSobreventa('Todavía no está reservado: el equipo te confirma cupo y pago.', [])).toEqual([])
    expect(frasesDeSobreventa('Aún no queda confirmado; el equipo te escribe.', [])).toEqual([])
    expect(frasesDeSobreventa('No se pueden sumar: aplica una sola.', [])).toEqual([])
    expect(frasesDeSobreventa('Puedes sumar los dos.', ['{"acumulable":"sí"}'])).toEqual([])
    expect(frasesDeSobreventa('Este mes hay 2x1.', ['{"condicion":"2x1 los martes"}'])).toEqual([])
  })
})

describe('ficha de función ampliada (§8.3)', () => {
  it('la semilla de Sabor (kickoff 22-oct): orden de llegada, sin elegir mesa, sin zonas, por persona y sin pareja', async () => {
    const r = await reglamentoSabor()
    const e = experiencias(r).find((x) => x.id === 'ejemplo-cena-1')!
    const f = fichaParaModelo(e, AHORA)
    expect(f).toMatchObject({ precio_por_persona: '$95.000', elige_mesa: 'no se elige mesa', ubicaciones: [], puestos: expect.stringMatching(/^30 /) })
    expect(f).not.toHaveProperty('precio_por_pareja')
    expect(String(f.disposicion)).toMatch(/orden de llegada.*hasta 9 personas/)
    expect(String(f.cobro_grupo)).toMatch(/sin descuento por pareja ni por grupo/)
    expect(zonaDe(e, 'quiero la mesa del frente')).toBeNull()
  })
  it('solo las condiciones vigentes hoy en Bogotá: la preventa sale en su semana y no después', async () => {
    const r = await reglamentoSabor()
    const e = experiencias(r).find((x) => x.id === 'ejemplo-cena-1')!
    expect(condicionesVigentes(e, EN_PREVENTA).map((c) => c.id)).toEqual(['preventa'])
    expect(condicionesVigentes(e, AHORA)).toEqual([])
    expect(JSON.stringify(fichaParaModelo(e, AHORA))).not.toContain('preventa')
    const dos = experiencias(await reglamentoSabor(conDosCondiciones(REGLAMENTO_SABOR))).find((x) => x.id === 'ejemplo-cena-1')!
    expect(condicionesVigentes(dos, AHORA).map((c) => c.id)).toEqual(['pago-anticipado', 'cumpleanero'])
  })
  it('la ficha cabe entera en el tope de un resultado de herramienta (no se recorta)', async () => {
    for (const fichas of [REGLAMENTO_SABOR, conZonaYMesaPedida(conDosCondiciones(REGLAMENTO_SABOR))]) {
      const r = await reglamentoSabor(fichas)
      const d = { experiencias: experiencias(r).filter((x) => x.id === 'ejemplo-cena-1').map((e) => fichaParaModelo(e, AHORA)) }
      expect(recortarResultado(d)).toBe(d)
      expect(tokens(JSON.stringify(d))).toBeLessThan(400)
    }
  })
  it('la guarda de precios acepta montos de condiciones y recargos devueltos, y frena la condición vencida', async () => {
    const r = await reglamentoSabor(conZonaYMesaPedida(conDosCondiciones(REGLAMENTO_SABOR)))
    const e = experiencias(r).find((x) => x.id === 'ejemplo-cena-1')!
    const fuentes = [JSON.stringify(fichaParaModelo(e, AHORA))]
    expect(preciosSinHerramienta('Pagando antes del jueves te descuentan $10.000 por persona; frente a la pantalla son $12.000 más.', fuentes)).toEqual([])
    expect(preciosSinHerramienta('La preventa te da $20.000 de descuento.', fuentes)).toEqual(['$20.000'])
    expect(preciosSinHerramienta('Con los dos te quedan $80.000.', fuentes)).toEqual(['$80.000'])
  })
})

describe('dominio: reglas, mesa y resumen (§8.3, §8.4, §8.5)', () => {
  it('las reglas del kickoff están escritas: parqueadero, niños y grupos', async () => {
    const d = dominioPublico({ reglamento: await reglamentoSabor(), ahoraMs: () => AHORA, vars: {} })
    const texto = async (clave: string) => String(((await d.leer('consultar_reglas', { clave }, ctx())).datos as { politica?: string }).politica)
    expect(await texto('parqueadero')).toMatch(/no tiene parqueadero.*bahía sin vigilancia.*no responde.*unas cuadras/)
    expect(await texto('ninos')).toMatch(/Depende de la película.*menores de 6 años no entran a ninguna/)
    expect(await texto('grupos')).toMatch(/5 o más.*guarda una mesa.*persona del equipo.*Desde 12 personas.*privada en otro horario/)
  })
  it('consultar_reglas: clave sin ficha devuelve sin_dato; la duda abierta dice rf.duda_abierta', async () => {
    const r = await reglamentoSabor(sinRegla('parqueadero')(REGLAMENTO_SABOR))
    const d = dominioPublico({ reglamento: r, ahoraMs: () => AHORA, vars: {} })
    expect(await d.leer('consultar_reglas', { clave: 'parqueadero' }, ctx())).toMatchObject({ ok: true, datos: { clave: 'parqueadero', sin_dato: true } })
    expect(await d.leer('consultar_reglas', { clave: 'mascotas' }, ctx())).toMatchObject({ ok: true, datos: { clave: 'mascotas' } })
    const c = await d.cerrar!('pasar_a_persona', { motivo: 'duda_abierta', pidio: 'parqueadero' }, ctx())
    expect(c.ok && c.salidas[0].texto).toMatch(/^No tengo ese dato confirmado/)
  })
  it('rf.preferencia_mesa anota la preferencia y dice el recargo de la zona; si no se elige mesa, no la anota', async () => {
    const r = await reglamentoSabor(conZonaYMesaPedida(REGLAMENTO_SABOR))
    const d = dominioPublico({ reglamento: r, ahoraMs: () => AHORA, vars: {} })
    const c = await d.cerrar!('respuesta_fija', { clave: 'rf.preferencia_mesa', preferencia: 'la mesa del frente' }, ctx())
    expect(c.ok && c.salidas[0].texto).toBe('Te la dejo anotada como preferencia; el equipo te confirma la ubicación. La zona frente a la pantalla tiene un recargo de $12.000 por persona.')
    expect(c.ok && c.privado).toEqual({ preferencia_mesa: 'la mesa del frente' })
    // La semilla de Sabor (kickoff 22-oct) ya va con elige_mesa: no.
    const d2 = dominioPublico({ reglamento: await reglamentoSabor(), ahoraMs: () => AHORA, vars: {} })
    expect(await d2.cerrar!('respuesta_fija', { clave: 'rf.preferencia_mesa', preferencia: 'la mesa del frente' }, ctx())).toMatchObject({ ok: false, candado: 'mesa_no_se_elige' })
  })
  it('grupo: pasa a persona con el texto que nombra la privada, sin prometer la mesa', async () => {
    const d = dominioPublico({ reglamento: await reglamentoSabor(), ahoraMs: () => AHORA, vars: {} })
    const c = await d.cerrar!('pasar_a_persona', { motivo: 'grupo', pidio: 'grupo de 14' }, ctx())
    const texto = c.ok ? c.salidas[0].texto : ''
    expect(texto).toMatch(/desde 12 personas.*experiencia privada/)
    expect(texto).not.toMatch(/(guard|apart|separ|reserv)\w* (la |una )?mesa/)
  })
  it('el resumen lleva precios unitarios sin total y la mesa como «(por confirmar)»; el «sí» dice rf.siguiente_paso', async () => {
    const r = await reglamentoSabor(conZonaYMesaPedida(REGLAMENTO_SABOR))
    const d = dominioPublico({ reglamento: r, ahoraMs: () => AHORA, vars: {} })
    const p = await d.proponer('reserva', { ...RESERVA, preferencia_mesa: 'frente a la pantalla' }, ctx(filasConSi))
    expect(p.ok).toBe(true)
    const resumen = p.ok ? p.propuesta.resumen : ''
    expect(resumen).toContain('$95.000 por persona')
    expect(resumen).toContain(lineaPreferenciaMesa('frente a la pantalla'))
    expect(resumen).toContain('(por confirmar)')
    expect(resumen).not.toMatch(/total \$|\$190\.000/)
    expect(resumen).toContain('te confirma el total')
    const h = await d.ejecutar(p.ok ? p.propuesta : (null as never), ctx(filasConSi))
    expect(h.lineas[0]).toMatch(/^Listo, ya tengo tus datos\. Todavía no está reservado/)
  })
  it('con la semilla de Sabor (elige_mesa: no) el resumen no lleva la línea de mesa ni precio por pareja', async () => {
    const d = dominioPublico({ reglamento: await reglamentoSabor(), ahoraMs: () => AHORA, vars: {} })
    expect(await d.proponer('reserva', { ...RESERVA, preferencia_mesa: 'la mesa del frente' }, ctx(filasConSi))).toMatchObject({ ok: false, candado: 'mesa_no_se_elige' })
    const p = await d.proponer('reserva', RESERVA, ctx(filasConSi))
    expect(p.ok).toBe(true)
    const resumen = p.ok ? p.propuesta.resumen : ''
    expect(resumen).toContain('2 personas · $95.000 por persona\n')
    expect(resumen).not.toMatch(/Preferencia de mesa|por pareja/)
    expect(resumen).toContain('te confirma el total, el cupo y el pago.')
    expect(resumen).not.toMatch(/\bmesa\b/)
    const h = await d.ejecutar(p.ok ? p.propuesta : (null as never), ctx(filasConSi))
    expect(h.lineas[0]).toBe('Listo, ya tengo tus datos. Todavía no está reservado: el equipo de Sabor te escribe por aquí para confirmar cupo y pago. La reserva queda hecha cuando el pago esté aprobado.')
    expect(p.ok && p.propuesta.datos).not.toHaveProperty('preferencia_mesa')
  })
})
