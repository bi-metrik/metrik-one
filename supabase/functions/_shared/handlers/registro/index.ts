// ============================================================
// Handler: Registro — Router (W01, W02, W03, W04, W06, W32)
// Split into individual modules for maintainability
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { handleGastoDirecto } from './gasto-directo.ts';
import { handleGastoOperativo } from './gasto-operativo.ts';
import { handleHoras } from './horas.ts';
import { handleTimerIniciar, handleTimerParar, handleTimerEstado } from './timer.ts';
import { handleCobro } from './cobro.ts';
import { handleContactoNuevo } from './contacto.ts';
import { handleSaldoBancario } from './saldo.ts';
import { handleResumeRegistro } from './resume.ts';

export async function handleRegistro(ctx: HandlerContext): Promise<void> {
  const { parsed, session } = ctx;

  // If resuming a multi-step flow
  if (session.state !== 'started') {
    await handleResumeRegistro(ctx);
    return;
  }

  switch (parsed.intent) {
    case 'GASTO_DIRECTO': await handleGastoDirecto(ctx); break;
    case 'GASTO_OPERATIVO': await handleGastoOperativo(ctx); break;
    case 'HORAS': await handleHoras(ctx); break;
    case 'TIMER_INICIAR': await handleTimerIniciar(ctx); break;
    case 'TIMER_PARAR': await handleTimerParar(ctx); break;
    case 'TIMER_ESTADO': await handleTimerEstado(ctx); break;
    case 'COBRO': await handleCobro(ctx); break;
    case 'CONTACTO_NUEVO': await handleContactoNuevo(ctx); break;
    case 'SALDO_BANCARIO': await handleSaldoBancario(ctx); break;
  }
}
