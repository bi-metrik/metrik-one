/**
 * Los TRAMOS de un vuelo: ida y regreso, cada uno con su número, fecha, salida, llegada,
 * escala y equipaje (Parte B, bloque B3, del brief de captura del 2026-09-23).
 *
 * ## Qué es un tramo aquí
 *
 * Un TRAYECTO (ida o regreso), no cada vuelo de una conexión: la lectura no separa la tarifa
 * ni las horas por conexión, así que partirla obligaría a repartir a mano lo que la captura
 * da junto. Es la misma unidad que la tabla de vuelos del documento (`trayectosDelVuelo`).
 *
 * ## De dónde sale, y por qué se guarda
 *
 * Sale de la lectura del pantallazo con lo corregido encima (`detalleDelItem`) y se guarda en
 * `items.tramos` al leer y al corregir. Guardado, el tramo deja de ser una deducción que cada
 * consumidor rehace a su manera: la descripción de la línea y la tabla del documento leen lo
 * mismo. Sin la columna (migración pendiente, o una línea anterior), se deriva de la MISMA
 * lectura con la MISMA función: el documento sale idéntico.
 *
 * ⚠️ Los valores se guardan tal como se leyeron (fecha `AAAA-MM-DD` o `--MM-DD`, hora como
 * vino). Normalizar es trabajo de quien imprime (`horaCorta`, `fechaCorta`): una hora que no
 * parsea se descarta al imprimir, no al guardar, para que la ficha siga mostrando lo leído.
 *
 * ⚠️ Los números de vuelo se reparten entre ida y regreso con la regla del documento
 * (`numerosDeVuelo`): mitad y mitad cuando son pares y hay regreso. Si no se pueden repartir,
 * ningún tramo lleva número —pegarlos todos a la ida afirmaría que el regreso no tiene vuelo— y
 * quedan en `numerosSinTramo`.
 *
 * Puro: no toca la base ni importa nada que la toque.
 */

import { numerosDeVuelo } from '@/lib/pdf/cotizacion-trappvel-formato'

export type SentidoTramo = 'ida' | 'regreso'

export interface EquipajeTramo {
  personal: boolean | null
  mano: boolean | null
  bodega: boolean | null
}

export interface TramoVuelo {
  sentido: SentidoTramo
  origen: string | null
  destino: string | null
  fecha: string | null
  salida: string | null
  llegada: string | null
  /** El número (o los números de una conexión) de ESTE tramo. `null` = no se pudo saber. */
  numero: string | null
  /** Dónde para: «Bogotá», o varias con « · ». `null` = directo o no se leyó el recorrido. */
  escala: string | null
  /**
   * `true` solo si la captura dijo 0 escalas, y solo en la ida (así lo declara la ranura:
   * `escalas` cuenta la ida). Un regreso nunca se afirma directo por omisión.
   */
  directo: boolean | null
  equipaje: EquipajeTramo
}

function texto(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

function booleano(v: string | null | undefined): boolean | null {
  const t = (v ?? '').trim().toLowerCase()
  if (t === 'true' || t === 'sí' || t === 'si') return true
  if (t === 'false' || t === 'no') return false
  return null
}

/**
 * Los tramos de un vuelo a partir de sus campos leídos (slug → valor, con lo corregido
 * encima). Siempre la ida; el regreso solo si la captura leyó algo suyo (fecha u horas):
 * un viaje de solo ida no produce un tramo vacío.
 */
export function tramosDeCampos(valor: (slug: string) => string | null | undefined): {
  tramos: TramoVuelo[]
  numerosSinTramo: string | null
} {
  const origen = texto(valor('origen'))
  const destino = texto(valor('destino'))
  const equipaje: EquipajeTramo = {
    personal: booleano(valor('equipaje_personal')),
    mano: booleano(valor('equipaje_mano')),
    bodega: booleano(valor('equipaje_bodega')),
  }
  const hayRegreso = [valor('fecha_regreso'), valor('hora_salida_regreso'), valor('hora_llegada_regreso')]
    .some(v => texto(v) !== null)
  const numeros = numerosDeVuelo(texto(valor('numero_vuelo')), hayRegreso)
  const escalas = texto(valor('escalas'))

  const ida: TramoVuelo = {
    sentido: 'ida',
    origen,
    destino,
    fecha: texto(valor('fecha_salida')),
    salida: texto(valor('hora_salida')),
    llegada: texto(valor('hora_llegada')),
    numero: numeros.ida,
    escala: texto(valor('escala_ida')),
    directo: escalas === null ? null : Number(escalas) === 0 ? true : Number.isFinite(Number(escalas)) ? false : null,
    equipaje,
  }
  if (!hayRegreso) return { tramos: [ida], numerosSinTramo: numeros.sinAsignar }
  const regreso: TramoVuelo = {
    sentido: 'regreso',
    origen: destino,
    destino: origen,
    fecha: texto(valor('fecha_regreso')),
    salida: texto(valor('hora_salida_regreso')),
    llegada: texto(valor('hora_llegada_regreso')),
    numero: numeros.regreso,
    escala: texto(valor('escala_regreso')),
    directo: null,
    equipaje,
  }
  return { tramos: [ida, regreso], numerosSinTramo: numeros.sinAsignar }
}

function esBooleanoONulo(v: unknown): v is boolean | null {
  return v === null || typeof v === 'boolean'
}

function esTextoONulo(v: unknown): v is string | null {
  return v === null || typeof v === 'string'
}

/**
 * Los tramos guardados en `items.tramos`, validados. `null` = no hay (columna ausente, vacía
 * o con una forma que no se reconoce): quien lee cae a derivarlos de la lectura.
 *
 * ⚠️ Una forma a medias NO se usa a medias: un tramo mal formado invalida el arreglo entero.
 * Imprimir la ida guardada con el regreso deducido mezclaría dos fuentes en la misma tabla.
 */
export function leerTramos(raw: unknown): TramoVuelo[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 2) return null
  const out: TramoVuelo[] = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') return null
    const r = t as Record<string, unknown>
    if (r.sentido !== 'ida' && r.sentido !== 'regreso') return null
    const campos = ['origen', 'destino', 'fecha', 'salida', 'llegada', 'numero', 'escala'] as const
    if (!campos.every(c => esTextoONulo(r[c] ?? null))) return null
    if (!esBooleanoONulo(r.directo ?? null)) return null
    const e = (r.equipaje && typeof r.equipaje === 'object' ? r.equipaje : {}) as Record<string, unknown>
    if (![e.personal, e.mano, e.bodega].every(x => esBooleanoONulo(x ?? null))) return null
    out.push({
      sentido: r.sentido,
      origen: (r.origen ?? null) as string | null,
      destino: (r.destino ?? null) as string | null,
      fecha: (r.fecha ?? null) as string | null,
      salida: (r.salida ?? null) as string | null,
      llegada: (r.llegada ?? null) as string | null,
      numero: (r.numero ?? null) as string | null,
      escala: (r.escala ?? null) as string | null,
      directo: (r.directo ?? null) as boolean | null,
      equipaje: {
        personal: (e.personal ?? null) as boolean | null,
        mano: (e.mano ?? null) as boolean | null,
        bodega: (e.bodega ?? null) as boolean | null,
      },
    })
  }
  if (out[0].sentido !== 'ida') return null
  if (out.length === 2 && out[1].sentido !== 'regreso') return null
  return out
}

/**
 * Un tramo en una línea de la descripción: «Ida AV264: 2026-11-12 13:10–17:00». La hora va
 * pegada a su fecha, y la llegada a la salida: se lee de un golpe y es lo que quien cotiza
 * confirma antes de que el documento salga. `null` si el tramo no trae nada que decir.
 */
export function textoDeTramo(t: TramoVuelo): string | null {
  const horas = t.salida && t.llegada ? `${t.salida}–${t.llegada}` : t.salida ?? (t.llegada ? `llega ${t.llegada}` : null)
  const cuando = [t.fecha, horas].filter(Boolean).join(' ')
  const cabeza = `${t.sentido === 'ida' ? 'Ida' : 'Regreso'}${t.numero ? ` ${t.numero}` : ''}`
  if (!cuando && !t.numero) return null
  return cuando ? `${cabeza}: ${cuando}` : cabeza
}
