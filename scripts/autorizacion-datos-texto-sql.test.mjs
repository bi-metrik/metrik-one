import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PGlite } from '@electric-sql/pglite'
import { parsear } from './autorizacion-datos-texto-sql.mjs'

// Un documento con la MISMA forma que el de Emilio (piezas 1, 1b y 3), con texto inventado.
const DOC = `---
x: y
---

# Cómo leer

nada

# Pieza 1. Texto de la página

Nota para Max.

> ## Autorización para el uso de sus datos
>
> Hola, [NOMBRE_CLIENTE]. [AGENCIA] necesita su autorización.
>
> **Para qué.**
> - Atender su solicitud.
> - Reservar el viaje.
>
> ☐ **Casilla 1 (obligatoria):** Soy [NOMBRE_CLIENTE] y autorizo a [AGENCIA].
>
> ☐ **Casilla 2 (opcional):** Autorizo los sensibles.
>
> ☐ **Casilla 3 (opcional; ONE la exige si el viaje lleva menores):** Autorizo por los menores.
>
> **[ Autorizo ]**
>
> <small>Versión [VERSION].</small>

**Reglas de la pantalla (para Max):** no van.

# Pieza 1b. Detalle completo

> # Aviso de privacidad de [AGENCIA]
>
> **1. Responsable.** [RESPONSABLE].

# Pieza 2. Botón

nada

# Pieza 3. Mensajes de envío

## 3a. Correo automático

**Asunto:** [AGENCIA]: autorice

> Hola, [NOMBRE_CLIENTE]:
>
> **[ Revisar y autorizar ]** → [LINK]

## 3b. WhatsApp

> Hola [NOMBRE_CLIENTE], soy [NOMBRE_COMERCIAL].
> Enlace: [LINK]

**Instrucción del bot a la comercial (cuando le entrega el mensaje para copiar):** «Mándale esto primero». Razón.

# Pieza 4. Vigencia
`

describe('texto de Emilio → INSERT', () => {
  it('saca título, cuerpo, casillas, detalle y mensajes, sin botón ni versión', () => {
    const t = parsear(DOC)
    expect(t.titulo).toBe('Autorización para el uso de sus datos')
    expect(t.casillas).toEqual([
      { clave: 'generales', texto: 'Soy [NOMBRE_CLIENTE] y autorizo a [AGENCIA].' },
      { clave: 'sensibles', texto: 'Autorizo los sensibles.' },
      { clave: 'menores', texto: 'Autorizo por los menores.' },
    ])
    expect(t.cuerpo_md).toBe('Hola, [NOMBRE_CLIENTE]. [AGENCIA] necesita su autorización.\n\n**Para qué.**\n- Atender su solicitud.\n- Reservar el viaje.')
    expect(t.detalle_md).toBe('# Aviso de privacidad de [AGENCIA]\n\n**1. Responsable.** [RESPONSABLE].')
    expect(t.mensajes).toEqual({
      correo_asunto: '[AGENCIA]: autorice',
      correo_cuerpo: 'Hola, [NOMBRE_CLIENTE]:\n\n[LINK]',
      whatsapp: 'Hola [NOMBRE_CLIENTE], soy [NOMBRE_COMERCIAL].\nEnlace: [LINK]',
      instruccion_comercial: 'Mándale esto primero',
    })
  })

  it('el SQL que imprime entra a la tabla de la migración', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autz-'))
    const doc = join(dir, 'doc.md')
    writeFileSync(doc, DOC)
    const WS = '00000000-0000-4000-8000-0000000000a1'
    const sql = execFileSync('node', [
      join(process.cwd(), 'scripts/autorizacion-datos-texto-sql.mjs'), doc,
      '--workspace', WS, '--version', 'demo-v1.0', '--mayor', '1', '--menor', '0',
      '--encargado', 'Persona Inventada', '--canal', 'datos@inventado.co',
    ], { encoding: 'utf8' })
    const db = new PGlite()
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create table public.workspaces (id uuid primary key); create table public.staff (id uuid primary key);
      create table public.negocios (id uuid primary key);
      create table public.contactos (id uuid primary key, workspace_id uuid, nombre text, email text, custom_data jsonb);
      insert into public.workspaces values ('${WS}');`)
    await db.exec(readFileSync(join(process.cwd(), 'supabase/migrations/20261008230000_autorizacion_datos_enlace.sql'), 'utf8'))
    const r = await db.query(sql)
    expect(r.rows[0]).toMatchObject({ version: 'demo-v1.0' })
    expect(r.rows[0].plantilla_sha256).toMatch(/^[0-9a-f]{64}$/)
    const v = await db.query(`select variables, jsonb_array_length(casillas) as n from public.autorizacion_datos_textos`)
    expect(v.rows[0]).toEqual({ variables: { encargado: 'Persona Inventada', canal_datos: 'datos@inventado.co' }, n: 3 })
    await db.close()
  }, 30_000)
})
