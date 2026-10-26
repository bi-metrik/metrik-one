import { epaycoHabilitado, esTokenTarjeta } from '@/lib/suscripciones/pasarela/epayco'
import { esTipoDocumentoTitular, limpiarDocumentoTitular, limpiarNombrePersona, nombreEnTarjeta, type TipoDocumentoTitular } from './documento-titular'

/**
 * El método de pago al registrarse (decisión A2: la empresa registra la tarjeta y se le cobra al
 * terminar la prueba). Puro.
 *
 * Se pide SOLO si las dos cosas están: ePayco encendido y las Condiciones vigentes con la cláusula de
 * cobro (`condicionesVigentes().conCobro`). Con las Condiciones v1.0 («no pide tarjeta ni ningún medio
 * de pago») pedirla sería contradecir lo que la persona acepta, así que la pantalla no la pide aunque
 * ePayco esté encendido.
 *
 * Lo que llega del navegador es el TOKEN que dio ePayco.js, el nombre del titular, su documento y un
 * celular (ePayco los exige). Nunca el número, la fecha ni el CVC: esos campos no tienen `name` en el
 * formulario y no viajan a ONE.
 *
 * El documento es el del TITULAR de la tarjeta, no el NIT de la empresa: el antifraude de ePayco
 * compara el documento y el nombre del cobro con los del medio de pago, y una tarjeta personal
 * mandada con el NIT de la empresa sale «Rechazada eControl» (transacción 390341460, 2026-10-19).
 */
export function pideMetodoPago(conCobro: boolean, env: Record<string, string | undefined> = process.env): boolean {
  return conCobro && epaycoHabilitado(env)
}

export interface TarjetaRegistro {
  token: string
  /** Nombres y apellidos del titular, en dos campos: partirlos en la primera palabra fallaba (390432324). */
  nombres: string
  apellidos: string
  /** Los dos juntos, como van en `card[name]` y en lo que se guarda. */
  titular: string
  tipoDocumento: TipoDocumentoTitular
  documento: string
  celular: string
}

export type ProblemaTarjeta = 'sin_tarjeta' | 'token' | 'nombres' | 'apellidos' | 'tipo_documento' | 'documento' | 'celular'

export function leerTarjeta(v: unknown): { ok: true; tarjeta: TarjetaRegistro } | { ok: false; problema: ProblemaTarjeta } {
  if (!v || typeof v !== 'object') return { ok: false, problema: 'sin_tarjeta' }
  const t = v as Record<string, unknown>
  if (!esTokenTarjeta(t.token)) return { ok: false, problema: 'token' }
  const nombres = limpiarNombrePersona(t.nombres)
  if (!nombres) return { ok: false, problema: 'nombres' }
  const apellidos = limpiarNombrePersona(t.apellidos)
  if (!apellidos) return { ok: false, problema: 'apellidos' }
  if (!esTipoDocumentoTitular(t.tipoDocumento)) return { ok: false, problema: 'tipo_documento' }
  const documento = limpiarDocumentoTitular(t.tipoDocumento, t.documento)
  if (!documento) return { ok: false, problema: 'documento' }
  const celular = typeof t.celular === 'string' ? t.celular.replace(/\D/g, '') : ''
  if (!/^3\d{9}$/.test(celular)) return { ok: false, problema: 'celular' }
  return {
    ok: true,
    tarjeta: { token: t.token as string, nombres, apellidos, titular: nombreEnTarjeta(nombres, apellidos), tipoDocumento: t.tipoDocumento, documento, celular },
  }
}

export function textoProblemaTarjeta(p: ProblemaTarjeta): string {
  switch (p) {
    case 'sin_tarjeta':
    case 'token':
      return 'No pudimos registrar la tarjeta. Revisa los datos e inténtalo de nuevo.'
    case 'nombres':
      return 'Escribe los nombres del titular como aparecen en la tarjeta.'
    case 'apellidos':
      return 'Escribe los apellidos del titular como aparecen en la tarjeta.'
    case 'tipo_documento':
      return 'Elige el tipo de documento del titular de la tarjeta.'
    case 'documento':
      return 'Escribe el número de documento del titular de la tarjeta, sin puntos.'
    case 'celular':
      return 'Escribe un celular de 10 dígitos que empiece por 3.'
  }
}

/**
 * «Nombre Apellido Otro» → nombre y apellido, partido en la primera palabra. Solo para lo que no trae
 * los dos campos: la razón social de un registro viejo y el titular guardado antes del 2026-10-20.
 */
export function partirNombre(titular: string): { nombre: string; apellido: string } {
  const partes = titular.trim().split(/\s+/)
  if (partes.length === 1) return { nombre: partes[0], apellido: partes[0] }
  return { nombre: partes[0], apellido: partes.slice(1).join(' ') }
}

/**
 * Lo que se guarda del pagador en `workspaces.config_extra.valida_pagador`: lo mínimo que ePayco pide
 * en cada cobro y que no está en otra parte. El titular de la tarjeta puede no ser la empresa.
 */
export interface PagadorGuardado {
  celular: string
  /**
   * Desde el 2026-10-19. Los registros de antes solo tienen el celular. `nombres` y `apellidos`,
   * desde el 2026-10-20: los del 19 solo tienen `nombre` (completo) y se parten como antes.
   */
  titular?: { nombre: string; nombres?: string; apellidos?: string; tipo_documento: TipoDocumentoTitular; documento: string }
}

export function pagadorParaGuardar(t: TarjetaRegistro): PagadorGuardado {
  return {
    celular: t.celular,
    titular: { nombre: t.titular, nombres: t.nombres, apellidos: t.apellidos, tipo_documento: t.tipoDocumento, documento: t.documento },
  }
}

/**
 * El documento y el nombre con que se cobra la tarjeta: los del titular guardado en el registro. Un
 * registro de antes del 2026-10-19 no tiene titular: se cobra como antes, con el NIT y la razón social
 * de la empresa (`respaldo`).
 */
export function titularDelCobro(
  pagador: unknown,
  respaldo: { nit: string; razonSocial: string },
): { tipoDocumento: string; documento: string; nombre: string; apellido: string } {
  const t = (pagador && typeof pagador === 'object' ? (pagador as { titular?: unknown }).titular : null) as Record<string, unknown> | null
  if (t && esTipoDocumentoTitular(t.tipo_documento) && typeof t.nombre === 'string' && t.nombre.trim()) {
    const documento = limpiarDocumentoTitular(t.tipo_documento, t.documento)
    const nombres = limpiarNombrePersona(t.nombres)
    const apellidos = limpiarNombrePersona(t.apellidos)
    const nombre = nombres && apellidos ? { nombre: nombres, apellido: apellidos } : partirNombre(t.nombre)
    if (documento) return { tipoDocumento: t.tipo_documento, documento, ...nombre }
  }
  return { tipoDocumento: 'NIT', documento: respaldo.nit, ...partirNombre(respaldo.razonSocial) }
}
