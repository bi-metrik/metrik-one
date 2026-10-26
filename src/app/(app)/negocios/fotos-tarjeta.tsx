'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { claveDeFoto } from '@/lib/fotos/clave'
import type { DudaVista, ElementoVista } from '@/lib/fotos/vista'
import type { ProveedorDeTarjeta } from '@/lib/proveedores/vigencia'
import { fotosParaTarjetas, type FotosDeTarjetas, type PedidoFoto } from '../fotos/actions'

/**
 * Los perfiles de hotel y de tour vistos desde las tarjetas de la cotización (Mauricio,
 * 2026-10-16): cada tarjeta dice qué hotel o tour muestra (`useFotoDeBiblioteca`) y el proveedor
 * los pide TODOS en una sola acción (las server actions de Next van en fila; una por tarjeta haría
 * esperar a la cotización entera). El servidor crea el perfil la primera vez, reconoce los alias y
 * devuelve la pregunta «¿Es el mismo hotel que …?» cuando el nombre se parece a otro.
 *
 * Sin proveedor (o sin biblioteca en el espacio) la tarjeta queda como antes: la foto en la opción.
 */

/** Lo cambió alguien (otra tarjeta del mismo hotel, el perfil): los demás vuelven a leer. */
const EVENTO_FOTOS_BIBLIOTECA = 'one:fotos-biblioteca'

export function avisarCambioDeFotos(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_FOTOS_BIBLIOTECA))
}

/**
 * La llave de la tarjeta: la del nombre y, si la línea fijó su ficha, también su id. Sin ficha fijada,
 * la de un servicio escrito a mano va aparte (`~a`): no toma ficha por el nombre (2026-10-20).
 */
const sufijo = (x: { proveedorId?: string | null; aMano?: boolean; descartada?: string | null }) => (x.proveedorId ? `#${x.proveedorId}` : x.aMano ? '~a' : x.descartada ? `!${x.descartada}` : '')
const llave = (p: PedidoFoto) => `${p.tipo}:${claveDeFoto(p.tipo, p.nombre, p.ciudad)}${sufijo(p)}`

interface Leido {
  elemento: ElementoVista | null
  duda: DudaVista | null
  /** La ficha del proveedor con sus tarifarios (aviso de vigencia). */
  proveedor: ProveedorDeTarjeta | null
  /** De qué ficha son las fotos (brief del 2026-10-21, punto 5). */
  fotosDe: { nombre: string; ciudad: string | null; deshacer: boolean } | null
  /** El nombre se parece a varias fichas: no se asoció; va a «Por clasificar». */
  porClasificar: number
}

interface Estado {
  /** `null` = todavía no se sabe; `false` = el espacio no tiene biblioteca. */
  disponible: boolean | null
  editable: boolean
  /** Lo leído por llave de la tarjeta. Ausente = sin leer. */
  leidos: Record<string, Leido>
}

interface Contexto {
  estado: Estado
  registrar: (p: PedidoFoto) => () => void
  poner: (p: PedidoFoto, e: ElementoVista | null) => void
}

const Ctx = createContext<Contexto | null>(null)

export function FotosEnTarjetas({
  children,
  leer = fotosParaTarjetas,
  destino = null,
}: {
  children: ReactNode
  /** Inyectable para verla con datos de muestra. */
  leer?: (pedidos: PedidoFoto[], opciones?: { destino?: string | null }) => Promise<FotosDeTarjetas>
  /** El destino del viaje: la ciudad con que se compara un nombre que llegó sin ciudad (2026-10-21). */
  destino?: string | null
}) {
  const [estado, setEstado] = useState<Estado>({ disponible: null, editable: false, leidos: {} })
  const pedidos = useRef(new Map<string, { pedido: PedidoFoto; usos: number }>())
  const pedidas = useRef(new Set<string>())
  const [version, setVersion] = useState(0)
  const disponible = useRef<boolean | null>(null)

  const cargar = useCallback(
    async (todas: boolean) => {
      if (disponible.current === false) return
      const faltan = [...pedidos.current.entries()].filter(([k]) => todas || !pedidas.current.has(k))
      if (faltan.length === 0) return
      for (const [k] of faltan) pedidas.current.add(k)
      try {
        const r = await leer(faltan.map(([, v]) => v.pedido), { destino })
        if (!r.ok) {
          disponible.current = false
          setEstado((e) => ({ ...e, disponible: false }))
          return
        }
        disponible.current = true
        const porLlave = new Map(r.tarjetas.map((t) => [`${t.tipo}:${t.clave}${sufijo(t)}`, t]))
        setEstado((e) => {
          const leidos = { ...e.leidos }
          for (const [k] of faltan) {
            const t = porLlave.get(k)
            leidos[k] = { elemento: t?.elemento ?? null, duda: t?.duda ?? null, proveedor: t?.proveedor ?? null, fotosDe: t?.fotosDe ?? null, porClasificar: t?.porClasificar ?? 0 }
          }
          return { disponible: true, editable: r.editable, leidos }
        })
      } catch {
        // Sin red: se reintenta con la próxima tarjeta o el próximo cambio.
        for (const [k] of faltan) pedidas.current.delete(k)
      }
    },
    [leer, destino],
  )

  // Las tarjetas que aparecen en el mismo render se piden juntas.
  useEffect(() => {
    if (version === 0) return
    const t = setTimeout(() => void cargar(false), 0)
    return () => clearTimeout(t)
  }, [version, cargar])

  useEffect(() => {
    const otraVez = () => void cargar(true)
    window.addEventListener(EVENTO_FOTOS_BIBLIOTECA, otraVez)
    return () => window.removeEventListener(EVENTO_FOTOS_BIBLIOTECA, otraVez)
  }, [cargar])

  const registrar = useCallback((p: PedidoFoto) => {
    const k = llave(p)
    const actual = pedidos.current.get(k)
    pedidos.current.set(k, { pedido: p, usos: (actual?.usos ?? 0) + 1 })
    if (!pedidas.current.has(k)) setVersion((v) => v + 1)
    return () => {
      const v = pedidos.current.get(k)
      if (!v) return
      if (v.usos <= 1) pedidos.current.delete(k)
      else pedidos.current.set(k, { ...v, usos: v.usos - 1 })
    }
  }, [])

  const poner = useCallback((p: PedidoFoto, e: ElementoVista | null) => {
    setEstado((s) => {
      const antes = s.leidos[llave(p)]
      return { ...s, leidos: { ...s.leidos, [llave(p)]: { elemento: e, duda: null, proveedor: antes?.proveedor ?? null, fotosDe: antes?.fotosDe ?? null, porClasificar: antes?.porClasificar ?? 0 } } }
    })
  }, [])

  const valor = useMemo(() => ({ estado, registrar, poner }), [estado, registrar, poner])
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export interface FotoDeBiblioteca {
  /** `null` = todavía no se sabe. */
  disponible: boolean | null
  editable: boolean
  /** `undefined` = sin leer; `null` = el perfil sin fotos (o sin perfil todavía). */
  elemento: ElementoVista | null | undefined
  /** «¿Es el mismo hotel que …?», sin contestar. */
  duda: DudaVista | null
  /** La ficha del proveedor con sus tarifarios; `null` sin ficha (o sin leer). */
  proveedor: ProveedorDeTarjeta | null
  /** «Fotos de: <ficha> · <ciudad>» (y si se ofrece «No es este»). */
  fotosDe: { nombre: string; ciudad: string | null; deshacer: boolean } | null
  /** Se parece a varias fichas: sin fotos de biblioteca hasta clasificarlo en Proveedores. */
  porClasificar: number
  /** Lo que quedó después de un cambio (subir, contestar la duda): se pinta ya. */
  poner: (e: ElementoVista | null) => void
}

/** El perfil del hotel o tour que muestra una tarjeta. `null` sin proveedor o sin pedido. */
export function useFotoDeBiblioteca(pedido: PedidoFoto | null): FotoDeBiblioteca | null {
  const ctx = useContext(Ctx)
  const tipo = pedido?.tipo
  const nombre = pedido?.nombre
  const ciudad = pedido?.ciudad ?? null
  const proveedorId = pedido?.proveedorId ?? null
  const aMano = pedido?.aMano === true
  const descartada = pedido?.descartada ?? null
  const registrar = ctx?.registrar
  useEffect(() => {
    if (!registrar || !tipo || !nombre) return
    return registrar({ tipo, nombre, ciudad, ...(proveedorId ? { proveedorId } : {}), ...(aMano ? { aMano } : {}), ...(descartada ? { descartada } : {}) })
  }, [registrar, tipo, nombre, ciudad, proveedorId, aMano, descartada])
  if (!ctx || !pedido || !pedido.nombre) return null
  const leido = ctx.estado.leidos[llave(pedido)]
  return {
    disponible: ctx.estado.disponible,
    editable: ctx.estado.editable,
    elemento: leido ? leido.elemento : undefined,
    duda: leido?.duda ?? null,
    proveedor: leido?.proveedor ?? null,
    fotosDe: leido?.fotosDe ?? null,
    porClasificar: leido?.porClasificar ?? 0,
    poner: (e) => ctx.poner(pedido, e),
  }
}
