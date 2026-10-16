import { describe, expect, it } from 'vitest'
import { escenario } from './escenario'
import { modeloGuionado } from './modelo-guionado'
import { propuestaVigente } from './nucleo'
import { resolverResponsable, responsablePendiente } from './bandeja/dominio'
import { equipoDesdeFilas, staffDePrueba } from './bandeja/equipo'
import type { MiembroEquipo } from './bandeja/dominio'
import type { PedidoModelo } from './tipos'

/**
 * Trappvel, 2026-10-16 (reunión con Mauricio): «cuando se crea un nuevo viaje … debemos preguntar siempre
 * obligatoriamente quién va a ser el responsable de la ejecución». Las invariantes que sostiene el código:
 *   · no hay propuesta de viaje nuevo sin responsable elegido (el modelo recibe el candado y pregunta con opciones);
 *   · el responsable es del equipo comercial activo (y se vuelve a validar al escribir);
 *   · quién es lo interpreta el MODELO («la llevo yo», «Ale», un audio): aquí el modelo es un guion, el código solo valida.
 * Datos inventados.
 */

const MARTIN = { id: 'c-martin', nombre: 'MARTIN MORA', celular: '3001237311' }
const REF = 'Martin Mora (cel. …7311)'
const EQUIPO: MiembroEquipo[] = [
  { id: 'st-ale', nombre: 'Alejandra Pinto', esQuienEscribe: false },
  { id: 'st-dani', nombre: 'Daniela Suárez', esQuienEscribe: false },
  { id: 'st-edgar', nombre: 'Edgar Alba', esQuienEscribe: false },
  { id: 'st-tati', nombre: 'Tatiana Ríos', esQuienEscribe: true },
]
const OPCIONES = EQUIPO.map((m) => ({ titulo: m.nombre }))
const estadoDe = (p: PedidoModelo) => String(p.mensajes[0].parts[0].text ?? '')
const ultimaRespuesta = (p: PedidoModelo) => JSON.stringify(p.mensajes.at(-1)?.parts.map((x) => x.functionResponse?.response) ?? [])

describe('viaje nuevo: el bot pregunta quién lo lleva', () => {
  it('sin responsable no hay propuesta: el modelo pregunta con la lista, elige por el toque y el viaje nace con esa persona', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: REF, destino: 'San Andrés' } } },
      (p) => {
        // El candado le llegó al modelo con las opciones del equipo.
        expect(ultimaRespuesta(p)).toContain('Falta quién lleva este viaje')
        expect(ultimaRespuesta(p)).toContain('Alejandra Pinto · Daniela Suárez · Edgar Alba · Tatiana Ríos')
        return { name: 'responder', args: { tema: 'solicitud', texto: '¿Quién lleva este viaje?', opciones: OPCIONES } }
      },
      // El toque de la lista vuelve al modelo como texto; él nombra a la persona.
      (p) => {
        expect(JSON.stringify(p.mensajes)).toContain('[toque: Edgar Alba]')
        return { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: REF, destino: 'San Andrés', responsable: 'Edgar Alba' } } }
      },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: [], equipo: EQUIPO, remitente: { nombre: 'Tatiana', rol: 'operator' } })

    const t1 = await e.escribe('Abre un viaje nuevo de Martín Mora a San Andrés')
    // Cuatro personas: va como lista; ninguna propuesta quedó pendiente.
    expect(t1[0].tipo).toBe('lista')
    expect('opciones' in t1[0] && t1[0].opciones.map((o) => o.titulo)).toEqual(EQUIPO.map((m) => m.nombre))
    expect(propuestaVigente(e.almacen.filas)).toBeNull()
    expect(e.almacen.trazas().at(-1)!.candados?.map((c) => c.candado)).toContain('falta_responsable')

    const t2 = await e.toca('Edgar Alba')
    expect(t2[0].texto).toBe(`¿Abro este viaje?\n${REF} · San Andrés · Viaje a medida\nLo lleva: Edgar Alba`)
    expect(e.puerto.escrituras).toEqual([])

    const t3 = await e.toca('Sí, ábrelo')
    expect(t3[0].texto).toContain('para Martin Mora. Lo lleva Edgar Alba.')
    expect(e.puerto.escrituras).toEqual([{ tipo: 'viaje', codigo: 'M1 26 1', contactoId: 'c-martin', destino: 'San Andrés', responsableId: 'st-edgar' }])
    expect(modelo.restantes()).toBe(0)
  })

  it('«la llevo yo»: el modelo nombra a quien escribe y el viaje dice «Lo llevas tú»', async () => {
    const modelo = modeloGuionado([
      (p) => {
        expect(estadoDe(p)).toContain('Equipo comercial (quién puede llevar un viaje nuevo): Alejandra Pinto · Daniela Suárez · Edgar Alba · Tatiana Ríos.')
        expect(estadoDe(p)).toContain('Quien te escribe es Tatiana Ríos.')
        return { name: 'buscar', args: { texto: 'Martín Mora' } }
      },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: REF, responsable: 'Tatiana Ríos' } } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: [], equipo: EQUIPO })
    await e.escribe('Viaje nuevo para Martín Mora, la llevo yo')
    const t = await e.toca('Sí, ábrelo')
    expect(t[0].texto).toContain('Lo llevas tú.')
    expect(e.puerto.escrituras[0]).toMatchObject({ tipo: 'viaje', responsableId: 'st-tati' })
  })

  it('alguien que no está en el equipo: candado, sin propuesta, y el modelo vuelve a preguntar', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: REF, responsable: 'Rodrigo Pérez' } } },
      (p) => {
        expect(ultimaRespuesta(p)).toContain('«Rodrigo Pérez» no está en el equipo comercial')
        return { name: 'responder', args: { tema: 'solicitud', texto: 'Rodrigo no está en el equipo comercial. ¿Quién lleva este viaje?', opciones: OPCIONES } }
      },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: [], equipo: EQUIPO })
    await e.escribe('Viaje nuevo para Martín Mora, lo lleva Rodrigo')
    expect(propuestaVigente(e.almacen.filas)).toBeNull()
    expect(e.almacen.trazas().at(-1)!.candados?.map((c) => c.candado)).toContain('responsable_fuera_del_equipo')
    expect(e.puerto.escrituras).toEqual([])
  })

  it('la comercial ignora la pregunta: el viaje no se crea y el estado dice que la pregunta sigue pendiente', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: REF } } },
      { name: 'responder', args: { tema: 'solicitud', texto: '¿Quién lleva este viaje?', opciones: OPCIONES } },
      (p) => {
        expect(estadoDe(p)).toContain('Pendiente: preguntaste quién lleva el viaje nuevo y no lo han elegido.')
        return { name: 'responder', args: { tema: 'solicitud', texto: 'Hoy es jueves. ¿Quién lleva el viaje de Martín Mora?', opciones: OPCIONES } }
      },
      (p) => {
        // Elegido y propuesto: la pregunta ya no está pendiente.
        expect(estadoDe(p)).toContain('Pendiente: preguntaste quién lleva')
        return { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: REF, responsable: 'Daniela Suárez' } } }
      },
      (p) => {
        expect(estadoDe(p)).not.toContain('Pendiente: preguntaste quién lleva')
        return { name: 'responder', args: { tema: 'solicitud', texto: 'Quedo atento.' } }
      },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: [], equipo: EQUIPO })
    await e.escribe('Viaje nuevo para Martín Mora')
    await e.escribe('¿qué día es hoy?')
    expect(e.puerto.escrituras).toEqual([])
    expect(responsablePendiente(e.almacen.filas)).toBe(true)
    await e.escribe('Dani')
    expect(responsablePendiente(e.almacen.filas)).toBe(false)
    await e.escribe('gracias')
    expect(e.puerto.escrituras).toEqual([])
    expect(modelo.restantes()).toBe(0)
  })

  it('si la persona sale del equipo entre la propuesta y el toque, no se abre nada', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: REF, responsable: 'Edgar Alba' } } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: [], equipo: EQUIPO })
    await e.escribe('Viaje nuevo para Martín Mora, que lo lleve Edgar')
    e.puerto.equipo = EQUIPO.filter((m) => m.id !== 'st-edgar')
    await e.toca('Sí, ábrelo')
    expect(e.puerto.escrituras).toEqual([])
    expect(e.almacen.trazas().at(-1)!.ejecucion?.resultado).toBe('error')
  })

  it('sin equipo comercial, o sin poder leerlo, no se abre el viaje', async () => {
    for (const equipo of [[] as MiembroEquipo[], 'error' as const]) {
      const modelo = modeloGuionado([
        { name: 'buscar', args: { texto: 'Martín Mora' } },
        { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: REF, responsable: 'Edgar Alba' } } },
        { name: 'responder', args: { tema: 'solicitud', texto: 'No puedo abrirlo todavía.' } },
      ])
      const e = await escenario({ modelo, contactos: [MARTIN], viajes: [] })
      e.puerto.equipo = equipo
      await e.escribe('Viaje nuevo para Martín Mora, lo lleva Edgar')
      expect(propuestaVigente(e.almacen.filas)).toBeNull()
      expect(e.almacen.trazas().at(-1)!.candados?.map((c) => c.candado)).toContain(equipo === 'error' ? 'lectura_fallida' : 'sin_equipo_comercial')
    }
  })
})

describe('resolverResponsable: solo comprueba a quién nombró el modelo', () => {
  it('por id, por nombre exacto sin tildes ni mayúsculas, o con una aclaración entre paréntesis', () => {
    expect(resolverResponsable(EQUIPO, 'st-dani')).toMatchObject({ id: 'st-dani' })
    expect(resolverResponsable(EQUIPO, 'daniela suarez')).toMatchObject({ id: 'st-dani' })
    expect(resolverResponsable(EQUIPO, 'Tatiana Ríos (quien escribe)')).toMatchObject({ id: 'st-tati' })
  })

  it('no adivina: un apodo, un nombre a medias o alguien de fuera no resuelven (eso lo interpreta el modelo)', () => {
    expect(resolverResponsable(EQUIPO, 'Ale')).toBeNull()
    expect(resolverResponsable(EQUIPO, 'Daniela')).toBeNull()
    expect(resolverResponsable(EQUIPO, 'Rodrigo Pérez')).toBeNull()
    expect(resolverResponsable(EQUIPO, '')).toBeNull()
  })

  it('dos personas con el mismo nombre: «varias», el modelo tiene que preguntar', () => {
    const dobles = [...EQUIPO, { id: 'st-dani2', nombre: 'Daniela Suárez', esQuienEscribe: false }]
    expect(resolverResponsable(dobles, 'Daniela Suárez')).toBe('varias')
    expect(resolverResponsable(dobles, 'st-dani2')).toMatchObject({ id: 'st-dani2' })
  })
})

describe('equipoDesdeFilas: staff activo con área comercial, sin el de prueba', () => {
  const filas = [
    { id: 'st-edgar', full_name: 'Edgar Alba', is_active: true, areas: ['comercial'] },
    { id: 'st-tati', full_name: 'Tatiana Ríos', is_active: true, areas: ['comercial', 'operaciones'] },
    { id: 'st-ops', full_name: 'Olga Operaciones', is_active: true, areas: ['operaciones'] },
    { id: 'st-ida', full_name: 'Ida Inactiva', is_active: false, areas: ['comercial'] },
    { id: 'st-sin', full_name: 'Sin Área', is_active: true, areas: [] },
    { id: 'st-cp', full_name: 'PRUEBA · Comercial', is_active: true, areas: ['comercial'] },
  ]

  it('deja solo a los comerciales activos, ordenados, y marca a quien escribe', () => {
    expect(equipoDesdeFilas(filas, ['st-cp'], 'st-tati')).toEqual([
      { id: 'st-edgar', nombre: 'Edgar Alba', esQuienEscribe: false },
      { id: 'st-tati', nombre: 'Tatiana Ríos', esQuienEscribe: true },
    ])
  })

  it('el staff de prueba no le sale a las comerciales; sí a quien escribe desde una cuenta de prueba', () => {
    expect(equipoDesdeFilas(filas, ['st-cp'], 'st-edgar').map((m) => m.id)).not.toContain('st-cp')
    expect(equipoDesdeFilas(filas, ['st-cp'], 'st-cp').map((m) => m.id)).toEqual(['st-edgar', 'st-cp', 'st-tati'])
    // Sin la marca en la config, sale como cualquiera (por eso hay que declararla).
    expect(equipoDesdeFilas(filas, [], 'st-edgar').map((m) => m.id)).toContain('st-cp')
  })

  it('quien escribe sin área comercial no queda en la lista', () => {
    expect(equipoDesdeFilas(filas, [], 'st-ops').some((m) => m.esQuienEscribe)).toBe(false)
  })

  it('staffDePrueba solo acepta una lista de ids', () => {
    expect(staffDePrueba({ staff_de_prueba: ['a', '', 3, 'b'] })).toEqual(['a', 'b'])
    expect(staffDePrueba({ staff_de_prueba: 'a' })).toEqual([])
    expect(staffDePrueba(null)).toEqual([])
  })
})
