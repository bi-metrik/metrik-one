import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { todayBogotaISO } from '@/lib/dates/bogota';
import { ejecutarBarrido } from '@/lib/compliance/barrido';

// R3 — barrido diario de monitoreo recurrente.
//
// Barre SOLO los workspaces que adoptaron el motor (tienen fila en
// `compliance_monitoreo_config`). Sin fila no se toca nada: entrar al motor es
// un acto del oficial, no una consecuencia de haber usado el modulo alguna vez.
//
// Los que adoptaron pero no fijaron tope corren en simulacion: seleccionan,
// cuentan y dejan su fila sin llamar a la fuente. Asi la decision pendiente
// —cuanto puede gastar el motor— queda visible en pantalla en vez de resolverse
// sola contra la cuenta del cliente.

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronHeader = req.headers.get('x-vercel-cron');

  if (!cronHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: configs, error } = await supabase
    .from('compliance_monitoreo_config')
    .select('workspace_id');

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const hoy = todayBogotaISO();
  const resumenes: unknown[] = [];

  for (const c of (configs ?? []) as { workspace_id: string }[]) {
    try {
      resumenes.push(await ejecutarBarrido(c.workspace_id, hoy));
    } catch (err) {
      // Un workspace que falla no puede tumbar el barrido de los demas: cada
      // uno tiene su cuenta, su tope y su evidencia.
      resumenes.push({
        workspace_id: c.workspace_id,
        error: err instanceof Error ? err.message : 'barrido_fallo',
      });
    }
  }

  return NextResponse.json({ ok: true, dia: hoy, workspaces: resumenes.length, resumenes });
}
