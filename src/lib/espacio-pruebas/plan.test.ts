import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LLAVES, ORIGEN, casoDeC0, crearAlmacenDoble, esquemaDelDoble } from '../../../test/espacio-pruebas-doble'
import type { Fila } from './almacen'
import { clasificarTabla, TABLAS_QUE_SE_COPIAN } from './clasificacion'
import { pareceDatoPersonal, remapear, sinLlaves } from './jsonb'
import { contarPorTabla, crearUsuarios, deshacer, ejecutar, planificar, purgar, type OpcionesPlan, type Plan } from './plan'
import { SEMILLAS } from './semillas'

const CORREO = 'persona@metrik.example'
const caso = casoDeC0()

function opciones(extra: Partial<OpcionesPlan> = {}): OpcionesPlan {
  let n = 0
  return {
    origen: 'trappvel',
    destino: 'trappvel-pruebas',
    nombre: 'Viajes Prueba',
    correoBase: CORREO,
    incluirClaves: [],
    hoy: '2026-10-13',
    nuevoId: () => `bbbbbbbb-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    caso,
    ...extra,
  }
}

const filasDe = (plan: Plan, tabla: string): Fila[] =>
  plan.pasos.flatMap(p => (p.tipo === 'insertar' && p.tabla === tabla ? p.filas : p.tipo === 'guardar' && p.tabla === tabla ? [p.fila] : []))

async function aplicar(a: ReturnType<typeof crearAlmacenDoble>, extra: Partial<OpcionesPlan> = {}) {
  await crearUsuarios(a, CORREO, 'trappvel-pruebas')
  const plan = await planificar(a, opciones(extra))
  await ejecutar(a, plan)
  return plan
}

describe('clasificación de tablas', () => {
  it('la lista de copia manda y lo desconocido queda sin clasificar', () => {
    expect(clasificarTabla('bloque_configs').accion).toBe('copia')
    expect(clasificarTabla('cotizaciones').accion).toBe('excluye')
    expect(clasificarTabla('cotizacion_itinerarios').accion).toBe('excluye')
    expect(clasificarTabla('wa_bandeja_conversacion').accion).toBe('excluye')
    expect(clasificarTabla('backup_lo_que_sea_20260101').accion).toBe('excluye')
    expect(clasificarTabla('tabla_que_nadie_vio').accion).toBe('sin_clasificar')
    for (const r of TABLAS_QUE_SE_COPIAN) expect(clasificarTabla(r.patron).accion).toBe('copia')
  })
})

describe('jsonb', () => {
  it('quita credenciales a cualquier profundidad y dice dónde', () => {
    const r = sinLlaves({ a: { siigo: { x: 1 }, b: [{ api_key: 'z', c: 1 }] }, drive_folder_id: 'q' }, /(siigo|api_?key|drive)/i, 'cfg')
    expect(r.valor).toEqual({ a: { b: [{ c: 1 }] } })
    expect(r.quitadas.sort()).toEqual(['cfg.a.b[0].api_key', 'cfg.a.siigo', 'cfg.drive_folder_id'])
  })
  it('remapea ids en columnas y dentro de jsonb', () => {
    const m = new Map([['aaaaaaaa-0000-4000-8000-000000000004', 'nuevo']])
    expect(remapear({ x: ['AAAAAAAA-0000-4000-8000-000000000004'], y: 'otro' }, m)).toEqual({ x: ['nuevo'], y: 'otro' })
  })
  it('señala correos y teléfonos sin imprimirlos', () => {
    expect(pareceDatoPersonal({ a: 'x@y.co', b: { c: '+57 300 000 0000' }, d: 'nada' }, 'r')).toEqual([
      { ruta: 'r.a', tipo: 'correo' }, { ruta: 'r.b.c', tipo: 'telefono' },
    ])
  })
})

describe('plan del espacio de pruebas (simulacro sobre el doble)', () => {
  it('crea el workspace marcado, con el interruptor encendido y sin canales ni almacenamiento propio', async () => {
    const plan = await planificar(crearAlmacenDoble(), opciones())
    const [ws] = filasDe(plan, 'workspaces')
    const cfg = ws.config_extra as Record<string, unknown>
    expect(ws).toMatchObject({ slug: 'trappvel-pruebas', name: 'Viajes Prueba', cotizacion_template_slug: 'trappvel', subscription_status: 'trial' })
    expect(cfg).toMatchObject({ espacio_de_pruebas: true, clon_de: 'trappvel', grupo: 'demo', cotizacion_por_pasos: { activo: true } })
    for (const k of ['storage_provider', 'storage_supabase_url', 'wa_customer_bot', 'siigo', 'bandeja_solicitudes', 'llave_nueva_sin_clasificar']) {
      expect(cfg).not.toHaveProperty(k)
    }
    expect(cfg.iva_cotizacion).toEqual({ base: 'ingreso_propio', precio: 'iva_incluido' })
    expect(ws.modules).toEqual({ business: true, pausa_enabled: true })
    expect(ws).not.toHaveProperty('logo_url')
    expect(ws).not.toHaveProperty('drive_folder_id')
    expect(plan.informe.clavesDescartadas.map(c => c.clave)).toContain('llave_nueva_sin_clasificar')
    // Lo que no se sabe si es inocuo se agrega a mano, tras revisar el simulacro.
    const conClave = await planificar(crearAlmacenDoble(), opciones({ incluirClaves: ['llave_nueva_sin_clasificar'] }))
    expect(filasDe(conClave, 'workspaces')[0].config_extra).toHaveProperty('llave_nueva_sin_clasificar')
  })

  it('no queda ni un id de la cliente en lo que se escribe', async () => {
    const plan = await planificar(crearAlmacenDoble(), opciones())
    const texto = JSON.stringify(plan.pasos)
    for (const [nombre, id] of Object.entries(ORIGEN)) {
      if (nombre === 'defDatos' || nombre === 'defCotizacion') continue // catálogo global de bloques
      expect(texto, nombre).not.toContain(id)
    }
  })

  it('copia la línea activa con su config, sin carpetas ni Siigo, y con el aprobador cambiado por la dueña de prueba', async () => {
    const plan = await planificar(crearAlmacenDoble(), opciones())
    const lineas = filasDe(plan, 'lineas_negocio')
    expect(lineas.map(l => l.nombre)).toEqual(['Viaje a medida'])
    const [l] = lineas
    expect(l.drive_folder_id).toBeNull()
    const cfg = l.config_extra as Record<string, unknown>
    expect(cfg).not.toHaveProperty('siigo')
    expect(cfg).not.toHaveProperty('facturacion')
    expect(cfg).not.toHaveProperty('drive_folder_id')
    expect(cfg.margen).toEqual({ piso_pct: 5, aviso_pct: 10, convencion: 'sobre_venta', default_pct: 15 })
    const dueno = plan.usuarios[0]
    expect(cfg.aprobaciones).toEqual({ staff_ids: [dueno.staffId] })
    expect(filasDe(plan, 'etapas_negocio')).toHaveLength(3)
    expect(filasDe(plan, 'bloque_configs')).toHaveLength(4)
    expect(filasDe(plan, 'bloque_configs').every(b => b.workspace_id === filasDe(plan, 'workspaces')[0].id)).toBe(true)
    expect(filasDe(plan, 'servicios')).toHaveLength(1)
    expect(filasDe(plan, 'servicio_tarifas_versiones')).toHaveLength(0) // inmutable: no se podría borrar
  })

  it('no copia datos ni personas, y dice qué dejó y por qué', async () => {
    const plan = await planificar(crearAlmacenDoble(), opciones())
    const negocios = filasDe(plan, 'negocios')
    expect(negocios.every(n => (n.metadata as Record<string, unknown>).es_prueba === true)).toBe(true)
    expect(filasDe(plan, 'contactos').map(c => c.nombre)).toEqual(['Familia de Prueba'])
    expect(filasDe(plan, 'wa_collaborators')).toHaveLength(0)
    const excluidas = Object.fromEntries(plan.informe.excluidas.map(e => [e.tabla, e.motivo]))
    expect(Object.keys(excluidas).sort()).toEqual([
      'activity_log', 'contactos', 'cotizaciones', 'expense_categories', 'negocios', 'profiles', 'servicio_tarifas_versiones',
      'staff', 'wa_collaborators', 'workspace_stages',
    ])
    expect(plan.informe.sinClasificar).toEqual([{ tabla: 'tabla_sin_clasificar', filas: 1 }])
    const [fiscal] = filasDe(plan, 'fiscal_profiles')
    expect(plan.pasos.find(p => p.tabla === 'fiscal_profiles')).toMatchObject({ tipo: 'guardar', conflicto: 'workspace_id' })
    expect(fiscal).toMatchObject({ nit: '900000001', razon_social: 'AGENCIA DE PRUEBA S.A.S', tax_regime: 'ordinario', iva_responsible: true })
    expect(fiscal).not.toHaveProperty('direccion_fiscal')
    expect(fiscal).not.toHaveProperty('email_facturacion')
    // Lo que parece dato personal en la config copiada se señala para revisar.
    expect(plan.informe.datosPersonales).toEqual(expect.arrayContaining([
      'workspaces.config_extra.documento_viaje.firma.contacto (telefono)',
      'bloque_configs.config_extra.notificar.correo (correo)',
      'lineas_negocio.config_extra.terminos_base (telefono)',
    ]))
  })

  it('da acceso con dos alias: la dueña (autoriza) y la asesora', async () => {
    const plan = await planificar(crearAlmacenDoble(), opciones())
    expect(plan.usuarios.map(u => [u.correo, u.role])).toEqual([
      ['persona+trappvel-pruebas-dueno@metrik.example', 'owner'],
      ['persona+trappvel-pruebas-asesora@metrik.example', 'operator'],
    ])
    expect(filasDe(plan, 'profiles').every(p => p.platform_admin === false)).toBe(true)
  })

  it('siembra el caso fijo con los precios de C0 y un negocio por variante', async () => {
    const plan = await planificar(crearAlmacenDoble(), opciones())
    const negocios = filasDe(plan, 'negocios')
    expect(negocios).toHaveLength(SEMILLAS.length)
    const cotizaciones = filasDe(plan, 'cotizaciones')
    expect(cotizaciones.every(c => c.estado === 'borrador')).toBe(true)
    expect(new Set(cotizaciones.map(c => c.codigo)).size).toBe(SEMILLAS.length)
    const porClave = (clave: string) => {
      const neg = negocios.find(n => (n.metadata as Record<string, unknown>).semilla_pruebas === clave)!
      const cot = cotizaciones.find(c => c.negocio_id === neg.id)!
      return { neg, cot, items: filasDe(plan, 'items').filter(i => i.cotizacion_id === cot.id) }
    }
    const fijo = porClave('caso-fijo')
    expect(fijo.cot).toMatchObject({ valor_total: 22_448_922, costo_total: 19_081_590, fecha_validez: '2026-10-27' })
    expect(fijo.items).toHaveLength(11)
    expect(fijo.items.find(i => i.nombre === 'AVIANCA BOGOTÁ ⇄ SAN ANDRÉS')?.precio_venta).toBe(7_303_877)
    const tarifas = filasDe(plan, 'cotizacion_itinerarios').filter(t => t.cotizacion_id === fijo.cot.id)
    expect(tarifas.map(t => t.nombre)).toEqual(['Económica', 'Recomendada', 'Premium'])
    const opciones_ = filasDe(plan, 'itinerario_opciones').filter(o => tarifas.some(t => t.id === o.itinerario_id))
    expect(opciones_).toHaveLength(9)
    expect(opciones_.every(o => fijo.items.some(i => i.id === o.item_id))).toBe(true)
    expect(porClave('flujo-nuevo').items).toHaveLength(12)
    const cero = porClave('desde-cero')
    expect(cero.items).toHaveLength(0)
    expect(cero.cot).toMatchObject({ valor_total: 0, costo_total: 0, margen_porcentaje: 15 })
    // La etapa 2 de la copia, y los datos del viaje solo en la casilla que los declara.
    const etapas = filasDe(plan, 'etapas_negocio')
    expect(fijo.neg.etapa_actual_id).toBe(etapas.find(e => e.numero === 2)!.id)
    const casillas = filasDe(plan, 'negocio_bloques').filter(b => b.negocio_id === fijo.neg.id)
    expect(casillas).toHaveLength(3)
    const viaje = casillas.find(c => (c.data as Record<string, unknown>).adultos === 6)!
    expect(viaje.data).toEqual({ adultos: 6, ninos: 1, infantes: 1, fecha_salida: '2026-11-23', fecha_regreso: '2026-11-28', destino: 'San Andrés y Providencia', nivel_detalle: 'normal' })
    expect(casillas.find(c => c.id !== viaje.id && c.estado === 'completo')?.data).toEqual({ nombre: 'Familia de Prueba' })
    expect(filasDe(plan, 'negocio_responsables').every(r => r.staff_id === plan.usuarios[1].staffId)).toBe(true)
  })

  it('el simulacro no escribe', async () => {
    const a = crearAlmacenDoble()
    const antes = JSON.stringify(a.estado)
    await planificar(a, opciones())
    expect(JSON.stringify(a.estado)).toBe(antes)
    expect(a.usuarios).toHaveLength(0)
  })
})

/** Las llaves foráneas de los tipos de la base (`Relationships`), tabla → [columna, apunta]. */
function llavesDeLaBase(): { tabla: string; columna: string; apunta: string }[] {
  const src = readFileSync(resolve(process.cwd(), 'src/types/database.ts'), 'utf8')
  const tablas = src.slice(src.indexOf('    Tables: {'), src.indexOf('    Views: {'))
  const partes = tablas.split(/\n {6}(\w+): \{\n {8}Row:/)
  const out: { tabla: string; columna: string; apunta: string }[] = []
  for (let i = 1; i < partes.length; i += 2) {
    const rel = partes[i + 1].slice(partes[i + 1].indexOf('Relationships:'))
    for (const m of rel.matchAll(/columns: \["(\w+)"\]\s*isOneToOne: \w+\s*referencedRelation: "(\w+)"/g)) {
      out.push({ tabla: partes[i], columna: m[1], apunta: m[2] })
    }
  }
  return out
}

describe('el doble hace cumplir las llaves foráneas de la base', () => {
  it('el doble declara todas las llaves de la base entre sus tablas', () => {
    const base = llavesDeLaBase()
    expect(base.length).toBeGreaterThan(100) // el lector de los tipos no se rompió en silencio
    const delDoble = new Set(Object.keys(esquemaDelDoble()))
    const declaradas = new Set(LLAVES.map(l => `${l.tabla}.${l.columna}->${l.apunta}`))
    const faltan = base
      .filter(l => delDoble.has(l.tabla) && delDoble.has(l.apunta))
      .map(l => `${l.tabla}.${l.columna}->${l.apunta}`)
      .filter(k => !declaradas.has(k))
    expect(faltan).toEqual([])
  })

  it('frena una fila que apunta a otra que todavía no existe (como la base)', async () => {
    const a = crearAlmacenDoble()
    await expect(a.insertar('workspaces', [{ id: 'dddddddd-0000-4000-8000-000000000009', slug: 'x', linea_activa_id: 'no-existe' }]))
      .rejects.toThrow(/workspaces_linea_activa_id_fkey/)
    expect(a.estado.workspaces.some(w => w.slug === 'x')).toBe(false)
  })

  it('el workspace nace sin línea activa y la recibe cuando la línea ya existe', async () => {
    const a = crearAlmacenDoble()
    const plan = await aplicar(a)
    const [lineaCopia] = filasDe(plan, 'lineas_negocio')
    expect(filasDe(plan, 'workspaces')[0].linea_activa_id).toBeNull()
    const iInsertaLinea = plan.pasos.findIndex(p => p.tipo === 'insertar' && p.tabla === 'lineas_negocio')
    const iFija = plan.pasos.findIndex(p => p.tipo === 'actualizar' && p.tabla === 'workspaces' && 'linea_activa_id' in p.patch)
    expect(iFija).toBeGreaterThan(iInsertaLinea)
    expect(a.estado.workspaces.find(w => w.id === plan.destino.id)?.linea_activa_id).toBe(lineaCopia.id)
  })

  it('una referencia hacia adelante en las semillas también se difiere (tarifa aceptada)', async () => {
    const a = crearAlmacenDoble()
    await crearUsuarios(a, CORREO, 'trappvel-pruebas')
    // El caso trae la tarifa aceptada: la cotización se inserta antes que sus tarifas.
    const conLaTarifa = (t: Record<string, Fila[]>) => ({
      ...t,
      cotizaciones: t.cotizaciones.map(c => ({ ...c, tarifa_aceptada_id: t.cotizacion_itinerarios[0].id })),
    })
    const conTarifa = await planificar(a, opciones({ caso: {
      ...caso,
      tablas: { 'caso-fijo': conLaTarifa(caso.tablas['caso-fijo']), 'flujo-nuevo': conLaTarifa(caso.tablas['flujo-nuevo']) },
    } }))
    expect(filasDe(conTarifa, 'cotizaciones').every(c => c.tarifa_aceptada_id === null)).toBe(true)
    await ejecutar(a, conTarifa)
    const escrita = a.estado.cotizaciones.filter(c => c.workspace_id === conTarifa.destino.id && c.tarifa_aceptada_id != null)
    expect(escrita.length).toBeGreaterThan(0)
    expect(escrita.every(c => a.estado.cotizacion_itinerarios.some(t => t.id === c.tarifa_aceptada_id && t.cotizacion_id === c.id))).toBe(true)
  })

  it('si una escritura falla a mitad de camino, deshacer no deja nada', async () => {
    const a = crearAlmacenDoble()
    const creados = await crearUsuarios(a, CORREO, 'trappvel-pruebas')
    const plan = await planificar(a, opciones())
    const origen = JSON.stringify(Object.fromEntries(Object.entries(crearAlmacenDoble().estado)))
    // Una etapa que apunta a una línea que no existe: la base la frena después de crear el workspace.
    const etapas = plan.pasos.find(p => p.tipo === 'insertar' && p.tabla === 'etapas_negocio')!
    if (etapas.tipo === 'insertar') etapas.filas[0].linea_id = 'no-existe'
    await expect(ejecutar(a, plan)).rejects.toThrow(/etapas_negocio_linea_id_fkey/)
    const inf = await deshacer(a, { origen: 'trappvel', destino: 'trappvel-pruebas', correoBase: CORREO }, creados)
    expect(inf.residuo).toEqual({})
    expect(inf.workspaceBorrado).toBe(true)
    expect(a.usuarios).toHaveLength(0)
    expect(JSON.stringify(Object.fromEntries(Object.entries(a.estado)))).toBe(origen)
  })
})

describe('aplicar, repetir y borrar (sobre el doble)', () => {
  it('es idempotente: la segunda corrida no escribe nada nuevo', async () => {
    const a = crearAlmacenDoble()
    await aplicar(a)
    const negocios = a.estado.negocios.length
    const segunda = await planificar(a, opciones())
    expect(segunda.destino.existe).toBe(true)
    expect(segunda.pasos).toEqual([])
    expect(segunda.informe.semillas.every(s => s.estado === 'ya existe')).toBe(true)
    await ejecutar(a, segunda)
    expect(a.estado.negocios.length).toBe(negocios)
  })

  it('respeta lo que la base siembra al crear el workspace: un solo perfil fiscal, con el régimen y la identidad inventada', async () => {
    const a = crearAlmacenDoble()
    const plan = await aplicar(a)
    const fiscales = a.estado.fiscal_profiles.filter(f => f.workspace_id === plan.destino.id)
    expect(fiscales).toHaveLength(1)
    expect(fiscales[0]).toMatchObject({ nit: '900000001', tax_regime: 'ordinario', iva_responsible: true })
    expect(a.estado.expense_categories.filter(f => f.workspace_id === plan.destino.id)).toHaveLength(1)
  })

  it('vuelve a encender el interruptor si alguien lo apagó', async () => {
    const a = crearAlmacenDoble()
    const plan = await aplicar(a)
    const ws = a.estado.workspaces.find(w => w.id === plan.destino.id)!
    ws.config_extra = { ...(ws.config_extra as object), cotizacion_por_pasos: { activo: false } }
    const otra = await planificar(a, opciones())
    expect(contarPorTabla(otra.pasos).get('workspaces (actualizar)')).toBe(1)
    await ejecutar(a, otra)
    expect((ws.config_extra as Record<string, unknown>).cotizacion_por_pasos).toEqual({ activo: true })
  })

  it('--borrar no deja rastro y no toca el origen', async () => {
    const a = crearAlmacenDoble()
    const origen = JSON.stringify(Object.fromEntries(Object.entries(crearAlmacenDoble().estado)))
    const plan = await aplicar(a)
    // Lo que hace la prueba después: un archivo subido y una fila de actividad del espacio.
    a.objetos.push({ bucket: 've-documentos', ruta: `${plan.destino.id}/confirmaciones/x.pdf` })
    a.estado.activity_log.push({ id: 'cccccccc-0000-4000-8000-000000000001', workspace_id: plan.destino.id })
    const inf = await purgar(a, { origen: 'trappvel', destino: 'trappvel-pruebas', correoBase: CORREO })
    expect(inf.residuo).toEqual({})
    expect(inf.errores).toEqual({})
    expect(inf.workspaceBorrado).toBe(true)
    expect(inf.usuariosBorrados).toHaveLength(2)
    expect(inf.archivosBorrados).toBe(1)
    expect(a.usuarios).toHaveLength(0)
    expect(JSON.stringify(a.estado)).not.toContain(plan.destino.id)
    // Ni el rastro que deja el trigger al borrar las etapas copiadas.
    const lineasCopia = filasDe(plan, 'lineas_negocio').map(l => l.id)
    expect(a.estado.etapas_nombres_anteriores.filter(n => lineasCopia.includes(n.linea_id))).toEqual([])
    expect(JSON.stringify(Object.fromEntries(Object.entries(a.estado)))).toBe(origen)
  })

  it('--resembrar borra solo los negocios sembrados y los vuelve a crear', async () => {
    const a = crearAlmacenDoble()
    await aplicar(a)
    const lineas = a.estado.lineas_negocio.length
    const inf = await purgar(a, { origen: 'trappvel', destino: 'trappvel-pruebas', correoBase: CORREO, soloSemillas: true })
    expect(inf.residuo).toEqual({})
    expect(a.estado.negocios.filter(n => n.workspace_id !== ORIGEN.ws)).toHaveLength(0)
    expect(a.estado.lineas_negocio.length).toBe(lineas)
    const otra = await planificar(a, opciones())
    expect(otra.informe.semillas.every(s => s.estado === 'nueva')).toBe(true)
    expect(filasDe(otra, 'contactos')).toHaveLength(0) // el contacto inventado se reusa
    await ejecutar(a, otra)
    expect(a.estado.negocios.filter(n => n.workspace_id !== ORIGEN.ws)).toHaveLength(SEMILLAS.length)
  })
})

describe('guardas', () => {
  it('nunca escribe sobre el origen ni sobre un workspace que no nació de aquí', async () => {
    await expect(planificar(crearAlmacenDoble(), opciones({ destino: 'trappvel' }))).rejects.toThrow(/mismo workspace/)
    const a = crearAlmacenDoble()
    a.estado.workspaces.push({ id: 'dddddddd-0000-4000-8000-000000000001', slug: 'trappvel-pruebas', config_extra: {} })
    await expect(planificar(a, opciones())).rejects.toThrow(/no es un espacio de pruebas/)
    await expect(purgar(a, { origen: 'trappvel', destino: 'trappvel-pruebas', correoBase: CORREO })).rejects.toThrow(/no es un espacio de pruebas/)
    await expect(purgar(a, { origen: 'trappvel', destino: 'trappvel', correoBase: CORREO })).rejects.toThrow(/no puede ser el origen/)
  })

  it('un alias que ya es de otro workspace no se mueve', async () => {
    const a = crearAlmacenDoble({ usuarios: [{ id: ORIGEN.perfilAsesora, correo: 'persona+trappvel-pruebas-asesora@metrik.example' }] })
    await expect(planificar(a, opciones())).rejects.toThrow(/ya es usuario de otro workspace/)
  })

  it('no borra un workspace con un perfil ajeno parado en él', async () => {
    const a = crearAlmacenDoble()
    const plan = await aplicar(a)
    a.estado.profiles.push({ id: 'eeeeeeee-0000-4000-8000-000000000001', workspace_id: plan.destino.id, full_name: 'Alguien que entró' })
    const inf = await purgar(a, { origen: 'trappvel', destino: 'trappvel-pruebas', correoBase: CORREO })
    expect(inf.bloqueos).toHaveLength(1)
    expect(inf.workspaceBorrado).toBe(false)
    expect(a.estado.workspaces.some(w => w.id === plan.destino.id)).toBe(true)
  })
})
