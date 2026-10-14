import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atenderPendientes } from './cola'
import { escenario, reglamentoDePrueba } from './escenario'
import type { Escenario } from './escenario'
import { modeloGuionado } from './modelo-guionado'
import type { Paso } from './modelo-guionado'
import { TEXTO_NO_PUDE } from './nucleo'
import { REGLAMENTO_ANEXO_A } from './bandeja/reglamento-anexo-a'
import { conPerfil, FICHAS_PERFIL } from './bandeja/reglamento-perfil'
import { perfilSql } from './bandeja/perfil-sql'
import { filaDeLaFrase, lineasFuera } from './bandeja/dominio'
import { esquemaCarga, instruccionesCarga, validarCarga } from './bandeja/extraccion'
import { planGuardado, separarHechos, textoComparable } from '../perfil-contacto'
import { CONJUNTO_PERFIL } from './arnes/conjuntos'
import type { ContactoMem, ExtractorMemoria, ViajeMem } from './memoria'
import type { CampoEntendible } from '../wa-entendimiento-reglas'
import type { Salida } from './tipos'

/**
 * El perfil del contacto desde el bot (brief a Max del 2026-10-12, corte 1 del motor de perfil).
 *
 * «Recuerda que a Mauricio Moreno le gusta la comida italiana»: el MODELO decide que es un pedido de perfil y marca cada
 * hecho (dato, sensible, juicio, nombra a un menor); el código solo protege las invariantes. Aquí el modelo es un guion
 * (Gemini está en 403 por facturación): lo que se prueba es lo que el código hace con lo que el modelo diga.
 *
 * Casos del brief: los tres ejemplos (escrito, «siempre viaja con la mamá», un audio), uno ambiguo (dos Mauricios), uno
 * sin autorización, uno sensible («es celíaco»), uno de juicio y uno mixto (lo del viaje al viaje, lo de la persona al
 * perfil como sugerido, sin otro toque). La verdad es el estado final del perfil en la base en memoria.
 * Datos inventados.
 */

const MAURICIO: ContactoMem = { id: 'c-mauricio', nombre: 'MAURICIO MORENO', celular: '3001234567' }
const MAURICIO_2: ContactoMem = { id: 'c-mauricio-2', nombre: 'MAURICIO MORENO', celular: '3109876543' }
const VIVIANA: ContactoMem = { id: 'c-viviana', nombre: 'VIVIANA PAZ', celular: '3157770011' }
const REF = 'Mauricio Moreno (cel. …4567)'
const REF_2 = 'Mauricio Moreno (cel. …6543)'
const REF_VIVIANA = 'Viviana Paz (cel. …0011)'
const VIAJE: ViajeMem = { id: 'v-m1', codigo: 'M1 26 1', contactoId: 'c-mauricio', nombre: 'CARTAGENA', destino: 'Cartagena', abierto: true, datos: {} }

const reglamento = () => reglamentoDePrueba(conPerfil(REGLAMENTO_ANEXO_A))
const autorizado = { estado: 'autorizado' as const, fecha: '2026-10-10T15:00:00Z', menores: false }

async function mundo(p: { guion: Paso[]; contactos?: ContactoMem[]; viajes?: ViajeMem[]; autorizados?: string[]; campos?: CampoEntendible[]; extraer?: ExtractorMemoria }): Promise<Escenario> {
  const e = await escenario({
    modelo: modeloGuionado(p.guion), contactos: p.contactos ?? [MAURICIO], viajes: p.viajes ?? [], reglamento: await reglamento(),
    ...(p.campos ? { campos: p.campos, extraer: p.extraer } : {}),
  })
  for (const id of p.autorizados ?? ['c-mauricio']) e.puerto.autorizaciones.set(id, autorizado)
  return e
}

const hecho = (texto: string, frase: string, dimension = 'preferencias', clase = 'dato', extra: Record<string, unknown> = {}) => ({ dimension, texto, frase, clase, ...extra })
const perfilDe = (e: Escenario, contactoId = 'c-mauricio') => e.puerto.perfil.filter((h) => h.contactoId === contactoId)
const errorDe = (e: Escenario) => e.trazas().flatMap((t) => t.candados ?? [])

describe('perfil explícito: «recuerda que a … le gusta …»', () => {
  const PIDE = 'recuerda que a Mauricio Moreno le gusta la comida italiana'

  it('propone con el resumen del código, no escribe sin toque, y [Guardar] lo deja confirmado con su origen', async () => {
    const e = await mundo({
      guion: [
        { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
        (p) => {
          // La acción y la forma de los hechos están en la declaración que ve el modelo.
          const prop = p.herramientas.find((h) => h.name === 'proponer')!.parameters as { properties: { accion: { enum: string[] }; datos: { properties: Record<string, unknown> } } }
          expect(prop.properties.accion.enum).toContain('perfil_contacto')
          expect(prop.properties.datos.properties.hechos).toBeDefined()
          return { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF, hechos: [hecho('le gusta la comida italiana', 'le gusta la comida italiana')] } } }
        },
      ],
    })
    const r = await e.escribe(PIDE)
    expect(r).toHaveLength(1)
    const s = r[0] as Extract<Salida, { tipo: 'botones' }>
    expect(s.tipo).toBe('botones')
    expect(s.texto).toBe('Guardo en el perfil de MAURICIO MORENO: le gusta la comida italiana (preferencias)')
    expect(s.opciones.map((o) => o.titulo)).toEqual(['Guardar', 'Corregir'])
    // Sin toque, nada.
    expect(e.puerto.escrituras).toEqual([])
    expect(perfilDe(e)).toEqual([])

    const t = await e.toca('Guardar')
    expect(t[0].texto).toBe('Guardé en el perfil de MAURICIO MORENO: le gusta la comida italiana.')
    const pedido = e.almacen.filas.find((f) => f.texto === PIDE)!
    expect(perfilDe(e)).toEqual([expect.objectContaining({
      dimension: 'preferencias', texto: 'le gusta la comida italiana', estado: 'confirmado', origenTipo: 'bot_explicito', origenRef: pedido.id,
    })])
    // Un segundo toque no escribe dos veces.
    await e.toca('Guardar')
    expect(perfilDe(e)).toHaveLength(1)
  })

  it('«Viviana siempre viaja con la mamá» → con quién viaja', async () => {
    const e = await mundo({
      contactos: [MAURICIO, VIVIANA], autorizados: ['c-viviana'],
      guion: [
        { name: 'buscar', args: { texto: 'Viviana' } },
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF_VIVIANA, hechos: [hecho('siempre viaja con la mamá', 'siempre viaja con la mamá', 'nucleo_viaje')] } } },
      ],
    })
    const r = await e.escribe('Viviana siempre viaja con la mamá')
    expect(r[0].texto).toBe('Guardo en el perfil de VIVIANA PAZ: siempre viaja con la mamá (con quién viaja)')
    await e.toca('Guardar')
    expect(perfilDe(e, 'c-viviana')).toEqual([expect.objectContaining({ dimension: 'nucleo_viaje', estado: 'confirmado' })])
  })

  it('un audio (su transcripción) sostiene el hecho igual que un escrito', async () => {
    const e = await mundo({
      guion: [
        { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF, hechos: [hecho('prefiere hoteles pequeños', 'él siempre prefiere hoteles pequeños')] } } },
      ],
    })
    e.reloj.avanzar(20_000)
    const audio = e.almacen.entrante({ workspaceId: e.deps.workspaceId, phone: e.deps.phone, clase: 'audio', texto: 'oye, anota que Mauricio Moreno él siempre prefiere hoteles pequeños' })
    await atenderPendientes(e.deps)
    expect(e.mensajero.enviados.at(-1)!.salida.texto).toBe('Guardo en el perfil de MAURICIO MORENO: prefiere hoteles pequeños (preferencias)')
    await e.toca('Guardar')
    expect(perfilDe(e)).toEqual([expect.objectContaining({ texto: 'prefiere hoteles pequeños', origenRef: audio.id, estado: 'confirmado' })])
  })

  it('[Corregir] no escribe nada', async () => {
    const e = await mundo({
      guion: [
        { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF, hechos: [hecho('le gusta la comida italiana', 'le gusta la comida italiana')] } } },
      ],
    })
    await e.escribe(PIDE)
    const r = await e.toca('Corregir')
    expect(r[0].texto).toBe('Listo, no hice nada.')
    expect(e.puerto.escrituras).toEqual([])
  })

  it('lo que ya está confirmado no se vuelve a proponer; un sugerido igual se CONFIRMA (no se duplica)', async () => {
    const e = await mundo({
      guion: [
        { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF, hechos: [hecho('le gusta la comida italiana', 'le gusta la comida italiana')] } } },
        { name: 'responder', args: { tema: 'cliente', texto: 'Eso ya está en su perfil.' } },
        { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF, hechos: [hecho('viaja siempre con la esposa', 'viaja siempre con la esposa', 'nucleo_viaje')] } } },
      ],
    })
    e.puerto.perfil.push(
      { id: 'h-1', contactoId: 'c-mauricio', dimension: 'preferencias', texto: 'Le gusta la comida italiana', estado: 'confirmado', origenTipo: 'manual', origenRef: 'usuario:u1' },
      { id: 'h-2', contactoId: 'c-mauricio', dimension: 'nucleo_viaje', texto: 'viaja siempre con la esposa', estado: 'sugerido', origenTipo: 'bot_conversacion', origenRef: 'f-0' },
    )
    expect((await e.escribe(PIDE))[0].texto).toBe('Eso ya está en su perfil.')
    expect(errorDe(e).map((c) => c.candado)).toContain('ya_en_perfil')
    await e.escribe('recuerda que Mauricio Moreno viaja siempre con la esposa')
    await e.toca('Guardar')
    expect(perfilDe(e).map((h) => [h.id, h.estado])).toEqual([['h-1', 'confirmado'], ['h-2', 'confirmado']])
  })
})

describe('perfil: el contacto', () => {
  it('ambiguo (dos Mauricio Moreno): el candado no deja adivinar; el bot pregunta y guarda en el que eligió', async () => {
    const e = await mundo({
      contactos: [MAURICIO, MAURICIO_2], autorizados: ['c-mauricio', 'c-mauricio-2'],
      guion: [
        { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: 'Mauricio Moreno', hechos: [hecho('le gusta la comida italiana', 'le gusta la comida italiana')] } } },
        { name: 'responder', args: { tema: 'cliente', texto: 'Tengo dos Mauricio Moreno. ¿Cuál?', opciones: [{ titulo: '…4567' }, { titulo: '…6543' }] } },
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF_2, hechos: [hecho('le gusta la comida italiana', 'le gusta la comida italiana')] } } },
      ],
    })
    const r = await e.escribe('recuerda que a Mauricio Moreno le gusta la comida italiana')
    expect(r[0].tipo).toBe('botones')
    expect(errorDe(e).map((c) => c.candado)).toEqual(['cliente_ambiguo'])
    await e.toca('…6543')
    await e.toca('Guardar')
    expect(perfilDe(e, 'c-mauricio')).toEqual([])
    expect(perfilDe(e, 'c-mauricio-2')).toEqual([expect.objectContaining({ texto: 'le gusta la comida italiana', estado: 'confirmado' })])
  })

  it('sin `buscar` antes no hay propuesta (el id tiene que salir del directorio del workspace)', async () => {
    const e = await mundo({
      guion: [
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF, hechos: [hecho('le gusta la comida italiana', 'le gusta la comida italiana')] } } },
        { name: 'responder', args: { tema: 'cliente', texto: 'Déjame buscarlo primero.' } },
      ],
    })
    await e.escribe('recuerda que a Mauricio Moreno le gusta la comida italiana')
    expect(errorDe(e).map((c) => c.candado)).toEqual(['cliente_sin_buscar'])
    expect(e.puerto.escrituras).toEqual([])
  })
})

describe('perfil: las invariantes', () => {
  it('sin autorización vigente no se propone nada; el modelo recibe la frase y ofrece el link', async () => {
    const e = await mundo({
      autorizados: [],
      guion: [
        { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF, hechos: [hecho('le gusta la comida italiana', 'le gusta la comida italiana')] } } },
        (p) => {
          const ultimo = p.mensajes.at(-1)!.parts[0].functionResponse!.response as { error: string }
          expect(ultimo.error).toContain('«MAURICIO MORENO todavía no autoriza el uso de sus datos; no lo guardo. ¿Te paso su link?»')
          return { name: 'responder', args: { tema: 'cliente', texto: 'MAURICIO MORENO todavía no autoriza el uso de sus datos; no lo guardo. ¿Te paso su link?', opciones: [{ titulo: 'Sí, pásamelo' }, { titulo: 'No' }] } }
        },
        { name: 'link_autorizacion', args: { cliente: REF } },
      ],
    })
    const r = await e.escribe('recuerda que a Mauricio Moreno le gusta la comida italiana')
    expect(r[0].texto).toBe('MAURICIO MORENO todavía no autoriza el uso de sus datos; no lo guardo. ¿Te paso su link?')
    expect(errorDe(e).map((c) => c.candado)).toEqual(['sin_autorizacion'])
    expect(e.puerto.perfil).toEqual([])
    // «Sí, pásamelo» → el flujo del link de siempre (sale el mensaje para reenviar).
    const link = await e.toca('Sí, pásamelo')
    expect(link.at(-1)!.texto).toContain('/autorizacion/')
    expect(e.puerto.perfil).toEqual([])
  })

  it('si la autorización se cae entre la propuesta y el toque, no se escribe', async () => {
    const e = await mundo({
      guion: [
        { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF, hechos: [hecho('le gusta la comida italiana', 'le gusta la comida italiana')] } } },
      ],
    })
    await e.escribe('recuerda que a Mauricio Moreno le gusta la comida italiana')
    e.puerto.autorizaciones.delete('c-mauricio')
    const r = await e.toca('Guardar')
    expect(r[0].texto).toBe(TEXTO_NO_PUDE)
    expect(e.puerto.perfil).toEqual([])
    // Lo ataja el ejecutor antes de escribir (la guarda de la base, imitada por el puerto en memoria, es la segunda capa).
    expect(e.trazas().at(-1)!.error).toContain('sin autorización de datos vigente')
  })

  it('sensible («es celíaco»): no va al perfil; el bot dice que va en el viaje abierto, como requisito especial', async () => {
    const e = await mundo({
      viajes: [VIAJE],
      guion: [
        { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF, hechos: [hecho('es celíaco', 'es celíaco', 'preferencias', 'sensible')] } } },
        (p) => {
          const ultimo = p.mensajes.at(-1)!.parts[0].functionResponse!.response as { error: string }
          expect(ultimo.error).toContain('«es celíaco» no va al perfil (es de salud o creencias): va en el viaje, como requisito especial (M1 26 1)')
          return { name: 'responder', args: { tema: 'cliente', texto: 'Eso es de salud: no lo guardo en su perfil. Va en el viaje M1 26 1 como requisito especial; ¿lo anoto ahí?' } }
        },
      ],
    })
    await e.escribe('recuerda que Mauricio Moreno es celíaco')
    expect(errorDe(e).map((c) => c.candado)).toEqual(['perfil_no_guardable'])
    expect(e.puerto.escrituras).toEqual([])
  })

  it('juicio («es malgeniado»): no se guarda y el modelo lo dice en una línea', async () => {
    const e = await mundo({
      guion: [
        { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF, hechos: [hecho('es malgeniado', 'es malgeniado', 'otro', 'juicio')] } } },
        { name: 'responder', args: { tema: 'cliente', texto: 'Eso es una opinión sobre él: no la guardo en su perfil.' } },
      ],
    })
    await e.escribe('anota que Mauricio Moreno es malgeniado')
    expect(errorDe(e)).toEqual([expect.objectContaining({ candado: 'perfil_no_guardable', detalle: expect.stringContaining('«es malgeniado» no lo guardo: es una opinión sobre la persona') })])
    expect(e.puerto.escrituras).toEqual([])
  })

  it('un dato junto a un juicio: se propone el dato y el resumen dice qué no se guarda', async () => {
    const e = await mundo({
      guion: [
        { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF, hechos: [hecho('le gusta la comida italiana', 'le gusta la comida italiana'), hecho('es tacaño', 'es tacaño', 'otro', 'juicio')] } } },
      ],
    })
    const r = await e.escribe('a Mauricio Moreno le gusta la comida italiana, aunque es tacaño')
    expect(r[0].texto).toBe([
      'Guardo en el perfil de MAURICIO MORENO: le gusta la comida italiana (preferencias)',
      '«es tacaño» no lo guardo: es una opinión sobre la persona, no un dato.',
    ].join('\n'))
    await e.toca('Guardar')
    expect(perfilDe(e).map((h) => h.texto)).toEqual(['le gusta la comida italiana'])
  })

  it('menores: un nombre no entra; el modelo vuelve a proponer solo con el patrón', async () => {
    const e = await mundo({
      guion: [
        { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF, hechos: [hecho('viaja con su hija Sofía de 5 años', 'viaja con su hija Sofía de 5 años', 'nucleo_viaje', 'dato', { nombra_menores: true })] } } },
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF, hechos: [hecho('viaja con una hija de 5 años', 'viaja con su hija Sofía de 5 años', 'nucleo_viaje')] } } },
      ],
    })
    const r = await e.escribe('Mauricio Moreno viaja con su hija Sofía de 5 años')
    expect(errorDe(e).map((c) => c.candado)).toEqual(['menor_con_nombre'])
    expect(r[0].texto).toBe('Guardo en el perfil de MAURICIO MORENO: viaja con una hija de 5 años (con quién viaja)')
  })

  it('una frase que el comercial no escribió no sostiene un hecho (ni la de un reenvío)', async () => {
    const e = await mundo({
      guion: [
        { name: 'buscar', args: { texto: 'Mauricio Moreno' } },
        { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: REF, hechos: [hecho('le gusta el golf', 'le encanta el golf')] } } },
        { name: 'responder', args: { tema: 'cliente', texto: '¿Qué quieres que recuerde de él?' } },
      ],
    })
    await e.reenvia('me encanta el golf')
    await e.escribe('recuerda algo de Mauricio Moreno')
    expect(errorDe(e).map((c) => c.candado)).toContain('texto_sin_respaldo')
    expect(e.puerto.escrituras).toEqual([])
  })
})

// ── Mixto: lo del viaje al viaje, lo de la persona al perfil como sugerido ─────

const CAMPOS: CampoEntendible[] = [
  { slug: 'destino', tipo: 'texto', label: 'Destino', nivel: 'minimo', pregunta: '¿A dónde?' },
  { slug: 'fecha_salida', tipo: 'fecha', label: 'Fecha de salida', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'adultos', tipo: 'numero', label: 'Adultos', nivel: 'minimo', pregunta: '¿Cuántos adultos?' },
  { slug: 'requisitos_especiales', tipo: 'texto', label: 'Requisitos especiales', nivel: 'deseable', pregunta: '¿Algo especial?' },
] as CampoEntendible[]

const MIXTO = 'Para M1 26 1: salen el 3 de diciembre, viaja siempre con la esposa, les gusta el buen vino y él es malgeniado'

/** La extracción guionada: lo del viaje en sus campos y lo de la persona en `perfil`, con las marcas del modelo. */
const extraerMixto: ExtractorMemoria = async ({ textos, campos }) => ({
  mensajes: textos.map((_, i) => ({ n: i + 1, clase: 'cliente' })),
  citas: [],
  valores: {
    ...Object.fromEntries(campos.map((f) => [f.slug, { valor: 'por_definir', frase: '' }])),
    fecha_salida: { valor: '2026-12-03', frase: 'salen el 3 de diciembre' },
    adultos: { valor: '2', frase: 'viaja siempre con la esposa', como: 'deducido', calculo: 'él y su esposa' },
  },
  perfil: [
    hecho('viaja siempre con la esposa', 'viaja siempre con la esposa', 'nucleo_viaje'),
    hecho('le gusta el buen vino', 'les gusta el buen vino'),
    hecho('es malgeniado', 'él es malgeniado', 'otro', 'juicio'),
  ],
})

const guionMixto: Paso[] = [{ name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: 'M1 26 1' } } }]

describe('mixto: una solicitud que trae datos de la persona', () => {
  it('el resumen lo muestra; con UN toque el viaje se carga y lo de la persona queda SUGERIDO (sin el juicio)', async () => {
    const e = await mundo({ viajes: [VIAJE], campos: CAMPOS, extraer: extraerMixto, guion: guionMixto })
    const r = await e.escribe(MIXTO)
    expect(r[0].tipo).toBe('botones')
    expect(r[0].texto).toContain('Al perfil del cliente, por confirmar en ONE: viaja siempre con la esposa; le gusta el buen vino')
    expect(r[0].texto).not.toContain('malgeniado')
    expect(e.puerto.escrituras).toEqual([])

    const t = await e.toca('Anotar')
    expect(t[0].texto).toContain('Dejé en el perfil de MAURICIO MORENO, por confirmar en ONE: viaja siempre con la esposa; le gusta el buen vino.')
    expect(e.puerto.viajes[0].datos).toMatchObject({ fecha_salida: '2026-12-03', adultos: 2 })
    const fila = e.almacen.filas.find((f) => f.texto === MIXTO)!
    expect(perfilDe(e).map((h) => [h.texto, h.estado, h.origenTipo, h.origenRef])).toEqual([
      ['viaja siempre con la esposa', 'sugerido', 'bot_conversacion', fila.id],
      ['le gusta el buen vino', 'sugerido', 'bot_conversacion', fila.id],
    ])
    // Todo lo escrito salió de ese toque (la carga y los dos sugeridos), ninguno por fuera.
    const ejecucion = e.trazas().find((x) => x.ejecucion?.resultado === 'ejecutada')!.ejecucion!
    expect(ejecucion.escrituras?.map((x) => x.tipo)).toEqual(['anotacion', 'perfil', 'perfil'])
    expect(e.puerto.escrituras.map((x) => x.tipo)).toEqual(['carga', 'perfil', 'perfil'])
  })

  it('sin autorización: lo del viaje se carga, lo de la persona NO, y se dice', async () => {
    const e = await mundo({ viajes: [VIAJE], campos: CAMPOS, extraer: extraerMixto, guion: guionMixto, autorizados: [] })
    await e.escribe(MIXTO)
    const t = await e.toca('Anotar')
    expect(t[0].texto).toContain('Lo de la persona no lo guardé en su perfil: MAURICIO MORENO todavía no autoriza el uso de sus datos.')
    expect(e.puerto.viajes[0].datos).toMatchObject({ fecha_salida: '2026-12-03' })
    expect(e.puerto.perfil).toEqual([])
  })

  it('lo que alguien descartó no se vuelve a sugerir', async () => {
    const e = await mundo({ viajes: [VIAJE], campos: CAMPOS, extraer: extraerMixto, guion: guionMixto })
    e.puerto.perfil.push({ id: 'h-x', contactoId: 'c-mauricio', dimension: 'preferencias', texto: 'le gusta el buen vino', estado: 'descartado', origenTipo: 'bot_conversacion', origenRef: 'f-0' })
    await e.escribe(MIXTO)
    await e.toca('Anotar')
    expect(perfilDe(e).map((h) => [h.texto, h.estado])).toEqual([['le gusta el buen vino', 'descartado'], ['viaja siempre con la esposa', 'sugerido']])
  })
})

// ── Piezas puras ──────────────────────────────────────────────────────────────

describe('separarHechos: obedece las marcas del modelo, no lee el texto', () => {
  const respaldo = ['le gusta la comida italiana y es celíaco']
  it('dato con frase escrita entra; sensible, juicio y menores nombrados no; sin frase escrita tampoco', () => {
    const r = separarHechos([
      hecho('le gusta la comida italiana', 'le gusta la comida ITALIANA'),
      hecho('es celíaco', 'es celíaco', 'preferencias', 'sensible'),
      hecho('es grosero', 'es celíaco', 'otro', 'juicio'),
      hecho('viaja con Sofía', 'italiana', 'nucleo_viaje', 'dato', { nombra_menores: true }),
      hecho('juega golf', 'juega golf'),
      hecho('algo', 'italiana', 'gustos'),
    ], respaldo)
    expect(r.guardables).toEqual([{ dimension: 'preferencias', texto: 'le gusta la comida italiana', frase: 'le gusta la comida ITALIANA' }])
    expect(r.fuera.map((f) => f.motivo)).toEqual(['sensible', 'juicio', 'nombra_menores', 'sin_respaldo', 'forma'])
  })
  it('el mismo texto del modelo, con el mismo significado y palabras distintas, NO se considera igual (eso lo decide el modelo)', () => {
    expect(textoComparable('Le gusta la comida italiana.')).toBe(textoComparable('le gusta la comida italiana'))
    expect(textoComparable('le encanta la comida italiana')).not.toBe(textoComparable('le gusta la comida italiana'))
  })
})

describe('planGuardado', () => {
  const ex = [
    { id: 'a', texto: 'le gusta el vino', estado: 'confirmado' as const },
    { id: 'b', texto: 'viaja con la esposa', estado: 'sugerido' as const },
    { id: 'c', texto: 'prefiere la playa', estado: 'descartado' as const },
  ]
  const n = (texto: string) => ({ texto })
  it('confirmado: inserta lo nuevo, confirma el sugerido igual, y una persona puede volver a pedir lo descartado', () => {
    const r = planGuardado([n('Le gusta el vino'), n('viaja con la esposa'), n('prefiere la playa'), n('nuevo')], ex, 'confirmado')
    expect(r.yaEstaban.map((h) => h.texto)).toEqual(['Le gusta el vino'])
    expect(r.confirmar.map((x) => x.id)).toEqual(['b'])
    expect(r.insertar.map((h) => h.texto)).toEqual(['prefiere la playa', 'nuevo'])
  })
  it('sugerido: lo descartado no vuelve y un sugerido igual no se repite', () => {
    const r = planGuardado([n('viaja con la esposa'), n('prefiere la playa'), n('nuevo')], ex, 'sugerido')
    expect(r.insertar.map((h) => h.texto)).toEqual(['nuevo'])
    expect(r.confirmar).toEqual([])
  })
})

describe('lineasFuera y filaDeLaFrase', () => {
  it('sensible sin viajes abiertos: dice que solo va en un viaje', () => {
    expect(lineasFuera([{ texto: 'es celíaco', motivo: 'sensible' }], { viajes_abiertos: [] }))
      .toEqual(['«es celíaco» no va al perfil (es de salud o creencias): solo se anota en un viaje, como requisito especial, y no tiene viajes abiertos.'])
  })
  it('la fila es la última donde está escrita la frase', () => {
    const f = (id: string, texto: string) => ({ id, workspace_id: 'w', phone: 'p', direccion: 'entrante' as const, clase: 'escrito' as const, texto, created_at: '' })
    expect(filaDeLaFrase([f('1', 'le gusta el vino'), f('2', 'otra cosa'), f('3', 'Le gusta el VINO tinto')], 'le gusta el vino')).toBe('3')
    expect(filaDeLaFrase([f('1', 'x')], 'nada')).toBeNull()
  })
})

describe('extracción con perfil', () => {
  it('sin `perfil` el prompt y el esquema son los de siempre (la app de «Pegar conversación» no cambia)', () => {
    expect(instruccionesCarga(CAMPOS, '2026-10-12')).toBe(instruccionesCarga(CAMPOS, '2026-10-12', {}, {}, undefined, {}))
    expect(instruccionesCarga(CAMPOS, '2026-10-12')).not.toContain('perfil:')
    expect((esquemaCarga(CAMPOS) as { properties: Record<string, unknown> }).properties.perfil).toBeUndefined()
    expect((esquemaCarga(CAMPOS, { perfil: true }) as { properties: Record<string, unknown> }).properties.perfil).toBeDefined()
  })
  it('con `perfil` la parte fija del prompt crece poco (tope 1.450 tokens; sin perfil sigue el de 1.200)', () => {
    const fijo = instruccionesCarga([], '2026-10-08', {}, {}, undefined, { perfil: true })
    expect(fijo).toContain('5. perfil:')
    expect(Math.ceil(fijo.length / 4)).toBeLessThanOrEqual(1450)
  })
  it('validarCarga: lo de la persona solo de mensajes del cliente o del comercial, sin sensibles ni juicios', () => {
    const raw = {
      mensajes: [{ n: 1, clase: 'cliente' }, { n: 2, clase: 'tercero' }],
      valores: {},
      perfil: [hecho('le gusta el vino', 'le gusta el vino'), hecho('prefiere Europa', 'promo Europa'), hecho('es diabético', 'le gusta el vino', 'otro', 'sensible')],
    }
    const v = validarCarga(raw, CAMPOS, ['le gusta el vino', 'promo Europa'], { hoyISO: '2026-10-12' })
    expect(v.perfil.map((h) => h.texto)).toEqual(['le gusta el vino'])
  })
})

describe('el conjunto `perfil` del arnés (para qa-real.sh): sus veredictos aprueban una corrida correcta', () => {
  const correr = async (id: string, guion: Paso[]) => {
    const caso = CONJUNTO_PERFIL.find((c) => c.id === id)!
    const e = await escenario({ modelo: modeloGuionado(guion), contactos: caso.contactos, viajes: caso.viajes, reglamento: await reglamento() })
    for (const c of caso.autorizados ?? []) e.puerto.autorizaciones.set(c, autorizado)
    for (const p of caso.pasos ?? []) {
      if (p.escribe) await e.escribe(p.escribe)
      // Como `tocarOEscribir` de correr.ts: sin ese botón, la persona escribe.
      else if (p.toca) {
        try { await e.toca(p.toca) } catch { await e.escribe(p.oEscribe ?? 'sí') }
      }
    }
    return caso.esperado(e.puerto, e.trazas())
  }
  it('cp-explicito', async () => {
    const ref = 'Martin Mora (cel. …7311)'
    expect(await correr('cp-explicito', [
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: ref, hechos: [hecho('le gusta la comida italiana', 'le gusta la comida italiana')] } } },
    ])).toMatchObject({ ok: true })
  })
  it('cp-sin-autorizacion', async () => {
    expect(await correr('cp-sin-autorizacion', [
      { name: 'buscar', args: { texto: 'Pedro Pardo' } },
      { name: 'proponer', args: { accion: 'perfil_contacto', datos: { cliente: 'Pedro Pardo (cel. …3344)', hechos: [hecho('le gustan los cruceros', 'le gustan los cruceros')] } } },
      { name: 'responder', args: { tema: 'cliente', texto: 'PEDRO PARDO todavía no autoriza el uso de sus datos; no lo guardo. ¿Te paso su link?' } },
    ])).toMatchObject({ ok: true })
  })
  it('un bot que no hace nada no aprueba los casos positivos', async () => {
    const nada: Paso[] = Array.from({ length: 6 }, () => ({ name: 'responder', args: { tema: 'cliente', texto: '¿Me cuentas más?' } }))
    expect(await correr('cp-explicito', nada)).toMatchObject({ ok: false })
    expect(await correr('cp-sin-autorizacion', nada)).toMatchObject({ ok: false })
  })
})

describe('las fichas del reglamento', () => {
  it('conPerfil reemplaza por clave y agrega las nuevas', () => {
    const r = conPerfil(REGLAMENTO_ANEXO_A)
    expect(r).toHaveLength(REGLAMENTO_ANEXO_A.length + 3)
    expect(r.find((f) => f.clave === 'alc.no_temas')!.cuando).toContain('«Juan es celíaco» es un dato de un cliente, no es fuera')
    expect(r.filter((f) => f.clave.startsWith('g.perfil')).map((f) => f.clave)).toEqual(['g.perfil_explicito', 'g.perfil_marcas'])
  })
  it('el SQL de Trappvel es exactamente lo que genera reglamento-perfil.ts (una sola fuente) y no publica', () => {
    const sql = readFileSync(join(process.cwd(), 'sql/trappvel/2026-10-12_reglamento-perfil-contacto.sql'), 'utf8')
    expect(sql.trimEnd()).toBe(perfilSql().trimEnd())
    expect(sql).not.toMatch(/perform\s+public\.bot_publicar_reglamento/i)
    expect(FICHAS_PERFIL.every((f) => sql.includes(`'${f.clave}'`))).toBe(true)
  })
})
