// Vista del repositorio de archivos de un negocio (almacenamiento externo).
//
// Componente de presentación puro: no lee la sesión ni la base, recibe lo que ya
// resolvió `page.tsx`. Así la prueba de render fija QUÉ se pinta sin montar Next.
//
// Cada archivo abre por `/api/archivos/abrir`, que vuelve a validar sesión y workspace
// y firma por 5 minutos: aquí nunca viaja una URL firmada, que vencería con la página
// abierta.

import Link from 'next/link'
import { ArrowLeft, Download, FileText, FolderOpen, AlertTriangle } from 'lucide-react'
import { hrefArchivo } from '@/lib/almacenamiento/referencia'
import { formatearTamano, type GrupoRepositorio } from '@/lib/almacenamiento/repositorio'
import { formatBogotaFechaCortaAno } from '@/lib/dates/bogota'

export type EstadoRepositorio =
  | { tipo: 'ok'; grupos: GrupoRepositorio[]; truncado: boolean }
  | { tipo: 'sin_acceso' }
  | { tipo: 'error'; mensaje: string }

export interface RepositorioArchivosProps {
  negocioId: string
  negocio: { codigo: string | null; nombre: string } | null
  estado: EstadoRepositorio
}

export default function RepositorioArchivos({ negocioId, negocio, estado }: RepositorioArchivosProps) {
  const volver = estado.tipo === 'sin_acceso' ? '/negocios' : `/negocios/${negocioId}`

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
      <div className="space-y-1">
        <Link
          href={volver}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {estado.tipo === 'sin_acceso' ? 'Volver a negocios' : 'Volver al negocio'}
        </Link>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <FolderOpen className="h-5 w-5 text-amber-500" />
          Archivos del negocio
        </h1>
        {negocio && (
          <p className="text-sm text-muted-foreground">
            {negocio.codigo ? `${negocio.codigo} · ` : ''}
            {negocio.nombre}
          </p>
        )}
      </div>

      {estado.tipo === 'sin_acceso' && (
        <Aviso texto="No tienes acceso a los archivos de este negocio." />
      )}

      {estado.tipo === 'error' && <Aviso texto={estado.mensaje} />}

      {estado.tipo === 'ok' && <Contenido grupos={estado.grupos} truncado={estado.truncado} />}
    </div>
  )
}

function Contenido({ grupos, truncado }: { grupos: GrupoRepositorio[]; truncado: boolean }) {
  const total = grupos.reduce((n, g) => n + g.archivos.length, 0)

  return (
    <>
      <p className="text-xs text-muted-foreground">
        {total === 0
          ? 'Este negocio todavía no tiene archivos.'
          : `${total} ${total === 1 ? 'archivo' : 'archivos'}`}
      </p>

      {truncado && (
        <Aviso texto="La lista está incompleta: el negocio tiene más archivos de los que esta vista muestra." />
      )}

      {grupos.map((g) => (
        <section key={g.clave || '(raiz)'} className="rounded-lg border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="text-sm font-medium text-foreground">{g.etiqueta}</h2>
            <span className="text-[11px] tabular-nums text-muted-foreground">{g.archivos.length}</span>
          </header>
          {g.archivos.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground/70">Sin archivos</p>
          ) : (
            <ul className="divide-y divide-border">
              {g.archivos.map((a) => (
                <li key={a.path} className="flex items-center gap-3 px-3 py-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <a
                    href={hrefArchivo(a.referencia) ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-sm text-foreground hover:underline"
                  >
                    {a.nombre}
                  </a>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                    {formatBogotaFechaCortaAno(a.actualizado) ?? '—'}
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {formatearTamano(a.bytes)}
                  </span>
                  <a
                    href={hrefArchivo(a.referencia, { descargar: true }) ?? undefined}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`Descargar ${a.nombre}`}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  )
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <p className="text-xs text-amber-800">{texto}</p>
    </div>
  )
}
