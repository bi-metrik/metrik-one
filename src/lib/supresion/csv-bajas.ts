import { huella, normalizarEmail, normalizarNit, normalizarTelefono, type TipoSupresion } from './huella'

/**
 * CSV de bajas -> filas de `supresiones`. Cabecera: email,telefono,nit,fecha,canal,motivo,campana
 * (todas opcionales salvo que haya al menos email, telefono o nit por fila). Una fila con varios
 * datos genera una baja por cada dato. Sin tocar la red: la escritura vive en el script.
 */

export type FilaBaja = {
  tipo: TipoSupresion
  huella: string
  baja_at: string
  canal: string
  motivo: string
  campana: string | null
}

const CANALES = ['email', 'whatsapp', 'telefono', 'formulario', 'verbal', 'rebote', 'otro']
const MOTIVOS = ['baja', 'rebote_duro', 'queja', 'reclamo', 'otro']

export function partirCsv(texto: string): string[][] {
  const filas: string[][] = []
  let fila: string[] = [], celda = '', comillas = false
  const t = texto.replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { celda += '"'; i++ }
      else if (c === '"') comillas = false
      else celda += c
    } else if (c === '"') comillas = true
    else if (c === ',') { fila.push(celda); celda = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      fila.push(celda); celda = ''
      if (fila.some((x) => x.trim())) filas.push(fila)
      fila = []
    } else celda += c
  }
  fila.push(celda)
  if (fila.some((x) => x.trim())) filas.push(fila)
  return filas
}

export function filasDeBajas(
  texto: string,
  defecto: { canal: string; motivo: string; campana: string | null; ahora?: Date },
): { filas: FilaBaja[]; errores: string[] } {
  const [cab, ...datos] = partirCsv(texto)
  const errores: string[] = []
  if (!cab) return { filas: [], errores: ['CSV vacio'] }
  const idx = (n: string) => cab.map((c) => c.trim().toLowerCase()).indexOf(n)
  const col = { email: idx('email'), telefono: idx('telefono'), nit: idx('nit'), fecha: idx('fecha'), canal: idx('canal'), motivo: idx('motivo'), campana: idx('campana') }
  if (col.email < 0 && col.telefono < 0 && col.nit < 0) return { filas: [], errores: ['la cabecera necesita email, telefono o nit'] }

  const filas: FilaBaja[] = []
  const visto = new Set<string>()
  datos.forEach((f, i) => {
    const g = (k: keyof typeof col) => (col[k] >= 0 ? (f[col[k]] ?? '').trim() : '')
    const n = i + 2
    const canal = g('canal').toLowerCase() || defecto.canal
    const motivo = g('motivo').toLowerCase() || defecto.motivo
    if (!CANALES.includes(canal)) return void errores.push(`fila ${n}: canal invalido "${canal}"`)
    if (!MOTIVOS.includes(motivo)) return void errores.push(`fila ${n}: motivo invalido "${motivo}"`)
    let baja_at = (defecto.ahora ?? new Date()).toISOString()
    if (g('fecha')) {
      const d = new Date(g('fecha'))
      if (isNaN(d.getTime())) return void errores.push(`fila ${n}: fecha invalida "${g('fecha')}"`)
      baja_at = d.toISOString()
    }
    const campana = g('campana') || defecto.campana
    const vals: [TipoSupresion, string | null, string][] = [
      ['email', normalizarEmail(g('email')), g('email')],
      ['telefono', normalizarTelefono(g('telefono')), g('telefono')],
      ['nit', normalizarNit(g('nit')), g('nit')],
    ]
    let alguno = false
    for (const [tipo, norm, crudo] of vals) {
      if (!crudo) continue
      if (!norm) { errores.push(`fila ${n}: ${tipo} no valido`); continue }
      alguno = true
      const h = huella(tipo, norm)
      if (visto.has(tipo + h)) continue
      visto.add(tipo + h)
      filas.push({ tipo, huella: h, baja_at, canal, motivo, campana })
    }
    if (!alguno && !errores.some((e) => e.startsWith(`fila ${n}:`))) errores.push(`fila ${n}: sin email, telefono ni nit`)
  })
  return { filas, errores }
}
