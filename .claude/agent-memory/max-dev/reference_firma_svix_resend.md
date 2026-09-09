---
name: firma-svix-resend
description: Verificar un webhook de Resend/Svix no es el HMAC de Meta; el vector oficial publicado sirve de prueba, y la ventana de 5 min tiene un supuesto que hay que vigilar
metadata:
  type: reference
---

# La firma de Svix (Resend) no se parece al HMAC de Meta

Resend firma sus webhooks con **Svix**. Escribirlo "como `wa-webhook`" produce **401 en todo**,
que desde afuera se lee como "el proveedor no esta llamando". Tres diferencias, y cada una sola
basta para romperlo:

1. Lo firmado es `` `${svix-id}.${svix-timestamp}.${body}` ``, **no** el cuerpo.
2. La clave son los bytes del secreto **decodificado de base64** quitandole `whsec_`, **no** el texto.
3. La firma va en **base64** (no hex) y el header es una **lista separada por espacios**
   (`v1,<b64> v1,<b64> v2,<b64>`): basta que **una** entrada `v1` coincida.

Implementacion viva: `supabase/functions/_shared/resend-acuses.ts` (`verificarFirmaSvix`).
Es un modulo puro: solo `crypto.subtle`, `atob`, `btoa`, `TextEncoder` — todos globales en Deno
**y** en Node 18+, asi que el mismo archivo corre en la edge function y en vitest sin imports.

## El vector oficial es la unica prueba que vale

Svix publica un caso reproducible en
`https://docs.svix.com/receiving/verifying-payloads/how-manual`:

```
secret    whsec_plJ3nmyCDGBKInavdOK15jsl
payload   {"event_type":"ping","data":{"success":true}}
msg_id    msg_loFOjxBNrRLzqYUf
timestamp 1731705121
firma     v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=
```

Verificado con `node:crypto` el 2026-09-09: coincide. **Es el unico caso que puede afirmar que
la mecanica es la de Svix y no la nuestra** — todo lo demas se construye con nuestro propio
criterio y pasaria igual si el criterio estuviera mal. Si algun dia hay que "ajustarlo para que
pase", el que esta mal es el codigo.

Corolario de metodo: las firmas de los demas casos se generan con `node:crypto` y el codigo bajo
prueba usa `crypto.subtle`. Dos implementaciones distintas a proposito; con una sola, un error
compartido pasa inadvertido.

## ⚠️ La ventana de 5 minutos descansa en un supuesto

`TOLERANCIA_SEGUNDOS = 300` es el mismo valor que aplica la libreria oficial de Svix, y Resend
recomienda esa libreria. **El supuesto es que Svix vuelve a firmar en cada reintento** — si
reusara el timestamp original, todo cliente que use la libreria oficial perderia cada reintento
posterior a 5 min, lo cual seria absurdo. Ninguna de las dos documentaciones lo dice con todas
las letras.

Por eso el rechazo por ventana tiene **razon propia** (`timestamp_fuera_de_ventana`) y no se
mezcla con `sin_firma_valida`: si el supuesto fuera falso, el log lo dice con todas las letras
en vez de parecer un ataque. Los reintentos de Resend van a 5 s, 5 min, 30 min, 2 h, 5 h, 10 h,
asi que el sintoma seria "los acuses de primera entrega entran y los reintentos no".

Ver tambien [[acuses-resend-avisos-cliente]].
