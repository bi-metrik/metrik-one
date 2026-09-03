'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Building2, ChevronDown, Mail, MapPin, Megaphone, MessageCircle, Phone, IdCard } from 'lucide-react'
import { esEmpresaEspejo } from '@/lib/contactos/empresa-espejo'
import { telDesdeTelefono, whatsappDesdeTelefono } from '@/lib/contactos/telefono'
import type { ResumenCampanas } from '@/lib/contactos/campanas'
import { ROLES_CONTACTO, resolverStatusContacto } from '@/lib/catalogos/constants'
import { formatBogotaFechaCortaAno } from '@/lib/dates/bogota'

/**
 * Panel del contacto dentro del negocio.
 *
 * Existe porque para conseguir el teléfono de la persona con la que se va a
 * hablar había que ABANDONAR el caso, abrir el 360 del contacto en otra pestaña
 * y devolverse. 973 de 1.029 contactos del workspace tienen teléfono y no se
 * veía en ningún punto del negocio.
 *
 * **Lee, no escribe.** Cada campo editable lleva a donde se edita. Abrir
 * escritura aquí sería resolver el árbol de permisos en un segundo lugar, y eso
 * ya es fondo, no presentación. Las excepciones son enlaces, no escrituras: el
 * teléfono abre llamada y WhatsApp, el correo abre el cliente de correo.
 *
 * **Persona natural: una sola ficha, no dos.** Cuando la "empresa" del negocio
 * es la persona natural espejo del contacto (184 de los 190 negocios con
 * empresa del workspace), no se pinta un bloque de empresa: sus datos con
 * contenido —documento, municipio— se muestran DENTRO del bloque del contacto,
 * porque para quien mira son datos de la persona. La fila de `empresas` sigue
 * existiendo igual en la base; solo deja de verse como una entidad aparte.
 * El criterio lo decide `esEmpresaEspejo` (dos condiciones, no una).
 *
 * `variant`:
 *  - `rail`: columna derecha pegada, desde `lg:`. Se pinta completo.
 *  - `movil`: por debajo de `lg` no cabe una segunda columna. Se pinta como
 *    tarjeta plegable con una línea de resumen SIEMPRE visible (nombre,
 *    teléfono y campaña) y el resto detrás de un toggle. Mobile-first es el
 *    default de este producto y no se rompe por una pantalla de escritorio.
 *    El NOMBRE en ese resumen no es opcional: desde que el header del negocio
 *    dejó de repetir contacto y empresa, este es el único sitio donde se ve sin
 *    desplegar nada en un celular.
 */

export type ContactoPanel = {
  id: string
  nombre: string
  telefono: string | null
  email: string | null
  rol: string | null
  segmento: string | null
}

export type EmpresaPanel = {
  id: string
  nombre: string
  tipo_persona: string | null
  contacto_id: string | null
  numero_documento: string | null
  tipo_documento: string | null
  municipio: string | null
  departamento: string | null
  telefono: string | null
  email_fiscal: string | null
}

interface Props {
  contacto: ContactoPanel | null
  empresa: EmpresaPanel | null
  campanas: ResumenCampanas | null
  variant: 'rail' | 'movil'
}

function labelRol(rol: string | null): string | null {
  if (!rol) return null
  return ROLES_CONTACTO.find(r => r.value === rol)?.label ?? rol.replace(/_/g, ' ')
}

/** Fila etiqueta/valor del panel. No se pinta si no hay valor. */
function Fila({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-right text-xs">{children}</dd>
    </div>
  )
}

function Cuerpo({ contacto, empresa, campanas }: Omit<Props, 'variant'>) {
  const espejo = esEmpresaEspejo(empresa, contacto?.id ?? null)
  const tel = telDesdeTelefono(contacto?.telefono)
  const wa = whatsappDesdeTelefono(contacto?.telefono)
  const status = resolverStatusContacto(contacto?.segmento)
  const rol = labelRol(contacto?.rol ?? null)

  // Datos fiscales que valen la pena mostrar dentro de la persona. Solo si hay
  // dato: medido en producción, 1 de 184 empresas tiene documento y 1 tiene
  // municipio, así que pintarlos siempre llenaría el panel de "Sin dato".
  const documento = espejo ? empresa?.numero_documento?.trim() || null : null
  const municipio = espejo
    ? [empresa?.municipio?.trim(), empresa?.departamento?.trim()].filter(Boolean).join(', ') || null
    : null

  return (
    <div className="space-y-3">
      {/* ── Contacto ── */}
      <section className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-bold uppercase">
            {contacto?.nombre?.charAt(0) ?? '?'}
          </span>
          <h3 className="text-xs font-semibold">Contacto</h3>
        </div>

        {contacto ? (
          <>
            <Link
              href={`/directorio/contacto/${contacto.id}`}
              className="block truncate text-sm font-semibold leading-tight hover:underline"
              title={contacto.nombre}
            >
              {contacto.nombre}
            </Link>

            {(rol || status.label) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {status.label && (
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${status.chipClass}`}>
                    {status.label}
                  </span>
                )}
                {rol && (
                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {rol}
                  </span>
                )}
              </div>
            )}

            <dl className="mt-2.5 space-y-1.5">
              {tel && (
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={`tel:${tel}`}
                    className="inline-flex min-w-0 items-center gap-1.5 text-xs tabular-nums hover:underline"
                  >
                    <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{contacto.telefono}</span>
                  </a>
                  {wa && (
                    <a
                      href={`https://wa.me/${wa}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-[10px] font-medium text-green-700 transition-colors hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300"
                      title="Abrir WhatsApp"
                    >
                      <MessageCircle className="h-3 w-3" />
                      WhatsApp
                    </a>
                  )}
                </div>
              )}

              {contacto.email && (
                <a
                  href={`mailto:${contacto.email}`}
                  className="flex min-w-0 items-center gap-1.5 text-xs hover:underline"
                  title={contacto.email}
                >
                  <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{contacto.email}</span>
                </a>
              )}

              {documento && (
                <Fila label={empresa?.tipo_documento?.trim() || 'Documento'}>
                  <span className="tabular-nums">{documento}</span>
                </Fila>
              )}

              {municipio && (
                <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{municipio}</span>
                </div>
              )}
            </dl>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Este negocio no tiene contacto.</p>
        )}
      </section>

      {/* ── Origen ── */}
      {campanas && (
        <section className="rounded-lg border border-dashed border-border p-3">
          <div className="mb-2 flex items-center gap-2">
            <Megaphone className="h-3.5 w-3.5 shrink-0 text-blue-600" />
            <h3 className="text-xs font-semibold">Origen</h3>
            <span className="text-[11px] text-muted-foreground">
              {campanas.formularios} formulario{campanas.formularios !== 1 ? 's' : ''}
            </span>
          </div>
          <dl className="space-y-1">
            <Fila label={campanas.hayVarias ? 'Primera' : 'Campaña'}>
              <span className="font-semibold">{campanas.primeraNombre}</span>
            </Fila>
            {campanas.primeraFecha && (
              <Fila label="Fecha">
                <span className="tabular-nums text-muted-foreground">
                  {formatBogotaFechaCortaAno(campanas.primeraFecha)}
                </span>
              </Fila>
            )}
            {campanas.hayVarias && campanas.ultimaNombre && (
              <Fila label="Última">
                <span className="text-muted-foreground">{campanas.ultimaNombre}</span>
              </Fila>
            )}
          </dl>
        </section>
      )}

      {/* ── Empresa ──
          Solo cuando NO es la persona natural espejo del contacto. */}
      {empresa && !espejo && (
        <section className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-purple-400" />
            <h3 className="text-xs font-semibold">Empresa</h3>
          </div>
          <Link
            href={`/directorio/empresa/${empresa.id}`}
            className="block truncate text-sm font-semibold leading-tight hover:underline"
            title={empresa.nombre}
          >
            {empresa.nombre}
          </Link>
          <dl className="mt-2 space-y-1">
            {empresa.numero_documento?.trim() && (
              <Fila label={empresa.tipo_documento?.trim() || 'NIT'}>
                <span className="tabular-nums">{empresa.numero_documento}</span>
              </Fila>
            )}
            {(empresa.municipio?.trim() || empresa.departamento?.trim()) && (
              <Fila label="Ciudad">
                {[empresa.municipio?.trim(), empresa.departamento?.trim()].filter(Boolean).join(', ')}
              </Fila>
            )}
            {/* Datos de la empresa, no de la persona: solo aparecen en el bloque
                de empresa real, y solo si el RUT los dejó. */}
            {empresa.telefono?.trim() && (
              <Fila label="Teléfono">
                <a href={`tel:${telDesdeTelefono(empresa.telefono) ?? empresa.telefono}`} className="tabular-nums hover:underline">
                  {empresa.telefono}
                </a>
              </Fila>
            )}
            {empresa.email_fiscal?.trim() && (
              <Fila label="Correo">
                <a href={`mailto:${empresa.email_fiscal}`} className="hover:underline">{empresa.email_fiscal}</a>
              </Fila>
            )}
          </dl>
        </section>
      )}
    </div>
  )
}

export default function PanelContacto({ contacto, empresa, campanas, variant }: Props) {
  const [abierto, setAbierto] = useState(false)

  if (variant === 'rail') {
    return <Cuerpo contacto={contacto} empresa={empresa} campanas={campanas} />
  }

  // ── Móvil: tarjeta plegable con resumen siempre visible ──
  const tel = telDesdeTelefono(contacto?.telefono)
  const wa = whatsappDesdeTelefono(contacto?.telefono)

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Línea de resumen: nombre arriba, teléfono debajo, los dos SIN abrir nada.
          El nombre va primero porque por debajo de `lg:` no hay rail y el header
          del negocio dejó de pintarlo: si aquí solo estuviera el teléfono —959 de
          los 982 contactos del workspace lo tienen el 2026-09-03, así que el
          nombre caía casi nunca—, en un celular el caso no diría de quién es hasta que alguien
          tocara el chevron. El teléfono conserva su `tel:` y sus tabular-nums, y
          no se pinta cuando no hay: una línea vacía no es información. */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-xs font-medium">
            {contacto?.nombre ?? 'Sin contacto'}
          </span>
          {tel && (
            <a href={`tel:${tel}`} className="inline-flex min-w-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground hover:underline">
              <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{contacto?.telefono}</span>
            </a>
          )}
          {campanas && (
            <span className="truncate text-[11px] text-muted-foreground">
              <Megaphone className="mr-1 inline h-3 w-3 align-[-1px] text-blue-600" />
              {campanas.primeraNombre}
            </span>
          )}
        </div>

        {wa && (
          <a
            href={`https://wa.me/${wa}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-[10px] font-medium text-green-700 transition-colors hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300"
            title="Abrir WhatsApp"
          >
            <MessageCircle className="h-3 w-3" />
            WhatsApp
          </a>
        )}

        <button
          type="button"
          onClick={() => setAbierto(v => !v)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent"
          aria-expanded={abierto}
        >
          <IdCard className="h-3.5 w-3.5" />
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${abierto ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {abierto && (
        <div className="border-t border-border p-3">
          <Cuerpo contacto={contacto} empresa={empresa} campanas={campanas} />
        </div>
      )}
    </div>
  )
}
