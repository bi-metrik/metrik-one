import { describe, expect, it } from 'vitest'
import { escenarioOne } from './escenario'
import { modeloGuionado } from '../modelo-guionado'
import { anunciaQueNoRegistra } from '../nucleo'
import { fechaCorta, permisosDe } from './dominio'
import { ROLE_PERMISSIONS } from '../../../../../src/lib/roles'
import type { ArchivoAdjunto, Lector } from './lectura-adjunto'
import type { LecturaAdjunto, PedidoModelo } from '../tipos'

/**
 * Ingresos por WhatsApp (2026-10-21, Mauricio: «dale con los ingresos»). Caso real: «registra el siguiente ingreso en el
 * proyecto de Dimpro» con la foto de un comprobante de $400.000; el bot lo propuso como GASTO, y al corregirle «no es un
 * gasto, es un ingreso» contestó «solo puedo anotar gastos… lo cancelo» y en el MISMO mensaje volvió a mostrar la
 * propuesta de gasto. El negocio tenía la cuota 1 de $400.000, esperada el 26-oct, sin pagar. Datos inventados salvo la
 * forma del caso.
 */

const NEGOCIOS = [
  { id: 'n-d', codigo: 'D1 26 5', nombre: 'Documentación de gasoducto', empresa: 'Dimpro Pruebas', contacto: null, etapa: 'cobro', valor: 1_200_000 },
  { id: 'n-a', codigo: 'A1 26 1', nombre: 'Concesión de prueba', empresa: 'Alfa Grupo', contacto: null, etapa: 'cobro', valor: 1_000_000 },
]
const CUOTA_1 = { id: 'cobro-1', negocioId: 'n-d', numeroCuota: 1, monto: 400000, fechaEsperada: '2026-10-26', notas: null, fecha: null, soporte: null }
const CUOTA_2 = { id: 'cobro-2', negocioId: 'n-d', numeroCuota: 2, monto: 800000, fechaEsperada: '2026-11-26', notas: null, fecha: null, soporte: null }
const FOTO: ArchivoAdjunto = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 0xff, 0xd9]), mime: 'image/jpeg' }
const comprobante = (monto: number): LecturaAdjunto => ({ legible: true, monto, fecha: '2026-10-21', comercio: 'Banco de Pruebas', nit: null, descripcion: 'depósito electrónico, Documentación de gasoducto' })
const lectorDe = (l: LecturaAdjunto | null): Lector => async () => l
const textoDelTurno = (p: PedidoModelo) => String(p.mensajes[0].parts[0].text)

async function mundo(o: { rol?: string; lectura?: LecturaAdjunto | null; cuotas?: Array<typeof CUOTA_1>; guion: Parameters<typeof modeloGuionado>[0] }) {
  const e = await escenarioOne({ modelo: modeloGuionado(o.guion), negocios: NEGOCIOS, rol: o.rol ?? 'owner', lector: lectorDe(o.lectura === undefined ? comprobante(400000) : o.lectura) })
  e.puerto.cobros = structuredClone(o.cuotas ?? [CUOTA_1, CUOTA_2])
  return e
}

describe('el caso real: comprobante de $400.000 que cuadra con la cuota 1', () => {
  it('propone marcar la cuota pagada con el soporte, y con el toque la confirma por el camino de la app', async () => {
    const e = await mundo({
      guion: [
        (p) => {
          expect(textoDelTurno(p)).toContain('registrar ingresos (pagos recibidos de cuotas de un negocio)')
          expect(textoDelTurno(p)).toContain('lo que dice el archivo: total $400.000')
          return { name: 'buscar_negocios', args: { texto: 'Dimpro' } }
        },
        { name: 'proponer', args: { accion: 'ingreso', datos: { negocio: 'D1 26 5', soporte: '#1' } } },
      ],
    })
    const t = await e.foto('registra el siguiente ingreso en el proyecto de Dimpro', { archivo: FOTO })
    expect(t[0].texto).toBe([
      '💵 Cuadra con la cuota 1 de $400.000 de D1 26 5 · Dimpro Pruebas — Documentación de gasoducto, esperada el 26-oct',
      '📅 Pagado el 21-oct',
      '📷 Con la foto #1 como soporte',
      '¿La marco como pagada con este soporte?',
    ].join('\n'))
    expect('opciones' in t[0] && t[0].opciones.map((x) => x.titulo)).toEqual(['Marcar pagada', 'No'])
    expect(e.puerto.escrituras).toEqual([])
    const h = await e.toca('Marcar pagada')
    expect(h[0].texto).toContain('✅ Cuota 1 de D1 26 5 · Dimpro Pruebas — Documentación de gasoducto marcada como pagada: $400.000, 21-oct.')
    expect(h[0].texto).toContain('📎 Con su soporte.')
    const c = e.puerto.cobros.find((x) => x.id === 'cobro-1')!
    expect(c.fecha).toBe('2026-10-21')
    expect(c.monto).toBe(400000)
    expect(c.soporte).toMatchObject({ url: expect.stringMatching(/^one:\/\/gastos-soportes\//), mime_type: 'image/jpeg' })
    expect(e.puerto.escrituras).toEqual([{ tipo: 'cobro', id: 'cobro-1', fecha: '2026-10-21', monto: 400000, soporte: true }])
  })
})

describe('un pago que no cuadra: no inventa, y el parcial solo con la persona', () => {
  it('no cuadra → candado con las cuotas; la persona dice que es un abono → pago parcial a la cuota 1', async () => {
    const e = await mundo({
      lectura: comprobante(350000),
      guion: [
        { name: 'proponer', args: { accion: 'ingreso', datos: { negocio: 'D1 26 5', soporte: '#1' } } },
        (p) => {
          const r = JSON.stringify(p.mensajes.at(-1))
          expect(r).toContain('no cuadra con ninguna cuota pendiente')
          expect(r).toContain('cuota 1 de $400.000 (esperada el 2026-10-26); cuota 2 de $800.000')
          return { name: 'responder', args: { tema: 'ingreso', texto: 'El pago de $350.000 no cuadra con ninguna cuota de D1 26 5 (la 1 es de $400.000). ¿Es un abono a la cuota 1, es de otro negocio o es un pago no programado?' } }
        },
        { name: 'proponer', args: { accion: 'ingreso', datos: { negocio: 'D1 26 5', soporte: '#1', cuota: '1', parcial: true } } },
      ],
    })
    await e.foto('pago de dimpro D1 26 5', { archivo: FOTO })
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['ingreso_no_cuadra'])
    expect(e.puerto.escrituras).toEqual([])
    const t = await e.escribe('es un abono a la cuota 1')
    expect(t[0].texto).toContain('💵 Pago parcial de $350.000 a la cuota 1 de $400.000 de D1 26 5')
    expect(t[0].texto).toContain('⚠️ La cuota queda confirmada por $350.000 (lo que entró), no por $400.000')
    await e.toca('Marcar pagada')
    expect(e.puerto.cobros.find((x) => x.id === 'cobro-1')).toMatchObject({ fecha: '2026-10-21', monto: 350000 })
  })

  it('cuadra por monto con la cuota que corresponde (la 2 de $800.000), no con la primera', async () => {
    const e = await mundo({ lectura: comprobante(800000), guion: [{ name: 'proponer', args: { accion: 'ingreso', datos: { negocio: 'D1 26 5', soporte: '#1' } } }] })
    const t = await e.foto('pago de dimpro', { archivo: FOTO })
    expect(t[0].texto).toContain('💵 Cuadra con la cuota 2 de $800.000')
  })

  it('una cuota nombrada que no cuadra, sin decir que es parcial, tampoco se propone', async () => {
    const e = await mundo({
      guion: [
        { name: 'proponer', args: { accion: 'ingreso', datos: { negocio: 'D1 26 5', soporte: '#1', cuota: '2' } } },
        { name: 'responder', args: { tema: 'ingreso', texto: 'No cuadra con la cuota 2.' } },
      ],
    })
    await e.foto('pago de la cuota 2 de dimpro', { archivo: FOTO })
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['ingreso_no_cuadra'])
  })

  it('un negocio sin cuotas pendientes: no se registra nada y se dice', async () => {
    const e = await mundo({
      cuotas: [],
      guion: [
        { name: 'proponer', args: { accion: 'ingreso', datos: { negocio: 'A1 26 1', monto: 400000 } } },
        { name: 'responder', args: { tema: 'ingreso', texto: 'A1 26 1 no tiene cuotas pendientes en ONE.' } },
      ],
    })
    await e.escribe('recibí 400000 de alfa A1 26 1')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['sin_cobros_pendientes'])
    expect(e.puerto.escrituras).toEqual([])
  })

  it('las cuotas se leen frescas: si alguien la pagó en la app antes del toque, no se escribe nada', async () => {
    const e = await mundo({ guion: [{ name: 'proponer', args: { accion: 'ingreso', datos: { negocio: 'D1 26 5', soporte: '#1' } } }] })
    await e.foto('ingreso de dimpro', { archivo: FOTO })
    e.puerto.cobros[0].fecha = '2026-10-20'
    const t = await e.toca('Marcar pagada')
    expect(t[0].texto).toContain('No pude hacerlo ahora')
    expect(e.puerto.escrituras).toEqual([])
  })
})

describe('permisos: solo quien puede registrar cobros en la app', () => {
  it('un operador recibe el «no tiene permiso» y nada se propone', async () => {
    const e = await mundo({
      rol: 'operator',
      guion: [
        { name: 'proponer', args: { accion: 'ingreso', datos: { negocio: 'D1 26 5', soporte: '#1' } } },
        { name: 'responder', args: { tema: 'ingreso', texto: 'Tu rol no permite registrar ingresos por aquí.' } },
      ],
    })
    await e.foto('ingreso de dimpro', { archivo: FOTO })
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['rol'])
    expect(e.puerto.escrituras).toEqual([])
  })

  it('permisosDe().ingresos es exactamente canRegisterCobro de src/lib/roles.ts', () => {
    for (const [rol, p] of Object.entries(ROLE_PERMISSIONS)) expect([rol, permisosDe(rol).ingresos]).toEqual([rol, p.canRegisterCobro])
  })
})

describe('«no es un gasto, es un ingreso» a mitad de la propuesta (el bug del caso real)', () => {
  it('el texto «lo cancelo» no sale con la propuesta de gasto debajo; se propone el ingreso y el botón viejo no registra', async () => {
    const e = await mundo({
      guion: [
        { name: 'proponer', args: { accion: 'gasto', datos: { monto: 400000, negocio: 'D1 26 5', categoria: 'otros', soporte: '#1' } } },
        // Lo que hizo el bot real: dice que cancela y vuelve a proponer el gasto.
        { name: 'proponer', args: { accion: 'gasto', texto: 'Solo puedo anotar gastos; lo cancelo.', datos: { monto: 400000, negocio: 'D1 26 5', categoria: 'otros', soporte: '#1' } } },
        { name: 'proponer', args: { accion: 'ingreso', datos: { negocio: 'D1 26 5', soporte: '#1' } } },
      ],
    })
    const t1 = await e.foto('registra el siguiente ingreso en el proyecto de Dimpro', { archivo: FOTO })
    expect(t1[0].texto).toContain('💰 Gasto de $400.000')
    const t2 = await e.escribe('no es un gasto, es un ingreso, es el pago del proyecto')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['propuesta_contradicha'])
    expect(t2).toHaveLength(1)
    expect(t2[0].texto).not.toContain('lo cancelo')
    expect(t2[0].texto).toContain('💵 Cuadra con la cuota 1 de $400.000')
    // El «Registrar» del gasto ya venció: no escribe.
    await e.toca('Registrar')
    expect(e.puerto.escrituras).toEqual([])
    await e.toca('Marcar pagada')
    expect(e.puerto.escrituras.map((x) => x.tipo)).toEqual(['cobro'])
  })

  it('anunciaQueNoRegistra: lee lo que escribe el BOT, no a la persona', () => {
    expect(anunciaQueNoRegistra('Solo puedo anotar gastos… lo cancelo')).toBe(true)
    expect(anunciaQueNoRegistra('No lo registro: falta el negocio')).toBe(true)
    expect(anunciaQueNoRegistra('Cuadra con la cuota 1')).toBe(false)
    expect(anunciaQueNoRegistra('¿Lo registro con este soporte?')).toBe(false)
  })

  it('fechaCorta', () => {
    expect(fechaCorta('2026-10-26')).toBe('26-oct')
  })
})
