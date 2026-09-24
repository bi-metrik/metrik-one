'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, CheckCircle2, FileText, History, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { hrefArchivo } from '@/lib/almacenamiento/referencia'
import type { ReprocesoResumen, VistaDatosClave } from '@/lib/negocios/datos-clave'
import type { LecturaFuente, ResultadoVoto } from '@/lib/negocios/votos'

/** Corrige una lectura dudosa al valor de la mayoría. La inyecta la ficha (server action). */
export type CorregirLectura = (votoSlug: string, clave: string) => Promise<{ success: boolean; error?: string }>

/**
 * Tarjeta «Datos clave» del negocio: lo que cambia el trámite, a la vista en todas las
 * etapas. Solo lectura: cada dato se corrige en el bloque donde se responde.
 *
 * Tres estados por campo, y ninguno se esconde:
 *  - con valor: el valor, y su nota si la trae («cotizada»);
 *  - «Sin definir» en ámbar: el dato le aplica al caso y falta. Es justo lo que hay que ver;
 *  - «No aplica» en gris: ninguna de sus fuentes le aplica al caso.
 * Las contradicciones entre datos (los cruces de la línea) van arriba y en rojo, con el
 * texto del cruce. Si una frena el avance en esta etapa, lo dice.
 *
 * La decisión de qué mostrar ya viene tomada del servidor (`datos-clave.ts`); aquí solo se
 * pinta, así que la tarjeta y el gate de avance no pueden decir cosas distintas.
 */
export default function PanelDatosClave({
  vista,
  corregirLectura,
}: {
  vista: VistaDatosClave | null | undefined
  corregirLectura?: CorregirLectura
}) {
  const lecturas = vista?.lecturas ?? []
  const reprocesos = vista?.reprocesos ?? []
  if (
    !vista ||
    (vista.campos.length === 0 && vista.contradicciones.length === 0 && lecturas.length === 0 && reprocesos.length === 0)
  ) return null
  const enDisputa = lecturas.filter(l => l.estado === 'dudosa' || l.estado === 'manual')
  const resueltas = lecturas.filter(l => l.estado === 'acuerdo' || l.estado === 'sin_contraste')

  return (
    <section className="rounded-lg border border-border bg-card p-3" aria-label={vista.titulo}>
      <div className="mb-2 flex items-center gap-2">
        <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <h3 className="text-xs font-semibold">{vista.titulo}</h3>
      </div>

      {vista.contradicciones.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {vista.contradicciones.map(c => (
            <li
              key={c.slug}
              className="flex gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] leading-snug text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
            >
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
              <span>
                {c.mensaje}
                {c.bloquea && <span className="font-semibold"> Frena el avance en esta etapa.</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {enDisputa.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {enDisputa.map(v => (
            <LecturaEnDisputa key={v.slug} voto={v} corregirLectura={corregirLectura} />
          ))}
        </ul>
      )}

      {vista.campos.length > 0 && (
        <dl className="space-y-1.5">
          {vista.campos.map(campo => (
            <div key={campo.label}>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{campo.label}</dt>
                <dd className="min-w-0 flex-1 text-right text-xs">
                  {campo.valor.estado === 'ok' && (
                    <>
                      <span className="font-medium">{campo.valor.texto}</span>
                      {campo.valor.nota && (
                        <span className="ml-1 text-[10px] text-muted-foreground">({campo.valor.nota})</span>
                      )}
                    </>
                  )}
                  {campo.valor.estado === 'sin_definir' && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      Sin definir
                    </span>
                  )}
                  {campo.valor.estado === 'no_aplica' && <span className="text-muted-foreground">No aplica</span>}
                </dd>
              </div>
              {campo.detalle.length > 0 && (
                <ul className="mt-0.5 space-y-0.5 text-right">
                  {campo.detalle.map((d, i) => (
                    <li key={i} className="text-[11px] leading-snug text-muted-foreground">{d}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </dl>
      )}

      {resueltas.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-border pt-2">
          {resueltas.map(v => (
            <li key={v.slug} className="text-[11px] leading-snug text-muted-foreground">
              <span className="font-medium text-foreground">{v.label}: {v.valor}</span>
              {' · '}
              {concordancia(v)}
            </li>
          ))}
        </ul>
      )}

      {reprocesos.length > 0 && <Reprocesos reprocesos={reprocesos} />}
    </section>
  )
}

function listaEtiquetas(fuentes: LecturaFuente[]): string {
  const e = [...new Set(fuentes.map(f => f.etiqueta))]
  return e.length <= 1 ? (e[0] ?? '') : `${e.slice(0, -1).join(', ')} y ${e[e.length - 1]}`
}

/**
 * La confianza que se muestra sale de la CONCORDANCIA entre documentos, no del número
 * que devuelve la IA: V0142 salió con 0,98 y estaba mal leído.
 */
function concordancia(v: ResultadoVoto): string {
  if (v.estado === 'sin_contraste') {
    return `solo en ${listaEtiquetas(v.fuentes)}, sin otro documento con qué contrastarlo`
  }
  const coinciden = v.fuentes.filter(f => f.estado === 'coincide')
  const confirmadas = v.fuentes.filter(f => f.estado === 'confirmada')
  let texto = `coincide en ${listaEtiquetas(coinciden)}`
  for (const c of confirmadas) {
    texto += ` · ${c.etiqueta} dice ${c.valor}, confirmado a mano${c.editada_por ? ` por ${c.editada_por}` : ''}`
  }
  return texto
}

function LecturaEnDisputa({ voto, corregirLectura }: { voto: ResultadoVoto; corregirLectura?: CorregirLectura }) {
  const [pendiente, startTransition] = useTransition()
  const [hecho, setHecho] = useState<string | null>(null)

  const corregir = (f: LecturaFuente) => {
    if (!corregirLectura) return
    startTransition(async () => {
      const res = await corregirLectura(voto.slug, f.clave)
      if (!res.success) {
        toast.error(res.error ?? 'No se pudo corregir')
        return
      }
      setHecho(f.clave)
      toast.success(`${f.etiqueta} corregido a ${voto.valor}`)
    })
  }

  return (
    <li className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] leading-snug text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
      <div className="flex gap-1.5">
        <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
        <span>
          {voto.mensaje}
          {voto.bloquea && <span className="font-semibold"> Frena el avance en esta etapa.</span>}
          {voto.niega_generacion && (
            <span className="font-semibold"> No se generan documentos para la DIAN mientras siga así.</span>
          )}
        </span>
      </div>
      <ul className="mt-1.5 space-y-1 pl-4">
        {voto.fuentes.map(f => (
          <li key={f.clave} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={f.estado === 'coincide' ? 'text-red-800/70 dark:text-red-300/70' : 'font-semibold'}>
              {f.etiqueta}: {f.valor}
            </span>
            {f.estado === 'dudosa' && (
              <span className="rounded bg-red-100 px-1 py-px text-[10px] font-semibold uppercase tracking-wide dark:bg-red-900/50">
                Lectura dudosa
                {f.forma === 'prefijo' || f.forma === 'prefijo_y_dv'
                  ? ' · trae el código del tipo de documento'
                  : f.dv_invalido ? ' · no valida con su DV' : ''}
              </span>
            )}
            {f.estado === 'en_disputa' && (
              <span className="rounded bg-red-100 px-1 py-px text-[10px] font-semibold uppercase tracking-wide dark:bg-red-900/50">
                Revisión manual
              </span>
            )}
            {f.archivo && hrefArchivo(f.archivo) && (
              <a
                href={hrefArchivo(f.archivo) ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 underline underline-offset-2"
              >
                <FileText className="h-3 w-3" aria-hidden />
                Ver PDF
              </a>
            )}
            {f.estado === 'dudosa' && voto.valor && corregirLectura && hecho !== f.clave && (
              <button
                type="button"
                onClick={() => corregir(f)}
                disabled={pendiente}
                className="rounded border border-red-300 bg-white px-1.5 py-px text-[10px] font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60 dark:border-red-800 dark:bg-transparent dark:text-red-200"
              >
                {pendiente ? 'Corrigiendo…' : `Corregir a ${voto.valor}`}
              </button>
            )}
            {hecho === f.clave && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-3 w-3" aria-hidden />
                Corregido
              </span>
            )}
          </li>
        ))}
      </ul>
      {voto.estado === 'dudosa' ? (
        <p className="mt-1.5 pl-4 text-[10px] text-red-800/80 dark:text-red-300/80">
          Mira el PDF antes de corregir: si el documento mismo dice otro número, el error está en el documento y hay que pedir uno nuevo.
        </p>
      ) : (
        <p className="mt-1.5 pl-4 text-[10px] text-red-800/80 dark:text-red-300/80">
          Ningún número tiene mayoría. Revisa los PDF y corrige a mano el que esté mal leído.
        </p>
      )}
    </li>
  )
}

function Reprocesos({ reprocesos }: { reprocesos: ReprocesoResumen[] }) {
  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="mb-1 flex items-center gap-1.5">
        <History className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Reprocesos</span>
      </div>
      <ul className="space-y-0.5">
        {reprocesos.map(r => (
          <li
            key={`${r.ciclo}-${r.abierto_at}`}
            className={
              r.activo
                ? 'text-[11px] font-medium leading-snug text-amber-800 dark:text-amber-300'
                : 'text-[11px] leading-snug text-muted-foreground'
            }
          >
            {r.texto}
          </li>
        ))}
      </ul>
    </div>
  )
}
