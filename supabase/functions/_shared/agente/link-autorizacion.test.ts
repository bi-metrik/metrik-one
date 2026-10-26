import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { escenario } from './escenario'
import { modeloGuionado } from './modelo-guionado'
import { fechaCorta, INSTRUCCION_POR_DEFECTO, MENSAJE_WHATSAPP_POR_DEFECTO } from './bandeja/autorizacion'

/**
 * `link_autorizacion`: la comercial pide el link de autorización de datos de un cliente y el bot contesta con dos
 * mensajes que escribe el código (la instrucción y, aparte, el mensaje con el link para reenviar), o dice que ya autorizó.
 * El pedido lo clasifica el modelo (aquí, un guion); el código solo exige la ficha vista por `buscar`.
 * Datos inventados; ningún modelo real.
 */

const CONTACTOS = [{ id: 'c-mauricio', nombre: 'MAURICIO MORENO', celular: '3001234567' }]
const REF = 'Mauricio Moreno (cel. …4567)'
const PIDE = 'envíame el link de autorización de datos para el cliente Mauricio Moreno'

describe('link_autorizacion', () => {
  it('sin autorización: dos mensajes, el segundo es el mensaje para reenviar con el link real', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
      (p) => {
        // La herramienta está declarada y cierra el turno.
        expect(p.herramientas.map((h) => h.name)).toContain('link_autorizacion')
        return { name: 'link_autorizacion', args: { cliente: REF } }
      },
    ])
    const e = await escenario({ modelo, contactos: CONTACTOS })
    const r = await e.escribe(PIDE)
    expect(r).toHaveLength(2)
    expect(r[0].texto).toContain('Mándale esto a Mauricio Moreno en tu primera respuesta')
    expect(r[1].texto).toBe([
      'Hola Mauricio Moreno, soy el de la agencia.',
      `Para preparar su cotización necesitamos que autorice el uso de sus datos en este enlace (1 minuto): https://agencia.metrikone.co/autorizacion/${'T'.repeat(43)}?m=w`,
      'Cualquier duda me escribe por aquí.',
    ].join('\n'))
    expect(e.puerto.escrituras).toEqual([{ tipo: 'enlace_autorizacion', contactoId: 'c-mauricio' }])
    const t = e.trazas().at(-1)!
    expect(t.salidas_extra).toHaveLength(1)
    expect(t.herramientas?.find((h) => h.nombre === 'link_autorizacion')).toMatchObject({ ok: true, privado: { contactoId: 'c-mauricio' } })
    // Los dos mensajes cierran el turno: ninguno queda sin atender.
    const filas = await e.almacen.leer(e.deps.workspaceId, e.deps.phone, '2000-01-01')
    expect(filas.filter((f) => f.direccion === 'saliente').every((f) => f.turno_id)).toBe(true)
  })

  it('ya autorizó: lo dice con la fecha, sin link', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
      { name: 'link_autorizacion', args: { cliente: REF } },
    ])
    const e = await escenario({ modelo, contactos: CONTACTOS })
    const fecha = new Date().toISOString()
    e.puerto.autorizaciones.set('c-mauricio', { estado: 'autorizado', fecha, menores: true })
    const r = await e.escribe(PIDE)
    expect(r).toEqual([{ tipo: 'texto', texto: `Mauricio Moreno ya autorizó el ${fechaCorta(fecha, fecha)}.` }])
    expect(e.puerto.escrituras).toEqual([])
  })

  it('candado: sin `buscar` antes no hay link (vuelve al modelo)', async () => {
    const modelo = modeloGuionado([
      { name: 'link_autorizacion', args: { cliente: 'Mauricio Moreno' } },
      { name: 'responder', args: { tema: 'cliente', texto: 'Déjame buscarlo primero.' } },
    ])
    const e = await escenario({ modelo, contactos: CONTACTOS })
    const r = await e.escribe(PIDE)
    expect(r).toEqual([{ tipo: 'texto', texto: 'Déjame buscarlo primero.' }])
    expect(e.trazas().at(-1)!.candados).toEqual([expect.objectContaining({ candado: 'cliente_sin_buscar' })])
    expect(e.puerto.escrituras).toEqual([])
  })

  it('si no se pudo revisar, no inventa link ni autorización', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
      { name: 'link_autorizacion', args: { cliente: REF } },
      { name: 'responder', args: { tema: 'cliente', texto: 'No pude revisar la autorización ahora.' } },
    ])
    const e = await escenario({ modelo, contactos: CONTACTOS })
    e.puerto.autorizaciones.set('c-mauricio', 'error')
    const r = await e.escribe(PIDE)
    expect(r).toEqual([{ tipo: 'texto', texto: 'No pude revisar la autorización ahora.' }])
  })
})

describe('textos por defecto', () => {
  it('son copia de los de la app (src/lib/autorizacion-datos/texto.ts)', () => {
    const app = readFileSync(join(process.cwd(), 'src/lib/autorizacion-datos/texto.ts'), 'utf8')
    for (const linea of MENSAJE_WHATSAPP_POR_DEFECTO.split('\n')) expect(app).toContain(`'${linea}'`)
    expect(app).toContain(`'${INSTRUCCION_POR_DEFECTO}'`)
  })
})
