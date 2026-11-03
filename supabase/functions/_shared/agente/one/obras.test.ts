import { describe, expect, it } from 'vitest'
import { modeloGuionado } from '../modelo-guionado'
import { declaraciones } from '../herramientas'
import { escenarioObras, PANTALLAZO_SELLANTE, puertoDePrueba } from './escenario-obras'
import { botonNoEsDe } from './obras'
import { sinPesos } from './operario'
import type { Salida } from '../tipos'

/**
 * El modo obras de punta a punta con un modelo guionado y la base en memoria (datos inventados). Lo que se prueba son
 * los candados del diseño (§7): nada se escribe sin toque, ninguna cifra sin respaldo, el operario no registra pagos ni
 * ve la asistencia, la llegada es de quien escribe, con la hora del mensaje y solo hoy.
 */

const opciones = (s: Salida | undefined) => (s && 'opciones' in s ? s.opciones.map((o) => o.titulo) : [])
const todosLosBotonesCaben = (ss: Salida[]) => ss.every((s) => !('opciones' in s) || s.opciones.every((o) => [...o.titulo].length <= (s.tipo === 'lista' ? 24 : 20)))

describe('pago con el pantallazo de la transferencia (§3.1)', () => {
  it('el camino feliz: [Sí, regístralo] guarda valor, fecha del pantallazo, transacción, obra y rubro', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 1850000, negocio: 'R1 26 1', rubro: 'Materiales', descripcion: 'sellante', soporte: '#1' }] } } },
    ])
    const e = await escenarioObras({ modelo })
    await e.pantallazo('', PANTALLAZO_SELLANTE)
    const t2 = await e.dicta('Esto es de Potosí, materiales, el sellante que se compró ayer', { despuesMs: 2000 })
    const p = t2.at(-1)!
    expect(p.texto).toContain('Registro el pago de *$1.850.000* del 20-oct a *Reserva de Potosí*, en *Materiales* (sellante).')
    expect(p.texto).toContain('Transacción 0004587123.')
    expect(opciones(p)).toEqual(['Sí, regístralo', 'Cambiar algo', 'No es de la empresa'])
    expect(e.puerto.escrituras).toEqual([])
    const t3 = await e.toca('Sí, regístralo')
    expect(t3[0].texto).toBe('✅ Guardado. Potosí lleva $1.850.000 en materiales.')
    expect(e.puerto.escrituras).toMatchObject([{ tipo: 'gasto', monto: 1850000, negocio: 'R1 26 1', fecha: '2026-10-20', rubro: 'Materiales', categoria: 'materiales', numero: '0004587123', repetido: false, soporte: true }])
  })

  it('[No es de …] descarta sin guardar', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 1850000, negocio: 'R1 26 1', rubro: 'Materiales', soporte: '#1' }] } } },
    ])
    const e = await escenarioObras({ modelo })
    await e.pantallazo('de potosí, materiales', PANTALLAZO_SELLANTE)
    await e.toca('No es de')
    expect(e.puerto.escrituras).toEqual([])
  })

  it('sin pantallazo: lo dice; con la fecha del mensaje lo avisa', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 900000, negocio: 'C1 26 2', rubro: 'Mano de obra externa', descripcion: 'el de la grúa' }] } } },
    ])
    const e = await escenarioObras({ modelo })
    const t = await e.dicta('le pagué 900 mil al de la grúa, RCN')
    expect(t[0].texto).toContain('No tengo el pantallazo; si lo mandas, le agrego el número de la transacción.')
    expect(t[0].texto).toContain('Fecha: la del mensaje')
  })

  it('el valor de la nota no es el del pantallazo: no elige (candado), y con la elección de la persona sí propone', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 1580000, negocio: 'R1 26 1', rubro: 'Materiales', soporte: '#1' }] } } },
      (p) => {
        const ultimo = JSON.stringify(p.mensajes.at(-1))
        expect(ultimo).toContain('dice $1.850.000')
        return { name: 'responder', args: { tema: 'pago', texto: 'En el pantallazo dice $1.850.000 y en la nota $1.580.000. ¿Cuál es?', opciones: [{ titulo: '$1.850.000' }, { titulo: '$1.580.000' }] } }
      },
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 1580000, negocio: 'R1 26 1', rubro: 'Materiales', soporte: '#1', monto_elegido: true }] } } },
    ])
    const e = await escenarioObras({ modelo })
    await e.pantallazo('Potosí materiales, 1.580.000', PANTALLAZO_SELLANTE)
    const t = e.mensajero.enviados.at(-1)!.salida
    expect(opciones(t)).toEqual(['$1.850.000', '$1.580.000'])
    expect(e.trazas().some((x) => (x.candados ?? []).some((c) => c.candado === 'monto_distinto'))).toBe(true)
    const t2 = await e.toca('$1.580.000')
    expect(t2[0].texto).toContain('*$1.580.000*')
    expect(e.puerto.escrituras).toEqual([])
  })

  it('número de transacción ya registrado: la propuesta pregunta [Es otro pago] / [Es el mismo]', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 1850000, negocio: 'R1 26 1', rubro: 'Materiales', soporte: '#1' }] } } },
    ])
    const e = await escenarioObras({ modelo, mundo: { pagos: [{ id: 'p-viejo', fecha: '2026-10-20', monto: 1850000, negocio_id: 'o-potosi', rubro_id: 'r-mat', categoria: 'materiales', numero: '0004587123', huella: null, descripcion: null }] } })
    const t = await e.pantallazo('potosí materiales', PANTALLAZO_SELLANTE)
    expect(t[0].texto).toContain('Ese pago ya está registrado el 20-oct en Reserva de Potosí, Materiales, $1.850.000.')
    expect(opciones(t[0])).toEqual(['Es otro pago', 'Es el mismo'])
    await e.toca('Es el mismo')
    expect(e.puerto.escrituras).toEqual([])
  })

  it('la misma imagen dos veces sin número: también pregunta (huella de la imagen)', async () => {
    const sinNumero = { ...PANTALLAZO_SELLANTE, numero_transaccion: null }
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 1850000, negocio: 'R1 26 1', rubro: 'Materiales', soporte: '#1' }] } } },
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 1850000, negocio: 'R1 26 1', rubro: 'Materiales', soporte: '#5' }] } } },
    ])
    const e = await escenarioObras({ modelo })
    await e.pantallazo('potosí materiales', sinNumero, { contenido: 'la-misma' })
    await e.toca('Sí, regístralo')
    const t = await e.pantallazo('potosí materiales', sinNumero, { contenido: 'la-misma', despuesMs: 60_000 })
    expect(t[0].texto).toContain('Ese pago ya está registrado el')
    expect(opciones(t[0])).toEqual(['Es otro pago', 'Es el mismo'])
    await e.toca('Es otro pago')
    expect(e.puerto.escrituras.map((w) => w.repetido)).toEqual([false, true])
  })

  it('un pago para dos obras (D3): dos partidas con el mismo pantallazo que suman exacto; si no suman, candado', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 900000, negocio: 'R1 26 1', rubro: 'Materiales', soporte: '#1' }, { monto: 900000, negocio: 'C1 26 2', rubro: 'Materiales', soporte: '#1' }] } } },
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 925000, negocio: 'R1 26 1', rubro: 'Materiales', soporte: '#1' }, { monto: 925000, negocio: 'C1 26 2', rubro: 'Materiales', soporte: '#1' }] } } },
    ])
    const e = await escenarioObras({ modelo })
    const t = await e.pantallazo('mitad Potosí, mitad RCN, materiales', PANTALLAZO_SELLANTE)
    expect(e.trazas().some((x) => (x.candados ?? []).some((c) => c.candado === 'reparto'))).toBe(true)
    expect(t.at(-1)!.texto).toContain('Total: *$1.850.000*')
    await e.toca('Registrar los 2')
    expect(e.puerto.escrituras.map((w) => [w.negocio, w.monto, w.numero])).toEqual([['R1 26 1', 925000, '0004587123'], ['C1 26 2', 925000, '0004587123']])
  })

  it('rubro que no existe: no lo crea; obra que no está activa: no la propone', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 50000, negocio: 'R1 26 1', rubro: 'Publicidad' }] } } },
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 50000, negocio: 'Z9 26 9', rubro: 'Materiales' }] } } },
      { name: 'responder', args: { tema: 'pago', texto: 'Los rubros de obra son Materiales, Mano de obra externa, Transporte, Equipos y Otros de obra. ¿En cuál lo dejo?' } },
    ])
    const e = await escenarioObras({ modelo })
    await e.escribe('ponlo en publicidad, 50 mil de potosí')
    const cs = e.trazas().flatMap((x) => (x.candados ?? []).map((c) => c.candado))
    expect(cs).toEqual(['rubro', 'obra_inexistente'])
    expect(e.puerto.escrituras).toEqual([])
  })

  it('«Gasto de empresa» solo si la persona lo tocó en la lista de destinos (D2)', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 2000000, empresa: true, empresa_dicho_en: '#1', categoria: 'arriendo' }] } } },
      { name: 'preguntar_destino', args: { para: 'pago', texto: '¿De qué obra es el pago de $2.000.000?' } },
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 2000000, empresa: true, empresa_dicho_en: '#3', categoria: 'arriendo' }] } } },
    ])
    const e = await escenarioObras({ modelo })
    const t = await e.escribe('pagué el arriendo de la bodega, 2 millones')
    expect(t[0].tipo).toBe('lista')
    expect(opciones(t[0])).toEqual(['Potosí', 'RCN Calle 26', 'Calle 93', 'Gasto de empresa'])
    const t2 = await e.toca('Gasto de empresa')
    expect(t2[0].texto).toContain('*Gasto de empresa*')
    await e.toca('Sí, regístralo')
    expect(e.puerto.escrituras).toMatchObject([{ tipo: 'gasto', negocio: null, monto: 2000000, categoria: 'arriendo' }])
  })
})

describe('tanda: una propuesta con varias partidas; ninguna vence en silencio (C19)', () => {
  it('[Registrar los 3] guarda los tres y dice el total', async () => {
    const lect = (m: number, n: string) => ({ ...PANTALLAZO_SELLANTE, monto: m, numero_transaccion: n })
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [1, 2, 3].map((i) => ({ monto: [1000000, 1230000, 2000000][i - 1], negocio: 'C1 26 2', rubro: 'Mano de obra externa', soporte: `#${i}` })) } } },
    ])
    const e = await escenarioObras({ modelo })
    for (const [i, m] of [1000000, 1230000, 2000000].entries()) {
      // llegan casi juntos: la ventana de los adjuntos los atiende en un solo turno
      e.almacen.entrante({ workspaceId: e.deps.workspaceId, phone: e.deps.phone, clase: 'imagen', texto: null, media: { tipo: 'imagen', id: `m-${i}` } })
      e.puerto.archivos.set(`m-${i}`, { bytes: new TextEncoder().encode(`tx-${i}`), mime: 'image/jpeg' })
      void m
    }
    const lecturas = { 'tx-0': lect(1000000, '111'), 'tx-1': lect(1230000, '222'), 'tx-2': lect(2000000, '333') }
    e.deps.dominio = (await escenarioObras({ modelo, puerto: e.puerto, lector: async (a) => lecturas[new TextDecoder().decode(a.bytes) as keyof typeof lecturas] })).deps.dominio
    const t = await e.dicta('los tres son de RCN, mano de obra externa')
    const p = t.at(-1)!
    expect(p.texto).toContain('Registro 3 pagos:')
    expect(p.texto).toContain('Total: *$4.230.000*')
    expect(opciones(p)).toEqual(['Registrar los 3', 'Revisar uno a uno', 'No es de la empresa'])
    const t2 = await e.toca('Registrar los 3')
    expect(t2[0].texto).toBe('✅ Guardados 3 pagos por $4.230.000.')
    expect(e.puerto.escrituras.map((w) => w.numero)).toEqual(['111', '222', '333'])
  })

  it('[Revisar uno a uno]: el primero solo; tras el toque, el siguiente', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 100000, negocio: 'C1 26 2', rubro: 'Transporte' }, { monto: 200000, negocio: 'R1 26 1', rubro: 'Equipos' }] } } },
    ])
    const e = await escenarioObras({ modelo })
    await e.escribe('100 mil de transporte de RCN y 200 mil de equipos de Potosí')
    const t = await e.toca('Revisar uno a uno')
    expect(t[0].texto).toContain('*$100.000*')
    expect(t[0].texto).not.toContain('$200.000')
    const t2 = await e.toca('Sí, regístralo')
    expect(t2[0].texto).toContain('✅ Guardado.')
    expect(t2[0].texto).toContain('*$200.000*')
    await e.toca('Sí, regístralo')
    expect(e.puerto.escrituras.map((w) => w.monto)).toEqual([100000, 200000])
  })

  it('si el turno deja atrás la pendiente, primero «Tienes 1 pago sin confirmar» [Verlos], que la revive sin modelo', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 1850000, negocio: 'R1 26 1', rubro: 'Materiales', soporte: '#1' }] } } },
      { name: 'ver_obra', args: { codigo: 'C1 26 2' } },
      { name: 'responder', args: { tema: 'obra', texto: 'RCN Calle 26: vendido $30.000.000.' } },
    ])
    const e = await escenarioObras({ modelo })
    await e.pantallazo('potosí, materiales', PANTALLAZO_SELLANTE)
    const t = await e.escribe('¿cómo va RCN?')
    expect(t[0].texto).toBe('Tienes 1 pago sin confirmar.')
    expect(opciones(t[0])).toEqual(['Verlos'])
    expect(t[1].texto).toContain('$30.000.000')
    const t2 = await e.toca('Verlos')
    expect(t2[0].texto).toContain('Esto sigue sin confirmar:')
    expect(modelo.restantes()).toBe(0)
    await e.toca('Sí, regístralo')
    expect(e.puerto.escrituras).toHaveLength(1)
  })
})

describe('ingresos y facturas (§3.2, §3.5)', () => {
  it('ingreso con la única factura abierta de la obra; tras el toque, lo recibido de la factura', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'ingreso', datos: { monto: 23950000, negocio: 'F1 26 1' } } },
    ])
    const e = await escenarioObras({ modelo })
    const t = await e.dicta('Ya pagó la Federación el saldo de Calle 93, entraron 23 millones 950')
    expect(t[0].texto).toContain('Ingreso de *$23.950.000* hoy 21-oct · Obra *Edificio Calle 93* (cliente Federación de Prueba) · Paga la factura *FE-231* de $25.000.000.')
    expect(opciones(t[0])).toEqual(['Sí, regístralo', 'Es otra factura', 'No es de factura'])
    const t2 = await e.toca('Sí, regístralo')
    expect(t2[0].texto).toBe('✅ Guardado. La FE-231 tiene $23.950.000 recibidos de $25.000.000. Cuando quede pagada, se marca en ONE.')
    expect(e.puerto.escrituras).toMatchObject([{ tipo: 'ingreso', monto: 23950000, negocio: 'F1 26 1', factura: 'FE-231' }])
  })

  it('[No es de factura] lo vuelve a armar sin factura', async () => {
    const modelo = modeloGuionado([{ name: 'proponer', args: { accion: 'ingreso', datos: { monto: 10000000, negocio: 'F1 26 1' } } }])
    const e = await escenarioObras({ modelo })
    await e.escribe('entró un anticipo de 10 millones de la 93')
    const t = await e.toca('No es de factura')
    expect(t[0].texto).toContain('Sin factura')
    await e.toca('Sí, regístralo')
    expect(e.puerto.escrituras).toMatchObject([{ tipo: 'ingreso', factura: null }])
  })

  it('factura emitida; un número repetido pregunta si es otra', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'factura', datos: { factura: 'FE-240', monto: 12000000, negocio: 'R1 26 1', fecha: '2026-10-18' } } },
      { name: 'proponer', args: { accion: 'factura', datos: { factura: 'FE-231', monto: 25000000, negocio: 'F1 26 1' } } },
    ])
    const e = await escenarioObras({ modelo })
    const t = await e.escribe('emití la FE-240 a Potosí por 12 millones el 18')
    expect(t[0].texto).toBe('Registro la factura *FE-240* del 18-oct por *$12.000.000* a *Reserva de Potosí* (Conjunto Reserva de Potosí).')
    const t2 = await e.toca('Sí, regístrala')
    expect(t2[0].texto).toBe('✅ Guardada. Potosí tiene $12.000.000 facturados y $0 recibidos de esa factura.')
    const t3 = await e.escribe('y la FE-231 de la 93 por 25 millones')
    expect(opciones(t3[0])).toEqual(['Es otra factura', 'Es la misma'])
  })
})

describe('corregir cualquier registro (C14)', () => {
  it('busca en la base, muestra antes y después y cambia con el toque', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar_registros', args: { tipo: 'pago', monto: 1850000, dias: 3 } },
      (p) => {
        const id = /"id":"(p-[^"]+)"/.exec(JSON.stringify(p.mensajes.at(-1)))![1]
        return { name: 'proponer', args: { accion: 'corregir', datos: { tipo: 'pago', id, negocio: 'C1 26 2' } } }
      },
    ])
    const e = await escenarioObras({ modelo, mundo: { pagos: [{ id: 'p-1', fecha: '2026-10-20', monto: 1850000, negocio_id: 'o-potosi', rubro_id: 'r-mat', categoria: 'materiales', numero: '9', huella: null, descripcion: 'sellante' }] } })
    const t = await e.escribe('el de 1.850 de ayer no era Potosí, era RCN')
    expect(t[0].texto).toContain('Antes: Obra Reserva de Potosí')
    expect(t[0].texto).toContain('Después: Obra RCN Calle 26')
    await e.toca('Sí, cámbialo')
    expect(e.puerto.pagos[0].negocio_id).toBe('o-rcn')
  })
})

describe('consultas (C15, C23, §5)', () => {
  it('ver_obra: el cierre de la base, con la mano de obra por jornadas (media en días de dos obras)', async () => {
    const puerto = puertoDePrueba({
      pagos: [{ id: 'p1', fecha: '2026-10-10', monto: 14320000, negocio_id: 'o-potosi', rubro_id: 'r-mat', categoria: 'materiales', numero: null, huella: null, descripcion: null }],
      llegadas: [
        { id: 'l1', collaborator_id: 'op-pedro', negocio_id: 'o-potosi', fecha: '2026-10-20', hora: '2026-10-20T12:12:00Z', valor: 140000 },
        { id: 'l2', collaborator_id: 'op-pedro', negocio_id: 'o-potosi', fecha: '2026-10-21', hora: '2026-10-21T12:12:00Z', valor: 140000 },
        { id: 'l3', collaborator_id: 'op-pedro', negocio_id: 'o-93', fecha: '2026-10-21', hora: '2026-10-21T18:40:00Z', valor: 140000 },
      ],
    })
    const c = await puerto.cierreObra('o-potosi')
    expect(c).toMatchObject({ mano_obra: 210000, jornadas: 1.5, gastos_total: 14320000, utilidad: 48000000 - 14320000 - 210000 })
    const modelo = modeloGuionado([{ name: 'ver_obra', args: { codigo: 'R1 26 1' } }, (p) => {
      const r = JSON.stringify(p.mensajes.at(-1))
      expect(r).toContain('$14.320.000')
      expect(r).toContain('https://prueba.metrikone.co/negocios/o-potosi')
      expect(r).not.toContain('retenido')
      return { name: 'responder', args: { tema: 'obra', texto: '*Reserva de Potosí* al 21-oct\nUtilidad hasta hoy: $33.470.000 (70 %)\nMateriales: $14.320.000\nMano de obra: $210.000 (1.5 jornadas)' } }
    }])
    const e = await escenarioObras({ modelo, puerto })
    const t = await e.escribe('¿Cómo va Potosí?')
    expect(t[0].texto).toContain('Utilidad hasta hoy: $33.470.000')
  })

  it('una cifra que ninguna herramienta devolvió no sale', async () => {
    const modelo = modeloGuionado([
      { name: 'responder', args: { tema: 'obra', texto: 'Potosí va en $21.280.000 de utilidad.' } },
      { name: 'responder', args: { tema: 'obra', texto: 'Potosí va en $21.280.000 de utilidad.' } },
    ])
    const e = await escenarioObras({ modelo })
    const t = await e.escribe('¿cómo va Potosí?')
    expect(t[0].texto).not.toContain('21.280.000')
  })

  it('asistencia de hoy: por obra con la hora y quién no ha marcado', async () => {
    const puerto = puertoDePrueba({ llegadas: [{ id: 'l1', collaborator_id: 'op-pedro', negocio_id: 'o-potosi', fecha: '2026-10-21', hora: '2026-10-21T12:12:00Z', valor: 140000 }] })
    const modelo = modeloGuionado([{ name: 'asistencia', args: {} }, (p) => {
      const r = JSON.stringify(p.mensajes.at(-1))
      expect(r).toContain('"obra":"Potosí","llegadas":[{"persona":"Pedro","hora":"7:12 a. m."}]')
      expect(r).toContain('"sin_marcar_llegada":["Jhon","Luis"]')
      expect(r).not.toContain('$')
      return { name: 'responder', args: { tema: 'asistencia', texto: '*Asistencia de hoy, 21-oct*\nPotosí: Pedro (7:12 a. m.)\nSin marcar llegada: Jhon, Luis' } }
    }])
    const e = await escenarioObras({ modelo, puerto })
    const t = await e.escribe('¿Dónde está la gente hoy?')
    expect(t[0].texto).toContain('Pedro (7:12 a. m.)')
  })
})

describe('el operario: candado de rol (C5, C7, D10)', () => {
  it('su turno solo trae su llegada y sus días: ni pagos, ni asistencia, ni obras', async () => {
    const modelo = modeloGuionado([{ name: 'responder', args: { tema: 'conversacion', texto: 'Buenos días.' } }])
    const e = await escenarioObras({ modelo, quien: { operario: 'op-pedro' } })
    await e.escribe('hola')
    const decl = modelo.pedidos[0].herramientas.map((h) => h.name)
    expect(decl.sort()).toEqual(['mis_dias', 'preguntar_obra', 'proponer', 'responder'].sort())
    const proponer = modelo.pedidos[0].herramientas.find((h) => h.name === 'proponer')!
    expect(JSON.stringify(proponer.parameters)).toContain('"enum":["llegada"]')
    void declaraciones
  })

  it('«ya llegué a Potosí» → confirmar con el nombre de ONE y la hora del MENSAJE (no la del texto); se guarda el id de la obra a su nombre', async () => {
    const modelo = modeloGuionado([{ name: 'proponer', args: { accion: 'llegada', datos: { obra: 'R1 26 1' }, texto: 'Buenos días, Pedro.' } }])
    const e = await escenarioObras({ modelo, quien: { operario: 'op-pedro' } })
    e.reloj.ms = Date.parse('2026-10-21T12:12:00Z') - 20_000
    const t = await e.escribe('Buenos días, ya llegué a Potosí desde las 6')
    expect(t[0].texto).toBe('Buenos días, Pedro.\n¿Anoto su llegada a *Reserva de Potosí*, 7:12 a. m.?')
    expect(opciones(t[0])).toEqual(['Sí, anotar', 'Otra obra'])
    expect(e.puerto.escrituras).toEqual([])
    const t2 = await e.toca('Sí, anotar')
    expect(t2[0].texto).toBe('✅ Llegada anotada. Que le vaya bien.')
    expect(e.puerto.llegadasMem).toMatchObject([{ collaborator_id: 'op-pedro', negocio_id: 'o-potosi', fecha: '2026-10-21', hora: '2026-10-21T12:12:00.000Z', valor: 140000 }])
  })

  it('sin obra: el listado; tocar la obra ya es la confirmación (un toque)', async () => {
    const modelo = modeloGuionado([{ name: 'preguntar_obra', args: { motivo: 'no_dijo', texto: 'Buenos días, Pedro.' } }])
    const e = await escenarioObras({ modelo, quien: { operario: 'op-pedro' } })
    const t = await e.escribe('ya llegué')
    expect(t.map((x) => x.texto)).toEqual(['Buenos días, Pedro.\n¿A qué obra llegó?'])
    expect(opciones(t[0])).toEqual(['Potosí', 'RCN Calle 26', 'Calle 93'])
    const t2 = await e.toca('Potosí')
    expect(t2[0].texto).toBe('✅ Llegada a Potosí anotada, 10:00 a. m. Que le vaya bien.')
    expect(e.puerto.llegadasMem).toHaveLength(1)
  })

  it('obra que no existe: listado con «la oficina la tiene que crear primero»', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'llegada', datos: { obra: 'Chía' } } },
      { name: 'preguntar_obra', args: { motivo: 'no_coincide' } },
    ])
    const e = await escenarioObras({ modelo, quien: { operario: 'op-pedro' } })
    const t = await e.escribe('estoy en Chía')
    expect(t[0].texto).toContain('Si es una obra nueva, la oficina la tiene que crear primero.')
    expect(e.puerto.llegadasMem).toEqual([])
  })

  it('segunda obra el mismo día: medio y medio; tercera: «¿Cambio alguna?»; la misma: no duplica', async () => {
    const puerto = puertoDePrueba({ llegadas: [{ id: 'l1', collaborator_id: 'op-pedro', negocio_id: 'o-potosi', fecha: '2026-10-21', hora: '2026-10-21T12:12:00Z', valor: 140000 }] })
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'llegada', datos: { obra: 'F1 26 1' } } },
      { name: 'proponer', args: { accion: 'llegada', datos: { obra: 'C1 26 2' } } },
      { name: 'proponer', args: { accion: 'llegada', datos: { obra: 'R1 26 1' } } },
      { name: 'responder', args: { tema: 'llegada', texto: 'Ya quedó anotada su llegada a Potosí, 7:12 a. m.' } },
    ])
    const e = await escenarioObras({ modelo, puerto, quien: { operario: 'op-pedro' } })
    const t = await e.escribe('llegué a la 93')
    expect(t[0].texto).toContain('el día queda *medio en Potosí y medio en Calle 93*')
    expect(opciones(t[0])).toEqual(['Sí, mitad y mitad', 'Otra obra'])
    await e.toca('Sí, mitad y mitad')
    const t2 = await e.escribe('ahora en RCN')
    expect(t2[0].texto).toContain('Hoy ya tiene medio día en *Potosí* y medio en *Calle 93*. ¿Cambio alguna por *RCN Calle 26*?')
    await e.toca('No cambiar')
    expect(new Set(puerto.llegadasMem.map((l) => l.negocio_id))).toEqual(new Set(['o-potosi', 'o-93']))
    const t3 = await e.escribe('ya estoy en potosí')
    expect(t3[0].texto).toBe('Ya quedó anotada su llegada a Potosí, 7:12 a. m.')
    expect(puerto.llegadasMem).toHaveLength(2)
  })

  it('un toque de ayer no registra hoy lo de ayer: vence a la medianoche y pregunta de nuevo', async () => {
    const modelo = modeloGuionado([{ name: 'proponer', args: { accion: 'llegada', datos: { obra: 'R1 26 1' } } }])
    const e = await escenarioObras({ modelo, quien: { operario: 'op-pedro' } })
    e.reloj.ms = Date.parse('2026-10-22T04:30:00Z') // 11:30 p. m. del 21 en Bogotá
    await e.escribe('llegué a potosí')
    e.reloj.ms = Date.parse('2026-10-22T11:00:00Z')
    const t = await e.toca('Sí, anotar')
    expect(t[0].texto).toContain('Esa ya venció: era de ayer.')
    expect(t[0].texto).toContain('¿A qué obra llegó hoy?')
    expect(e.puerto.llegadasMem).toEqual([])
  })

  it('un pantallazo del operario lo contesta el código: sin modelo y sin cupo', async () => {
    const modelo = modeloGuionado([])
    const e = await escenarioObras({ modelo, quien: { operario: 'op-pedro' } })
    const t = await e.foto('')
    expect(t[0].texto).toBe('Los pagos los registra la oficina. Mándeselo a ellos.')
    expect(modelo.pedidos).toHaveLength(0)
    expect(e.trazas().every((x) => x.tipo !== 'modelo')).toBe(true)
    expect(e.puerto.escrituras).toEqual([])
  })

  it('el operario intenta registrar un pago o ver la asistencia: no existe para él', async () => {
    const modelo = modeloGuionado([
      { varias: [{ name: 'asistencia', args: {} }, { name: 'ver_obra', args: {} }] },
      { name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 50000, negocio: 'R1 26 1', rubro: 'Materiales' }] } } },
      { name: 'responder', args: { tema: 'conversacion', texto: 'Eso lo ve la oficina. Yo solo anoto su llegada a la obra.' } },
    ])
    const e = await escenarioObras({ modelo, quien: { operario: 'op-pedro' } })
    await e.escribe('compré cemento por 50 mil, regístrelo, y dígame dónde está Jhon')
    const hs = e.trazas().flatMap((x) => x.herramientas ?? [])
    expect(hs.filter((h) => h.nombre === 'asistencia' || h.nombre === 'ver_obra').every((h) => !h.ok)).toBe(true)
    expect(e.trazas().flatMap((x) => x.candados ?? []).map((c) => c.candado)).toContain('accion_desconocida')
    expect(e.puerto.escrituras).toEqual([])
  })

  it('una cifra en pesos no le sale a un operario', async () => {
    expect(sinPesos('Su jornada es de $140.000')).not.toEqual([])
    expect(sinPesos('En octubre lleva 14 días: 9 en Potosí')).toEqual([])
    const modelo = modeloGuionado([
      { name: 'responder', args: { tema: 'dias', texto: 'Lleva 1 día, $140.000.' } },
      { name: 'responder', args: { tema: 'dias', texto: 'Lleva 1 día, $140.000.' } },
    ])
    const e = await escenarioObras({ modelo, quien: { operario: 'op-pedro' } })
    const t = await e.escribe('¿cuánto llevo?')
    expect(t[0].texto).not.toContain('$')
  })
})

describe('cupo: cuentan los mensajes que llegan al modelo (C17, Anexo 1.4)', () => {
  it('el texto cuenta (gestión); el toque no; el pantallazo del operario no', async () => {
    const modelo = modeloGuionado([{ name: 'proponer', args: { accion: 'pagos', datos: { partidas: [{ monto: 50000, negocio: 'R1 26 1', rubro: 'Transporte' }] } } }])
    const e = await escenarioObras({ modelo })
    await e.escribe('50 mil de gasolina a potosí')
    await e.toca('Sí, regístralo')
    const ms = e.trazas().flatMap((x) => x.mensajes ?? [])
    expect(ms).toHaveLength(1)
    expect(ms[0].quien).toBe('gestion')
  })
})

describe('botones', () => {
  it('«No es de …» cabe en 20 caracteres', () => {
    expect(botonNoEsDe('Impervium')).toBe('No es de Impervium')
    expect(botonNoEsDe('Impermeables de Prueba')).toBe('No es de la empresa')
  })

  it('ningún botón de las conversaciones pasa del tope de Meta', async () => {
    const modelo = modeloGuionado([{ name: 'preguntar_destino', args: { para: 'pago', texto: '¿De qué obra es?' } }])
    const e = await escenarioObras({ modelo })
    const t = await e.pantallazo('', PANTALLAZO_SELLANTE)
    expect(todosLosBotonesCaben(t)).toBe(true)
  })
})
