// ============================================================
// WhatsApp Media Download + Supabase Storage Upload
// ============================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const META_API_VERSION = 'v21.0';

/** Get temporary download URL from Meta API for a media ID */
export async function getMediaUrl(mediaId: string): Promise<string | null> {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  if (!token) {
    console.error('[wa-media] WHATSAPP_ACCESS_TOKEN not set');
    return null;
  }

  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[wa-media] Meta media GET failed: ${res.status} — ${errBody.slice(0, 200)}`);
    return null;
  }

  const data = await res.json();
  return data.url || null;
}

/** Download binary media from Meta temporary URL */
export async function downloadMediaBinary(
  url: string,
): Promise<{ buffer: Uint8Array; mimeType: string; rawMimeType: string; sizeKB: number } | null> {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  if (!token) return null;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[wa-media] Media download failed: ${res.status} — ${errBody.slice(0, 200)}`);
    return null;
  }

  const rawMimeType = res.headers.get('content-type') || 'image/jpeg';
  const mimeType = rawMimeType.split(';')[0].trim().toLowerCase();
  const buffer = new Uint8Array(await res.arrayBuffer());
  const sizeKB = Math.round(buffer.length / 1024);

  return { buffer, mimeType, rawMimeType, sizeKB };
}

/** Map MIME type to file extension */
function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  return map[mime] || 'jpg';
}

/**
 * Download image from WhatsApp and store in Supabase Storage.
 * Returns the public URL or null if any step fails.
 * Path: gastos-soportes/{workspace_id}/{gasto_id}.{ext}
 */
export async function downloadAndStoreImage(
  supabase: SupabaseClient,
  imageId: string,
  workspaceId: string,
  gastoId: string,
): Promise<string | null> {
  try {
    console.log(`[wa-media] Starting image download for media: ${imageId}`);

    // 1. Get download URL from Meta
    const mediaUrl = await getMediaUrl(imageId);
    if (!mediaUrl) return null;

    // 2. Download binary
    const media = await downloadMediaBinary(mediaUrl);
    if (!media) return null;

    // 3. Validate size (5MB limit)
    if (media.buffer.length > 5 * 1024 * 1024) {
      console.error(`[wa-media] Image too large: ${media.sizeKB}KB`);
      return null;
    }

    // 4. Upload to Supabase Storage
    const ext = mimeToExt(media.mimeType);
    const filePath = `${workspaceId}/${gastoId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('gastos-soportes')
      .upload(filePath, media.buffer, {
        contentType: media.mimeType,
        upsert: true,
      });

    if (uploadError) {
      console.error(`[wa-media] Storage upload failed:`, uploadError.message);
      return null;
    }

    // 5. Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('gastos-soportes')
      .getPublicUrl(filePath);

    console.log(`[wa-media] Stored: ${filePath} (${media.sizeKB}KB)`);
    return publicUrl;
  } catch (err) {
    console.error('[wa-media] Unhandled error:', err);
    return null;
  }
}
