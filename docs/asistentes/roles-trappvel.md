# Roles de Trappvel por el número de Agus (2026-10-29)

Mauricio aprobó dos roles el 29-oct, en el canal `wa_one`:

- **`mano_derecha`** (el dueño): todo lo de viajes, más gastos con soporte, pagos recibidos, actividades, consulta de negocios y de gastos, y cifras. No incluye `equipo.contactos`.
- **`asesor_viajes`** (las asesoras comerciales): todo lo de viajes.

En los dos roles, el paso a una persona abre el WhatsApp de MeTRIK (`ESCALAMIENTO_METRIK` en `persona.ts`).

Nada está aplicado. Las fichas de cada rol salen de `supabase/functions/_shared/agente/bandeja/roles-trappvel.ts`. El SQL lo genera `roles-trappvel-sql.ts`, en la misma carpeta.

## Qué vive dónde

Quién tiene qué rol (ids de staff y de colaborador, teléfonos, nombres) **no entra al repo**. Vive en la carpeta del proyecto del cliente, fuera de `metrik-one`:

```
proyectos/trappvel/clarity/docs/asistente/roles/
  asignaciones.json                      quién tiene qué rol (lo lee el generador)
  banco-mano_derecha.json                el banco del arnés de cada rol
  banco-asesor_viajes.json
  2026-10-29_roles-agus-PENDIENTE.sql    generado: publicar y prender, en una transacción
  2026-10-29_roles-agus-ENSAYO.sql       generado: lo mismo dentro de DO $dry$ … RAISE EXCEPTION 'dry-run ok'
  2026-10-29_roles-agus-REVERSA.sql      generado: vuelve al camino de hoy
  LEEME.md                               el estado con los datos del cliente
```

En el repo quedan el código, este README y las pruebas, con datos inventados.

### `asignaciones.json`

```json
{
  "asignaciones": [
    { "quien": "Dueño", "rol": "mano_derecha", "staff": "00000000-0000-4000-8000-0000000000a1" },
    { "quien": "Asesora uno", "rol": "asesor_viajes", "staff": "00000000-0000-4000-8000-0000000000a2" },
    { "quien": "Asesora dos (colaboradora)", "rol": "asesor_viajes", "colaborador": "00000000-0000-4000-8000-0000000000c2" }
  ],
  "telefonos_agente": ["570000000022"],
  "telefono_prueba": "0000000099",
  "staff_sin_telefono": [{ "quien": "Asesora dos", "staff": "00000000-0000-4000-8000-0000000000a3", "telefono": "570000000022" }]
}
```

- `asignaciones`: cada persona va por su `staff` o por su `colaborador` de WhatsApp, uno solo, con un uuid. `quien` solo sale en un comentario del SQL.
- `telefonos_agente`: los teléfonos que se suman a `agente_telefonos`, porque hoy no llegan al agente. Solo dígitos. La reversa los quita.
- `telefono_prueba` (opcional): los últimos dígitos de un teléfono de prueba. Si también es de un staff, ese staff va a la mano derecha, porque al identificar gana el staff.
- `staff_sin_telefono` (opcional): staff que entra como colaborador porque no tiene `phone_whatsapp`. La cabecera del SQL trae, comentado, el UPDATE que se lo pone. No se aplica solo.

El generador valida el archivo y se niega si algo no cuadra: un rol que no existe, un id que no es uuid, staff y colaborador a la vez o un teléfono con letras.

## Correr el arnés con Haiku (sin Gemini)

El arnés manda a Claude Haiku 5.5 (`claude-haiku-5-5`) al agente, al comercial simulado, a la extracción y a los lectores de archivos. Usa el mismo `fetchModelo` de producción, pero sin respaldo, y no puede salir a otro lado que no sea `api.anthropic.com` (`arnes/proveedor-haiku.ts`). Solo pide `ANTHROPIC_API_KEY`: no lee `GEMINI_API_KEY`, y `LLM_PROVEEDOR` no lo cambia. Si un pedido intenta salir a Gemini, se bloquea y la corrida termina sin `banco.json` (salida 4). No hay juez de modelo: la calificación es por código (`arnes/calificar.ts`).

Los precios del gasto vienen de la página oficial de Anthropic, leída el 2026-10-29 (Haiku 5.5, prompts de hasta 100.000 tokens): entrada USD 0,10, salida USD 0,50 y lectura de caché USD 0,01 por millón de tokens. La escritura de caché se cuenta como entrada, así que el gasto puede quedar un poco corto.

Desde la raíz de `metrik-one`, con `R=/home/mauricio/Developer/metrik/proyectos/trappvel/clarity/docs/asistente/roles`:

```
# 0. La llave contesta (una llamada mínima)
ANTHROPIC_API_KEY=… deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/correr.ts --humo

# 1. Línea base: la bandeja de hoy, sin rol, con los mismos casos
ANTHROPIC_API_KEY=… deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/correr.ts --conjunto base-roles --k 3 --salida /tmp/arnes-base

# 2. Cada rol (con --excluir, los casos que la línea base no pasa 3 de 3)
ANTHROPIC_API_KEY=… deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/correr.ts --rol mano_derecha --k 3 --excluir <ids> --salida /tmp/arnes-md
ANTHROPIC_API_KEY=… deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/correr.ts --rol asesor_viajes --k 3 --excluir <ids> --salida /tmp/arnes-av

# 3. Los bancos a la carpeta del proyecto y regenerar los SQL ahí mismo
cp /tmp/arnes-md/banco.json "$R/banco-mano_derecha.json"
cp /tmp/arnes-av/banco.json "$R/banco-asesor_viajes.json"
deno run -A --node-modules-dir=none supabase/functions/_shared/agente/bandeja/roles-trappvel-sql.ts --asignaciones "$R/asignaciones.json"
```

- `--seco` corre todo sin red y sin llave, con un modelo falso. Prueba la cañería, no mide nada.
- `--excluir` deja fuera del banco la tarea de los casos que hoy tampoco pasan. Una dañina en un excluido frena igual, y el banco lista los excluidos.
- **El orden de las fichas.** Una versión publicada guarda las fichas ordenadas por clave (`bot_publicar_reglamento`), y así las lee producción. El arnés corre con ese orden (`ordenPublicado`), la base y cada rol. Con el mismo contenido en el orden del código, Haiku se comporta distinto: la bandeja publicada v3 (2026-10-14) es el reglamento del código ordenado por clave, con `herramientas` en null donde el código pone `[]`. Por eso su huella no es la del código y el paso 0 del SQL pide `--fichas-base`.
- `--fichas-base <json>`: las fichas publicadas de la bandeja, si no son las del código (ver «Si el paso 0 frena»).
- `--proveedor gemini` vuelve al arnés de antes (`GEMINI_API_KEY`, gemini-3.8-flash con respaldo flash-lite).

## Para publicar

1. Correr el arnés con Haiku hasta que los dos bancos digan `pasa: true` (k = 3) y regenerar los SQL (pasos 1 a 3 de arriba).
2. Desplegar `wa-webhook` con el código del PR. `chatwoot-agente` comparte el componedor pero su comportamiento no cambia, así que se puede desplegar después.
3. Correr `ENSAYO.sql`: tiene que terminar en `dry-run ok`. Después, `PENDIENTE.sql`.

Lo que hace `PENDIENTE.sql`, en orden:

1. Verifica que la bandeja publicada sea la base con que corrió el arnés (paso 0).
2. Prende las funciones.
3. Crea los roles.
4. Carga las fichas.
5. Publica con el banco. `asistente_publicar_rol` rechaza un banco con `pasa: false`, y entonces el archivo no deja nada: lo prueba `roles-trappvel-sql.test.ts` en PGlite.
6. Mueve el puntero y prende los roles.
7. Asigna cada persona a su rol, y el staff del teléfono de prueba a la mano derecha.
8. Suma `telefonos_agente` a `agente_telefonos`.

**Si el paso 0 frena**, las fichas publicadas de `bandeja-solicitudes` no son la base del código porque la agencia las ajustó:

1. Exportarlas con el SELECT de la cabecera del SQL.
2. Correr el arnés con `--fichas-base <json>`.
3. Regenerar con `roles-trappvel-sql.ts --asignaciones … --fichas-base <json>`.

Así el rol nunca le cambia a la bandeja un texto ya aprobado.

## Estado (29-oct)

- Línea base con el orden publicado (Haiku, k = 3): pasan 19 de 25, sin dañinas. No pasan 3 de 3: `c1-1140, r-fuera, r-ignora, r-cliente-nuevo, r-ambiguo, a-foto-anotar`. Ese es el `--excluir` de los roles. `r-lista` pasa con este orden y entra al banco. `r-cliente-nuevo` es la falla heredada: después de crear al cliente, el modelo propone el viaje con quien escribe sin que nadie lo dijera.

- La primera corrida, con Gemini, se cortó a la mitad porque la llave de pruebas llegó a su tope de gasto (HTTP 429). Por eso los bancos de la carpeta del proyecto dicen `pasa: false` y la publicación se rechaza sola. La huella de cada banco sí es la de las fichas de su rol.
- El arnés ya corre con Haiku y solo falta la corrida real k = 3 con `ANTHROPIC_API_KEY`.
- **Con los roles prendidos**, cualquier otro remitente del workspace que llegue al agente recibe «Por este chat todavía no tengo nada habilitado para ti…» (`RF_SIN_ROL`). Quien no está en `agente_telefonos` sigue por el bot de antes.
- Una persona que entra como colaboradora no es del equipo comercial para la bandeja: «la llevo yo» no la puede elegir y el bot pregunta quién lo lleva. Ponerle el teléfono en su staff lo arregla.
