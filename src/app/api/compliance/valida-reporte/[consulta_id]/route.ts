import { NextRequest } from 'next/server';

const VALIDA_API_BASE = process.env.VALIDA_API_BASE ?? 'https://api.valida.metrikone.co';

// Proxy server-side al endpoint de PDF de Valida. Usa la api_key server-only
// para que el cliente nunca la vea.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ consulta_id: string }> },
) {
  const { consulta_id } = await params;
  const apiKey = process.env.VALIDA_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'valida_api_key_missing' }, { status: 500 });
  }

  const upstream = await fetch(`${VALIDA_API_BASE}/api/v1/reporte/${consulta_id}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!upstream.ok) {
    return Response.json({ error: 'upstream_error', status: upstream.status }, { status: upstream.status });
  }

  const buffer = await upstream.arrayBuffer();
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="valida-reporte-${consulta_id.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
