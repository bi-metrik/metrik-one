---
name: valida-portal-autoservicio
description: Portal de llaves API de metrik-valida (PR #42) — lleva la Politica de Tratamiento v1.4 y una 0033 CAMBIADA (huella del correo sin acceso, version de la politica en el ingreso), sin aplicar; vigencia fija 15-sep en cinco sitios; codigo de Auth de 8 digitos
metadata:
  type: project
---

**⚠️ CADUCO lo de "sin mergear / sin aplicar" (2026-09-15 noche):** #42 esta en `origin/main` como
`725a5f9` (visto en el clon); 0033 aplicada segun `proyectos/4d-soft/valida/CONTEXT.md` (no lo medi en la
base). La v2 esta especificada en [[valida-portal-v2-spec]].

**Estado al 2026-09-15 (tarde):** PR **bi-metrik/metrik-valida#42** (`feat/portal-api-autoservicio`,
punta `da75333`) `MERGEABLE`/`CLEAN`, checks verdes (`Tipos y pruebas` + Vercel). **Sin mergear** y
`db/migrations/0033_portal_clientes_llaves.sql` **sin aplicar**. Lleva dentro la Politica de
Tratamiento de Datos Personales **v1.4** (propuesta de Emilio aprobada por Mauricio el 15-sep).

**Why:** en Valida `main` despliega a produccion en el acto, y la v1.4 no puede publicarse sin el
aviso del portal ni el portal sin la v1.4 (regla «documento publicado no describe lo que no existe»).

**How to apply:**
- Orden: 0033 ANTES del merge (lectura previa de `pg_get_functiondef` descrita en el PR).
- ⚠️ **0033 cambio con la v1.4:** `portal_eventos.email_huella` + trigger BEFORE INSERT
  `portal_eventos_minimizar` (actor `anonimo` → correo nulo, con CHECK), `portal_huella_correo(text)`,
  `portal_estado_codigo` busca por huella, `portal_registrar_ingreso(..., p_politica_version)`.
  Quien diga "0033 no cambio" habla de antes del 15-sep por la tarde.
- ⚠️ **Vigencia de la v1.4 fija en el codigo: 15 de septiembre de 2026, en CINCO sitios** (hero y
  nota de la pagina; portada, pie y nota del PDF). Si el deploy sale otro dia, se cambian los cinco;
  `lib/docs/privacidad-publicada.test.ts` exige que coincidan. La version vive ademas en
  `lib/recursos/politica-privacidad.ts` (aviso del portal + bitacora); la pagina y el PDF la
  escriben LITERAL a proposito (el guardrail de pares lee texto).
- ⚠️ La 12.1 publica plazos de WhatsApp (90 dias texto del bot, 12 meses acuses, 7 dias sesiones,
  vigencia+10 anios aceptaciones) que **ningun proceso de ONE ejecuta hoy**: no hay purga en
  `wa_envios`/`wa_message_log`.
- `portal_eventos` SI tiene salida (punta `da75333`): `portal_suprimir_eventos_vencidos(ejecutado_por,
  limite)`, SECURITY DEFINER solo service_role; el trigger inmutable deja pasar DELETE solo con la
  marca local `valida.supresion_portal_eventos=on` Y evento con `portal_eventos_retencion()` (10 anios)
  cumplido. **Sin cron a proposito** (nada vence antes de 2036) y sin nocion de retencion por orden
  de autoridad. Encabezado de la 12.1: «Plazo de conservacion» (mezcla minimos y maximos).
- §1 de la politica sigue «MeTRIK SAS, NIT en proceso»: la propuesta dejo METRIK IA S.A.S. fuera de
  #42 (hallazgo H10 de Emilio, cambio de Responsable = cambio sustancial).
- El PDF de privacidad tenia el recuadro de rol recortando el texto (`numText` con `flex: 1` dentro
  de una columna) desde la v1.3; solo se vio rasterizando. Arreglado con `rolText`.
- El Auth de Valida genera codigos de **8** digitos (configurable 6-10, `lib/portal/formato-codigo.ts`).
- Diccionario publico en **v1.4** (la v1.3 la publico #43).
- Registro abierto en Auth (`disable_signup=false`) lo cierra el coordinador aparte: confirmar antes
  de invitar a nadie. Falta E2E en navegador contra Auth real. Relacionado: [[valida-bolsa-prepagada]],
  [[valida-privacidad-v13]], [[mirar-pdf-renderizado]].
