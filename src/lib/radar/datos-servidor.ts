import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { traerTodo } from '@/lib/supabase/paginar'
import { BIBLIOTECA, perfilDesdePreset } from './biblioteca'
import type { Tema } from './puntuar'

/**
 * Las lecturas del Radar. El puntaje NO se calcula aquí: se calcula en la pantalla contra los temas
 * del perfil, porque ahí el usuario cambia un peso y ve el orden moverse sin volver al servidor.
 * Lo que este archivo garantiza es que los datos lleguen COMPLETOS.
 *
 * ⚠️ `traerTodo` y no un `select` suelto: PostgREST corta en 1.000 filas y **no avisa** (devuelve
 * 200 sin error con la lista recortada). El universo del 2026-09-28 son 1.908 procesos, o sea que
 * una consulta directa perdería 908 en silencio y el Radar mostraría un tercio de las
 * convocatorias como si fueran todas.
 */

/** Un proceso como lo consume la pantalla. Sin `creado_at`/`visto_at`: no se muestran. */
export interface ProcesoEnPantalla {
  noticeUid: string
  referencia: string
  entidad: string
  departamento: string
  modalidad: string
  tipoContrato: string
  objeto: string
  valor: number
  fechaCierre: string | null
  duracion: string | null
  url: string | null
  sinRup: boolean
}

export interface PerfilEnPantalla {
  id: string | null
  nombre: string
  preset: string
  seleccionados: string[]
  pesos: Record<string, number>
  exclusiones: string[]
  propios: Tema[]
  /** `notice_uid` que el perfil sigue. */
  seguidos: string[]
  /** `notice_uid` que el perfil ocultó. */
  ocultos: string[]
}

interface FilaProceso {
  notice_uid: string
  referencia: string | null
  entidad: string | null
  departamento: string | null
  modalidad: string | null
  tipo_contrato: string | null
  objeto: string | null
  valor: string | number | null
  fecha_cierre: string | null
  duracion: string | null
  url: string | null
  sin_rup: boolean | null
}

/**
 * Los procesos cuya recepción de ofertas no ha vencido. Se filtra por `fecha_cierre >= hoy` y NO
 * se borra nada: un proceso que cerró se queda en la tabla porque puede haber una marca de
 * seguimiento colgando de él.
 *
 * Un proceso sin `fecha_cierre` entra: el dato falta, y esconderlo por eso sería decidir que no
 * existe. La pantalla lo pinta sin «vence en».
 */
export async function leerProcesosVigentes(hoy = todayBogotaISO()): Promise<ProcesoEnPantalla[]> {
  // `radar_procesos` nace en 20260928180000 y no está en `database.ts`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const campos =
    'notice_uid, referencia, entidad, departamento, modalidad, tipo_contrato, objeto, valor, fecha_cierre, duracion, url, sin_rup'

  const filas = await traerTodo<FilaProceso>(
    (desde, hasta) =>
      svc
        .from('radar_procesos')
        .select(campos)
        .or(`fecha_cierre.gte.${hoy},fecha_cierre.is.null`)
        .order('notice_uid')
        .range(desde, hasta),
    { etiqueta: 'procesos vigentes del Radar' },
  )

  return filas.map((f) => ({
    noticeUid: f.notice_uid,
    referencia: f.referencia ?? '',
    entidad: f.entidad ?? '',
    departamento: f.departamento ?? 'No especificado',
    modalidad: f.modalidad ?? '',
    tipoContrato: f.tipo_contrato ?? 'No especificado',
    objeto: f.objeto ?? '',
    valor: Number(f.valor ?? 0),
    fechaCierre: f.fecha_cierre,
    duracion: f.duracion,
    url: f.url,
    sinRup: f.sin_rup === true,
  }))
}

interface FilaPerfil {
  id: string
  nombre: string
  preset: string
  temas_sel: string[] | null
  pesos: Record<string, number> | null
  exclusiones: string[] | null
}

/**
 * El perfil activo del workspace, con sus temas propios y sus marcas.
 *
 * Si el workspace todavía no tiene perfil, devuelve el del preset `metrik` **sin guardarlo** y con
 * `id: null`. Crear la fila al leer escribiría en la base por el hecho de abrir una pantalla, y un
 * `GET` que escribe es un `GET` que no se puede reintentar: la crea la acción de guardar, cuando el
 * cliente elige su sector.
 */
export async function leerPerfilActivo(workspaceId: string): Promise<PerfilEnPantalla> {
  // Las tres tablas nacen en 20260928180000 y no están en `database.ts`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any

  const { data, error } = await svc
    .from('radar_perfiles')
    .select('id, nombre, preset, temas_sel, pesos, exclusiones')
    .eq('workspace_id', workspaceId)
    .eq('activo', true)
    .maybeSingle()
  if (error) {
    // Un fallo de lectura NO es «no tiene perfil»: con el preset por defecto el cliente vería
    // otros puntajes que los suyos y creería que el Radar cambió de opinión.
    throw new Error(`perfil del Radar: ${error.message}`)
  }

  const fila = data as FilaPerfil | null
  if (!fila) {
    const base = perfilDesdePreset('metrik')
    return { id: null, ...base, propios: [], seguidos: [], ocultos: [] }
  }

  const [temas, marcas] = await Promise.all([
    svc.from('radar_temas').select('tema_id, nombre, grupo, peso, terminos').eq('perfil_id', fila.id),
    svc.from('radar_seguimiento').select('notice_uid, estado').eq('perfil_id', fila.id),
  ])
  if (temas.error) throw new Error(`temas propios del Radar: ${temas.error.message}`)
  if (marcas.error) throw new Error(`marcas del Radar: ${marcas.error.message}`)

  const filasMarca = (marcas.data ?? []) as { notice_uid: string; estado: string }[]

  return {
    id: fila.id,
    nombre: fila.nombre,
    preset: fila.preset,
    seleccionados: fila.temas_sel ?? [],
    pesos: fila.pesos ?? {},
    exclusiones: fila.exclusiones ?? [],
    propios: ((temas.data ?? []) as { tema_id: string; nombre: string; grupo: string; peso: number; terminos: string[] }[]).map(
      (t): Tema => ({ id: t.tema_id, nombre: t.nombre, grupo: t.grupo, peso: t.peso, terminos: t.terminos }),
    ),
    seguidos: filasMarca.filter((m) => m.estado === 'sigue').map((m) => m.notice_uid),
    ocultos: filasMarca.filter((m) => m.estado === 'oculto').map((m) => m.notice_uid),
  }
}

/** Lo que la pantalla necesita de la biblioteca: no viaja el archivo entero por gusto, viaja todo porque el puntaje se calcula en el cliente. */
export function bibliotecaParaPantalla() {
  return {
    grupos: BIBLIOTECA.grupos,
    temas: BIBLIOTECA.temas,
    senalFuerte: BIBLIOTECA.senalFuerte,
    presets: Object.fromEntries(Object.entries(BIBLIOTECA.perfiles).map(([k, p]) => [k, p.nombre])),
    descartesDePliego: BIBLIOTECA.descartesDePliego,
    actualizado: BIBLIOTECA.actualizado,
  }
}
