import { describe, expect, it } from 'vitest'
import { componerDominio, fichasDelTurno, textoFueraDeTema } from './componer'
import { CATALOGO, catalogoDe } from './funciones/catalogo'
import { FUNCIONES_COMUNES } from './funciones/comunes'
import type { Funcion } from './funciones/tipos'
import { declaraciones } from './herramientas'
import { dominioOne, permisosDe } from './one/dominio'
import { FUNCIONES_POR_CARGO, componerOne, funcionesDelCargo, permisosDeFunciones, reglamentoOneDelTurno } from './one/cargos'
import { PuertoOneMemoria } from './one/puerto-memoria'
import { fichasOne, reglamentoOne } from './one/reglamento'
import { escenarioOne } from './one/escenario'
import { modeloGuionado } from './modelo-guionado'
import { dominioPublico } from './publico/dominio'
import { reglamentoSabor } from './publico/escenario'
import type { ContextoDominio, Dominio, Propuesta } from './tipos'

/**
 * La prueba de permisos del componedor (spec 2026-10-26, §2.6 punto 5): para cada cargo de ONE y para un rol de prueba
 * de cada canal, las herramientas declaradas son EXACTAMENTE las esperadas; una ajena no existe; una herramienta nueva
 * sin dueño o con dos hace fallar la prueba. Datos inventados.
 */

const NEGOCIOS = [
  { id: 'n-a', codigo: 'A1 26 1', nombre: 'Obra de prueba', empresa: 'Alfa Pruebas', contacto: null, etapa: 'ejecucion', valor: 2_500_000 },
]
const ctx: ContextoDominio = { workspaceId: 'w', phone: 'p', remitente: { nombre: 'x', rol: 'owner' }, conversacion: [], resultadosPrevios: [] }
const motorOne = (funciones?: string[], rol = 'owner') => dominioOne(new PuertoOneMemoria({ negocios: NEGOCIOS }), { rol, ...(funciones ? { funciones } : {}) })

/** Lo que ve el modelo: los nombres de las herramientas declaradas (núcleo incluido) y las acciones de `proponer`. */
async function loQueVe(cargo: string) {
  const c = componerOne(motorOne(funcionesDelCargo(cargo), cargo), funcionesDelCargo(cargo), () => {})
  const r = await reglamentoOneDelTurno(await reglamentoOne('Empresa de Prueba'), c)
  const decl = declaraciones(c.dominio, r)
  const proponer = decl.find((d) => d.name === 'proponer')
  return {
    herramientas: decl.map((d) => d.name),
    acciones: proponer ? ((proponer.parameters as { properties: { accion: { enum: string[] } } }).properties.accion.enum) : [],
  }
}

const LECTURAS_NEGOCIO = ['buscar_negocios', 'negocios_abiertos', 'ver_negocio']
const TODAS_ACCIONES = ['gasto', 'adjuntar_soporte', 'corregir_gasto', 'ingreso', 'actividad', 'contacto_nuevo']

describe('el dominio ONE por cargo: herramientas exactas', () => {
  const esperado: Record<string, { herramientas: string[]; acciones: string[] }> = {
    owner: { herramientas: [...LECTURAS_NEGOCIO, 'gastos_recientes', 'preguntar_destino', 'proponer', 'responder'], acciones: TODAS_ACCIONES },
    admin: { herramientas: [...LECTURAS_NEGOCIO, 'gastos_recientes', 'preguntar_destino', 'proponer', 'responder'], acciones: TODAS_ACCIONES },
    supervisor: { herramientas: [...LECTURAS_NEGOCIO, 'preguntar_destino', 'proponer', 'responder'], acciones: ['gasto', 'adjuntar_soporte', 'corregir_gasto', 'ingreso', 'actividad'] },
    operator: { herramientas: [...LECTURAS_NEGOCIO, 'preguntar_destino', 'proponer', 'responder'], acciones: ['gasto', 'adjuntar_soporte', 'corregir_gasto', 'actividad'] },
    contador: { herramientas: [...LECTURAS_NEGOCIO, 'gastos_recientes', 'preguntar_destino', 'responder'], acciones: [] },
    read_only: { herramientas: ['gastos_recientes', 'responder'], acciones: [] },
    desconocido: { herramientas: ['responder'], acciones: [] },
  }
  for (const [cargo, e] of Object.entries(esperado)) {
    it(`${cargo}: ${e.herramientas.join(', ')}${e.acciones.length ? ` · acciones ${e.acciones.join(', ')}` : ''}`, async () => {
      expect(await loQueVe(cargo)).toEqual(e)
    })
  }

  it('antes del componedor, todos los cargos veían todo (el dominio entero): el dueño sigue viendo exactamente eso', async () => {
    const entero = declaraciones(motorOne(), await reglamentoOne('Empresa de Prueba'))
    expect(entero.map((d) => d.name)).toEqual((await loQueVe('owner')).herramientas)
  })

  it('el mapa reproduce permisosDe en los seis cargos y en uno desconocido (incluido ver plata)', () => {
    for (const cargo of ['owner', 'admin', 'supervisor', 'operator', 'contador', 'read_only', 'raro']) {
      expect([cargo, permisosDeFunciones(funcionesDelCargo(cargo))]).toEqual([cargo, permisosDe(cargo)])
    }
    expect(Object.keys(FUNCIONES_POR_CARGO).sort()).toEqual(['admin', 'contador', 'operator', 'owner', 'read_only', 'supervisor'])
  })

  it('el dueño lee el mismo reglamento de siempre (salvo la respuesta fija de fuera de tema, que no va al modelo)', async () => {
    const base = await reglamentoOne('Empresa de Prueba')
    const c = componerOne(motorOne(funcionesDelCargo('owner')), funcionesDelCargo('owner'))
    const r = await reglamentoOneDelTurno(base, c)
    const sinRf = (fs: typeof base.fichas) => fs.filter((f) => f.clave !== 'rf.fuera_de_tema')
    expect(sinRf(r.fichas)).toEqual(sinRf(base.fichas))
    expect(r.fichas.find((f) => f.clave === 'rf.fuera_de_tema')!.hacer).toBe(
      'Eso no lo manejo por aquí. Te ayudo a registrar gastos con su soporte (foto o PDF), registrar pagos recibidos de cuotas, anotar actividades en tus negocios, crear contactos, consultar tus negocios y consultar tus gastos.')
  })

  it('un operador no lee las reglas de lo que no tiene (ingresos, contactos, consulta de gastos) y su ayuda dice solo lo suyo', async () => {
    const c = componerOne(motorOne(funcionesDelCargo('operator'), 'operator'), funcionesDelCargo('operator'))
    const r = await reglamentoOneDelTurno(await reglamentoOne('Empresa de Prueba'), c)
    const claves = r.fichas.map((f) => f.clave)
    for (const k of ['g.ingreso', 'g.contacto']) expect(claves).not.toContain(k)
    for (const k of ['g.actividad', 'p.gasto', 'g.consultas', 'inv.confirmar']) expect(claves).toContain(k)
    expect(r.fichas.find((f) => f.clave === 'alc.temas')!.valores!.temas).toEqual(['gasto', 'actividad', 'negocios', 'ayuda', 'conversacion'])
    expect(r.fichas.find((f) => f.clave === 'g.ayuda')!.hacer).toContain('registrar gastos con su soporte (foto o PDF), anotar actividades en tus negocios y consultar tus negocios')
    expect(r.fichas.find((f) => f.clave === 'g.ayuda')!.hacer).not.toContain('contactos')
    expect(r.huella).not.toBe((await reglamentoOne('Empresa de Prueba')).huella)
  })

  it('solo lectura no recibe fichas de registrar ni la de preguntar el destino', async () => {
    const c = componerOne(motorOne(funcionesDelCargo('read_only'), 'read_only'), funcionesDelCargo('read_only'))
    const claves = (await reglamentoOneDelTurno(await reglamentoOne('x'), c)).fichas.map((f) => f.clave)
    for (const k of ['p.gasto', 'g.elegir_destino', 'g.actividad', 'g.buscar_negocio', 'g.categoria']) expect(claves).not.toContain(k)
    expect(claves).toContain('g.consultas')
  })
})

describe('una herramienta ajena no existe y no se ejecuta', () => {
  it('leer, proponer y cerrar devuelven que no existe; ejecutar lanza (segunda llave)', async () => {
    const c = componerOne(motorOne(funcionesDelCargo('operator'), 'operator'), funcionesDelCargo('operator'))
    expect(await c.dominio.leer('gastos_recientes', {}, ctx)).toMatchObject({ ok: false, error: 'No existe la herramienta «gastos_recientes».' })
    expect(await c.dominio.proponer('ingreso', {}, ctx)).toMatchObject({ ok: false, candado: 'accion_desconocida' })
    const p: Propuesta = { accion: 'contacto_nuevo', datos: { nombre: 'X' }, resumen: 'x', si: 'Crear', no: 'No' }
    await expect(c.dominio.ejecutar(p, ctx)).rejects.toThrow(/no es de ninguna función de este rol/)
    const solo = componerOne(motorOne(funcionesDelCargo('read_only'), 'read_only'), funcionesDelCargo('read_only'))
    expect(solo.dominio.cerrar).toBeUndefined()
  })

  it('por el núcleo: un operador que llama `gastos_recientes` recibe «No existe la herramienta» y nada se lee', async () => {
    const e = await escenarioOne({
      modelo: modeloGuionado([
        { name: 'gastos_recientes', args: { dias: 1 } },
        { name: 'responder', args: { tema: 'gasto', texto: 'No puedo consultar gastos por aquí.' } },
      ]),
      negocios: NEGOCIOS, rol: 'operator',
    })
    await e.escribe('cuánto gasté hoy')
    const h = e.trazas().at(-1)!.herramientas!.find((x) => x.nombre === 'gastos_recientes')!
    expect(h.ok).toBe(false)
    expect(h.error).toContain('No existe la herramienta «gastos_recientes»')
  })

  it('un contador no tiene `proponer`: si el modelo lo llama igual, el núcleo lo ataja y no se escribe nada', async () => {
    const e = await escenarioOne({
      modelo: modeloGuionado([
        { name: 'proponer', args: { accion: 'gasto', datos: { monto: 1000, negocio: 'A1 26 1', categoria: 'otros' } } },
        { name: 'responder', args: { tema: 'gasto', texto: 'Tu rol no registra gastos por aquí.' } },
      ]),
      negocios: NEGOCIOS, rol: 'contador',
    })
    await e.escribe('gasté 1000 en la obra')
    expect(e.trazas().at(-1)!.candados!.map((x) => x.candado)).toEqual(['accion_desconocida'])
    expect(e.puerto.escrituras).toEqual([])
  })
})

describe('el catálogo cubre cada herramienta de cada motor una sola vez', () => {
  // Si alguien agrega una herramienta a un motor sin dársela a una función (o se la da a dos), esto falla: lo que no
  // tiene dueño no lo ve ningún rol, y lo que tiene dos se asignaría sin querer.
  it('motor one: toda lectura, acción y cierre tiene exactamente una función dueña', () => {
    const todas = Object.keys(CATALOGO).filter((k) => !CATALOGO[k].comun)
    const c = componerOne(motorOne(), todas, () => {})
    expect(c.errores).toEqual([])
    const m = motorOne()
    const delMotor = [...m.lecturas.map((x) => x.name), ...m.acciones, ...(m.cierres ?? []).map((x) => x.name)]
    expect(Object.keys(c.duenas).sort()).toEqual([...delMotor].sort())
  })

  it('motor publico: las comunes ponen `pasar_a_persona`; el resto lo reparte la sesión de Sabor (clientes.*)', async () => {
    const base = dominioPublico({ reglamento: await reglamentoSabor(), ahoraMs: () => Date.parse('2026-10-26T15:00:00Z'), vars: {} })
    const c = componerDominio({ motores: { publico: base }, funciones: [], log: () => {} })
    expect(c.declaradas).toEqual({ lecturas: [], cierres: ['pasar_a_persona'], acciones: [] })
  })

  it('una herramienta nueva en un motor sin dueño la detecta la prueba', () => {
    const m = motorOne()
    const conNueva: Dominio = { ...m, lecturas: [...m.lecturas, { name: 'nueva_lectura', description: 'x', parameters: { type: 'object', properties: {} } }] }
    const todas = Object.keys(CATALOGO).filter((k) => !CATALOGO[k].comun)
    const c = componerOne(conNueva, todas, () => {})
    const delMotor = [...conNueva.lecturas.map((x) => x.name), ...conNueva.acciones, ...(conNueva.cierres ?? []).map((x) => x.name)]
    expect(delMotor.filter((n) => !c.duenas[n])).toEqual(['nueva_lectura'])
  })

  it('una función que reclama una herramienta que el motor no declara, o una ya tomada, queda en `errores`', () => {
    const cat = catalogoDe([...FUNCIONES_COMUNES, ...Object.values(CATALOGO).filter((f) => !f.comun),
      { clave: 'equipo.fantasma', familia: 'equipo', queHace: 'x', herramientas: { one: { lecturas: ['no_existe', 'buscar_negocios'] } }, candados: [], fichas: [] } satisfies Funcion])
    const c = componerDominio({ motores: { one: motorOne() }, funciones: ['equipo.consulta_negocio', 'equipo.fantasma'], catalogo: cat, log: () => {} })
    expect(c.errores).toEqual([
      'equipo.fantasma: el motor one no declara lectura «no_existe»',
      '«buscar_negocios» es de equipo.consulta_negocio y de equipo.fantasma',
    ])
  })

  it('el catálogo rechaza claves mal formadas, repetidas o una común fuera de su familia', () => {
    const f: Funcion = { clave: 'equipo.x', familia: 'equipo', queHace: '', herramientas: {}, candados: [], fichas: [] }
    expect(() => catalogoDe([{ ...f, clave: 'Equipo.X' }])).toThrow(/mal formada/)
    expect(() => catalogoDe([f, f])).toThrow(/repetida/)
    expect(() => catalogoDe([{ ...f, comun: true }])).toThrow(/común/)
  })
})

describe('las reglas de composición', () => {
  it('una clave desconocida, sin motor o sin lo que requiere queda fuera y en el log; nunca abre nada', () => {
    const log: string[] = []
    const c = componerOne(motorOne(['equipo.gastos', 'recolector.llegada_obra', 'clientes.nada']), ['equipo.gastos', 'recolector.llegada_obra', 'clientes.nada'], (m) => log.push(m))
    expect(c.descartadas).toEqual([
      { clave: 'recolector.llegada_obra', motivo: 'no está en el catálogo del código' },
      { clave: 'clientes.nada', motivo: 'no está en el catálogo del código' },
      { clave: 'equipo.gastos', motivo: 'requiere equipo.consulta_negocio' },
    ])
    expect(c.declaradas).toEqual({ lecturas: [], cierres: [], acciones: [] })
    expect(log).toHaveLength(3)
  })

  it('un rol de prueba de wa_one (gastos con su consulta) declara solo eso', async () => {
    const funciones = [{ funcion: 'equipo.gastos', parametros: { rubros: true } }, { funcion: 'equipo.consulta_negocio', parametros: {} }]
    const c = componerOne(motorOne(['equipo.gastos', 'equipo.consulta_negocio']), funciones)
    expect(c.declaradas).toEqual({ lecturas: LECTURAS_NEGOCIO, cierres: ['preguntar_destino'], acciones: ['gasto', 'adjuntar_soporte', 'corregir_gasto'] })
    expect(c.parametros['equipo.gastos']).toEqual({ rubros: true })
    // Los `datos` de proponer: solo los de sus acciones (sin cuota, parcial, tipo, nombre…).
    expect(Object.keys(c.dominio.datosProponer).sort()).toEqual(['categoria', 'descripcion', 'empresa', 'empresa_dicho_en', 'fecha', 'gasto', 'monto', 'monto_distinto', 'negocio', 'soporte'])
  })

  it('el fuera de tema lo arma el código con lo que el rol hace', () => {
    const c = componerOne(motorOne(funcionesDelCargo('read_only'), 'read_only'), funcionesDelCargo('read_only'))
    expect(textoFueraDeTema(c)).toBe('Eso no lo manejo por aquí. Te ayudo a consultar tus gastos.')
    const nada = componerOne(motorOne([]), [])
    expect(textoFueraDeTema(nada)).toBe('Eso no lo manejo por aquí.')
  })

  it('las fichas de otro motor no se tocan aunque se llamen como las de ONE', async () => {
    const sabor = await reglamentoSabor()
    const base = dominioPublico({ reglamento: sabor, ahoraMs: () => Date.parse('2026-10-26T15:00:00Z'), vars: {} })
    const c = componerDominio({ motores: { publico: base }, funciones: [], log: () => {} })
    const conGloSoporte = [...sabor.fichas, { clave: 'glo.soporte', tipo: 'glosario' as const, carga: 'siempre' as const, hacer: 'de Sabor' }]
    expect(fichasDelTurno(conGloSoporte, c).map((f) => f.clave)).toEqual(conGloSoporte.map((f) => f.clave))
  })

  it('fichasOne: toda ficha que una función dice tener existe en el reglamento de ONE', () => {
    const claves = new Set(fichasOne('x').map((f) => f.clave))
    for (const f of Object.values(CATALOGO)) for (const k of f.fichas) expect([f.clave, claves.has(k)]).toEqual([f.clave, true])
  })
})
