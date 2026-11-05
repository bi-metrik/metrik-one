'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'

import { avisarCambioDeFotos, useFotoDeBiblioteca } from '@/app/(app)/negocios/fotos-tarjeta'
import { FotoDeTarjeta } from '@/app/(app)/negocios/hoja-cliente'
import PerfilFotos from '@/app/(app)/fotos/perfil-fotos'
import { DialogoAutorizacionFoto } from '@/app/(app)/fotos/autorizacion-foto'
import { subirFotoABiblioteca, type PedidoFoto } from '@/app/(app)/fotos/actions'
import { pedidoFotoDelPaquete } from '@/lib/cotizaciones/bloqueo-documento'
import type { PaqueteBloqueo } from '@/lib/cotizaciones/bloqueo-paquete'
import { comprimirFotoHotel } from '@/lib/cotizaciones/foto-hotel-navegador'
import type { PedidoAutorizacion } from '@/lib/fotos/autorizacion'
import type { CategoriaFoto } from '@/lib/fotos/categoria'
import { fotoDeLaTarjeta, type ElementoVista } from '@/lib/fotos/vista'

/**
 * La foto del hotel del PAQUETE DE BLOQUEO (Mauricio, 2026-11-05: «no permite agregar fotos a los
 * hoteles de los paquetes»). El mismo recuadro, la misma casilla «Tengo autorización» (Emilio,
 * 2026-10-16) y el mismo perfil de la biblioteca que el hotel suelto (`tarjeta-opcion.tsx`): la foto
 * queda en el espacio y sale sola en la propuesta.
 *
 * Lo que se pide a la biblioteca es el hotel GUARDADO del paquete (`pedidoFotoDelPaquete`), la misma
 * llave que busca el documento. Mientras el nombre del hotel no esté guardado no hay a qué ponerle la
 * foto: lo dice. Sin biblioteca en el espacio (otra plantilla) no pinta nada: el paquete no tiene foto
 * «de la opción» de respaldo.
 */
export function FotoDelHotelDelPaquete({ guardado, editable, nombreSinGuardar }: {
  /** El paquete como está guardado (`null` = todavía no). */
  guardado: PaqueteBloqueo | null
  editable: boolean
  /** El nombre que se está escribiendo, si es distinto del guardado. */
  nombreSinGuardar?: boolean
}) {
  const pedido: PedidoFoto | null = pedidoFotoDelPaquete(guardado)
  const bib = useFotoDeBiblioteca(pedido)
  const conBiblioteca = bib?.disponible === true
  const enTarjeta = conBiblioteca && bib.elemento !== undefined ? fotoDeLaTarjeta(bib.elemento) : null
  const [subiendo, setSubiendo] = useState(false)
  const [porAutorizar, setPorAutorizar] = useState<File | null>(null)
  const [perfilAbierto, setPerfilAbierto] = useState(false)

  if (!pedido) {
    return (
      <p className="m-0 text-[11px] text-[#6E6A62]" data-foto-paquete="sin-hotel">
        Guarda el paquete con el nombre del hotel para agregarle fotos.
      </p>
    )
  }
  if (!conBiblioteca || !bib) return null

  function quedo(elemento: ElementoVista | null) {
    bib?.poner(elemento)
    avisarCambioDeFotos()
  }

  function enviar(archivo: File, permiso: PedidoAutorizacion, categoria: CategoriaFoto | null) {
    if (subiendo || !pedido) return
    setSubiendo(true)
    void (async () => {
      try {
        const foto = await comprimirFotoHotel(archivo)
        if (!foto) { toast.error('Ese archivo no es una foto. Usa un JPG o un PNG.'); return }
        const r = await subirFotoABiblioteca(pedido, foto.dataUrl, null, categoria, permiso)
        if (!r.ok) { toast.error(r.error); return }
        setPorAutorizar(null)
        quedo(r.elemento)
      } catch {
        toast.error('No se pudo guardar la foto. Vuelve a intentarlo.')
      } finally {
        setSubiendo(false)
      }
    })()
  }

  return (
    <div className="space-y-1" data-foto-paquete={pedido.nombre}>
      <div className="flex items-start gap-3 max-sm:flex-col">
        {enTarjeta && (
          <FotoDeTarjeta
            fotoRef={null}
            editable={editable && bib.editable}
            subiendo={subiendo}
            onPoner={archivo => { if (!subiendo) setPorAutorizar(archivo) }}
            biblioteca={{
              tipo: 'hotel',
              foto: enTarjeta.foto ? { url: enTarjeta.foto.url } : null,
              mas: enTarjeta.mas,
              admiteOtra: enTarjeta.admiteOtra,
              duda: bib.duda,
              contestando: false,
              onContestar: () => {},
              onVerFotos: () => setPerfilAbierto(true),
            }}
          />
        )}
        <div className="space-y-0.5 text-[11px] text-[#6E6A62]">
          <p className="m-0">Foto de <b className="font-medium text-[#191713]">{bib.elemento?.nombre ?? pedido.nombre}</b> para la propuesta.</p>
          {bib.fotosDe && (
            <p className="m-0" data-fotos-de>Fotos de: <b className="font-medium text-[#191713]">{bib.fotosDe.nombre}</b>{bib.fotosDe.ciudad ? ` · ${bib.fotosDe.ciudad}` : ''}</p>
          )}
          {!bib.fotosDe && bib.porClasificar > 0 && (
            <p className="m-0 text-[#9A5F0C]" data-por-clasificar-tarjeta>
              Sin fotos: el nombre se parece a {bib.porClasificar} proveedores. Elige cuál es en{' '}
              <Link href="/proveedores?por=clasificar" className="underline">Proveedores, «Por clasificar»</Link>.
            </p>
          )}
          {nombreSinGuardar && (
            <p className="m-0 text-[#9A5F0C]" data-foto-paquete-nombre-cambiado>Cambiaste el nombre del hotel: guarda el paquete para que la foto sea la del nombre nuevo.</p>
          )}
        </div>
      </div>
      <DialogoAutorizacionFoto
        archivo={porAutorizar}
        guardando={subiendo}
        conCategoria
        nombre={bib.elemento?.nombre ?? pedido.nombre}
        onCancelar={() => setPorAutorizar(null)}
        onConfirmar={(permiso, categoria) => porAutorizar && enviar(porAutorizar, permiso, categoria)}
      />
      {perfilAbierto && (
        <PerfilFotos
          elemento={bib.elemento ?? null}
          pedido={pedido}
          abierto
          editable={editable && bib.editable}
          onCerrar={() => setPerfilAbierto(false)}
          onCambio={quedo}
        />
      )}
    </div>
  )
}
