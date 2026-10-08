---
name: autorizacion-datos-link
description: Autorización de datos del cliente final por link (Trappvel, 2026-10-08) — migración 20261008230000 APLICADA en producción (8-oct, por la sesión principal); texto de Emilio sin aprobar; vigencia en una RPC; marcas manuales no cuentan
metadata:
  type: project
---

Link por CONTACTO en `/autorizacion/<token>`; 4 casillas por separado; evidencia en
`autorizacion_datos_enlaces`; texto versionado e inmutable en `autorizacion_datos_textos`.

- La regla de vigencia vive UNA vez en la RPC `autorizacion_datos_estado` (la usan gate, bloque y bot).
  Solo una versión MAYOR posterior vuelve a pedirla. Las marcas del botón viejo
  (`custom_data.autorizacion_datos`) se ven «sin evidencia» y NO cuentan (Emilio, pieza 4.4).
- El Encargado sale de `variables.encargado` de la versión. En Trappvel es la PERSONA NATURAL del Anexo F, no
  la SAS: no reusar `ENCARGADO` de `compliance/vinculacion-publica.ts`.
- Sin texto publicado se muestra un marcador que no se puede firmar; `⟦…⟧` o marcadores vacíos (también en el
  detalle) bloquean «Autorizo». Es a propósito: el borrador de Emilio todavía trae `⟦CORREO DE DATOS⟧`.
- Correo al crear: Next lo manda por Resend; el bot llama `/api/autorizacion-datos/al-crear` (sin sesión, solo
  negocios de <15 min). El reclamo es un UPDATE condicionado sobre `correo_enviado_at`.
- La vía con evidencia (`registro_con_evidencia`, apagada) inserta un enlace YA aceptado con `via = 'evidencia'`;
  `aceptado_at` es la fecha del cliente, no la del registro.
- Pendiente al 2026-10-08: acompañantes adultos con link propio (no cerrar el diseño: un enlace es por contacto).

**Why:** Mauricio pidió prueba del titular, no el clic de la comercial; Emilio exige versión + sha256 + casillas.

**How to apply:** antes de encender el gate en Trappvel: migración aplicada, texto aprobado por Edgar y cargado
con `scripts/autorizacion-datos-texto-sql.mjs`, luego `config_extra.gates` de Solicitud. Ver
[[project_bandeja_hibrida]] para el bot.
