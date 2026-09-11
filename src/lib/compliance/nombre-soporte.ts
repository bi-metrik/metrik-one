import { todayBogotaISO } from '@/lib/dates/bogota'

/**
 * Nombre del archivo del documento de soporte de una consulta de listas.
 *
 * Vive aparte de la ruta por dos razones: un `route.ts` de Next solo admite
 * exportar sus metodos HTTP y su configuracion de segmento (cualquier otro
 * export lo rechaza la validacion de tipos), y esto se prueba mejor solo.
 *
 * El saneado NO es cosmetico: `nombre_consultado` es texto que escribio una
 * persona y termina DENTRO de una cabecera HTTP (`Content-Disposition`). Una
 * comilla o un salto de linea ahi no rompen el nombre, rompen la cabecera. Por
 * eso la regla es una lista blanca (solo `a-z0-9`), no una lista de caracteres
 * prohibidos: lo que no se reconoce se reemplaza, no se deja pasar.
 */
export function sanearParaNombreArchivo(valor: string, maxLargo = 40): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLargo)
    .replace(/-+$/g, '')
}

export type DatosNombreSoporte = {
  id: string
  nombre_consultado: string | null
  documento_numero: string | null
  created_at: string
}

/**
 * `soporte-listas-<sujeto>-<documento>-<AAAA-MM-DD>.pdf`
 *
 * El sujeto y el documento son OPCIONALES en la base (una consulta puede traer
 * solo uno de los dos), asi que cada parte entra solo si aporta algo tras el
 * saneado. Si no queda ninguna, se cae al prefijo del id — que es exactamente
 * el nombre que servia esta ruta antes, o sea que nunca se devuelve un archivo
 * sin identificador.
 *
 * La fecha es la de la CONSULTA leida en Bogota, no la de la descarga: es la
 * que el oficial de cumplimiento busca cuando ordena el expediente, y leerla en
 * UTC correre el dia para todo lo consultado despues de las 7 p.m.
 */
export function nombreArchivoSoporte(c: DatosNombreSoporte): string {
  const partes: string[] = []

  const sujeto = c.nombre_consultado ? sanearParaNombreArchivo(c.nombre_consultado) : ''
  if (sujeto) partes.push(sujeto)

  const documento = c.documento_numero ? sanearParaNombreArchivo(c.documento_numero, 20) : ''
  if (documento) partes.push(documento)

  if (partes.length === 0) partes.push(c.id.slice(0, 8))

  const fecha = fechaBogotaSegura(c.created_at)
  if (fecha) partes.push(fecha)

  return `soporte-listas-${partes.join('-')}.pdf`
}

/** `todayBogotaISO` no valida su entrada: una fecha rota saldria como "NaN-NaN-NaN". */
function fechaBogotaSegura(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return todayBogotaISO(d)
}
