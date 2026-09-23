/**
 * El titular corregido llega al tercero de Siigo sin tocar el del titular anterior.
 *
 * El caso que lo pidió es V0502 (SOENA): el RUT dice John Jairo Cifuentes Sabogal
 * (79782266) y su marca en Siigo es ese tercero. Si la financiera corrige el titular a
 * otro documento, la factura, el recibo de caja y el abono tienen que salir al tercero
 * del documento NUEVO — buscado o creado —, y el de John Jairo no se puede reescribir:
 * ya tiene documentos emitidos a su nombre.
 *
 * El defecto que esto cierra estaba en el ORDEN: `corregirContactoParaFactura` hacía el
 * PUT contra el `siigo_id` de la marca ANTES de resolver el tercero. Con el titular
 * corregido esa marca es la del titular anterior, y el PUT le habría cambiado nombre y
 * cédula. Ahora se guarda en ONE, se resuelve el tercero, y solo después se empuja.
 *
 * Sin red y sin base: Siigo y Supabase son dobles que ANOTAN cada llamada, porque lo que
 * se prueba es a qué tercero se le escribe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'
const NEG = 'neg-v0502'
const ID_JOHN = 'd26623b7-c2a1-4a36-97a9-c2446ea5749c'

let fila: { id: string; contacto_id: string | null; metadata: Record<string, unknown> }
let rutFalla = false
/** Terceros que YA existen en Siigo, por identificación. */
let enSiigo: Record<string, { id: string; branch_office: number }>
/** Toda llamada a Siigo, en orden: método + ruta + cuerpo. */
let llamadas: Array<{ metodo: string; ruta: string; body?: Record<string, unknown> }>
let contactoActualizado: Record<string, unknown> | null
let actividad: Array<{ tipo: string; contenido: string }>

const RUT = {
  numero_identificacion: { value: '79782266' },
  tipo_persona: { value: 'Natural' },
  primer_nombre: { value: 'JOHN' },
  otros_nombres: { value: 'JAIRO' },
  primer_apellido: { value: 'CIFUENTES' },
  segundo_apellido: { value: 'SABOGAL' },
  direccion: { value: 'CALLE 100 # 10-10' },
  pais: { value: 'Colombia' },
  departamento: { value: 'Bogotá D.C.' },
  municipio: { value: 'Bogotá' },
  email: { value: 'john@example.com' },
}

function servicioFalso() {
  return {
    from(tabla: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        update: (valores: Record<string, unknown>) => {
          if (tabla === 'contactos') contactoActualizado = valores
          return chain
        },
        single: async () => ({ data: { ...fila }, error: null }),
        maybeSingle: async () =>
          tabla === 'contactos'
            ? { data: { email: 'paula@example.com', telefono: '+57 318 2850319' }, error: null }
            : { data: { ...fila }, error: null },
        then: (resolve: (v: { data: unknown[] | null; error: { message: string } | null }) => unknown) => {
          if (tabla === 'negocio_bloques') {
            return resolve(rutFalla
              ? { data: null, error: { message: 'conexión caída' } }
              : { data: [{ data: { campos: RUT } }], error: null })
          }
          return resolve({ data: [], error: null })
        },
      }
      return chain
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))

vi.mock('./client', async () => {
  const real = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...real,
    siigoRequest: async (_ws: string, ruta: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
      const metodo = opts?.method ?? 'GET'
      llamadas.push({ metodo, ruta, body: opts?.body })
      if (metodo === 'GET' && ruta.startsWith('/v1/customers?identification=')) {
        const ident = decodeURIComponent(ruta.split('=')[1])
        const t = enSiigo[ident]
        return { results: t ? [t] : [] }
      }
      if (metodo === 'POST' && ruta === '/v1/customers') {
        const ident = String(opts?.body?.identification)
        enSiigo[ident] = { id: `nuevo-${ident}`, branch_office: 0 }
        return { id: `nuevo-${ident}`, branch_office: 0 }
      }
      if (metodo === 'PUT') return {}
      throw new Error(`ruta inesperada en el doble: ${metodo} ${ruta}`)
    },
  }
})

vi.mock('@/lib/negocios/marca-metadata', () => ({
  guardarMarcaEnMetadata: async (_svc: unknown, _ws: string, _neg: string, clave: string, marca: unknown) => {
    fila.metadata = { ...fila.metadata, [clave]: marca }
    return { ok: true as const }
  },
}))

vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async (_svc: unknown, f: { tipo: string; contenido: string }) => {
    actividad.push({ tipo: f.tipo, contenido: f.contenido })
    return { ok: true as const }
  },
}))

import {
  asegurarClienteSiigo,
  empujarCorreccionesAlTercero,
  guardarCorreccionesDeFactura,
  identificacionDelNegocio,
} from './clientes'
import { validarTitular, type TitularParaBorrador } from './titular'

const AUTOR = { nombre: 'Diana Parra', staffId: 'staff-diana' }

function titular(e: Parameters<typeof validarTitular>[0]): TitularParaBorrador {
  const v = validarTitular(e)
  if (!v.ok) throw new Error(v.mensaje)
  return v.titular
}

const PAULA = () => titular({ tipo_documento: '13', numero: '52100200', nombres: 'PAULA ANDREA', apellidos: 'OLIVEROS' })

/** El flujo de la emisión, en su orden: guardar en ONE, resolver, empujar. */
async function comoLaEmision(datos: Parameters<typeof guardarCorreccionesDeFactura>[2]) {
  const g = await guardarCorreccionesDeFactura(WS, NEG, datos, AUTOR)
  if (!g.ok) return { g }
  const c = await asegurarClienteSiigo(WS, NEG, 'manual')
  if (c.estado !== 'ya_existia' && c.estado !== 'creado') return { g, c }
  const e = c.estado === 'ya_existia'
    ? await empujarCorreccionesAlTercero(WS, NEG, c, { contactoCambiado: g.contactoCambiado })
    : null
  return { g, c, e }
}

beforeEach(() => {
  rutFalla = false
  llamadas = []
  contactoActualizado = null
  actividad = []
  // V0502 hoy: marca amarrada al tercero de John Jairo, que existe en Siigo.
  enSiigo = { '79782266': { id: ID_JOHN, branch_office: 0 } }
  fila = {
    id: NEG,
    contacto_id: 'con-paula',
    metadata: {
      siigo_cliente: {
        identificacion: '79782266', siigo_id: ID_JOHN, branch_office: 0,
        at: '2026-09-21T14:46:29.808Z', origen: 'automatico',
      },
    },
  }
})

const putsA = (id: string) => llamadas.filter(l => l.metodo === 'PUT' && l.ruta === `/v1/customers/${id}`)

describe('corregir el documento: la factura va a OTRO tercero y el anterior no se toca', () => {
  it('sin tercero en Siigo para el documento nuevo, se CREA con el titular corregido', async () => {
    const { g, c, e } = await comoLaEmision({ titular: PAULA() })

    expect(g).toMatchObject({ ok: true, titularCambiado: true })
    expect(c).toMatchObject({ estado: 'creado', identificacion: '52100200', nombre: 'PAULA ANDREA OLIVEROS' })
    // Se preguntó por el documento NUEVO y se creó con él.
    const post = llamadas.find(l => l.metodo === 'POST')
    expect(post?.body).toMatchObject({ identification: '52100200', name: ['PAULA ANDREA', 'OLIVEROS'] })
    // Lo que importa: el tercero de John Jairo NO recibió ningún PUT.
    expect(putsA(ID_JOHN)).toHaveLength(0)
    expect(llamadas.filter(l => l.metodo === 'PUT')).toHaveLength(0)
    expect(e).toBeNull()
    // Y la marca quedó en el tercero corregido: el recibo y el abono salen de ahí.
    expect(fila.metadata.siigo_cliente).toMatchObject({ identificacion: '52100200', siigo_id: 'nuevo-52100200' })
  })

  it('si el documento nuevo YA existe en Siigo, se usa tal como está: ningún PUT a nadie', async () => {
    // Reescribirlo le pondría la dirección del RUT, que es de OTRA persona.
    enSiigo['52100200'] = { id: 'id-paula', branch_office: 0 }

    const { c, e } = await comoLaEmision({ titular: PAULA(), email: 'nuevo@example.com' })

    expect(c).toMatchObject({ estado: 'ya_existia', identificacion: '52100200', siigo_id: 'id-paula' })
    expect(e).toEqual({ ok: true, empujado: false })
    expect(llamadas.filter(l => l.metodo === 'PUT')).toHaveLength(0)
    expect(llamadas.some(l => l.metodo === 'POST')).toBe(false)
  })

  it('la corrección queda aparte, con autor y fecha, y el RUT que reemplazó', async () => {
    await guardarCorreccionesDeFactura(WS, NEG, { titular: PAULA() }, AUTOR)

    expect(fila.metadata.titular_corregido).toMatchObject({
      tipo_documento: '13', numero: '52100200', nombre: ['PAULA ANDREA', 'OLIVEROS'],
      por: 'Diana Parra', por_staff_id: 'staff-diana',
      rut: { identificacion: '79782266', nombre: 'JOHN JAIRO CIFUENTES SABOGAL' },
    })
    expect(typeof (fila.metadata.titular_corregido as { at: string }).at).toBe('string')
    // La marca del tercero NO se toca al guardar: eso lo decide la resolución.
    expect(fila.metadata.siigo_cliente).toMatchObject({ identificacion: '79782266' })
    expect(actividad).toHaveLength(1)
    expect(actividad[0].tipo).toBe('cambio')
    expect(llamadas).toHaveLength(0)
  })

  it('la adopción de facturas lista las del titular corregido', async () => {
    await guardarCorreccionesDeFactura(WS, NEG, { titular: PAULA() }, AUTOR)
    expect((await identificacionDelNegocio(WS, NEG)).identificacion).toBe('52100200')
  })
})

describe('corregir solo el nombre: es el mismo tercero y se le lleva el nombre bueno', () => {
  it('mismo documento que el RUT: PUT al tercero de ese documento, con el nombre corregido', async () => {
    const { c, e } = await comoLaEmision({
      titular: titular({ tipo_documento: '13', numero: '79782266', nombres: 'JHON JAIRO', apellidos: 'CIFUENTES SABOGAL' }),
    })

    expect(c).toMatchObject({ estado: 'ya_existia', identificacion: '79782266' })
    expect(e).toEqual({ ok: true, empujado: true })
    const puts = putsA(ID_JOHN)
    expect(puts).toHaveLength(1)
    expect(puts[0].body).toMatchObject({ identification: '79782266', name: ['JHON JAIRO', 'CIFUENTES SABOGAL'] })
  })
})

describe('lo que NO es una corrección', () => {
  it('escribir exactamente lo del RUT quita la corrección que hubiera', async () => {
    await guardarCorreccionesDeFactura(WS, NEG, { titular: PAULA() }, AUTOR)
    const r = await guardarCorreccionesDeFactura(WS, NEG, {
      titular: titular({ tipo_documento: '13', numero: '79782266', nombres: 'John Jairo', apellidos: 'Cifuentes Sabogal' }),
    }, AUTOR)

    expect(r).toMatchObject({ ok: true, titularCambiado: true })
    expect(fila.metadata.titular_corregido).toBeNull()
    // Y el tercero vuelve a ser el de John Jairo.
    const c = await asegurarClienteSiigo(WS, NEG)
    expect(c).toMatchObject({ identificacion: '79782266' })
  })

  it('repetir la misma corrección no reescribe autor ni fecha', async () => {
    await guardarCorreccionesDeFactura(WS, NEG, { titular: PAULA() }, AUTOR)
    const antes = fila.metadata.titular_corregido
    const r = await guardarCorreccionesDeFactura(WS, NEG, { titular: PAULA() }, { nombre: 'Otra', staffId: 'staff-x' })

    expect(r).toMatchObject({ ok: true, titularCambiado: false })
    expect(fila.metadata.titular_corregido).toBe(antes)
    expect(actividad).toHaveLength(1)
  })

  it('con factura ya emitida NO se corrige, y no se escribe nada', async () => {
    fila.metadata.siigo_factura = { numero: 'FV-2-542', siigo_id: 'e290a0f0' }

    const r = await guardarCorreccionesDeFactura(WS, NEG, { titular: PAULA(), email: 'otro@example.com' }, AUTOR)

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.mensaje).toContain('FV-2-542')
    expect(fila.metadata).not.toHaveProperty('titular_corregido')
    // El rechazo llega ANTES de escribir: tampoco quedó medio cambio en el contacto.
    expect(contactoActualizado).toBeNull()
  })
})

describe('las salidas de emergencia no devuelven al titular anterior', () => {
  it('sin poder releer el RUT, una marca de OTRO titular no se usa: se para', async () => {
    await guardarCorreccionesDeFactura(WS, NEG, { titular: PAULA() }, AUTOR)
    rutFalla = true

    const c = await asegurarClienteSiigo(WS, NEG)

    // Devolver la marca de John Jairo emitiría a nombre de quien ya se dijo que no es.
    expect(c.estado).toBe('error')
  })

  it('sin poder releer el RUT, una marca del MISMO titular corregido sigue valiendo', async () => {
    await comoLaEmision({ titular: PAULA() })
    rutFalla = true

    const c = await asegurarClienteSiigo(WS, NEG)
    expect(c).toMatchObject({ estado: 'ya_existia', identificacion: '52100200' })
  })

  it('el empuje se niega si el tercero que le pasan no es el del titular vigente', async () => {
    await guardarCorreccionesDeFactura(WS, NEG, { titular: PAULA() }, AUTOR)

    // Quien llame con la marca vieja (el tercero de John Jairo) no puede reescribirlo.
    const e = await empujarCorreccionesAlTercero(
      WS, NEG, { identificacion: '79782266', siigo_id: ID_JOHN }, { contactoCambiado: true },
    )

    expect(e.ok).toBe(false)
    expect(putsA(ID_JOHN)).toHaveLength(0)
  })
})

describe('sin corrección del titular, el correo se sigue llevando como antes', () => {
  it('correo corregido: PUT al tercero resuelto, que es el del RUT', async () => {
    const { e } = await comoLaEmision({ email: 'nuevo@example.com' })

    expect(contactoActualizado).toEqual({ email: 'nuevo@example.com' })
    expect(e).toEqual({ ok: true, empujado: true })
    expect(putsA(ID_JOHN)).toHaveLength(1)
  })

  it('sin nada corregido no se le escribe a Siigo', async () => {
    const { e } = await comoLaEmision({})
    expect(e).toEqual({ ok: true, empujado: false })
    expect(llamadas.filter(l => l.metodo !== 'GET')).toHaveLength(0)
  })
})
