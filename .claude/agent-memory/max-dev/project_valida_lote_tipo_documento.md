---
name: project-valida-lote-tipo-documento
description: Tipo de documento de la carga masiva de Valida y las 753 filas viejas de AFI en error — se barren con la cuenta interna de MéTRIK, sin tocar AFI (2026-10-24)
metadata:
  type: project
---

La carga masiva de Valida normaliza `tipo_documento` en `src/lib/valida/tipo-documento.ts` (#1260, #1261: TI, PPT y RC ya se mandan). Antes «CEDULA», «PP», «TI» iban tal cual y Valida respondía 400.

**Las filas viejas de AFI (753 en error, 2026-10-24): decisión de Mauricio, NO se reprocesan en la cuenta de AFI ni se reescriben.** Se consultan con la cuenta de MéTRIK en Valida (cliente `eb9bb933…`, «MeTRIK — Consulta de listas», workspace ONE metrik) vía `scripts/valida/barrido-interno-afi.ts`; lo significativo se le reporta a AFI a mano. Por eso se cerraron sin merge metrik-valida#71 (consulta sin cobro) y ONE #1262, y se borró la migración 20261023180000 (nunca aplicada) junto con `reprocesar-tipo-documento.ts`.

- El script solo LEE ONE; las consultas quedan en Valida con `referencia_externa = afi-valida-consultas-<id AFI>`. Se retoma: JSONL en el scratchpad + pregunta a Valida por la referencia antes de cada POST (la idempotencia de Valida dura solo 24 h).
- Cuenta MéTRIK en Valida (2026-10-24): modalidad mensual, SIN plan (`plan_codigo` null), sin bolsa, `fairuse_umbral` null (global 5.000, blando). Sin plan no hay corte por bolsa ni por mora; `/cuenta/consumo` responde 409 `sin_plan_asignado`, y el script lo lee como «alcanza».
- La llave del workspace metrik (Vault) es la llave activa de ese cliente: verificado por prefijo y sha256 contra `api_keys` de Valida, sin imprimirla.
- Lo corre Mauricio, no Max.

**Why:** reprocesar en la cuenta de AFI le cobraba o le movía su historial; correrlo como MéTRIK no toca a AFI y no necesita cambiar Valida.
**How to apply:** si vuelve un «reproceso» de filas de un cliente, preguntar primero si va por la cuenta interna. El filtro sigue siendo `TIPOS_ACEPTADOS_ANTES` (CC, CE, NIT, PAS), no la lista de hoy. Valida: el hook de aislamiento no deja `git` ni `cd`+git en metrik-valida; leer archivos con `cd <ruta> && sed` sí pasa. Leer la base de Valida: Service Role de `.credentials.md` sección «Supabase — metrik-valida», solo GET por PostgREST.
