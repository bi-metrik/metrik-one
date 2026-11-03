import { describe, expect, it } from 'vitest'
import { escenario } from './escenario'
import { modeloGuionado } from './modelo-guionado'

/**
 * Falla medida con el modelo real (Trappvel, 2026-10-30; igual en main y en la rama de #1353): el comercial escribe el
 * pedido («dos adultos», destino, fechas) ANTES de crear al cliente; tras el toque «Crear» el modelo propone
 * `viaje_nuevo` sin `desde` y el pedido quedaba fuera de lo que se anota al abrirlo (2 de 3 corridas). El inicio del
 * viaje era el turno que lo propuso, que es el del toque.
 *
 * El invariante ya no depende de que el modelo mande `desde`: si el cliente del viaje se creó en esta conversación
 * después del último viaje nombrado, el pedido de ese viaje empieza justo después de ese último viaje (o al principio).
 * Datos INVENTADOS. Los modelos son guiones: ninguna llamada a un modelo real.
 */

const PEDIDO = 'Nueva solicitud, dos adultos a Curazao entre el 21 de junio y el 4 de julio de 2027, hoteles de 3 o 4 estrellas'
const DATOS_CLIENTE = 'Es Marta Rincón con celular 3155550142'
const REF = 'Marta Rincón (cel. …0142)'

describe('viaje_nuevo sin `desde`: el pedido escrito antes de crear al cliente no se pierde', () => {
  it('pedido → crear cliente → el modelo propone el viaje sin `desde` → al abrirlo se anota el pedido', async () => {
    const modelo = modeloGuionado([
      { name: 'responder', args: { tema: 'solicitud', texto: '¿A nombre de quién y con qué celular?' } },
      { name: 'buscar', args: { texto: DATOS_CLIENTE } },
      { name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Marta Rincón', llave: '3155550142' } } },
      // Tras el toque: el viaje, SIN `desde`.
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { responsable: 'Carla Comercial', dicho_en: 1, cliente: REF, destino: 'Curazao' } } },
    ])
    const e = await escenario({ modelo })
    await e.escribe(PEDIDO)
    await e.escribe(DATOS_CLIENTE)
    await e.toca('Crear')
    const r = await e.toca('Sí, ábrelo')
    expect(r[0].texto).toMatch(/Abrí \S+ 26 1 · Curazao para Marta Rincón\./)
    expect(r[0].texto).toContain('¿Lo anoto en')
    expect(r[0].texto).toContain(`• ${PEDIDO.slice(0, 70)}`)
    expect(r[0].texto).not.toContain('Reenvíame lo que te escribió')
    await e.toca('Anotar')
    expect(e.puerto.escrituras.at(-1)).toMatchObject({ tipo: 'carga' })
    expect(e.puerto.escrituras.at(-1)!.textos as string[]).toContain(PEDIDO)
  })

  it('el responsable llega en otro turno después del toque: igual se anota el pedido', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: DATOS_CLIENTE } },
      { name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Marta Rincón', llave: '3155550142' } } },
      { name: 'responder', args: { tema: 'solicitud', texto: '¿Quién lleva este viaje?' } },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { responsable: 'Beto Ventas', dicho_en: 5, cliente: REF, destino: 'Curazao' } } },
    ])
    const e = await escenario({ modelo })
    await e.escribe(`${PEDIDO}. ${DATOS_CLIENTE}`)
    await e.toca('Crear')
    await e.escribe('Asígneselo a Beto Ventas, por favor.')
    const r = await e.toca('Sí, ábrelo')
    expect(r[0].texto).toContain('¿Lo anoto en')
    expect(r[0].texto).toContain(`• ${PEDIDO.slice(0, 70)}`)
  })

  it('lo escrito de otro viaje antes de nombrarlo por última vez no entra al viaje del cliente nuevo', async () => {
    const OTRO = 'en el A1 26 1 agrega que la señora viaja con su mamá'
    const modelo = modeloGuionado([
      { name: 'responder', args: { tema: 'solicitud', texto: 'Listo, ¿lo anoto?' } },
      { name: 'buscar', args: { texto: DATOS_CLIENTE } },
      { name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Marta Rincón', llave: '3155550142' } } },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { responsable: 'Carla Comercial', dicho_en: 3, cliente: REF, destino: 'Curazao' } } },
    ])
    const e = await escenario({
      modelo,
      contactos: [{ id: 'c-ana', nombre: 'Ana Prieto', celular: '3005550111' }],
      viajes: [{ id: 'v-a', codigo: 'A1 26 1', contactoId: 'c-ana', nombre: 'ARUBA', destino: 'Aruba', abierto: true, datos: {} }],
    })
    await e.escribe(OTRO)
    await e.escribe(`${PEDIDO}. ${DATOS_CLIENTE}`)
    await e.toca('Crear')
    const r = await e.toca('Sí, ábrelo')
    expect(r[0].texto).toContain(`• ${PEDIDO.slice(0, 70)}`)
    expect(r[0].texto).not.toContain('viaja con su mamá')
  })
})
