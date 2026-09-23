'use client'

import { Fragment, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { aprobarEntradaValidaApi } from '@/lib/valida-api/acciones'
import { textoCasillaEntrada } from '@/lib/valida-api/entrada'
import { PRODUCTOS_ENTRADA, type ProductoEntrada } from '@/lib/valida-api/producto'
import { textoQuienFirma } from '@/lib/valida-api/quien-firma'
import type { EstadoEntradaPagina } from '@/lib/valida-api/resultados'
import { CALIDADES_ACEPTANTE, textoDeclaracionTerminos, validarDatosAceptante } from '@/lib/valida-api/terminos'
import { bloquesDeTexto, type Tramo } from '@/lib/valida-api/texto-documento'
import { aprobarEntradaValidaCda } from '@/lib/valida-cda/acciones'

// ── La entrada: términos vivos, Política y una sola aprobación ──────────────

type EntradaPendiente = Extract<EstadoEntradaPagina, { estado: 'pendiente' }>

/**
 * La única puerta del módulo. En la misma vista, en este orden: los términos vigentes del contrato
 * como texto con scroll propio, el aviso de la Política de Datos, la firma del contrato cuando le
 * toca a quien entra, y UNA casilla con UN botón.
 *
 * La casilla no se puede marcar hasta llegar al final de los términos. «Llegar al final» lo decide
 * un centinela al pie del texto observado con IntersectionObserver sobre el propio contenedor: si
 * el texto cabe sin scroll, el centinela se ve desde el principio y cuenta como leído.
 *
 * La usan Valida API (`/valida-api`) y Valida de los CDA (`/valida`); lo que cambia entre ellos
 * está en `producto.ts`. Los textos que se firman salen de las MISMAS funciones que usa el
 * servidor, con el mismo producto: si no coincidieran, el servidor rechaza la aprobación.
 */
export function EntradaTerminos({
  entrada,
  aviso,
  politicaUrl,
  politicaTitulo,
  producto = 'valida_api',
}: {
  entrada: EntradaPendiente
  aviso: string
  politicaUrl: string
  politicaTitulo: string
  producto?: ProductoEntrada
}) {
  const router = useRouter()
  const contenedorRef = useRef<HTMLDivElement>(null)
  const finRef = useRef<HTMLDivElement>(null)
  const [leido, setLeido] = useState(false)
  const [marcada, setMarcada] = useState(false)
  const [nombre, setNombre] = useState('')
  const [cedula, setCedula] = useState('')
  const [calidad, setCalidad] = useState('')
  const [pendiente, iniciar] = useTransition()

  const { documentos, contrato, conflicto } = entrada

  useEffect(() => {
    const raiz = contenedorRef.current
    const fin = finRef.current
    if (!raiz || !fin) return
    if (typeof IntersectionObserver === 'undefined') {
      // Navegador sin IntersectionObserver: se mide al desplazarse. Si el texto no necesita
      // scroll, aquí no hay forma de saberlo y la casilla queda cerrada, que es el lado seguro.
      const revisar = () => {
        if (raiz.scrollTop + raiz.clientHeight >= raiz.scrollHeight - 2) setLeido(true)
      }
      raiz.addEventListener('scroll', revisar, { passive: true })
      return () => raiz.removeEventListener('scroll', revisar)
    }
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          setLeido(true)
          observador.disconnect()
        }
      },
      { root: raiz, threshold: 0 },
    )
    observador.observe(fin)
    return () => observador.disconnect()
  }, [])

  const firmaDisponible = contrato.estado === 'pendiente' && contrato.puede ? contrato : null
  const puedeAprobar = !conflicto && (contrato.estado === 'aceptado' || firmaDisponible !== null)

  // Las declaraciones se arman con la MISMA función que usa el servidor. Si los datos cambian, la
  // casilla se desmarca: lo firmado tiene que ser lo que está a la vista.
  const validos = validarDatosAceptante({ nombre, cedula, calidad, declaraFacultades: true })
  const declaraciones =
    firmaDisponible && validos.ok
      ? firmaDisponible.porFirmar.map((d) => ({
          documentoId: d.documentoId,
          texto: textoDeclaracionTerminos(d, validos.datos, producto),
        }))
      : null
  const casilla = textoCasillaEntrada({
    documentos,
    firmaPor: firmaDisponible ? firmaDisponible.empresas : null,
    producto,
  })
  const casillaHabilitada = puedeAprobar && leido && (!firmaDisponible || declaraciones !== null)

  function cambiar(setter: (v: string) => void) {
    return (valor: string) => {
      setter(valor)
      setMarcada(false)
    }
  }

  function aprobar() {
    if (!casillaHabilitada || !marcada) return
    iniciar(async () => {
      const aprobarEntrada = producto === 'valida_cda' ? aprobarEntradaValidaCda : aprobarEntradaValidaApi
      const r = await aprobarEntrada({
        leyoHastaElFinal: leido,
        casillaMostrada: casilla,
        firma: firmaDisponible && declaraciones ? { nombre, cedula, calidad, declaraciones } : null,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <section className="rounded-lg border border-border bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 hidden h-5 w-5 shrink-0 text-acento sm:block" />
        <div className="min-w-0 flex-1 space-y-5">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-tinta">Antes de entrar: los términos de tu contrato y tus datos</h2>
            <p className="text-sm text-tinta-suave">
              Lee los términos hasta el final. Con una sola aprobación aceptas los términos y la Política de Datos, y
              se abre el módulo.
            </p>
          </div>

          <div className="space-y-2">
            <div
              ref={contenedorRef}
              role="region"
              aria-label="Términos de tu contrato"
              tabIndex={0}
              data-terminos
              className="max-h-[60vh] overflow-y-auto rounded-md border border-border bg-papel p-4 text-sm leading-relaxed text-tinta [overflow-wrap:anywhere] sm:max-h-[28rem]"
            >
              {documentos.map((d, i) => (
                <article key={d.documentoId} className={i > 0 ? 'mt-8 border-t border-border pt-6' : undefined}>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                    {d.titulo} · {d.version}
                  </p>
                  <TextoDocumento md={d.textoMd} />
                </article>
              ))}
              <div ref={finRef} data-fin-terminos aria-hidden className="h-px w-full" />
            </div>
            {puedeAprobar && (
              <p aria-live="polite" className={`text-xs ${leido ? 'text-acento' : 'text-tinta-suave'}`}>
                {leido ? 'Leíste los términos hasta el final.' : 'Lee hasta el final para poder aceptar.'}
              </p>
            )}
          </div>

          <div className="rounded-md border border-border p-4 text-sm">
            <p className="font-semibold text-tinta">Política de Datos</p>
            <p className="mt-1 text-tinta">{aviso}</p>
            <a
              href={politicaUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs font-semibold text-acento underline underline-offset-2"
            >
              Leer la {politicaTitulo} completa
            </a>
          </div>

          {conflicto && (
            <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Ya tienes registrada la aceptación de otro documento con el mismo nombre y versión, así que esta no se puede
              registrar desde aquí. Escríbenos para resolverlo.
            </p>
          )}

          {contrato.estado === 'pendiente' && !contrato.puede && (
            <p className="rounded-md border border-border bg-papel p-3 text-sm text-tinta-suave">
              {textoQuienFirma(contrato, producto)}
            </p>
          )}

          {firmaDisponible && (
            <FormularioFirma
              empresas={firmaDisponible.empresas}
              designada={PRODUCTOS_ENTRADA[producto].exigeDesignado}
              nombre={nombre}
              cedula={cedula}
              calidad={calidad}
              onNombre={cambiar(setNombre)}
              onCedula={cambiar(setCedula)}
              onCalidad={cambiar(setCalidad)}
              declaraciones={declaraciones}
              error={nombre && cedula && calidad && !validos.ok ? validos.error : null}
            />
          )}

          {puedeAprobar && (
            <div className="space-y-3">
              {/* La casilla nace SIN marcar y no se puede marcar sin haber llegado al final. */}
              <label className={`flex items-start gap-2 text-sm ${casillaHabilitada ? 'text-tinta' : 'text-tinta-suave'}`}>
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={marcada}
                  disabled={!casillaHabilitada}
                  onChange={(e) => setMarcada(e.target.checked)}
                />
                <span data-casilla>{casilla}</span>
              </label>
              <button
                type="button"
                disabled={!casillaHabilitada || !marcada || pendiente}
                onClick={aprobar}
                className="w-full rounded-md bg-acento px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
              >
                {pendiente ? 'Registrando…' : 'Acepto'}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** El texto de un documento, pintado como texto: títulos, párrafos, listas y negritas. */
export function TextoDocumento({ md }: { md: string }) {
  return (
    <div className="space-y-3">
      {bloquesDeTexto(md).map((b, i) => {
        if (b.tipo === 'titulo') {
          const clase =
            b.nivel === 1 ? 'text-base font-bold' : b.nivel === 2 ? 'pt-2 text-sm font-bold' : 'text-sm font-semibold'
          const Titulo = b.nivel === 1 ? 'h3' : b.nivel === 2 ? 'h4' : 'h5'
          return (
            <Titulo key={i} className={`${clase} text-tinta`}>
              <Tramos tramos={b.tramos} />
            </Titulo>
          )
        }
        if (b.tipo === 'lista') {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.items.map((item, j) => (
                <li key={j}>
                  <Tramos tramos={item} />
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i} className="whitespace-pre-line">
            <Tramos tramos={b.tramos} />
          </p>
        )
      })}
    </div>
  )
}

function Tramos({ tramos }: { tramos: Tramo[] }) {
  return (
    <>
      {tramos.map((t, i) =>
        t.negrita ? (
          <strong key={i} className="font-semibold">
            {t.texto}
          </strong>
        ) : (
          <Fragment key={i}>{t.texto}</Fragment>
        ),
      )}
    </>
  )
}

function FormularioFirma({
  empresas,
  designada,
  nombre,
  cedula,
  calidad,
  onNombre,
  onCedula,
  onCalidad,
  declaraciones,
  error,
}: {
  empresas: string[]
  /** Firma la persona que el contrato designó, no «el dueño del espacio». */
  designada: boolean
  nombre: string
  cedula: string
  calidad: string
  onNombre: (v: string) => void
  onCedula: (v: string) => void
  onCalidad: (v: string) => void
  declaraciones: { documentoId: string; texto: string }[] | null
  error: string | null
}) {
  const empresa = empresas.join(' y ')
  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-tinta">Firma del contrato</p>
        <p className="text-sm text-tinta">
          {designada
            ? `La empresa te designó para aceptar estos términos en su nombre. Acepta en nombre de ${empresa} solo si tienes facultades para obligarla: como su representante legal o como apoderado.`
            : `Eres el dueño de este espacio y el contrato todavía no tiene su aceptación. Acepta en nombre de ${empresa} solo si tienes facultades para obligarla: como su representante legal o como apoderado.`}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium text-tinta">Nombre completo</span>
          <input
            name="nombre"
            value={nombre}
            onChange={(e) => onNombre(e.target.value)}
            maxLength={120}
            autoComplete="name"
            className="w-full rounded-md border border-border px-3 py-2 text-base sm:text-sm"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium text-tinta">Cédula</span>
          <input
            name="cedula"
            value={cedula}
            onChange={(e) => onCedula(e.target.value)}
            inputMode="numeric"
            maxLength={16}
            className="w-full rounded-md border border-border px-3 py-2 text-base sm:text-sm"
          />
        </label>
      </div>
      <fieldset className="space-y-1 text-sm">
        <legend className="font-medium text-tinta">Actúo como</legend>
        <div className="flex flex-wrap gap-4">
          {(Object.keys(CALIDADES_ACEPTANTE) as (keyof typeof CALIDADES_ACEPTANTE)[]).map((clave) => (
            <label key={clave} className="flex items-center gap-2 text-tinta">
              <input type="radio" name="calidad" value={clave} checked={calidad === clave} onChange={() => onCalidad(clave)} />
              {CALIDADES_ACEPTANTE[clave]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="rounded-md border border-border bg-papel p-3 text-sm text-tinta">
        <p className="mb-1 text-xs font-semibold text-tinta-suave">
          {declaraciones && declaraciones.length > 1 ? 'Declaraciones que vas a firmar' : 'Declaración que vas a firmar'}
        </p>
        {declaraciones ? (
          <div className="space-y-2">
            {declaraciones.map((d) => (
              <p key={d.documentoId} data-declaracion>
                {d.texto}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-tinta-suave">
            {/* El error se dice cuando ya están los tres datos: antes, es solo un formulario a medio llenar. */}
            {error ?? 'Completa tu nombre completo, tu cédula y en qué calidad actúas para ver la declaración.'}
          </p>
        )}
      </div>
    </div>
  )
}
