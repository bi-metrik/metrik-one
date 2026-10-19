/**
 * Lo que la ficha manda al guardar «Datos», revisado (PURO). Solo nombre y tipo son obligatorios.
 * Devuelve las columnas de `fotos_perfiles` tal como se escriben.
 */
import { correosDeTexto, normalizarCelular, normalizarWeb } from './contacto'
import { esTarifaCanal, esTipoProveedor, normalizarEtiquetas, etiquetasDeTexto, type TarifaCanal, type TipoProveedor } from './tipos'

export interface DatosFicha {
  nombre: string
  tipoProveedor: TipoProveedor
  ciudad: string | null
  pais: string | null
  estrellas: number | null
  web: string | null
  contactoNombre: string | null
  /** Como lo escribió la persona; se guarda también en E.164 si se entiende. */
  celular: string | null
  correo: string | null
  telefono: string | null
  direccion: string | null
  notas: string | null
  etiquetas: string[]
  tarifasMayorista: boolean
  responsableId: string | null
  compradoViaId: string | null
  departamento: string | null
  destino: string | null
  /** `null` = no se sabe todavía. */
  ivaDeclarado: boolean | null
  ivaIncluido: boolean | null
  tarifaCanal: TarifaCanal | null
}

export interface ColumnasFicha {
  nombre: string
  tipo_proveedor: TipoProveedor
  ciudad: string | null
  pais: string | null
  estrellas: number | null
  web: string | null
  contacto_nombre: string | null
  celular: string | null
  celular_original: string | null
  correo: string | null
  telefono: string | null
  direccion: string | null
  notas: string | null
  etiquetas: string[]
  tarifas_mayorista: boolean
  responsable_tarifas_id: string | null
  comprado_via_id: string | null
  departamento: string | null
  destino: string | null
  iva_declarado: boolean | null
  iva_incluido: boolean | null
  tarifa_canal: TarifaCanal | null
}

/** «sí» / «no» / «no se sabe» de un selector de tres estados. */
export function triestado(v: unknown): boolean | null {
  if (v === true || v === 'si' || v === 'true') return true
  if (v === false || v === 'no' || v === 'false') return false
  return null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function corto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().replace(/[ \t]+/g, ' ')
  return t ? t.slice(0, max) : null
}

export function revisarDatos(entrada: unknown): { ok: true; columnas: ColumnasFicha } | { ok: false; error: string } {
  if (!entrada || typeof entrada !== 'object') return { ok: false, error: 'No llegaron los datos.' }
  const d = entrada as Record<string, unknown>
  const nombre = corto(d.nombre, 200)
  if (!nombre) return { ok: false, error: 'Escribe el nombre del proveedor.' }
  if (!esTipoProveedor(d.tipoProveedor)) return { ok: false, error: 'Elige qué tipo de proveedor es.' }
  const paisCrudo = corto(d.pais, 2)?.toUpperCase() ?? null
  const pais = paisCrudo && /^[A-Z]{2}$/.test(paisCrudo) ? paisCrudo : null
  if (paisCrudo && !pais) return { ok: false, error: 'El país va con su código de dos letras (CO, PA, ES…).' }
  let estrellas: number | null = null
  if (d.estrellas !== null && d.estrellas !== undefined && d.estrellas !== '') {
    const n = Number(d.estrellas)
    if (!Number.isInteger(n) || n < 0 || n > 5) return { ok: false, error: 'Las estrellas van de 0 a 5.' }
    estrellas = n
  }
  const webCruda = corto(d.web, 500)
  const web = normalizarWeb(webCruda)
  if (webCruda && !web) return { ok: false, error: 'La web no parece una dirección (ej.: www.hotel.com).' }
  const correoCrudo = corto(d.correo, 200)
  const correo = correosDeTexto(correoCrudo).correo
  if (correoCrudo && !correo) return { ok: false, error: 'El correo no parece válido.' }
  const cel = normalizarCelular(corto(d.celular, 120), pais ?? 'CO')
  const etiquetas = Array.isArray(d.etiquetas) ? normalizarEtiquetas(d.etiquetas) : etiquetasDeTexto(typeof d.etiquetas === 'string' ? d.etiquetas : '')
  const responsable = typeof d.responsableId === 'string' && UUID.test(d.responsableId) ? d.responsableId.toLowerCase() : null
  const via = typeof d.compradoViaId === 'string' && UUID.test(d.compradoViaId) ? d.compradoViaId.toLowerCase() : null
  return {
    ok: true,
    columnas: {
      nombre,
      tipo_proveedor: d.tipoProveedor,
      ciudad: corto(d.ciudad, 120),
      pais,
      estrellas,
      web,
      contacto_nombre: corto(d.contactoNombre, 200),
      celular: cel.e164,
      celular_original: cel.original,
      correo,
      telefono: corto(d.telefono, 120),
      direccion: corto(d.direccion, 300),
      notas: typeof d.notas === 'string' && d.notas.trim() ? d.notas.trim().slice(0, 20000) : null,
      etiquetas,
      tarifas_mayorista: d.tarifasMayorista === true,
      responsable_tarifas_id: responsable,
      comprado_via_id: via,
      departamento: corto(d.departamento, 120),
      destino: corto(d.destino, 120),
      iva_declarado: triestado(d.ivaDeclarado),
      iva_incluido: triestado(d.ivaIncluido),
      tarifa_canal: esTarifaCanal(d.tarifaCanal) ? d.tarifaCanal : null,
    },
  }
}

/** Fecha `YYYY-MM-DD` válida o `null`. */
export function fechaValida(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const [a, m, d] = v.split('-').map(Number)
  const f = new Date(Date.UTC(a, m - 1, d))
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? v : null
}

/** La vigencia y la temporada de un tarifario, revisadas. */
export function revisarVigencia(e: unknown): { ok: true; desde: string | null; hasta: string | null; temporada: string | null; notas: string | null } | { ok: false; error: string } {
  const d = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
  const desde = d.desde ? fechaValida(d.desde) : null
  const hasta = d.hasta ? fechaValida(d.hasta) : null
  if (d.desde && !desde) return { ok: false, error: 'La fecha «desde» no es válida.' }
  if (d.hasta && !hasta) return { ok: false, error: 'La fecha «hasta» no es válida.' }
  if (desde && hasta && hasta < desde) return { ok: false, error: '«Hasta» no puede ser antes de «desde».' }
  return { ok: true, desde, hasta, temporada: corto(d.temporada, 120), notas: corto(d.notas, 2000) }
}

/** Una cuenta bancaria como llega del formulario, revisada. */
export function revisarCuenta(e: unknown):
  | { ok: true; cuenta: { banco: string; tipo_cuenta: 'ahorros' | 'corriente' | 'otra'; numero: string; titular: string; titular_documento: string | null } }
  | { ok: false; error: string } {
  const d = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
  const banco = corto(d.banco, 120)
  const titular = corto(d.titular, 200)
  const numero = corto(d.numero, 40)?.replace(/\s+/g, ' ') ?? null
  const tipo = d.tipoCuenta
  if (!banco) return { ok: false, error: 'Escribe el banco.' }
  if (tipo !== 'ahorros' && tipo !== 'corriente' && tipo !== 'otra') return { ok: false, error: 'Elige el tipo de cuenta.' }
  if (!numero || !/^[0-9A-Za-z][0-9A-Za-z -]{2,38}[0-9A-Za-z]$/.test(numero)) return { ok: false, error: 'El número de cuenta lleva solo números, letras, guiones o espacios.' }
  if (!titular) return { ok: false, error: 'Escribe el titular de la cuenta.' }
  const doc = corto(d.titularDocumento, 40)
  if (doc && doc.length < 3) return { ok: false, error: 'El documento del titular es muy corto.' }
  return { ok: true, cuenta: { banco, tipo_cuenta: tipo, numero, titular, titular_documento: doc } }
}
