import { describe, expect, it } from 'vitest'
import { escenarioOne } from '../one/escenario'
import type { EscenarioOne } from '../one/escenario'
import { modeloGuionado } from '../modelo-guionado'
import { CATALOGO } from './catalogo'
import { FUNCIONES_EQUIPO_ONE } from './equipo-one'

/**
 * Los casos mínimos de cada función `equipo.*` (spec 2026-10-26, §2.2): donde DEBE actuar, donde NO debe (el candado la
 * ataja aunque el modelo la intente) y el caso de ROL (desde un cargo que no la tiene, la herramienta no existe). El
 * modelo es un guion: prueban el código (declaración, candados, permisos), no al modelo. Datos inventados.
 */

const NEGOCIOS = [
  { id: 'n-a', codigo: 'A1 26 1', nombre: 'Obra de prueba', empresa: 'Alfa Pruebas', contacto: null, etapa: 'ejecucion', valor: 2_500_000 },
]
const CUOTA = { id: 'cobro-1', negocioId: 'n-a', numeroCuota: 1, monto: 400000, fechaEsperada: '2026-10-26', notas: null, fecha: null, soporte: null }

interface Caso {
  tipo: 'actua' | 'no_actua' | 'rol';
  titulo: string;
  cargo: string;
  guion: Parameters<typeof modeloGuionado>[0];
  pasos: (e: EscenarioOne) => Promise<unknown>;
  espera: (e: EscenarioOne) => void;
  cuotas?: boolean;
}

const ultimaTraza = (e: EscenarioOne) => e.trazas().at(-1)!
const lectura = (e: EscenarioOne, nombre: string) => e.trazas().flatMap((t) => t.herramientas ?? []).find((h) => h.nombre === nombre)!
const candados = (e: EscenarioOne) => e.trazas().flatMap((t) => t.candados ?? []).map((c) => c.candado)
const responder = (texto = 'Listo.') => ({ name: 'responder', args: { tema: 'conversacion', texto } })

const CASOS: Record<string, Caso[]> = {
  'equipo.consulta_negocio': [
    { tipo: 'actua', titulo: 'lista los negocios abiertos', cargo: 'operator', guion: [{ name: 'negocios_abiertos', args: {} }, responder('Tienes 1 negocio abierto.')],
      pasos: (e) => e.escribe('qué negocios tengo'), espera: (e) => expect(lectura(e, 'negocios_abiertos')).toMatchObject({ ok: true }) },
    { tipo: 'no_actua', titulo: 'un código que no existe no se inventa', cargo: 'operator', guion: [{ name: 'ver_negocio', args: { codigo: 'Z9 26 9' } }, responder('No lo encuentro.')],
      pasos: (e) => e.escribe('cómo va el Z9 26 9'), espera: (e) => expect(lectura(e, 'ver_negocio').error).toContain('No hay un negocio abierto') },
    { tipo: 'rol', titulo: 'solo lectura no consulta negocios', cargo: 'read_only', guion: [{ name: 'negocios_abiertos', args: {} }, responder('No puedo.')],
      pasos: (e) => e.escribe('qué negocios tengo'), espera: (e) => expect(lectura(e, 'negocios_abiertos').error).toContain('No existe la herramienta') },
  ],
  'equipo.consulta_gastos': [
    { tipo: 'actua', titulo: 'los gastos de hoy', cargo: 'contador', guion: [{ name: 'gastos_recientes', args: { dias: 1 } }, responder('Hoy no hay gastos.')],
      pasos: (e) => e.escribe('cuánto gasté hoy'), espera: (e) => expect(lectura(e, 'gastos_recientes')).toMatchObject({ ok: true }) },
    { tipo: 'no_actua', titulo: 'de un negocio que no existe, no', cargo: 'contador', guion: [{ name: 'gastos_recientes', args: { codigo: 'Z9 26 9' } }, responder('No lo encuentro.')],
      pasos: (e) => e.escribe('gastos del Z9 26 9'), espera: (e) => expect(lectura(e, 'gastos_recientes').error).toContain('No hay un negocio abierto') },
    { tipo: 'rol', titulo: 'un operador no consulta gastos', cargo: 'operator', guion: [{ name: 'gastos_recientes', args: {} }, responder('No puedo.')],
      pasos: (e) => e.escribe('cuánto gasté hoy'), espera: (e) => expect(lectura(e, 'gastos_recientes').error).toContain('No existe la herramienta') },
  ],
  'equipo.ver_plata': [
    { tipo: 'actua', titulo: 'el contador ve el valor del negocio', cargo: 'contador', guion: [{ name: 'ver_negocio', args: { codigo: 'A1 26 1' } }, responder('Va bien.')],
      pasos: (e) => e.escribe('cómo va el A1 26 1'), espera: (e) => expect(JSON.stringify(lectura(e, 'ver_negocio').datos)).toContain('"valor"') },
    { tipo: 'no_actua', titulo: 'el supervisor no ve plata aunque pida el valor', cargo: 'supervisor', guion: [{ name: 'ver_negocio', args: { codigo: 'A1 26 1' } }, responder('No tengo el valor.')],
      pasos: (e) => e.escribe('cuánto vale el A1 26 1'), espera: (e) => expect(JSON.stringify(lectura(e, 'ver_negocio').datos)).not.toContain('valor') },
    { tipo: 'rol', titulo: 'un operador no ve el valor en la lista', cargo: 'operator', guion: [{ name: 'negocios_abiertos', args: {} }, responder('Uno.')],
      pasos: (e) => e.escribe('qué negocios tengo'), espera: (e) => expect(JSON.stringify(lectura(e, 'negocios_abiertos').datos)).not.toContain('valor') },
  ],
  'equipo.gastos': [
    { tipo: 'actua', titulo: 'registra un gasto con el toque', cargo: 'operator', guion: [{ name: 'proponer', args: { accion: 'gasto', datos: { monto: 47600, negocio: 'A1 26 1', categoria: 'transporte' } } }],
      pasos: async (e) => { await e.escribe('gasté 47.600 en transporte en la A1 26 1'); await e.toca('Registrar') },
      espera: (e) => expect(e.puerto.gastos.map((g) => [g.monto, g.negocio])).toEqual([[47600, 'A1 26 1']]) },
    { tipo: 'no_actua', titulo: 'monto cero: el candado lo ataja', cargo: 'operator', guion: [{ name: 'proponer', args: { accion: 'gasto', datos: { monto: 0, negocio: 'A1 26 1', categoria: 'otros' } } }, responder('¿De cuánto fue?')],
      pasos: (e) => e.escribe('gasté en la A1 26 1'), espera: (e) => { expect(candados(e)).toEqual(['monto']); expect(e.puerto.escrituras).toEqual([]) } },
    { tipo: 'rol', titulo: 'un contador no registra gastos', cargo: 'contador', guion: [{ name: 'proponer', args: { accion: 'gasto', datos: { monto: 1000, negocio: 'A1 26 1', categoria: 'otros' } } }, responder('No puedo.')],
      pasos: (e) => e.escribe('gasté 1000 en la A1 26 1'), espera: (e) => { expect(candados(e)).toEqual(['accion_desconocida']); expect(e.puerto.escrituras).toEqual([]) } },
  ],
  'equipo.actividades': [
    { tipo: 'actua', titulo: 'anota una llamada', cargo: 'operator', guion: [{ name: 'proponer', args: { accion: 'actividad', datos: { negocio: 'A1 26 1', tipo: 'llamada', texto: 'Llamé a Alfa' } } }],
      pasos: async (e) => { await e.escribe('llamé a Alfa por la A1 26 1'); await e.toca('Registrar') },
      espera: (e) => expect(e.puerto.escrituras.map((w) => w.tipo)).toEqual(['actividad']) },
    { tipo: 'no_actua', titulo: 'en un negocio que no existe, no', cargo: 'operator', guion: [{ name: 'proponer', args: { accion: 'actividad', datos: { negocio: 'Z9 26 9', tipo: 'nota', texto: 'x' } } }, responder('¿Cuál negocio?')],
      pasos: (e) => e.escribe('anota en el Z9 26 9 que llamé'), espera: (e) => expect(candados(e)).toEqual(['negocio_inexistente']) },
    { tipo: 'rol', titulo: 'solo lectura no anota', cargo: 'read_only', guion: [{ name: 'proponer', args: { accion: 'actividad', datos: { negocio: 'A1 26 1', tipo: 'nota', texto: 'x' } } }, responder('No puedo.')],
      pasos: (e) => e.escribe('anota que llamé'), espera: (e) => expect(candados(e)).toEqual(['accion_desconocida']) },
  ],
  'equipo.ingresos': [
    { tipo: 'actua', titulo: 'marca la cuota pagada', cargo: 'supervisor', cuotas: true, guion: [{ name: 'proponer', args: { accion: 'ingreso', datos: { negocio: 'A1 26 1', monto: 400000 } } }],
      pasos: async (e) => { await e.escribe('Alfa pagó 400.000 de la A1 26 1'); await e.toca('Marcar pagada') },
      espera: (e) => expect(e.puerto.escrituras.map((w) => w.tipo)).toEqual(['cobro']) },
    { tipo: 'no_actua', titulo: 'un monto que no cuadra no se registra callado', cargo: 'supervisor', cuotas: true, guion: [{ name: 'proponer', args: { accion: 'ingreso', datos: { negocio: 'A1 26 1', monto: 123000 } } }, responder('No cuadra con la cuota.')],
      pasos: (e) => e.escribe('Alfa pagó 123.000'), espera: (e) => { expect(candados(e)).toEqual(['ingreso_no_cuadra']); expect(e.puerto.escrituras).toEqual([]) } },
    { tipo: 'rol', titulo: 'un operador no registra ingresos', cargo: 'operator', cuotas: true, guion: [{ name: 'proponer', args: { accion: 'ingreso', datos: { negocio: 'A1 26 1', monto: 400000 } } }, responder('No puedo.')],
      pasos: (e) => e.escribe('Alfa pagó 400.000'), espera: (e) => { expect(candados(e)).toEqual(['accion_desconocida']); expect(e.puerto.escrituras).toEqual([]) } },
  ],
  'equipo.contactos': [
    { tipo: 'actua', titulo: 'crea un contacto con su teléfono escrito', cargo: 'admin', guion: [{ name: 'proponer', args: { accion: 'contacto_nuevo', datos: { nombre: 'Sofía Prueba', telefono: '3001234567' } } }],
      pasos: async (e) => { await e.escribe('nuevo contacto Sofía Prueba 3001234567'); await e.toca('Crear') },
      espera: (e) => expect(e.puerto.escrituras.map((w) => w.tipo)).toEqual(['contacto']) },
    { tipo: 'no_actua', titulo: 'un teléfono que nadie escribió no se usa', cargo: 'admin', guion: [{ name: 'proponer', args: { accion: 'contacto_nuevo', datos: { nombre: 'Sofía Prueba', telefono: '3119998877' } } }, responder('¿Su número?')],
      pasos: (e) => e.escribe('nuevo contacto Sofía Prueba'), espera: (e) => expect(candados(e)).toEqual(['telefono_sin_respaldo']) },
    { tipo: 'rol', titulo: 'un supervisor no crea contactos', cargo: 'supervisor', guion: [{ name: 'proponer', args: { accion: 'contacto_nuevo', datos: { nombre: 'Sofía Prueba' } } }, responder('No puedo.')],
      pasos: (e) => e.escribe('nuevo contacto Sofía Prueba'), espera: (e) => expect(candados(e)).toEqual(['accion_desconocida']) },
  ],
}

describe('casos mínimos de cada función equipo.* (debe actuar, no debe, rol)', () => {
  it('toda función de ONE tiene sus tres casos', () => {
    for (const f of FUNCIONES_EQUIPO_ONE) expect([f.clave, (CASOS[f.clave] ?? []).map((c) => c.tipo)]).toEqual([f.clave, ['actua', 'no_actua', 'rol']])
    for (const k of Object.keys(CASOS)) expect(CATALOGO[k]).toBeDefined()
  })
  for (const [funcion, casos] of Object.entries(CASOS)) {
    for (const c of casos) {
      it(`${funcion} · ${c.tipo} · ${c.titulo} (${c.cargo})`, async () => {
        const e = await escenarioOne({ modelo: modeloGuionado(c.guion), negocios: NEGOCIOS, rol: c.cargo })
        if (c.cuotas) e.puerto.cobros = [structuredClone(CUOTA)]
        await c.pasos(e)
        c.espera(e)
        // Ningún caso deja la traza sin su rol.
        expect(ultimaTraza(e).rol?.clave).toBe(`cargo:${c.cargo}`)
      })
    }
  }
})
