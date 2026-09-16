'use client'

import { Fragment, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle,
  BarChart3,
  BadgeCheck,
  Check,
  Copy,
  CreditCard,
  FileText,
  HelpCircle,
  KeyRound,
  Receipt,
  ShieldCheck,
} from 'lucide-react'
import { aprobarEntradaValidaApi, generarLlaveValidaApi, revocarLlaveValidaApi } from '@/lib/valida-api/acciones'
import { vistaConsumo } from '@/lib/valida-api/consumo-vista'
import { textoCasillaEntrada } from '@/lib/valida-api/entrada'
import {
  CALIDADES_ACEPTANTE,
  textoDeclaracionTerminos,
  validarDatosAceptante,
} from '@/lib/valida-api/terminos'
import { bloquesDeTexto, type Tramo } from '@/lib/valida-api/texto-documento'
import type {
  Carga,
  EstadoEntradaPagina,
  LlaveRecienEmitida,
  ResultadoLlaves,
  ResultadoPagos,
  ResultadoResumen,
  ResultadoTerminosAprobados,
} from '@/lib/valida-api/resultados'
import type { LlaveValida } from '@/lib/valida-api/tipos'
import { formatBogotaFechaCortaAno, formatBogotaFechaHora } from '@/lib/dates/bogota'
import { formatCOP } from '@/lib/cobros/format'

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
 */
export function EntradaValidaApi({
  entrada,
  aviso,
  politicaUrl,
  politicaTitulo,
}: {
  entrada: EntradaPendiente
  aviso: string
  politicaUrl: string
  politicaTitulo: string
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
      ? firmaDisponible.porFirmar.map((d) => ({ documentoId: d.documentoId, texto: textoDeclaracionTerminos(d, validos.datos) }))
      : null
  const casilla = textoCasillaEntrada({ documentos, firmaPor: firmaDisponible ? firmaDisponible.empresas : null })
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
      const r = await aprobarEntradaValidaApi({
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
              {contrato.razon === 'soporte'
                ? 'Estás en este espacio como soporte de MeTRIK. Los términos del contrato los acepta el dueño del espacio del cliente; cuando lo haga, podrás hacer aquí tu propia aprobación.'
                : 'El dueño del espacio, que es quien puede obligar a la empresa, todavía no ha aceptado estos términos. El módulo se abre cuando los acepte; después haces aquí tu propia aprobación.'}
            </p>
          )}

          {firmaDisponible && (
            <FormularioFirma
              empresas={firmaDisponible.empresas}
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
          Eres el dueño de este espacio y el contrato todavía no tiene su aceptación. Acepta en nombre de {empresa} solo
          si tienes facultades para obligarla: como su representante legal o como apoderado.
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

// ── Pestañas ───────────────────────────────────────────────────────────────

type Pestana = 'llaves' | 'consumo' | 'suscripcion' | 'terminos' | 'pagos' | 'ayuda'

export function ValidaApiCliente({
  resumen,
  llaves,
  terminos,
  pagos,
  operaLlaves,
  vePagos,
}: {
  resumen: ResultadoResumen
  llaves: ResultadoLlaves | null
  terminos: ResultadoTerminosAprobados
  pagos: ResultadoPagos | null
  operaLlaves: boolean
  vePagos: boolean
}) {
  const [pestana, setPestana] = useState<Pestana>(operaLlaves ? 'llaves' : 'consumo')

  const pestanas: { id: Pestana; etiqueta: string; icono: React.ReactNode; visible: boolean }[] = [
    { id: 'llaves', etiqueta: 'Llaves', icono: <KeyRound className="h-4 w-4" />, visible: operaLlaves },
    { id: 'consumo', etiqueta: 'Consumo', icono: <BarChart3 className="h-4 w-4" />, visible: true },
    { id: 'suscripcion', etiqueta: 'Suscripción', icono: <CreditCard className="h-4 w-4" />, visible: true },
    { id: 'terminos', etiqueta: 'Términos', icono: <FileText className="h-4 w-4" />, visible: true },
    { id: 'pagos', etiqueta: 'Pagos', icono: <Receipt className="h-4 w-4" />, visible: vePagos },
    { id: 'ayuda', etiqueta: 'Ayuda', icono: <HelpCircle className="h-4 w-4" />, visible: true },
  ]

  return (
    <div className="space-y-5">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
        {pestanas
          .filter((p) => p.visible)
          .map((p) => (
            <button
              key={p.id}
              role="tab"
              type="button"
              aria-selected={pestana === p.id}
              onClick={() => setPestana(p.id)}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                pestana === p.id ? 'border-tinta text-tinta' : 'border-transparent text-tinta-suave hover:text-tinta'
              }`}
            >
              {p.icono}
              {p.etiqueta}
            </button>
          ))}
      </div>

      {pestana === 'llaves' && llaves && <PestanaLlaves carga={llaves} />}
      {pestana === 'consumo' && <PestanaConsumo carga={resumen} />}
      {pestana === 'suscripcion' && <PestanaSuscripcion />}
      {pestana === 'terminos' && <PestanaTerminos carga={terminos} />}
      {pestana === 'pagos' && pagos && <PestanaPagos carga={pagos} />}
      {pestana === 'ayuda' && <PestanaAyuda />}
    </div>
  )
}

/** Lo que se dice cuando una pestaña no cargó. Nunca una lista vacía en su lugar. */
function AvisoCarga({ carga }: { carga: Exclude<Carga<unknown>, { estado: 'ok' }> }) {
  if (carga.estado === 'sin_acceso') {
    return <p className="rounded-lg border border-border bg-papel p-4 text-sm text-tinta-suave">{carga.razon}</p>
  }
  const titulo = carga.estado === 'rechazada' ? 'Valida rechazó la consulta' : 'No disponible en este momento'
  const detalle =
    carga.estado === 'rechazada'
      ? carga.mensaje
      : carga.motivo === 'sin_migracion'
        ? 'Esta sección todavía no está habilitada en este entorno.'
        : 'No pudimos conectar con Valida. El resto del módulo funciona; intenta de nuevo en unos minutos.'
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-semibold">{titulo}</p>
        <p className="mt-1">{detalle}</p>
      </div>
    </div>
  )
}

// ── Llaves ──────────────────────────────────────────────────────────────────

const ETIQUETA_ESTADO_LLAVE: Record<LlaveValida['estado'], string> = {
  activa: 'Activa',
  en_retiro: 'En retiro',
  vencida: 'Vencida',
  revocada: 'Revocada',
}

function PestanaLlaves({ carga }: { carga: ResultadoLlaves }) {
  const router = useRouter()
  const [nombre, setNombre] = useState('')
  const [recien, setRecien] = useState<LlaveRecienEmitida | null>(null)
  const [pendiente, iniciar] = useTransition()

  if (carga.estado !== 'ok') return <AvisoCarga carga={carga} />
  const { llaves, limite_vigentes } = carga.datos
  const vigentes = llaves.filter((l) => l.estado === 'activa' || l.estado === 'en_retiro').length
  const enLimite = vigentes >= limite_vigentes

  function generar(args: { nombre?: string; reemplazaA?: string; revocarAnterior?: boolean }) {
    iniciar(async () => {
      const r = await generarLlaveValidaApi(args)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setRecien(r.llave)
      setNombre('')
      router.refresh()
    })
  }

  function revocar(llave: LlaveValida) {
    if (!window.confirm(`¿Revocar la llave «${llave.nombre ?? llave.key_prefix}»? Deja de funcionar en la siguiente consulta.`)) return
    iniciar(async () => {
      const r = await revocarLlaveValidaApi(llave.key_id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.yaEstabaRevocada ? 'La llave ya estaba revocada.' : 'Llave revocada.')
      router.refresh()
    })
  }

  function regenerar(llave: LlaveValida) {
    if (!window.confirm(`¿Regenerar «${llave.nombre ?? llave.key_prefix}»? Recibirás una llave nueva; la anterior sigue funcionando un tiempo para que la cambies en tu sistema.`)) return
    generar({ reemplazaA: llave.key_id, revocarAnterior: false })
  }

  return (
    <div className="space-y-5">
      {recien && <LlaveUnaVez llave={recien} onCerrar={() => setRecien(null)} />}

      <div className="rounded-lg border border-border bg-white p-4">
        <p className="text-sm font-semibold text-tinta">Generar una llave</p>
        <p className="mt-1 text-xs text-tinta-suave">
          Tienes {vigentes} de {limite_vigentes} llaves vigentes.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={60}
            placeholder="Nombre, por ejemplo «ERP de facturación»"
            className="min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={pendiente || enLimite || nombre.trim().length === 0}
            onClick={() => generar({ nombre })}
            className="rounded-md bg-acento px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Generar
          </button>
        </div>
        {enLimite && (
          <p className="mt-2 text-xs text-amber-800">Llegaste al máximo de llaves vigentes. Revoca una para generar otra.</p>
        )}
      </div>

      {llaves.length === 0 ? (
        <p className="text-sm text-tinta-suave">Todavía no hay llaves para tu integración.</p>
      ) : (
        <ul className="space-y-2">
          {llaves.map((l) => (
            <li key={l.key_id} className="rounded-lg border border-border bg-white p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-tinta">{l.nombre ?? 'Sin nombre'}</span>
                <span className="text-xs text-tinta-suave">{ETIQUETA_ESTADO_LLAVE[l.estado] ?? l.estado}</span>
              </div>
              <p className="mt-1 font-mono text-xs text-tinta-suave">{l.key_prefix}…</p>
              <p className="mt-1 text-xs text-tinta-suave">
                Creada {formatBogotaFechaCortaAno(l.creada_en) ?? '—'}
                {' · '}
                {l.ultima_uso_en ? `último uso ${formatBogotaFechaHora(l.ultima_uso_en)}` : 'sin uso todavía'}
                {l.estado === 'en_retiro' && l.vence_en && ` · deja de funcionar ${formatBogotaFechaHora(l.vence_en)}`}
              </p>
              {l.estado === 'activa' && (
                <div className="mt-2 flex gap-3">
                  <button type="button" disabled={pendiente} onClick={() => regenerar(l)} className="text-xs font-semibold text-acento disabled:opacity-50">
                    Regenerar
                  </button>
                  <button type="button" disabled={pendiente} onClick={() => revocar(l)} className="text-xs font-semibold text-red-700 disabled:opacity-50">
                    Revocar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * La llave EN CLARO, una sola vez. Vive solo en el estado de este componente: no va a
 * localStorage, ni a la URL, ni a un log. Al cerrar el panel se descarta.
 */
export function LlaveUnaVez({ llave, onCerrar }: { llave: LlaveRecienEmitida; onCerrar: () => void }) {
  const [copiada, setCopiada] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(llave.llave)
      setCopiada(true)
    } catch {
      toast.error('No se pudo copiar. Selecciona el texto y cópialo a mano.')
    }
  }

  return (
    <div className="rounded-lg border-2 border-acento bg-acento-tinte p-4">
      <p className="text-sm font-semibold text-tinta">
        {llave.regenerada ? 'Llave regenerada' : 'Llave generada'}: {llave.nombre}
      </p>
      <p className="mt-1 text-sm font-semibold text-red-700">
        Esta es la única vez que vas a ver esta llave. Guárdala ahora en un lugar seguro: Valida solo conserva su huella y no podrá mostrártela de nuevo.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-white px-3 py-2 font-mono text-xs text-tinta">
          {llave.llave}
        </code>
        <button type="button" onClick={copiar} className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-tinta">
          {copiada ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copiada ? 'Copiada' : 'Copiar'}
        </button>
      </div>
      {llave.anteriorDejaDeAutenticarEn && (
        <p className="mt-2 text-xs text-tinta-suave">
          La llave anterior deja de funcionar el {formatBogotaFechaHora(llave.anteriorDejaDeAutenticarEn)}.
        </p>
      )}
      <button type="button" onClick={onCerrar} className="mt-3 text-sm font-semibold text-acento">
        Ya la guardé
      </button>
    </div>
  )
}

// ── Consumo ─────────────────────────────────────────────────────────────────

function PestanaConsumo({ carga }: { carga: ResultadoResumen }) {
  if (carga.estado !== 'ok') return <AvisoCarga carga={carga} />
  const vista = vistaConsumo(carga.datos)

  if (vista.tipo === 'sin_datos') {
    return <p className="text-sm text-tinta-suave">Valida no devolvió datos de consumo para tu cuenta.</p>
  }
  if (vista.tipo === 'mensual') {
    return <p className="text-sm text-tinta-suave">Tu cuenta tiene un plan mensual, no un paquete de consultas.</p>
  }

  return (
    <div className="space-y-4">
      {vista.vigente ? (
        <div className="rounded-lg border border-border bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-tinta">Paquete vigente</p>
            <p className="text-xs text-tinta-suave">Vence el {formatBogotaFechaCortaAno(vista.vigente.venceEn) ?? '—'}</p>
          </div>
          <p className="mt-2 text-2xl font-bold text-tinta">
            {vista.vigente.saldo.toLocaleString('es-CO')}{' '}
            <span className="text-sm font-normal text-tinta-suave">consultas disponibles</span>
          </p>
          <p className="text-xs text-tinta-suave">
            {vista.vigente.consumidas.toLocaleString('es-CO')} usadas de {vista.vigente.compradas.toLocaleString('es-CO')}
            {vista.vigente.porcentajeUsado !== null && ` (${vista.vigente.porcentajeUsado} %)`}
          </p>
          {vista.vigente.porcentajeUsado !== null && (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-papel">
              <div className="h-full bg-acento" style={{ width: `${vista.vigente.porcentajeUsado}%` }} />
            </div>
          )}
          {vista.vigente.cortada && (
            <p className="mt-3 text-sm font-semibold text-red-700">
              Este paquete está {vista.vigente.estado === 'vencida' ? 'vencido' : 'agotado'}: la API responde 402 hasta que haya uno nuevo.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-tinta-suave">No tienes un paquete vigente en este momento.</p>
      )}

      {vista.enEspera && (
        <div className="rounded-lg border border-border bg-white p-4 text-sm">
          <p className="font-semibold text-tinta">Paquete en espera</p>
          <p className="mt-1 text-tinta-suave">
            {vista.enEspera.consultas_compradas.toLocaleString('es-CO')} consultas pagadas. Se activa solo cuando el vigente se agote o venza.
          </p>
        </div>
      )}

      {vista.historial.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-tinta">Paquetes anteriores</p>
          <ul className="space-y-1 text-xs text-tinta-suave">
            {vista.historial.map((h) => (
              <li key={h.bolsa_id}>
                #{h.secuencia} · {h.consultas_compradas.toLocaleString('es-CO')} consultas · {h.consumidas.toLocaleString('es-CO')} usadas · {h.estado}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Suscripción: C4. Honesto, sin datos inventados ──────────────────────────

function PestanaSuscripcion() {
  return (
    <div className="rounded-lg border border-border bg-papel p-4 text-sm text-tinta-suave">
      <p className="font-semibold text-tinta">Todavía no tienes una suscripción</p>
      <p className="mt-1">
        Tus paquetes de consultas se recargan hoy por solicitud a MeTRIK. La renovación automática con tarjeta llega más adelante y
        vas a poder activarla desde aquí, después de aceptar los términos que la regulan.
      </p>
    </div>
  )
}

// ── Términos: lo que el usuario aprobó, para releerlo ──────────────────────

/**
 * Los términos que la persona aprobó en la entrada, con el mismo texto y el mismo render, y un sello
 * «Aprobado». Solo lectura: sin casilla, sin botón y con el scroll normal de la página. El texto
 * llega únicamente si el servidor comprobó que es el de la versión aprobada (`terminos-aprobados.ts`);
 * si no, se dice, y no se pinta ningún otro.
 */
export function PestanaTerminos({ carga }: { carga: ResultadoTerminosAprobados }) {
  if (carga.estado !== 'ok') return <AvisoCarga carga={carga} />
  if (carga.datos.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-papel p-4 text-sm text-tinta-suave">
        No encontramos términos aprobados por ti en este espacio. Escríbenos si esperabas verlos.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {carga.datos.map((t) =>
        t.estado === 'verificado' ? (
          <article key={t.documentoId} data-termino-aprobado className="rounded-lg border border-border bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                {t.titulo} · {t.version}
              </p>
              <span
                data-sello-aprobado
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800"
              >
                <BadgeCheck className="h-4 w-4" />
                Aprobado
              </span>
            </div>
            <div className="mt-2 space-y-0.5 text-xs text-tinta-suave">
              <p>Aprobado por ti el {formatBogotaFechaHora(t.aprobadoAt)} (hora Colombia).</p>
              {t.contrato && (
                <p>
                  Contrato aceptado el {formatBogotaFechaHora(t.contrato.aceptadoAt)}
                  {t.contrato.aceptadoPor && ` por ${t.contrato.aceptadoPor}`}
                  {t.contrato.canal === 'whatsapp' ? ', por WhatsApp.' : ', en este módulo.'}
                </p>
              )}
            </div>
            <div className="mt-4 rounded-md border border-border bg-papel p-4 text-sm leading-relaxed text-tinta [overflow-wrap:anywhere]">
              <TextoDocumento md={t.textoMd} />
            </div>
          </article>
        ) : (
          <div
            key={`${t.titulo ?? 'documento'}-${t.version}`}
            data-termino-no-verificado
            className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">
                No podemos mostrar el texto que aprobaste{t.titulo ? ` de «${t.titulo}»` : ''} ({t.version})
              </p>
              <p className="mt-1">
                Tu aprobación es del {formatBogotaFechaHora(t.aprobadoAt)} (hora Colombia), pero no pudimos comprobar que el
                texto guardado sea el mismo que aprobaste, así que no mostramos ninguno. Escríbenos para revisarlo.
              </p>
            </div>
          </div>
        ),
      )}
    </div>
  )
}

// ── Pagos ───────────────────────────────────────────────────────────────────

const ETIQUETA_ESTADO_COBRO = { pagado: 'Pagado', programado: 'Programado', anulado: 'Anulado' } as const

function PestanaPagos({ carga }: { carga: ResultadoPagos }) {
  if (carga.estado !== 'ok') return <AvisoCarga carga={carga} />
  if (carga.datos.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-papel p-4 text-sm text-tinta-suave">
        Tus pagos aparecen aquí cuando MeTRIK registre el contrato de este espacio.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {carga.datos.map((s) => (
        <section key={s.servicioContratadoId} className="rounded-lg border border-border bg-white p-4">
          <p className="text-sm font-semibold text-tinta">{s.nombre}</p>
          {s.cobros.length === 0 ? (
            <p className="mt-2 text-xs text-tinta-suave">Sin pagos registrados en este contrato.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-tinta-suave">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Fecha</th>
                    <th className="py-1 pr-3 font-medium">Concepto</th>
                    <th className="py-1 pr-3 font-medium">Valor</th>
                    <th className="py-1 pr-3 font-medium">Medio</th>
                    <th className="py-1 pr-3 font-medium">Estado</th>
                    <th className="py-1 font-medium">Recibo</th>
                  </tr>
                </thead>
                <tbody className="text-tinta">
                  {s.cobros.map((c) => (
                    <tr key={c.cobroId} className="border-t border-border">
                      <td className="py-1.5 pr-3">{c.fecha ? formatBogotaFechaCortaAno(c.fecha) : '—'}</td>
                      <td className="py-1.5 pr-3">{c.concepto}</td>
                      <td className={`py-1.5 pr-3 ${c.estado === 'anulado' ? 'line-through text-tinta-suave' : ''}`}>{formatCOP(c.monto)}</td>
                      <td className="py-1.5 pr-3">{c.fuente ?? '—'}</td>
                      <td className="py-1.5 pr-3">{ETIQUETA_ESTADO_COBRO[c.estado]}</td>
                      <td className="py-1.5">
                        {c.reciboDescargable ? (
                          <a href={`/api/valida-api/archivo/recibo/${c.cobroId}`} className="font-semibold text-acento">
                            {c.reciboNumero ?? 'Descargar'}
                          </a>
                        ) : (
                          (c.reciboNumero ?? '—')
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

// ── Ayuda ───────────────────────────────────────────────────────────────────

const RECURSOS = [
  { titulo: 'Guía del integrador', url: 'https://valida.metrik.com.co/docs', texto: 'Cómo autenticarte, consultar y leer el resultado.' },
  { titulo: 'Referencia de la API', url: 'https://valida.metrik.com.co/docs/referencia', texto: 'Cada ruta, sus campos y sus errores.' },
  { titulo: 'Manual', url: 'https://valida.metrik.com.co/recursos/manual', texto: 'El servicio explicado paso a paso.' },
  { titulo: 'Seguridad', url: 'https://valida.metrik.com.co/recursos/seguridad', texto: 'Cómo proteger tus llaves y tus datos.' },
  { titulo: 'Soporte', url: 'https://valida.metrik.com.co/recursos/soporte', texto: 'Cómo pedir ayuda y en qué tiempos respondemos.' },
] as const

function PestanaAyuda() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {RECURSOS.map((r) => (
        <li key={r.url}>
          <a href={r.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-border bg-white p-4 hover:border-acento">
            <p className="text-sm font-semibold text-tinta">{r.titulo}</p>
            <p className="mt-1 text-xs text-tinta-suave">{r.texto}</p>
          </a>
        </li>
      ))}
    </ul>
  )
}
