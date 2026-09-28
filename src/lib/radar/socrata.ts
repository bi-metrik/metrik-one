/**
 * La fuente del Radar: SECOP II Procesos de Contratación en datos.gov.co (Socrata, dataset
 * `p6dx-8zbt`). Puro y sin `fetch`: lo que se prueba es el mapeo y la deduplicación, no la red.
 *
 * Spec: `proyectos/metrik/one/2026-09-28_spec-radar-secop-en-one.md`, bloque D.
 *
 * ## Las tres cosas que este archivo hace ciertas
 *
 * 1. **Se pagina.** El `$limit` de Socrata corta en silencio, y un barrido corto se lee igual que
 *    uno completo: por eso `paginaSocrata` construye la URL con `$offset` y el cron sigue pidiendo
 *    hasta que un lote venga incompleto. No hay forma de distinguir «se acabó» de «me cortaron»
 *    mirando solo el conteo.
 * 2. **Se deduplica por `notice_uid`.** El dataset repite la MISMA fila por cada fase del proceso:
 *    sin esto, `IDARTES-SA-SI-013-2026` salía cuatro veces e inflaba todos los conteos. Medido en
 *    `metrik-data` el 2026-09-28: 2.075 filas crudas → 1.908 procesos únicos.
 * 3. **El objeto se guarda recortado a 600 caracteres**, que es lo que el puntaje lee y lo que la
 *    pantalla muestra. Guardar el pliego entero no cambia ningún FIT.
 *
 * `radar_procesos` es **global, no por workspace**: el dato es público y de entidades, y una copia
 * por cliente sería el mismo barrido multiplicado por clientes.
 */

/** Dataset de SECOP II. */
export const DATASET_SECOP = 'https://www.datos.gov.co/resource/p6dx-8zbt.json'

/** Los campos que se piden. Pedir `*` trae ~70 columnas por fila y nada de eso se usa. */
export const CAMPOS_SOCRATA = [
  'id_del_proceso',
  'referencia_del_proceso',
  'modalidad_de_contratacion',
  'entidad',
  'departamento_entidad',
  'ciudad_entidad',
  'descripci_n_del_procedimiento',
  'precio_base',
  'fecha_de_publicacion_del',
  'fecha_de_recepcion_de',
  'duracion',
  'unidad_de_duracion',
  'tipo_de_contrato',
  'urlproceso',
].join(',')

/** Tamaño de página. El exportador de `metrik-data` usa el mismo. */
export const PAGINA_SOCRATA = 20000

/** Tope del objeto que se guarda: lo que el puntaje lee y la pantalla muestra. */
export const LARGO_OBJETO = 600

/** Una fila cruda del dataset. Socrata manda todo como texto, salvo `urlproceso`, que es objeto. */
export interface FilaSocrata {
  id_del_proceso?: string
  referencia_del_proceso?: string
  modalidad_de_contratacion?: string
  entidad?: string
  departamento_entidad?: string
  ciudad_entidad?: string
  descripci_n_del_procedimiento?: string
  precio_base?: string
  fecha_de_publicacion_del?: string
  fecha_de_recepcion_de?: string
  duracion?: string
  unidad_de_duracion?: string
  tipo_de_contrato?: string
  urlproceso?: string | { url?: string }
}

/** Una fila de `radar_procesos`, lista para el upsert. */
export interface ProcesoRadar {
  notice_uid: string
  referencia: string
  entidad: string
  departamento: string
  ciudad: string | null
  modalidad: string
  tipo_contrato: string
  objeto: string
  valor: number
  fecha_publicacion: string | null
  fecha_cierre: string | null
  duracion: string | null
  url: string | null
  sin_rup: boolean
  es_compra: boolean
}

/**
 * La URL de una página de procesos con recepción de ofertas todavía abierta.
 *
 * El `$where` copia el del exportador: `estado_del_procedimiento in ('Abierto','Publicado')` y la
 * recepción después del final de HOY. El `$order` por `id_del_proceso` es lo que hace que la
 * paginación sea estable: sin orden, Socrata puede repetir y saltarse filas entre páginas.
 */
export function urlPaginaSocrata(hoy: string, offset: number, limite = PAGINA_SOCRATA): string {
  const params = new URLSearchParams({
    $where: `estado_del_procedimiento in('Abierto','Publicado') AND fecha_de_recepcion_de > '${hoy}T23:59:59'`,
    $select: CAMPOS_SOCRATA,
    $order: 'id_del_proceso',
    $limit: String(limite),
    $offset: String(offset),
  })
  return `${DATASET_SECOP}?${params.toString()}`
}

function texto(v: unknown): string {
  return String(v ?? '').trim()
}

/** `YYYY-MM-DD` o `null`. Socrata manda `2026-10-06T00:00:00.000`. */
function fecha(v: unknown): string | null {
  const s = texto(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/** El precio base. Un valor ilegible es 0 («sin presupuesto», que es un sondeo), no un error. */
function precio(v: unknown): number {
  const n = Number(texto(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** `urlproceso` llega como objeto `{ url }` o como texto, según la fila. */
function url(v: FilaSocrata['urlproceso']): string | null {
  if (v && typeof v === 'object') return texto(v.url) || null
  return texto(v) || null
}

export interface OpcionesPreparar {
  /** Modalidades que no exigen RUP inscrito (`BIBLIOTECA.sinRup`). */
  sinRup: readonly string[]
  /** Tipos de contrato que son compra de bienes (`BIBLIOTECA.tiposCompra`). */
  tiposCompra: readonly string[]
}

/**
 * Filas crudas → procesos únicos, en el orden en que llegaron (que es el de `id_del_proceso`).
 *
 * Gana la PRIMERA aparición de cada `notice_uid`, igual que `preparar()` en Python. Las fases
 * posteriores del mismo proceso no traen datos mejores: traen el mismo proceso otra vez.
 * Una fila sin `id_del_proceso` se descarta: sin clave natural no hay upsert idempotente.
 */
export function prepararProcesos(filas: readonly FilaSocrata[], op: OpcionesPreparar): ProcesoRadar[] {
  const sinRup = new Set(op.sinRup)
  const compra = new Set(op.tiposCompra)
  const vistos = new Set<string>()
  const salida: ProcesoRadar[] = []

  for (const f of filas) {
    const uid = texto(f.id_del_proceso)
    if (!uid || vistos.has(uid)) continue
    vistos.add(uid)

    const modalidad = texto(f.modalidad_de_contratacion)
    const tipo = texto(f.tipo_de_contrato) || 'No especificado'

    salida.push({
      notice_uid: uid,
      referencia: texto(f.referencia_del_proceso),
      entidad: texto(f.entidad),
      departamento: texto(f.departamento_entidad) || 'No especificado',
      ciudad: texto(f.ciudad_entidad) || null,
      modalidad,
      tipo_contrato: tipo,
      objeto: texto(f.descripci_n_del_procedimiento).slice(0, LARGO_OBJETO),
      valor: precio(f.precio_base),
      fecha_publicacion: fecha(f.fecha_de_publicacion_del),
      fecha_cierre: fecha(f.fecha_de_recepcion_de),
      duracion: `${texto(f.duracion)} ${texto(f.unidad_de_duracion)}`.trim() || null,
      url: url(f.urlproceso),
      sin_rup: sinRup.has(modalidad),
      es_compra: compra.has(tipo),
    })
  }

  return salida
}

/** Días calendario entre hoy y el cierre. `null` si no hay fecha de cierre. */
export function diasParaCierre(fechaCierre: string | null, hoy: string): number | null {
  if (!fechaCierre) return null
  const [a1, m1, d1] = hoy.split('-').map(Number)
  const [a2, m2, d2] = fechaCierre.split('-').map(Number)
  if (!a1 || !a2) return null
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000)
}
