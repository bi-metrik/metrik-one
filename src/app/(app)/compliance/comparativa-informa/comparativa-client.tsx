'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  ListChecks,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  listarConsultasDuales,
  obtenerConsultaDual,
  obtenerMetricsDuales,
  registrarVeredicto,
  type DualClasificacion,
  type DualDecision,
  type DualDetail,
  type DualListItem,
  type DualListResponse,
  type DualMetrics,
} from '@/lib/actions/compliance-dual';

type TabKey = 'cronologico' | 'dashboard';

const CLASIFICACIONES: Array<{ value: DualClasificacion; label: string; color: string }> = [
  { value: 'zero_zero', label: 'Sin matches', color: 'bg-[#10B981]/10 text-[#065F46] border-[#10B981]/30' },
  { value: 'match_match', label: 'Ambos coinciden', color: 'bg-[#1A1A1A] text-white border-[#1A1A1A]' },
  { value: 'solo_informa', label: 'Solo Informa', color: 'bg-[#F59E0B]/10 text-[#92400E] border-[#F59E0B]/30' },
  { value: 'solo_valida', label: 'Solo Valida', color: 'bg-[#3B82F6]/10 text-[#1E40AF] border-[#3B82F6]/30' },
  { value: 'pendiente', label: 'Pendiente', color: 'bg-[#6B7280]/10 text-[#374151] border-[#6B7280]/30' },
];

const DECISIONES: Array<{ value: DualDecision; label: string; descripcion: string }> = [
  { value: 'valida_correcto', label: 'Valida correcto', descripcion: 'Coincide con Informa o ambos sin matches válidos' },
  { value: 'valida_falso_negativo', label: 'Valida falso negativo', descripcion: 'Informa marcó, Valida no — y debió marcar' },
  { value: 'valida_falso_positivo', label: 'Valida falso positivo', descripcion: 'Valida marcó, pero la persona no es la misma' },
  { value: 'informa_falso_negativo', label: 'Informa falso negativo', descripcion: 'Valida marcó correctamente, Informa no detectó' },
  { value: 'informa_falso_positivo', label: 'Informa falso positivo', descripcion: 'Informa marcó pero la persona no era' },
  { value: 'inconcluso', label: 'Inconcluso', descripcion: 'Sin información suficiente para decidir' },
];

export default function ComparativaClient() {
  const [tab, setTab] = useState<TabKey>('cronologico');

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-[#E5E7EB]">
        <TabButton active={tab === 'cronologico'} onClick={() => setTab('cronologico')} icon={<ListChecks className="h-4 w-4" />}>
          Cronológico
        </TabButton>
        <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')} icon={<BarChart3 className="h-4 w-4" />}>
          Dashboard
        </TabButton>
      </div>

      {tab === 'cronologico' && <CronologicoTab />}
      {tab === 'dashboard' && <DashboardTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
        active
          ? 'border-[#10B981] text-[#1A1A1A]'
          : 'border-transparent text-[#6B7280] hover:text-[#1A1A1A]'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Tab Cronologico ──────────────────────────────────────────────────────

function CronologicoTab() {
  const [data, setData] = useState<DualListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [clasificacionFilter, setClasificacionFilter] = useState<DualClasificacion[]>([]);
  const [workspaceFilter, setWorkspaceFilter] = useState('');
  const [auditadaFilter, setAuditadaFilter] = useState<'all' | 'true' | 'false'>('all');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function cargar(p = page) {
    setError(null);
    startTransition(async () => {
      const r = await listarConsultasDuales({
        page: p,
        pageSize,
        clasificacion: clasificacionFilter.length > 0 ? clasificacionFilter : undefined,
        workspace: workspaceFilter.trim() || undefined,
        desde: desde || undefined,
        hasta: hasta || undefined,
        auditada: auditadaFilter,
      });
      if (r.ok) setData(r.data);
      else setError(r.error);
    });
  }

  useEffect(() => {
    cargar(1);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clasificacionFilter, workspaceFilter, auditadaFilter, desde, hasta]);

  function toggleClasificacion(v: DualClasificacion) {
    setClasificacionFilter(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-[#6B7280]" />
          <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">
            Filtros
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {CLASIFICACIONES.map(c => {
            const active = clasificacionFilter.includes(c.value);
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => toggleClasificacion(c.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  active
                    ? c.color
                    : 'bg-white text-[#6B7280] border-[#E5E7EB] hover:border-[#10B981]'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="grid sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1">
              Workspace
            </label>
            <input
              type="text"
              value={workspaceFilter}
              onChange={e => setWorkspaceFilter(e.target.value)}
              placeholder="ej: alma-afi"
              className="w-full h-9 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#10B981] text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1">
              Desde
            </label>
            <input
              type="date"
              value={desde}
              onChange={e => setDesde(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#10B981] text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1">
              Hasta
            </label>
            <input
              type="date"
              value={hasta}
              onChange={e => setHasta(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#10B981] text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1">
              Auditada
            </label>
            <select
              value={auditadaFilter}
              onChange={e => setAuditadaFilter(e.target.value as 'all' | 'true' | 'false')}
              className="w-full h-9 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#10B981] text-sm bg-white"
            >
              <option value="all">Todas</option>
              <option value="true">Auditadas</option>
              <option value="false">Pendientes</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#B91C1C] text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        <div className="p-3 border-b border-[#E5E7EB] flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">
            {data ? `${data.total} consultas` : 'Cargando…'}
          </p>
          <button
            type="button"
            onClick={() => cargar(page)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold text-[#1A1A1A] hover:bg-[#F5F4F2] disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} />
            Refrescar
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F5F4F2] border-b border-[#E5E7EB]">
                <Th>Fecha</Th>
                <Th>Workspace</Th>
                <Th>Modo</Th>
                <Th>Identificación / Nombre</Th>
                <Th align="center">Informa</Th>
                <Th align="center">Valida</Th>
                <Th>Clasificación</Th>
                <Th align="center">Auditada</Th>
                <Th>Decisión</Th>
              </tr>
            </thead>
            <tbody>
              {!data || data.items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-[#6B7280]">
                    {pending ? 'Cargando…' : 'Sin consultas con los filtros actuales.'}
                  </td>
                </tr>
              ) : (
                data.items.map(item => (
                  <ConsultaRow key={item.dual_id} item={item} onSelect={() => setSelectedId(item.dual_id)} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.total > data.page_size && (
          <div className="p-3 border-t border-[#E5E7EB] flex items-center justify-between gap-2">
            <p className="text-xs text-[#6B7280]">
              Página {data.page} de {totalPages}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1 || pending}
                onClick={() => {
                  const np = page - 1;
                  setPage(np);
                  cargar(np);
                }}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-[#E5E7EB] hover:bg-[#F5F4F2] disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={page >= totalPages || pending}
                onClick={() => {
                  const np = page + 1;
                  setPage(np);
                  cargar(np);
                }}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-[#E5E7EB] hover:bg-[#F5F4F2] disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedId && (
        <DetalleModal
          dualId={selectedId}
          onClose={() => setSelectedId(null)}
          onAudited={() => {
            setSelectedId(null);
            cargar(page);
          }}
        />
      )}
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'center' | 'right' }) {
  return (
    <th
      className={`text-${align} px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280] whitespace-nowrap`}
    >
      {children}
    </th>
  );
}

function ConsultaRow({
  item,
  onSelect,
}: {
  item: DualListItem;
  onSelect: () => void;
}) {
  const clasifConfig = CLASIFICACIONES.find(c => c.value === item.clasificacion);
  const decisionLabel = item.decision
    ? DECISIONES.find(d => d.value === item.decision)?.label ?? item.decision
    : null;

  return (
    <tr
      onClick={onSelect}
      className="border-b border-[#E5E7EB] last:border-0 hover:bg-[#F5F4F2]/60 cursor-pointer"
    >
      <td className="px-4 py-2.5 text-[#6B7280] whitespace-nowrap text-xs">
        {new Date(item.fecha).toLocaleDateString('es-CO', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </td>
      <td className="px-4 py-2.5 text-[#1A1A1A] font-medium text-xs">{item.workspace_origen}</td>
      <td className="px-4 py-2.5 text-[#6B7280] text-xs">{item.modo}</td>
      <td className="px-4 py-2.5 text-[#1A1A1A] text-sm max-w-[220px] truncate">
        {item.identificacion || item.nombre || '—'}
      </td>
      <td className="px-4 py-2.5 text-center font-semibold">{item.count_informa}</td>
      <td className="px-4 py-2.5 text-center font-semibold">{item.count_valida}</td>
      <td className="px-4 py-2.5">
        {clasifConfig && (
          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${clasifConfig.color}`}>
            {clasifConfig.label}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-center">
        {item.auditada ? (
          <Check className="inline h-4 w-4 text-[#10B981]" />
        ) : (
          <Clock className="inline h-4 w-4 text-[#6B7280]" />
        )}
      </td>
      <td className="px-4 py-2.5 text-[#6B7280] text-xs max-w-[180px] truncate">
        {decisionLabel ?? '—'}
      </td>
    </tr>
  );
}

// ─── Detalle modal ────────────────────────────────────────────────────────

function DetalleModal({
  dualId,
  onClose,
  onAudited,
}: {
  dualId: string;
  onClose: () => void;
  onAudited: () => void;
}) {
  const [detail, setDetail] = useState<DualDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const r = await obtenerConsultaDual(dualId);
      if (r.ok) setDetail(r.data);
      else setError(r.error);
    });
  }, [dualId]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-lg border border-[#E5E7EB] max-w-5xl w-full my-8 shadow-xl">
        <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">
              Detalle de consulta dual
            </p>
            <h2 className="text-lg font-bold text-[#1A1A1A] mt-0.5 font-mono">{dualId}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-[#F5F4F2] text-[#6B7280]"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {pending && !detail && (
          <div className="p-12 text-center text-sm text-[#6B7280]">Cargando…</div>
        )}

        {error && (
          <div className="m-5 p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#B91C1C] text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        {detail && <DetalleContent detail={detail} onAudited={onAudited} />}
      </div>
    </div>
  );
}

function DetalleContent({
  detail,
  onAudited,
}: {
  detail: DualDetail;
  onAudited: () => void;
}) {
  const informaCount = detail.informa.matches.length;
  const validaCount = detail.valida.matches.length;
  const divergencia = (informaCount > 0) !== (validaCount > 0);

  return (
    <div className="p-5 space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Stat label="Workspace" value={detail.workspace_origen} />
        <Stat label="Modo" value={detail.modo} />
        <Stat label="Tipo" value={detail.tipo} />
        <Stat label="Auditada" value={detail.auditada ? 'Sí' : 'No'} />
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-1">
          Consultado
        </p>
        <p className="text-base font-bold text-[#1A1A1A]">
          {detail.identificacion || detail.nombre || '—'}
        </p>
        <p className="text-xs text-[#6B7280] mt-0.5">
          {new Date(detail.fecha).toLocaleString('es-CO')}
        </p>
      </div>

      {divergencia && (
        <div className="p-3 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#92400E] text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            <strong>Divergencia detectada:</strong> Informa retornó {informaCount} matches y Valida {validaCount}.
            Revisa cuidadosamente antes de registrar veredicto.
          </span>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <PanelMatches
          titulo="Informa"
          subtitulo="Competencia (300+ listas)"
          color="#1A1A1A"
          count={informaCount}
        >
          {detail.informa.matches.length === 0 ? (
            <EmptyMatches />
          ) : (
            <ul className="space-y-2">
              {detail.informa.matches.map((m, i) => (
                <li key={i} className="p-3 rounded-md bg-[#F5F4F2] border border-[#E5E7EB]">
                  <p className="text-xs text-[#6B7280] font-semibold uppercase">{m.lista}</p>
                  <p className="text-sm text-[#1A1A1A] font-medium mt-0.5">{m.nombre}</p>
                  <p className="text-xs text-[#6B7280] font-mono mt-0.5">{m.documento ?? '—'}</p>
                  {m.fundamento && (
                    <p className="text-xs text-[#6B7280] mt-1 leading-relaxed">{m.fundamento}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </PanelMatches>

        <PanelMatches
          titulo="Valida"
          subtitulo="Motor MéTRIK"
          color="#10B981"
          count={validaCount}
        >
          {detail.valida.matches.length === 0 ? (
            <EmptyMatches />
          ) : (
            <ul className="space-y-2">
              {detail.valida.matches.map((m, i) => (
                <li key={i} className="p-3 rounded-md bg-[#10B981]/5 border border-[#10B981]/20">
                  <p className="text-xs text-[#065F46] font-semibold uppercase">{m.lista_slug}</p>
                  <p className="text-sm text-[#1A1A1A] font-medium mt-0.5">{m.nombre_principal}</p>
                  <p className="text-xs text-[#065F46] mt-0.5 font-bold">
                    Score: {(m.score_final * 100).toFixed(1)}%
                  </p>
                </li>
              ))}
            </ul>
          )}
        </PanelMatches>
      </div>

      <AuditForm detail={detail} onAudited={onAudited} />
    </div>
  );
}

function PanelMatches({
  titulo,
  subtitulo,
  color,
  count,
  children,
}: {
  titulo: string;
  subtitulo: string;
  color: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
      <div className="p-3 border-b border-[#E5E7EB] flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold" style={{ color }}>{titulo}</p>
          <p className="text-[10px] text-[#6B7280] uppercase tracking-wider">{subtitulo}</p>
        </div>
        <span
          className="inline-flex items-center justify-center h-7 min-w-[28px] px-2 rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {count}
        </span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function EmptyMatches() {
  return (
    <div className="py-6 text-center">
      <Check className="inline-block h-5 w-5 text-[#10B981] mb-1" />
      <p className="text-xs text-[#6B7280]">Sin coincidencias</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-[#F5F4F2] border border-[#E5E7EB]">
      <p className="text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold">{label}</p>
      <p className="text-sm font-bold text-[#1A1A1A] mt-0.5">{value}</p>
    </div>
  );
}

// ─── Audit Form ───────────────────────────────────────────────────────────

function AuditForm({
  detail,
  onAudited,
}: {
  detail: DualDetail;
  onAudited: () => void;
}) {
  const [decision, setDecision] = useState<DualDecision | ''>(detail.decision ?? '');
  const [notas, setNotas] = useState(detail.notas ?? '');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!decision) {
      setError('Selecciona una decisión');
      return;
    }
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const r = await registrarVeredicto({
        dualId: detail.dual_id,
        decision,
        notas: notas.trim() || undefined,
      });
      if (r.ok) {
        setInfo('Veredicto registrado.');
        setTimeout(() => onAudited(), 600);
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="bg-[#F5F4F2] rounded-lg border border-[#E5E7EB] p-4 space-y-3">
      <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">
        Registrar veredicto auditor
      </p>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1">
          Decisión
        </label>
        <select
          value={decision}
          onChange={e => setDecision(e.target.value as DualDecision | '')}
          className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#10B981] text-sm bg-white"
        >
          <option value="">— Selecciona —</option>
          {DECISIONES.map(d => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        {decision && (
          <p className="text-[11px] text-[#6B7280] mt-1">
            {DECISIONES.find(d => d.value === decision)?.descripcion}
          </p>
        )}
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1">
          Notas (opcional)
        </label>
        <textarea
          value={notas}
          onChange={e => setNotas(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#10B981] text-sm bg-white"
          placeholder="Observaciones del auditor…"
        />
      </div>

      <button
        type="submit"
        disabled={pending || !decision}
        className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#10B981] text-white text-sm font-semibold hover:bg-[#059669] disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
      >
        <Check className="h-4 w-4" />
        {pending ? 'Guardando…' : 'Registrar veredicto'}
      </button>

      {error && (
        <div className="p-2.5 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#B91C1C] text-xs flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </div>
      )}
      {info && (
        <div className="p-2.5 rounded-lg bg-[#10B981]/10 border border-[#10B981]/30 text-[#065F46] text-xs flex items-center gap-2">
          <Check className="h-3.5 w-3.5" /> {info}
        </div>
      )}
    </form>
  );
}

// ─── Tab Dashboard ────────────────────────────────────────────────────────

function DashboardTab() {
  const [metrics, setMetrics] = useState<DualMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function cargar() {
    setError(null);
    startTransition(async () => {
      const r = await obtenerMetricsDuales();
      if (r.ok) setMetrics(r.data);
      else setError(r.error);
    });
  }

  useEffect(() => {
    cargar();

  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-[#6B7280]">
          Métricas agregadas — alimentan los umbrales de validación de Vera.
        </p>
        <button
          type="button"
          onClick={cargar}
          disabled={pending}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-[#E5E7EB] text-xs font-semibold text-[#1A1A1A] hover:bg-[#F5F4F2] disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} />
          Refrescar
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#B91C1C] text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {!metrics && !error && (
        <div className="p-12 text-center text-sm text-[#6B7280]">Cargando métricas…</div>
      )}

      {metrics && <DashboardContent metrics={metrics} />}
    </div>
  );
}

function DashboardContent({ metrics }: { metrics: DualMetrics }) {
  const cumple = metrics.cumple_umbral_vera;
  const formatPct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);
  const veredictosArray = useMemo(
    () =>
      DECISIONES.map(d => ({
        decision: d,
        count: metrics.veredictos[d.value] ?? 0,
      })),
    [metrics.veredictos]
  );

  return (
    <div className="space-y-5">
      <div
        className={`p-4 rounded-lg border-2 flex items-center gap-3 ${
          cumple
            ? 'bg-[#10B981]/10 border-[#10B981] text-[#065F46]'
            : 'bg-[#EF4444]/10 border-[#EF4444] text-[#B91C1C]'
        }`}
      >
        {cumple ? (
          <Check className="h-6 w-6 shrink-0" />
        ) : (
          <AlertTriangle className="h-6 w-6 shrink-0" />
        )}
        <div>
          <p className="text-base font-bold">
            Valida confiable: {cumple ? 'SÍ' : 'NO'}
          </p>
          <p className="text-xs mt-0.5">
            Umbral Vera agregado: ≥100 positivos auditados, recall global ≥95% y precision ≥95%.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Total consultas" value={metrics.total_consultas.toString()} />
        <KpiCard label="% sin matches" value={`${(metrics.pct_zero_zero * 100).toFixed(1)}%`} />
        <KpiCard label="% divergencia" value={`${(metrics.pct_divergencia * 100).toFixed(1)}%`} />
        <KpiCard label="Pendientes auditoría" value={metrics.pendientes_auditoria.toString()} />
        <KpiCard label="Recall" value={formatPct(metrics.recall)} accent />
        <KpiCard label="Precision" value={formatPct(metrics.precision)} accent />
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        <div className="p-3 border-b border-[#E5E7EB]">
          <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">
            Veredictos por categoría
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F5F4F2] border-b border-[#E5E7EB]">
                <Th>Categoría</Th>
                <Th>Descripción</Th>
                <Th align="center">Total</Th>
              </tr>
            </thead>
            <tbody>
              {veredictosArray.map(v => (
                <tr key={v.decision.value} className="border-b border-[#E5E7EB] last:border-0">
                  <td className="px-4 py-2.5 text-[#1A1A1A] font-semibold text-sm">
                    {v.decision.label}
                  </td>
                  <td className="px-4 py-2.5 text-[#6B7280] text-xs leading-relaxed">
                    {v.decision.descripcion}
                  </td>
                  <td className="px-4 py-2.5 text-center font-bold text-[#1A1A1A]">{v.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        <div className="p-3 border-b border-[#E5E7EB]">
          <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">
            Por lista — umbral Vera ≥30 positivos auditados, recall ≥95% y precision ≥95%
          </p>
        </div>
        {metrics.por_lista.length === 0 ? (
          <p className="p-6 text-center text-sm text-[#6B7280]">Sin datos por lista.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F5F4F2] border-b border-[#E5E7EB]">
                  <Th>Lista</Th>
                  <Th align="center">Positivos auditados</Th>
                  <Th align="center">Recall</Th>
                  <Th align="center">Precision</Th>
                  <Th align="center">Cumple</Th>
                </tr>
              </thead>
              <tbody>
                {metrics.por_lista.map(l => (
                  <tr key={l.lista} className="border-b border-[#E5E7EB] last:border-0">
                    <td className="px-4 py-2.5 text-[#1A1A1A] font-semibold text-sm">{l.lista}</td>
                    <td className="px-4 py-2.5 text-center text-[#1A1A1A]">{l.positivos_auditados}</td>
                    <td className="px-4 py-2.5 text-center text-[#1A1A1A]">{formatPct(l.recall)}</td>
                    <td className="px-4 py-2.5 text-center text-[#1A1A1A]">{formatPct(l.precision)}</td>
                    <td className="px-4 py-2.5 text-center">
                      {l.cumple_umbral ? (
                        <Check className="inline h-4 w-4 text-[#10B981]" />
                      ) : (
                        <X className="inline h-4 w-4 text-[#EF4444]" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[#E5E7EB] bg-[#F5F4F2] p-4">
        <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
          Cómo se calcula
        </p>
        <ul className="text-xs text-[#374151] space-y-1.5 leading-relaxed list-disc list-inside">
          <li>
            <strong>Recall</strong> = positivos verdaderos / (positivos verdaderos + falsos negativos
            de Valida).
          </li>
          <li>
            <strong>Precision</strong> = positivos verdaderos / (positivos verdaderos + falsos positivos
            de Valida).
          </li>
          <li>
            <strong>Umbral por lista:</strong> ≥30 positivos auditados, recall y precision ≥95%.
          </li>
          <li>
            <strong>Umbral agregado:</strong> ≥100 positivos auditados, recall global y precision ≥95%.
            Define si Valida está lista para sustituir Informa.
          </li>
        </ul>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`p-3 rounded-lg border ${
        accent ? 'bg-[#10B981]/5 border-[#10B981]/30' : 'bg-white border-[#E5E7EB]'
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold">
        {label}
      </p>
      <p className={`text-xl font-bold mt-1 ${accent ? 'text-[#10B981]' : 'text-[#1A1A1A]'}`}>
        {value}
      </p>
    </div>
  );
}
