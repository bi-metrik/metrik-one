---
name: cerrar-bucket-cert-documentos
description: PR #742 mergeado (squash bfb6a10e) con la migracion que cierra el bucket publico cert-documentos — SIN aplicar a la base; y el detalle de que 20260630000001 nunca se aplico
metadata:
  type: project
---

**El bucket `cert-documentos` deja de ser publico y pierde su policy PUBLIC.** PR **#742**,
squash **bfb6a10e**, migracion `supabase/migrations/20260916010000_cerrar_bucket_cert_documentos.sql`
(dos sentencias idempotentes: `update storage.buckets set public = false` y
`drop policy if exists "Anyone can read cert documentos" on storage.objects`).

⚠️ **La migracion NO se aplico a la base.** La aplica y la registra en el ledger la sesion
principal. Mauricio dio el si explicito para produccion el 2026-09-16.

**Why:** el bucket nacio publico, tenia una policy sobre `storage.objects` con
`USING (bucket_id = 'cert-documentos'::text)` y **sin roles declarados** (o sea PUBLIC:
cualquiera, con sesion o sin ella). Medido antes de tocar nada: **0 objetos en el bucket,
0 filas en `cert_documentos`**, cero `getPublicUrl`/upload/download contra el en el repo.
Las certificaciones reales viven en el bucket **privado** `cert-databooks` con URL firmada,
asi que cerrarlo no le quita acceso a nada vivo.

⚠️ **Hallazgo lateral que importa: `20260630000001_security_advisors_ola1.sql` nunca se
aplico.** Ese archivo del PR #14 ya contenia el mismo `drop policy if exists "Anyone can
read cert documentos"` **y ademas** creaba la policy de reemplazo `"Users can read cert
documentos"` (SELECT `to authenticated`, acotada por carpeta = workspace del profile). Si
la policy PUBLIC seguia viva en produccion el 2026-09-16, el resto de esa migracion
tampoco esta aplicado. **How to apply:** antes de dar por cerrado cualquier hallazgo del
advisor de aquella tanda (Ola 1 / Ola 2, PRs #13–#15), comprobar contra `pg_policies` y
`pg_proc`, no contra el archivo del repo — el archivo existe en `main` desde junio y la
base decia otra cosa.

Familia de [[sql-prod-one]] y del gotcha de este repo sobre medir contra la funcion viva y
no contra el archivo de la migracion.
