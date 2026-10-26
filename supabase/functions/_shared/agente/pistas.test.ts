import { describe, expect, it } from 'vitest'
import {
  ENCABEZADO_PISTAS, TOPE_PISTAS, formatoDeCodigos, leerConfigTranscripcion, limpiarPista, listaDePistas, nombreCorto, proveedorDeGasto,
  fuentesDeComposicion, pistasDeFunciones, pistasSiEncendidas, textoPistas,
} from './pistas'
import type { BasePistas } from './pistas'
import type { Funcion } from './funciones/tipos'
import { CONFIG_PUBLICO_POR_DEFECTO, leerConfigPublico } from './publico/config'

const base: BasePistas = {
  equipo: ['Gloria Benavides', 'Hernán Quintero', ''],
  colaboradores: ['Wilmer Ospina', 'gloria benavides'],
  negocios: [
    { codigo: 'I1 26 5', nombre: 'Tanque Bosque Verde - impermeabilización interna', cliente: 'Inversiones Iguazú' },
    { codigo: 'I1 26 3', nombre: 'Cubierta Alameda', cliente: 'Inversiones Iguazú' },
    { codigo: 'R1 25 2', nombre: 'Terraza Mirador del Parque', cliente: 'Constructora Roble Alto' },
    { codigo: 'P 26 7', nombre: 'Microblading', cliente: 'Yeimy Castaño' },
    { codigo: null, nombre: null, cliente: null },
  ],
}

describe('el constructor de pistas (§4.6)', () => {
  it('ordena equipo, colaboradores, funciones, clientes y negocios; sin repetidos ni vacíos', () => {
    expect(listaDePistas(base, { extras: ['Lifting de pestañas'] })).toEqual([
      'Gloria Benavides', 'Hernán Quintero', 'Wilmer Ospina', 'Lifting de pestañas',
      'Inversiones Iguazú', 'Constructora Roble Alto', 'Yeimy Castaño',
      'Tanque Bosque Verde', 'Cubierta Alameda', 'Terraza Mirador del Parque', 'Microblading',
    ])
  })

  it('respeta el tope de cantidad y el de caracteres', () => {
    const muchos: BasePistas = { equipo: Array.from({ length: 200 }, (_, i) => `Persona Número ${i}`), colaboradores: [], negocios: [] }
    expect(listaDePistas(muchos)).toHaveLength(TOPE_PISTAS)
    expect(listaDePistas(muchos, { tope: 5 })).toHaveLength(5)
    const largo = listaDePistas(muchos, { tope: 80, maxCaracteres: 100 })
    expect(largo.join('; ').length).toBeLessThanOrEqual(100)
    expect(largo.length).toBeGreaterThan(0)
  })

  it('limpia cada pista: una línea, sin separadores, hasta 40 caracteres en palabra', () => {
    expect(limpiarPista('  Ana;\n«Lucía»  ')).toBe('Ana Lucía')
    expect(limpiarPista('Conjunto Residencial Balcones de Toledo Etapa Tres Torre B')!.length).toBeLessThanOrEqual(40)
    expect(limpiarPista('x')).toBeNull()
    expect(limpiarPista(42)).toBeNull()
    expect(nombreCorto('Juntas Coliseo (fase 2)')).toBe('Juntas Coliseo')
    expect(nombreCorto('Tanque Bosque Verde - impermeabilización interna')).toBe('Tanque Bosque Verde')
  })

  it('da el formato de los códigos con los prefijos en uso, nunca la lista', () => {
    const f = formatoDeCodigos(base.negocios.map((n) => n.codigo))!
    expect(f).toContain('«I1 26 1»')
    expect(f).toContain('Códigos de empresa en uso: I1, R1, P.')
    for (const c of ['I1 26 5', 'I1 26 3', 'R1 25 2', 'P 26 7']) expect(f).not.toContain(c)
    expect(formatoDeCodigos([null, 'sin formato'])).toBeNull()
    const t = textoPistas(base)!
    for (const c of ['I1 26 5', 'I1 26 3', 'R1 25 2']) expect(t).not.toContain(c)
  })

  it('el bloque: encabezado contra la inserción falsa, la lista y el formato; nada si no hay qué decir', () => {
    const t = textoPistas(base)!.split('\n')
    expect(t[0]).toBe(ENCABEZADO_PISTAS)
    expect(t[0]).toMatch(/si una no se oye, no la escribas/)
    expect(t[1]).toMatch(/^Gloria Benavides; Hernán Quintero; /)
    expect(t[2]).toMatch(/^Los códigos de negocio/)
    expect(textoPistas({ equipo: [], colaboradores: [], negocios: [] })).toBeNull()
  })

  it('en público (habla un cliente) no van los otros clientes, ni los negocios, ni el formato de los códigos', () => {
    const t = textoPistas(base, { incluirClientes: false, extras: ['Noche de Ramen'] })!
    expect(t).toContain('Gloria Benavides')
    expect(t).toContain('Noche de Ramen')
    for (const x of ['Inversiones Iguazú', 'Yeimy Castaño', 'Cubierta Alameda', 'códigos']) expect(t).not.toContain(x)
  })
})

describe('el interruptor', () => {
  it('apagado por defecto; solo `pistas: true` literal lo prende; el tope va de 5 a 80', () => {
    expect(leerConfigTranscripcion(undefined)).toEqual({ pistas: false, tope: TOPE_PISTAS, vocabulario: [] })
    expect(leerConfigTranscripcion({ transcripcion: { pistas: 'true' } }).pistas).toBe(false)
    expect(leerConfigTranscripcion({ transcripcion: { pistas: true } })).toEqual({ pistas: true, tope: TOPE_PISTAS, vocabulario: [] })
    expect(leerConfigTranscripcion({ transcripcion: { pistas: true, tope: 500 } }).tope).toBe(80)
    expect(leerConfigTranscripcion({ transcripcion: { pistas: true, tope: 1 } }).tope).toBe(5)
  })

  it('apagado no lee la base y devuelve null; prendido arma el bloque con las de las funciones', async () => {
    let lecturas = 0
    const leer = async () => { lecturas++; return { base, extras: ['Microblading'] } }
    expect(await pistasSiEncendidas(leerConfigTranscripcion({}), leer)).toBeNull()
    expect(lecturas).toBe(0)
    const t = await pistasSiEncendidas(leerConfigTranscripcion({ transcripcion: { pistas: true, tope: 5 } }), leer)
    expect(lecturas).toBe(1)
    expect(t!.split('\n')[1].split('; ')).toHaveLength(5)
  })

  it('si leer la base falla, se transcribe sin pistas (null), sin lanzar', async () => {
    const t = await pistasSiEncendidas({ pistas: true, tope: 10, vocabulario: [] }, async () => { throw new Error('caída') })
    expect(t).toBeNull()
  })

  it('público lee el mismo interruptor del workspace; apagado por defecto', () => {
    expect(CONFIG_PUBLICO_POR_DEFECTO.transcripcion.pistas).toBe(false)
    expect(leerConfigPublico({ chatwoot: { activo: true } }).transcripcion.pistas).toBe(false)
    expect(leerConfigPublico({ chatwoot: { activo: true }, transcripcion: { pistas: true } }).transcripcion.pistas).toBe(true)
  })
})

describe('el gancho de las funciones', () => {
  it('junta lo que aportan; la que falla o no tiene gancho no aporta', async () => {
    const r = await pistasDeFunciones([
      { funcion: { pistas: async (c) => [`Servicio de ${c.workspaceId}`, String(c.parametros.x)] }, parametros: { x: 'Henna' } },
      { funcion: {}, parametros: {} },
      { funcion: { pistas: async () => { throw new Error('no') } }, parametros: {} },
    ], 'ws1')
    expect(r).toEqual(['Servicio de ws1', 'Henna'])
  })
})

describe('las fuentes de una composición', () => {
  it('cada función que quedó, con sus parámetros; una Funcion del componedor encaja en el gancho', async () => {
    const conPistas: Funcion = {
      clave: 'clientes.x', familia: 'clientes', queHace: '', herramientas: {}, candados: [], fichas: [],
      pistas: async (c) => [`Taller ${String(c.parametros.nombre)}`],
    }
    const sinPistas: Funcion = { clave: 'comun.persona', familia: 'comun', queHace: '', herramientas: {}, candados: [], fichas: [], comun: true }
    const fuentes = fuentesDeComposicion({ funciones: [sinPistas, conPistas], parametros: { 'clientes.x': { nombre: 'Henna' } } })
    expect(fuentes.map((x) => x.parametros)).toEqual([{}, { nombre: 'Henna' }])
    expect(await pistasDeFunciones(fuentes, 'ws1')).toEqual(['Taller Henna'])
  })
})

describe('marcas y proveedores (caso real 2026-10-26: «suscripción a Resend» se transcribió «Recent Pro»)', () => {
  it('el proveedor sale de la descripción del gasto: el nombre propio, sin el detalle', () => {
    expect(proveedorDeGasto('suscripción a Resend')).toBe('Resend')
    expect(proveedorDeGasto('Vercel Pro (infra MeTRIK, pago PN; USD 20) — agosto')).toBe('Vercel Pro')
    expect(proveedorDeGasto('Tarifa Bold (2,89% + $900) sobre venta')).toBe('Tarifa Bold')
    expect(proveedorDeGasto('Supabase (infra MeTRIK, pago PN; USD 44.03)')).toBe('Supabase')
    expect(proveedorDeGasto('invitacion café cierre')).toBeNull()
    expect(proveedorDeGasto(null)).toBeNull()
  })

  it('los proveedores van al final y sin repetir; el vocabulario fijo va primero', () => {
    const conGastos: BasePistas = { ...base, gastos: ['suscripción a Resend', 'Supabase (infra) — junio', 'Supabase (infra) — julio'] }
    const l = listaDePistas(conGastos, { vocabulario: ['Tailscale'] })
    expect(l[0]).toBe('Tailscale')
    expect(l.slice(-2)).toEqual(['Resend', 'Supabase'])
  })

  it('en público (sin clientes) el lector no trae gastos, y el vocabulario sí va', () => {
    const l = listaDePistas({ equipo: ['Gloria'], colaboradores: [], negocios: [] }, { incluirClientes: false, vocabulario: ['Henna'] })
    expect(l).toEqual(['Henna', 'Gloria'])
  })

  it('el vocabulario se lee de la configuración: solo cadenas, hasta 40, y llega al bloque', async () => {
    const c = leerConfigTranscripcion({ transcripcion: { pistas: true, vocabulario: ['Resend', 7, 'Tailscale'] } })
    expect(c.vocabulario).toEqual(['Resend', 'Tailscale'])
    expect(leerConfigTranscripcion({ transcripcion: { vocabulario: Array.from({ length: 60 }, (_, i) => `M${i}`) } }).vocabulario).toHaveLength(40)
    const t = await pistasSiEncendidas(c, async () => ({ base }))
    expect(t!.split('\n')[1].startsWith('Resend; Tailscale; ')).toBe(true)
  })
})
