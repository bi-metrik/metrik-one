'use client'

import { ShieldCheck, ExternalLink } from 'lucide-react'

const LISTAS_CAUTELARES = [
  {
    nombre: 'OFAC (SDN List)',
    descripcion: 'Lista de Nacionales Especialmente Designados del Tesoro de EE.UU.',
    url: 'https://sanctionssearch.ofac.treas.gov/',
    obligatoria: true,
  },
  {
    nombre: 'ONU — Consejo de Seguridad',
    descripcion: 'Listas consolidadas de sanciones del Consejo de Seguridad de la ONU',
    url: 'https://www.un.org/securitycouncil/sanctions/consolidated-list',
    obligatoria: true,
  },
  {
    nombre: 'Union Europea',
    descripcion: 'Lista consolidada de sanciones de la UE',
    url: 'https://www.sanctionsmap.eu/',
    obligatoria: false,
  },
  {
    nombre: 'PEPs Colombia',
    descripcion: 'Personas Expuestas Politicamente — Procuraduria General de la Nacion',
    url: 'https://www.procuraduria.gov.co/',
    obligatoria: true,
  },
  {
    nombre: 'Lista Clinton (OFAC)',
    descripcion: 'Lista de personas y empresas vinculadas al narcotrafico',
    url: 'https://sanctionssearch.ofac.treas.gov/',
    obligatoria: true,
  },
]

interface ReglasValidacionSectionProps {
  workspaceId?: string
}

export default function ReglasValidacionSection({ workspaceId }: ReglasValidacionSectionProps) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          Define las listas cautelares contra las cuales se validaran los interesados del directorio.
          Estas reglas aplican a todos los riesgos del workspace.
        </p>
      </div>

      {/* Listas cautelares */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Listas cautelares activas
        </h4>
        <div className="space-y-1.5">
          {LISTAS_CAUTELARES.map((lista) => (
            <div
              key={lista.nombre}
              className="flex items-center justify-between rounded-lg border px-3 py-2.5"
            >
              <div className="flex items-center gap-3 min-w-0">
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{lista.nombre}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{lista.descripcion}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {lista.obligatoria && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                    Obligatoria
                  </span>
                )}
                <a
                  href={lista.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Ver lista"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reglas de validación */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Reglas de validacion
        </h4>
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">
            Las reglas de validacion automatica se configuraran en una fase posterior.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Incluira: periodicidad de revision, umbrales de coincidencia, escalacion automatica y notificaciones.
          </p>
        </div>
      </div>
    </div>
  )
}
