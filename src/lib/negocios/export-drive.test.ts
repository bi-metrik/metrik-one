import { describe, expect, it } from 'vitest'
import {
  correosPendientes,
  decidirAccionArchivo,
  leerConfigExportDrive,
  LLAVE_CORREOS,
  LLAVE_EXPORT_DRIVE,
  LLAVE_FILE_ID,
  nombreArchivoDrive,
  normalizarCorreos,
} from './export-drive'

/**
 * Las tres decisiones que deciden si se pisa el archivo de un cliente o se crea uno
 * nuevo, y a quien se le abre el acceso.
 *
 * ⚠️ Vistas FALLAR el 2026-09-10, por mutacion, una por una (se aplico la mutacion, se
 * corrio SOLO este archivo, se restauro). Lo que cayo en cada caso esta anotado sobre
 * el `describe` correspondiente. Sin eso, un archivo de pruebas que solo pasa no dice
 * nada sobre si el codigo hace algo.
 */

// ── Lectura de configuracion ────────────────────────────────────────────────

const conBloque = (bloque: unknown) => ({ [LLAVE_EXPORT_DRIVE]: bloque })

/**
 * Mutacion probada: quitar el `if (fileId === null)` de `leerConfigExportDrive` para
 * que el ultimo ambito gane en vez del primero.
 * Cayo: «la linea gana sobre el workspace».
 */
describe('leerConfigExportDrive', () => {
  it('sin configuracion devuelve nada, sin reventar', () => {
    expect(leerConfigExportDrive([])).toEqual({ fileId: null, correos: [] })
    expect(leerConfigExportDrive([null, undefined, {}])).toEqual({ fileId: null, correos: [] })
  })

  it('lee el file_id y los correos del workspace', () => {
    const cfg = leerConfigExportDrive([
      conBloque({ [LLAVE_FILE_ID]: '1AbC', [LLAVE_CORREOS]: ['a@x.com', 'b@x.com'] }),
    ])
    expect(cfg).toEqual({ fileId: '1AbC', correos: ['a@x.com', 'b@x.com'] })
  })

  it('la linea gana sobre el workspace (precedencia por orden de la lista)', () => {
    const linea = conBloque({ [LLAVE_FILE_ID]: 'de-la-linea' })
    const workspace = conBloque({ [LLAVE_FILE_ID]: 'del-workspace' })
    expect(leerConfigExportDrive([linea, workspace]).fileId).toBe('de-la-linea')
  })

  it('la precedencia es POR CLAVE: la linea fija el archivo y hereda los correos', () => {
    // Si fuera en bloque, una linea con archivo propio se quedaria sin lista de
    // correos y habria que repetirla en cada linea — que es como se desincronizan.
    const linea = conBloque({ [LLAVE_FILE_ID]: 'de-la-linea' })
    const workspace = conBloque({ [LLAVE_FILE_ID]: 'otro', [LLAVE_CORREOS]: ['a@x.com'] })
    expect(leerConfigExportDrive([linea, workspace])).toEqual({
      fileId: 'de-la-linea',
      correos: ['a@x.com'],
    })
  })

  it('un file_id vacio o en blanco cuenta como ausente', () => {
    expect(leerConfigExportDrive([conBloque({ [LLAVE_FILE_ID]: '' })]).fileId).toBeNull()
    expect(leerConfigExportDrive([conBloque({ [LLAVE_FILE_ID]: '   ' })]).fileId).toBeNull()
  })

  it('aguanta un bloque con la forma equivocada sin lanzar', () => {
    // Es config escrita a mano: un arreglo o una cadena donde deberia ir un objeto no
    // puede tumbar la subida.
    expect(leerConfigExportDrive([conBloque('texto suelto')]).fileId).toBeNull()
    expect(leerConfigExportDrive([conBloque(['a', 'b'])]).correos).toEqual([])
    expect(leerConfigExportDrive([conBloque({ [LLAVE_CORREOS]: 'a@x.com' })]).correos).toEqual([])
  })
})

// ── Correos ─────────────────────────────────────────────────────────────────

/**
 * Mutacion probada: quitar el filtro del regex en `normalizarCorreos` (dejar pasar
 * cualquier cadena no vacia).
 * Cayeron: «descarta lo que no es un correo» y «lista vacia».
 */
describe('normalizarCorreos', () => {
  it('recorta, baja a minusculas y quita repetidos', () => {
    expect(normalizarCorreos([' Deisy.Ramirez@GrupoSoena.com ', 'deisy.ramirez@gruposoena.com']))
      .toEqual(['deisy.ramirez@gruposoena.com'])
  })

  it('descarta lo que no es un correo, sin tumbar el resto', () => {
    expect(normalizarCorreos(['', '   ', 'Daniela', 'sin-arroba.com', 'a@b', 42, null,
      'daniela.jativa@gruposoena.com']))
      .toEqual(['daniela.jativa@gruposoena.com'])
  })

  it('lista vacia es lista vacia (no revienta, no inventa)', () => {
    expect(normalizarCorreos([])).toEqual([])
  })
})

/**
 * Mutacion probada: en `correosPendientes`, devolver `deseados` sin filtrar por los
 * permisos ya concedidos.
 * Cayeron: «no repite a quien ya tiene acceso» y «compara sin distinguir mayusculas».
 */
describe('correosPendientes', () => {
  it('con la lista vacia no hay nada que compartir', () => {
    expect(correosPendientes([], [])).toEqual([])
    expect(correosPendientes([], [{ emailAddress: 'a@x.com', role: 'reader', type: 'user' }]))
      .toEqual([])
  })

  it('en el primer clic todos estan pendientes', () => {
    expect(correosPendientes(['a@x.com', 'b@x.com'], [])).toEqual(['a@x.com', 'b@x.com'])
  })

  it('no repite a quien ya tiene acceso', () => {
    const permisos = [{ emailAddress: 'a@x.com', role: 'reader', type: 'user' }]
    expect(correosPendientes(['a@x.com', 'b@x.com'], permisos)).toEqual(['b@x.com'])
  })

  it('compara sin distinguir mayusculas ni espacios', () => {
    const permisos = [{ emailAddress: '  A@X.com ', role: 'reader', type: 'user' }]
    expect(correosPendientes(['a@x.com'], permisos)).toEqual([])
  })

  it('NO le baja el rol a quien alguien subio a editor a mano', () => {
    // Solo se mira la direccion. Bajarlo seria pisar una decision tomada con el
    // archivo delante, y este boton no tiene contexto para eso.
    const permisos = [{ emailAddress: 'a@x.com', role: 'writer', type: 'user' }]
    expect(correosPendientes(['a@x.com'], permisos)).toEqual([])
  })

  it('ignora los permisos sin direccion (el dueno, `anyone`)', () => {
    const permisos = [{ emailAddress: null, role: 'owner', type: 'user' },
      { emailAddress: '', role: 'reader', type: 'anyone' }]
    expect(correosPendientes(['a@x.com'], permisos)).toEqual(['a@x.com'])
  })
})

// ── Crear vs. actualizar ────────────────────────────────────────────────────

/**
 * Mutacion probada: en `decidirAccionArchivo`, devolver siempre
 * `{accion:'actualizar'}` cuando hay `fileId`, sin mirar la ficha.
 * Cayeron las tres de recreacion (borrado, papelera, sin permiso).
 *
 * Segunda mutacion probada: devolver `soltarFileId: null` siempre.
 * Cayo «dice QUE id hay que soltar».
 */
describe('decidirAccionArchivo', () => {
  const sano = { id: '1AbC', trashed: false, puedeEditar: true }

  it('sin file_id guardado, crea', () => {
    expect(decidirAccionArchivo(null, null)).toEqual({
      accion: 'crear', soltarFileId: null, motivo: 'sin_file_id',
    })
  })

  it('con un archivo sano, actualiza en sitio', () => {
    expect(decidirAccionArchivo('1AbC', sano)).toEqual({ accion: 'actualizar', fileId: '1AbC' })
  })

  it('si el archivo guardado ya no existe, crea otro', () => {
    // Este es el caso que deja el boton roto PARA SIEMPRE si no se comprueba: el
    // update contra un id borrado responde 404 en cada clic.
    expect(decidirAccionArchivo('1AbC', null)).toEqual({
      accion: 'crear', soltarFileId: '1AbC', motivo: 'no_existe',
    })
  })

  it('si el archivo guardado esta en la papelera, crea otro', () => {
    expect(decidirAccionArchivo('1AbC', { ...sano, trashed: true })).toEqual({
      accion: 'crear', soltarFileId: '1AbC', motivo: 'en_papelera',
    })
  })

  it('si el archivo existe pero ya no se puede escribir, crea otro', () => {
    expect(decidirAccionArchivo('1AbC', { ...sano, puedeEditar: false })).toEqual({
      accion: 'crear', soltarFileId: '1AbC', motivo: 'sin_permiso',
    })
  })

  it('dice QUE id hay que soltar, para no tirar el de otro', () => {
    // El id viaja aparte del motivo a proposito: quien ejecuta suelta ESE y no el que
    // haya en la base cuando llegue, que pudo cambiar en el medio.
    const plan = decidirAccionArchivo('el-roto', null)
    expect(plan).toMatchObject({ accion: 'crear', soltarFileId: 'el-roto' })
  })

  it('una ficha sin `puedeEditar` se toma como editable', () => {
    // Drive puede no devolver `capabilities` segun los campos pedidos; ausente no es
    // lo mismo que `false`, y tratarlo como false crearia un archivo nuevo por clic.
    expect(decidirAccionArchivo('1AbC', { id: '1AbC', trashed: false }))
      .toEqual({ accion: 'actualizar', fileId: '1AbC' })
  })
})

// ── Nombre ──────────────────────────────────────────────────────────────────

describe('nombreArchivoDrive', () => {
  it('lleva el nombre del espacio', () => {
    expect(nombreArchivoDrive('SOENA')).toBe('Negocios — SOENA')
  })

  it('sin nombre de espacio no deja un guion suelto', () => {
    expect(nombreArchivoDrive('')).toBe('Negocios')
    expect(nombreArchivoDrive('   ')).toBe('Negocios')
  })

  it('NO lleva fecha: el archivo es uno solo y se actualiza en sitio', () => {
    // Con fecha, el nombre mentiria desde el segundo clic.
    expect(nombreArchivoDrive('SOENA')).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})
