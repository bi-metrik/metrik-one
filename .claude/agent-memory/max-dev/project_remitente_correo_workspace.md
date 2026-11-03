---
name: project-remitente-correo-workspace
description: Remitente propio por workspace (config_extra.remitente_correo, SOE-010) y cuentas de cobro desde metrik.com.co (26-oct); qué envíos lo respetan y qué falta para SOENA
metadata:
  type: project
---

Clave `workspaces.config_extra.remitente_correo = { nombre?, direccion }` (PR feat/remitentes-resend, 2026-10-26).
Lista blanca en `supabase/functions/_shared/remitente-correo.ts` (`DOMINIOS_PERMITIDOS`): metrikone.co + subdominios,
metrik.com.co solo raíz. Dominio fuera → console.error y sale el remitente de siempre.

Respetan la clave: notificar-etapa (aviso al cliente), correo-viajero.ts, autorización de datos (envío y copia).
Fuera a propósito: correos internos, MeTRIK propios (cuotas/enlace automático, Valida, actas), auth.

**Why:** Resend Pro (10 dominios); SOENA sin DNS en gruposoena.com → `soena.metrikone.co`. Requisito: sin clave, `from`
byte a byte igual; por eso el logo (`workspaces.logo_url`) en la cabecera de notificar-etapa solo sale CON la clave.

**How to apply:** orden para SOENA: verificar soena.metrikone.co en Resend (registros DNS + en el MISMO paso
`<slug>` CNAME al destino del ALIAS `*`, ver abajo) → desplegar notificar-etapa → escribir la
clave. Un dominio nuevo se agrega a la lista solo después de verificarlo en Resend. Otros FROM de facturacion@metrikone.co
(enlace-automatico, cobro-prueba Valida) NO se movieron a metrik.com.co.

⚠️⚠️ **Incidente 2026-10-26 (~13:00-15:30):** los registros de Resend bajo `soena.metrikone.co` (send/rsend/_domainkey)
convirtieron `soena` en nombre vacío y el comodín `*.metrikone.co` dejó de aplicarle: SOENA no resolvía ~2 h, sin un
solo error en Vercel/Supabase/logs. Arreglo: `soena` CNAME explícito al destino del ALIAS `*` (rec_6a3afcd9838afdf0940fe4b3).
Para todo workspace nuevo con remitente `<slug>.metrikone.co`: crear ese CNAME en el mismo paso (valor de
`vercel dns ls metrikone.co`, nunca de memoria) y comprobar con `dig +short`. `vercel dns add` lo corre Mauricio.
Gotcha en docs/gotchas.md.
