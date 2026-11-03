import { describe, expect, it } from 'vitest'
import { escenario, reglamentoDePrueba } from '../escenario'
import type { Escenario } from '../escenario'
import { modeloGuionado } from '../modelo-guionado'
import { CATALOGO } from './catalogo'
import { FUNCIONES_EQUIPO_VIAJES } from './equipo-viajes'
import { fichasDelRol } from '../bandeja/roles-trappvel'

/**
 * Los casos mínimos de cada función `equipo.*` del motor de viajes (la bandeja de Trappvel con roles, 2026-10-29): donde
 * DEBE actuar, donde NO debe (el candado la ataja aunque el modelo la intente) y el caso de ROL (desde un rol que no la
 * tiene, la herramienta no existe). El modelo es un guion: prueban el código, no al modelo. Datos inventados.
 */

const CONTACTOS = [{ id: 'c-martin', nombre: 'MARTIN MORA', celular: '5550001001' }]
const VIAJES = [{ id: 'v-m1', codigo: 'M1 26 1', contactoId: 'c-martin', nombre: 'CARTAGENA', destino: 'Cartagena', abierto: true, datos: {} }]
const REF = 'Martin Mora (cel. …7311)'
const TODAS = ['equipo.viajes_consulta', 'equipo.viajes_registro', 'equipo.clientes_viaje', 'equipo.autorizacion_datos']

interface Caso {
  tipo: 'actua' | 'no_actua' | 'rol';
  titulo: string;
  funciones: string[];
  guion: Parameters<typeof modeloGuionado>[0];
  pasos: (e: Escenario) => Promise<unknown>;
  espera: (e: Escenario) => void;
}

const herramienta = (e: Escenario, nombre: string) => e.trazas().flatMap((t) => t.herramientas ?? []).find((h) => h.nombre === nombre)!
const candados = (e: Escenario) => e.trazas().flatMap((t) => t.candados ?? []).map((c) => c.candado)
const responder = (texto = 'Listo.') => ({ name: 'responder', args: { tema: 'viaje', texto } })
const buscarMartin = { name: 'buscar', args: { texto: 'Martín Mora' } }

const CASOS: Record<string, Caso[]> = {
  'equipo.viajes_consulta': [
    { tipo: 'actua', titulo: 've cómo va un viaje', funciones: TODAS, guion: [{ name: 'ver_viaje', args: { codigo: 'M1 26 1' } }, responder('Va bien.')],
      pasos: (e) => e.escribe('cómo va el M1 26 1'), espera: (e) => expect(herramienta(e, 'ver_viaje')).toMatchObject({ ok: true }) },
    { tipo: 'no_actua', titulo: 'una búsqueda vacía no lee nada', funciones: TODAS, guion: [{ name: 'buscar', args: { texto: '' } }, responder('¿A quién busco?')],
      pasos: (e) => e.escribe('busca'), espera: (e) => expect(herramienta(e, 'buscar').error).toContain('Dime qué buscar') },
    { tipo: 'rol', titulo: 'un rol sin la consulta no busca', funciones: ['equipo.gastos', 'equipo.consulta_negocio'], guion: [buscarMartin, responder('No puedo.')],
      pasos: (e) => e.escribe('busca a Martín Mora'), espera: (e) => expect(herramienta(e, 'buscar').error).toContain('No existe la herramienta') },
  ],
  'equipo.viajes_registro': [
    { tipo: 'actua', titulo: 'abre un viaje que la asesora lleva', funciones: TODAS,
      guion: [buscarMartin, { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: REF, destino: 'San Andrés', responsable: 'Carla Comercial', dicho_en: 1 } } }],
      pasos: async (e) => { await e.escribe('viaje nuevo de Martín Mora a San Andrés, lo llevo yo'); await e.toca('Sí, ábrelo') },
      espera: (e) => expect(e.puerto.escrituras.filter((w) => w.tipo === 'viaje').map((w) => w.contactoId)).toEqual(['c-martin']) },
    { tipo: 'no_actua', titulo: 'no anota en un viaje que nadie nombró', funciones: TODAS,
      guion: [{ name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: 'M1 26 1', texto: 'salen el 3' } } }, responder('¿A qué viaje?')],
      pasos: (e) => e.escribe('salen el 3'), espera: (e) => { expect(candados(e)).toEqual(['viaje_nombrado']); expect(e.puerto.escrituras).toEqual([]) } },
    { tipo: 'rol', titulo: 'un rol de solo consulta no abre viajes', funciones: ['equipo.viajes_consulta'],
      guion: [buscarMartin, { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: REF, responsable: 'Carla Comercial', dicho_en: 1 } } }, responder('No puedo.')],
      pasos: (e) => e.escribe('viaje nuevo de Martín Mora, lo llevo yo'), espera: (e) => { expect(candados(e)).toEqual(['accion_desconocida']); expect(e.puerto.escrituras).toEqual([]) } },
  ],
  'equipo.clientes_viaje': [
    { tipo: 'actua', titulo: 'crea una clienta con su celular escrito', funciones: TODAS,
      guion: [{ name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Sofía Prueba', llave: '5550009988' } } }],
      pasos: async (e) => { await e.escribe('clienta nueva Sofía Prueba 5550009988'); await e.toca('Crear') },
      espera: (e) => expect(e.puerto.escrituras.map((w) => w.tipo)).toEqual(['cliente']) },
    { tipo: 'no_actua', titulo: 'sin llave escrita no se crea', funciones: TODAS,
      guion: [{ name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Sofía Prueba', llave: '5550009988' } } }, responder('¿Su celular?')],
      pasos: (e) => e.escribe('clienta nueva Sofía Prueba'), espera: (e) => { expect(candados(e)).toEqual(['falta_llave']); expect(e.puerto.escrituras).toEqual([]) } },
    { tipo: 'rol', titulo: 'un rol sin clientes no los crea', funciones: ['equipo.viajes_consulta', 'equipo.viajes_registro'],
      guion: [{ name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Sofía Prueba', llave: '5550009988' } } }, responder('No puedo.')],
      pasos: (e) => e.escribe('clienta nueva Sofía Prueba 5550009988'), espera: (e) => { expect(candados(e)).toEqual(['accion_desconocida']); expect(e.puerto.escrituras).toEqual([]) } },
  ],
  'equipo.autorizacion_datos': [
    { tipo: 'actua', titulo: 'manda el link de un cliente buscado', funciones: TODAS, guion: [buscarMartin, { name: 'link_autorizacion', args: { cliente: REF } }],
      pasos: (e) => e.escribe('pásame el link de autorización de Martín Mora'),
      espera: (e) => { expect(e.puerto.escrituras).toEqual([{ tipo: 'enlace_autorizacion', contactoId: 'c-martin' }]); expect(e.mensajero.enviados).toHaveLength(2) } },
    { tipo: 'no_actua', titulo: 'sin buscar al cliente no sale link', funciones: TODAS, guion: [{ name: 'link_autorizacion', args: { cliente: REF } }, responder('Déjame buscarlo.')],
      pasos: (e) => e.escribe('pásame el link de Martín Mora'), espera: (e) => { expect(candados(e)).toEqual(['cliente_sin_buscar']); expect(e.puerto.escrituras).toEqual([]) } },
    { tipo: 'rol', titulo: 'un rol sin autorización no tiene el link', funciones: ['equipo.viajes_consulta', 'equipo.viajes_registro'],
      guion: [buscarMartin, { name: 'link_autorizacion', args: { cliente: REF } }, responder('No puedo.')],
      pasos: (e) => e.escribe('pásame el link de autorización de Martín Mora'),
      espera: (e) => { expect(herramienta(e, 'link_autorizacion').error).toContain('No existe la herramienta'); expect(e.puerto.escrituras).toEqual([]) } },
  ],
}

describe('casos mínimos de cada función de viajes (debe actuar, no debe, rol)', () => {
  it('toda función de viajes tiene sus tres casos', () => {
    for (const f of FUNCIONES_EQUIPO_VIAJES) expect([f.clave, (CASOS[f.clave] ?? []).map((c) => c.tipo)]).toEqual([f.clave, ['actua', 'no_actua', 'rol']])
    for (const k of Object.keys(CASOS)) expect(CATALOGO[k]).toBeDefined()
  })
  for (const [funcion, casos] of Object.entries(CASOS)) {
    for (const c of casos) {
      it(`${funcion} · ${c.tipo} · ${c.titulo}`, async () => {
        const e = await escenario({
          modelo: modeloGuionado(c.guion), contactos: CONTACTOS, viajes: VIAJES,
          reglamento: await reglamentoDePrueba(fichasDelRol('asesor_viajes')),
          rol: { clave: 'prueba', funciones: c.funciones },
        })
        await c.pasos(e)
        c.espera(e)
        // Ningún caso deja la traza sin su rol.
        expect(e.trazas().at(-1)!.rol?.clave).toBe('prueba')
      })
    }
  }
})
