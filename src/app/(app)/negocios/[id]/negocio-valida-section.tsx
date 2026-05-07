import Link from 'next/link';
import { ShieldCheck, ExternalLink } from 'lucide-react';
import type { ConsultaHistorialItem } from '@/lib/actions/valida-consultas';
import { HistorialTable } from '../../valida/valida-client';

export default function NegocioValidaSection({
  consultas,
  error,
}: {
  consultas: ConsultaHistorialItem[];
  error: string | null;
}) {
  return (
    <section className="mt-8 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[#10B981]" />
          <h2 className="text-base font-bold text-[#1A1A1A]">Consultas Valida</h2>
          <span className="text-xs text-[#6B7280]">({consultas.length})</span>
        </div>
        <Link
          href="/valida"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#10B981] hover:text-[#059669]"
        >
          Ir a Valida <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <HistorialTable consultas={consultas} error={error} />
    </section>
  );
}
