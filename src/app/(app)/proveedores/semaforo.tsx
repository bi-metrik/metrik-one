import { NOMBRE_SEMAFORO, type Semaforo } from '@/lib/proveedores/vigencia'

const CLASE: Record<Semaforo, string> = {
  vigente: 'border-[#10B981]/40 bg-[#10B981]/10 text-[#047857]',
  por_vencer: 'border-[#D97706]/40 bg-[#D97706]/10 text-[#9A5F0C]',
  vencido: 'border-[#DC2626]/40 bg-[#DC2626]/10 text-[#B42318]',
  sin_fechas: 'border-[#CFCAC0] bg-[#F1EEE7] text-[#6E6A62]',
  sin_tarifario: 'border-[#CFCAC0] bg-white text-[#6E6A62]',
}

/** El estado del tarifario como pastilla: vigente / por vencer / vencido / sin fechas / sin tarifario. */
export function PastillaSemaforo({ semaforo }: { semaforo: Semaforo }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${CLASE[semaforo]}`} data-semaforo={semaforo}>
      {NOMBRE_SEMAFORO[semaforo]}
    </span>
  )
}
