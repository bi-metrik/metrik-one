import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, History as HistoryIcon } from 'lucide-react';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { listarBitacoraSegmentacion } from '@/lib/actions/valida-segmentacion';
import { PRESET_LABEL, VARIABLE_CONTRAPARTE_LABEL, VARIABLE_EMPLEADO_LABEL } from '@/lib/valida/segmentacion-presets';
import type { EntradaBitacora } from '@/lib/valida/segmentacion-presets';

export const dynamic = 'force-dynamic';

export default async function BitacoraPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data: profile } = await svc
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single();

  if (!profile?.workspace_id) redirect('/onboarding');

  const { data: ws } = await svc
    .from('workspaces')
    .select('modules')
    .eq('id', profile.workspace_id)
    .single();

  const modules = (ws?.modules as Record<string, boolean>) ?? {};
  if (!modules.compliance) redirect('/');

  if (!['owner', 'admin', 'supervisor'].includes(profile.role)) {
    redirect('/');
  }

  const r = await listarBitacoraSegmentacion();
  const entradas = r.ok ? r.entradas : [];

  // Resolver nombres de profiles para los aplicada_por
  const userIds = Array.from(new Set(entradas.map(e => e.aplicada_por).filter(Boolean))) as string[];
  const nombres: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profs } = await svc
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds);
    for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null }>) {
      nombres[p.id] = p.full_name ?? 'Sin nombre';
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link
          href="/compliance/segmentacion"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B7280] hover:text-[#1A1A1A] mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver a segmentación
        </Link>
        <div className="flex items-center gap-3">
          <HistoryIcon className="h-6 w-6 text-[#10B981]" />
          <div>
            <h1 className="text-xl font-bold text-[#1A1A1A]">Bitácora de segmentación</h1>
            <p className="text-sm text-[#6B7280]">
              Historial de cambios a la metodología de segmentación SARLAFT del workspace.
            </p>
          </div>
        </div>
      </div>

      {!r.ok ? (
        <div className="p-6 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#B91C1C]">
          Error: {r.error}
        </div>
      ) : entradas.length === 0 ? (
        <div className="p-8 bg-white border border-[#E5E7EB] rounded-lg text-center text-sm text-[#6B7280]">
          Aún no hay versiones aplicadas. Cuando apliques la primera configuración aparecerá aquí.
        </div>
      ) : (
        <div className="space-y-3">
          {entradas.map(entrada => (
            <EntradaCard
              key={entrada.id}
              entrada={entrada}
              nombreUsuario={entrada.aplicada_por ? nombres[entrada.aplicada_por] ?? null : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EntradaCard({ entrada, nombreUsuario }: { entrada: EntradaBitacora; nombreUsuario: string | null }) {
  const fecha = new Date(entrada.aplicada_at).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <details className="bg-white border border-[#E5E7EB] rounded-lg overflow-hidden">
      <summary className="p-4 cursor-pointer hover:bg-[#F5F4F2] transition-colors flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="bg-[#1A1A1A] text-white text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">
            v{entrada.version}
          </span>
          <div>
            <p className="text-sm font-semibold text-[#1A1A1A]">{PRESET_LABEL[entrada.preset]}</p>
            <p className="text-xs text-[#6B7280]">{fecha} · {nombreUsuario ?? 'Usuario sin nombre'}</p>
          </div>
        </div>
        {entrada.razon_cambio && (
          <span className="text-xs text-[#6B7280] italic max-w-md truncate">
            «{entrada.razon_cambio}»
          </span>
        )}
      </summary>

      <div className="border-t border-[#E5E7EB] p-4 space-y-4 bg-[#F5F4F2]/50">
        <PesosTabla
          titulo="Contrapartes"
          pesos={entrada.pesos_contrapartes as Record<string, number>}
          labels={VARIABLE_CONTRAPARTE_LABEL}
        />
        <PesosTabla
          titulo="Empleados"
          pesos={entrada.pesos_empleados as Record<string, number>}
          labels={VARIABLE_EMPLEADO_LABEL}
        />
        <UmbralesTabla
          titulo="Umbrales contrapartes"
          umbrales={entrada.umbrales_contrapartes}
        />
        <UmbralesTabla
          titulo="Umbrales empleados"
          umbrales={entrada.umbrales_empleados}
        />
      </div>
    </details>
  );
}

function PesosTabla({
  titulo,
  pesos,
  labels,
}: {
  titulo: string;
  pesos: Record<string, number>;
  labels: Record<string, string>;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-2">{titulo}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        {Object.entries(pesos).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between bg-white border border-[#E5E7EB] rounded px-2 py-1.5">
            <span className="text-[#1A1A1A]">{labels[k] ?? k}</span>
            <span className="font-mono font-semibold">{Math.round((v as number) * 100)} %</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UmbralesTabla({
  titulo,
  umbrales,
}: {
  titulo: string;
  umbrales: { alto_min: number; medio_min: number; frec_alto_meses: number; frec_medio_meses: number; frec_bajo_meses: number };
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-2">{titulo}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <UmbralCell label="Alto si ≥" valor={umbrales.alto_min.toFixed(2)} extra={`cada ${umbrales.frec_alto_meses} meses`} color="text-[#EF4444]" />
        <UmbralCell label="Medio si ≥" valor={umbrales.medio_min.toFixed(2)} extra={`cada ${umbrales.frec_medio_meses} meses`} color="text-[#F59E0B]" />
        <UmbralCell label="Bajo" valor="<" extra={`cada ${umbrales.frec_bajo_meses} meses`} color="text-[#10B981]" />
      </div>
    </div>
  );
}

function UmbralCell({ label, valor, extra, color }: { label: string; valor: string; extra: string; color: string }) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded px-2 py-1.5">
      <p className={`text-[10px] font-bold uppercase tracking-wider ${color}`}>{label}</p>
      <p className="text-sm font-mono font-semibold">{valor}</p>
      <p className="text-[10px] text-[#6B7280]">{extra}</p>
    </div>
  );
}
