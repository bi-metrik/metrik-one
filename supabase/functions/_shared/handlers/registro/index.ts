// ============================================================
// Handler: Registro — Router (MVP: GASTO + CONTACTO_NUEVO)
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { handleGasto } from './gasto.ts';
import { handleContactoNuevo } from './contacto.ts';
import { handleResumeRegistro } from './resume.ts';

export async function handleRegistro(ctx: HandlerContext): Promise<void> {
  const { parsed, session } = ctx;

  // Resume multi-step flow
  if (session.state !== 'started') {
    await handleResumeRegistro(ctx);
    return;
  }

  switch (parsed.intent) {
    case 'GASTO': await handleGasto(ctx); break;
    case 'CONTACTO_NUEVO': await handleContactoNuevo(ctx); break;
  }
}
