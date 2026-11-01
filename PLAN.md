# Plan — `talkingwithmyself-agent`
## Agente de ingesta, redacción y publicación de **Talking With Myself**
> *Engineering, leadership & systems, thinking out loud.*
### Plan de implementación (NO implementado)

> Creado: 2026-10-29 · Actualizado: 2026-10-31 con las respuestas de Jesus · Estado: **todas las decisiones tomadas; listo para empezar etapa 0.**
> Fuente de contexto: `~/code/cabrera-systems-blog/PLAN.md` (secciones 1, "Dos proyectos y su contrato", 6, 7, 8, 9, 11).
> Restricciones: costo $0 · nunca push a `main` · token GitHub solo sobre `cabrera-systems-blog` · no inventar hechos · EN + ES.

---

## Índice
1. [Qué hace el agente](#1)
2. [Decisiones tomadas](#2)
3. [Arquitectura](#3)
4. [Pipeline de un post](#4)
5. [Contrato con el blog (schema)](#5)
6. [Redacción con Claude: reglas editoriales y anti-invención](#6)
7. [Publicación: rama, preview, merge](#7)
8. [Bot de Telegram](#8)
9. [Share outputs](#9)
10. [Seguridad y secrets](#10)
11. [Plan por etapas](#11)
12. [Costos](#12)
13. [Preguntas abiertas](#13)

---

<a name="1"></a>
## 1. Qué hace el agente

```
Telegram: /nuevo → nota de voz 2–5 min + imágenes + URLs → /listo
   │
   ├─ Transcribe la voz (detecta idioma → original) y limpia muletillas
   ├─ Lee las URLs (texto limpio, solo como contexto/fuente)
   ├─ Optimiza: audio → MP3 mono ~1–2 MB · imágenes → WebP
   ├─ Portada: la imagen marcada #portada; si no hay, pregunta y (si aceptas) la genera y te la valida
   ├─ Claude redacta EN + ES (adapta, no traduce), tono profesional
   ├─ Autorrevisión: ¿hay algo que no esté en la voz ni en las URLs?
   ├─ Valida contra el schema del blog
   ├─ Commit (autor Jesus, coautor Claude) a rama post/<id> → Vercel preview
   └─ Telegram: "Listo 👉 <preview>  [✅ Publicar] [✏️ Cambios]"
         ✅ → fija date = hoy → merge a main → publicado (~1 min) → share outputs
         ✏️ → instrucciones (texto o voz) → nuevo commit → nuevo preview
```

El agente **estructura el punto de vista de Jesus**: no agrega datos, cifras, clientes, nombres ni anécdotas que no estén en la nota de voz o en las URLs.

---

<a name="2"></a>
## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Dónde corre | **Raspberry Pi 5, 8 GB, SD** (siempre encendida, ya corre otros proyectos). Telegram por *long polling* → nada expuesto a internet |
| Cómo corre | **Servicio `systemd`** (no cron, ver 2.1) |
| Fin de la ingesta | **Comando explícito** `/listo` (sin cierre automático por inactividad) |
| Id del post | `AAAAMMDDHHmm-<slug>`, p.ej. `202611031222-dashboards-lie`. Hora del `/nuevo` en **`America/Mexico_City`**. Slug corto (ver 4.2) |
| Audio publicado | **Opt-in por post, apagado por defecto** (2026-10-31). La nota de voz siempre es la fuente de la redacción, pero `audio.mp3`, `transcript.md` y los campos `audio/audioLang/duration` solo se publican si Jesus lo activa (botón *🎙 Publicar audio* en Telegram; `--audio` en la CLI). Sin audio no hay audiograma ni entrada en el feed de podcast |
| Transcripción publicada | **Limpia** (cuando se publica audio): sin muletillas ni repeticiones, sin cambiar el contenido |
| Tono | **Profesional** (claro, directo, primera persona, sin relleno) |
| Audiograma | Solo en posts con audio publicado. **X cuenta gratis** → máx. **2:20** (140 s): fragmento + "escucha completo en el blog" |
| Commits | **Autor: Jesus, con su email personal**, y trailer `Co-Authored-By: Claude …` |
| Share outputs | **Ambos**: los textos se comitean en `share/` **y** se envían a Telegram. El **MP4 del audiograma solo va a Telegram** (regenerable con `/share <id>`) |
| Claude | **Solo suscripción** vía `claude -p` (Claude Code headless). **Sin** API de respaldo |
| `date` del post | **Fecha del merge** (✅), no la de la nota de voz |
| Imágenes | **Patrón en el caption**: `#portada`, `#1`, `#2`… (ver 4.6) |
| Sin portada | El agente **pregunta** si la genera; si sí, la generada pasa por **su propia validación** en Telegram antes del preview (ver 4.7) |
| Transcripción (motor) | whisper.cpp local en la Pi, $0 (modelo según benchmark, ver 2.1) |
| Portadas generadas | Plantillas propias (SVG → WebP), sin IA de imágenes, $0 |

### 2.1 Implicaciones de correr en la Raspberry Pi

- **La Pi (verificado 2026-10-31):** Raspberry Pi 5 Model B, 4× Cortex-A76 @ 2.4 GHz, `aarch64`, 7.9 GiB RAM (~5.7 GiB disponibles con lo que ya corre), swap zram 2 GiB, SD de 29.8 GB, **Debian 13 (trixie)**. Acceso por SSH en la red local.
  - Debian trixie trae Node 20 → instalar **Node 22 LTS** desde NodeSource (o `nvm`). ffmpeg desde apt. whisper.cpp **compilado desde fuente** (con optimizaciones NEON/dotprod que el A76 soporta).
- **Whisper en la Pi 5.** La RAM alcanza para `large-v3-turbo` cuantizado (q5, < 1 GB en uso); la duda es la velocidad. Como el flujo es asíncrono, basta con que 5 min de audio se transcriban en ≲ 15 min. Etapa 0b incluye un **benchmark** con una nota real: `large-v3-turbo` q5 → `medium` q5 → `small`, y se queda el más preciso que cumpla el tiempo. Revisar espacio libre en la SD (modelo ~0.6–1.6 GB).
- **SD card (desgaste y fallos).** Archivos intermedios (WAV, frames del audiograma, renders) en `tmpfs` (`/run` o `/tmp` en RAM), no en la SD. En la SD solo queda `data/` (estado, audio original, borradores: pocos MB por post) y el clon del blog. Logs en `journald` con límite de tamaño. Respaldo: lo publicado vive en GitHub; `data/` de jobs en curso se puede perder sin daño grave.
- **systemd en vez de cron.** El bot es un proceso de larga duración (long polling, botones con respuesta inmediata); con cron habría que ejecutarlo cada minuto, con hasta 60 s de latencia en cada botón y riesgo de ejecuciones solapadas. `systemd` (ya incluido en Raspberry Pi OS) da reinicio automático (`Restart=always`), arranque al encender, límites de recursos (`CPUQuota`, `MemoryMax`, `Nice`) y logs. Las tareas periódicas (limpieza de `data/`, aviso de expiración de tokens) van como **systemd timers**. No interfiere con el cron de los otros proyectos.
- **Claude Code en la Pi.** Instalar Claude Code (Linux arm64) y autenticar sin navegador con `claude setup-token` → token de larga duración en `CLAUDE_CODE_OAUTH_TOKEN`. Verificar en etapa 0 que `claude -p` funciona en la Pi con la suscripción.
- **Sin API de respaldo:** si la suscripción falla (límite de uso alcanzado, token vencido), el job queda en pausa, el bot avisa ("Claude no disponible: <motivo>; reintento en X") y reintenta con *backoff*. Nada se pierde porque el estado está en disco. Comando `/reintentar` para forzarlo.
- **Convivencia con otros proyectos:** whisper y ffmpeg corren con `Nice=10` y `CPUQuota=300%` (deja un núcleo libre) y `MemoryMax=3G`, para no afectar los cron existentes. Limpieza automática de jobs publicados > 90 días.

---

<a name="3"></a>
## 3. Arquitectura

**Stack:** Node 22 + TypeScript (mismo lenguaje que el blog → se puede reutilizar el schema zod). Todo con soporte arm64.

| Pieza | Herramienta |
|---|---|
| Telegram | `grammY` (long polling) |
| GitHub | `@octokit/rest` + `git` CLI |
| Transcripción | `whisper-cli` (whisper.cpp compilado en la Pi) |
| Audio/vídeo | `ffmpeg` (apt) |
| Imágenes | `sharp` (WebP, recortes) |
| Portadas | `satori` + `@resvg/resvg-js` |
| URLs | `fetch` + `@mozilla/readability` + `linkedom` |
| Claude | `claude -p --tools "" --strict-mcp-config --no-session-persistence --system-prompt … --output-format json --json-schema …` (probado en 0a). **No usar `--bare`**: ese modo solo acepta API key e ignora el login de la suscripción |
| Validación | `zod` (schema del blog) |
| Estado | archivos JSON por post (sin BD) |

**Estructura propuesta:**

```
talkingwithmyself-agent/
  src/
    core/            # pipeline puro, sin Telegram (usable por CLI)
      ingest.ts      # junta voz, imágenes, URLs en un "job"
      ids.ts         # AAAAMMDDHHmm-slug
      transcribe.ts  # whisper + limpieza
      media.ts       # mp3, webp, cover, audiograma
      sources.ts     # lectura de URLs
      draft.ts       # llamadas a Claude
      review.ts      # autorrevisión anti-invención
      render.ts      # escribe en.md / es.md con frontmatter
      schema.ts      # schema del blog
      publish.ts     # rama, commit, preview, merge
      share.ts       # LinkedIn, dev.to, audiograma
    claude.ts        # wrapper de `claude -p` (reintentos, parseo JSON)
    bot/             # Telegram: handlers, botones, whitelist
    cli.ts           # `twm draft ./carpeta`, `twm publish <id>`…
  prompts/           # formato editorial, tono, reglas (versionados)
  templates/cover/   # plantillas SVG de portada
  deploy/            # unidades systemd (servicio + timers), script de instalación en la Pi
  data/              # (gitignored) jobs: raw audio, transcript, drafts, historial
  config.yaml        # configuración del agente (sin secretos)
  .env.example       # solo secretos
```

**Configuración — tres capas, cada una con un dueño:**

| Archivo | Repo / lugar | Dueño | Contiene |
|---|---|---|---|
| `src/content/site.yaml` | `cabrera-systems-blog` (propuesta para la sesión del blog) | Blog (validado con zod, incluido en `schema/`) | Datos editoriales compartidos: **tags** (id + etiqueta EN/ES), idiomas, autor, handles (`@TalkingWMy`), URL base/canónica |
| `config.yaml` | este repo | Agente | Runtime: zona horaria, modelo de Whisper, límites de duración/peso, plantillas de portada, trailer de coautor, nombre/email de autor de commits, rutas, repo destino, límites de CPU |
| `/etc/twm/agent.env` (prod) / `.env` (dev) | fuera de git | Jesus | **Solo secretos**: tokens de Telegram, GitHub y Claude, `chat_id` permitido |

- Un solo YAML **por dueño**, no uno para todo: lo editorial lo valida el build del blog y llega por PR; lo del agente se cambia sin tocar el blog; los secretos nunca entran a git.
- El agente solo escribe en `site.yaml` la sección `tags`, usando la librería `yaml` en modo documento (respeta comentarios y orden), para que el diff del PR muestre solo las líneas del tag nuevo.
- `config.yaml` se valida con zod al arrancar; si falta algo o es inválido, el servicio no arranca y lo dice en el log.
- Overrides por entorno con variables (`TWM_WHISPER_MODEL=…`) para usar el mismo archivo en la Mac y en la Pi.

**Estado por post** (`data/<id>/job.json`): estado (`collecting → transcribed → drafted → [cover_review] → previewed → published`, o `paused` si Claude no está disponible), idioma original, rutas de archivos, rama, PR, URL del preview, historial de revisiones. Permite reanudar tras reinicios de la Pi.

**Repositorio del blog:** clon dedicado en la Pi (`data/blog-repo/`).

**Desarrollo:** se programa y prueba en la Mac (el núcleo es CLI y no depende de la Pi); se despliega en la Pi con un script (`deploy/install.sh`) o `git pull` + reinicio del servicio.

---

<a name="4"></a>
## 4. Pipeline de un post

### 4.1 Ingesta
`/nuevo` abre un job; todo lo que llegue (voz, imágenes, URLs, texto de contexto) se adjunta; `/listo` lo cierra y arranca el pipeline. Si llega contenido sin job abierto, el bot pregunta "¿abro un post nuevo?" con botón.

### 4.2 Id
`AAAAMMDDHHmm-<slug>` con la hora del `/nuevo` en `America/Mexico_City` (la misma zona se usa para `date`).
- Slug del id: **en inglés**, 2–4 palabras, **máx. 30 caracteres** (id total ≤ 43), sin stopwords: `202611031222-dashboards-lie`.
- El id es el nombre de la carpeta. Los **slugs de URL** por idioma son aparte (`slug` en cada `.md`), también cortos (≤ 50 caracteres, sin el timestamp): `/blog/en/observability-dashboards-lie`, `/blog/es/los-dashboards-mienten`.
- La hora del id no es la fecha publicada (`date` = merge).

### 4.3 Audio
Telegram entrega OGG/Opus. `ffmpeg` → normalización (`loudnorm`), recorte de silencios al inicio/fin, MP3 mono 48 kbps: 2–5 min ≈ **0.7–1.8 MB**. `duration` en segundos.

### 4.4 Transcripción
whisper.cpp con detección de idioma → `audioLang` y `original`, con timestamps (necesarios para elegir el fragmento del audiograma). Glosario de términos propios como prompt inicial.
**Limpieza** con Claude: quita muletillas ("eh", "o sea", "este…"), repeticiones y arranques en falso; corrige puntuación y términos mal reconocidos. Regla: **no agrega, no resume, no reordena ideas**. La versión limpia se escribe en `transcript.md` (solo en `audioLang`); la cruda queda en `data/` para auditoría.

### 4.5 Fuentes
Cada URL → texto legible + título. Si no se puede leer (paywall, login), se avisa y se sigue sin ella. Se guardan en `sourceUrls`.

### 4.6 Imágenes (patrón en el caption)

| Caption de la imagen | Uso |
|---|---|
| `#portada` / `#cover` | Portada (`cover.webp`). Si hay varias, gana la última |
| `#1`, `#2`… (opcional + texto) | Imagen del cuerpo en esa posición; el texto ayuda a ubicarla y a escribir el alt. Ej: `#2 diagrama del pipeline` |
| sin patrón | Imagen del cuerpo; Claude la ubica junto a la idea más relacionada |
| (ninguna con `#portada`) | El agente **pregunta** (ver 4.7) |

Se recomienda mandar la portada **como archivo** (sin compresión de Telegram). `sharp` → WebP (máx. ~1600 px, calidad ~80); portada recortada a 1200×630 (OG) + versión cuadrada para el audiograma. `coverAlt` y alts los genera Claude describiendo la imagen, sin inventar contexto.

### 4.7 Portada faltante: pregunta + validación propia
1. Al recibir `/listo` sin imagen `#portada`, el bot pregunta: *"No mandaste portada. [🎨 Genérala tú] [📎 La mando yo]"*. Mientras tanto la transcripción y la redacción **siguen en paralelo** (no se pierde tiempo).
2. **📎 La mando yo** → espera una imagen (con o sin `#portada`) y sigue el flujo normal.
3. **🎨 Genérala tú** → cuando ya existe el título (paso de estructura), genera la portada con la plantilla y la manda a Telegram como imagen para **validarla**:
   *"[✅ Usar] [🔄 Otra variante] [✏️ Cambios] [📎 La mando yo]"*
   - 🔄 → otra plantilla/variación de color o motivo.
   - ✏️ → instrucción en texto/voz ("menos texto", "usa el astronauta", "título más corto") → nueva versión.
4. El commit y el preview del post **no se hacen** hasta que la portada esté aprobada. Después, el post pasa por la validación normal del preview (✅/✏️ del post).
5. Si en los ✏️ del post cambia el título, se pregunta si se regenera la portada (vuelve a esta validación).

### 4.8 Redacción, autorrevisión y validación
Ver sección 6. Si el schema falla, Claude corrige con el error; máx. 2 intentos, si no, se avisa.

### 4.9 Publicación
Ver sección 7.

---

<a name="5"></a>
## 5. Contrato con el blog (schema)

> Acordado con la sesión del blog y confirmado por Jesus el 2026-10-31 (registrado en `~/code/cabrera-systems-blog/PLAN.md` sección 6). Campos en borrador hasta que el blog congele `schemaVersion: 1` y lo notifique.

- El schema es **propiedad de `cabrera-systems-blog`**: el schema zod del blog es la fuente de verdad.
- **Cómo lo consume el agente:** el build del blog genera **`schema/post.schema.json`** y **`schema/site.schema.json`** (rutas fijas en la raíz del repo). Los tags viven en **`src/content/site.yaml`** (aceptado por el blog; nombres exactos de claves finales al congelar v1). Antes de cada commit el agente lo lee de `main` y valida. Si `schemaVersion` de `main` ≠ la soportada → no publica y avisa.
- Validación doble: local en el agente + en build del blog. **`main` tiene branch protection que exige el check de Vercel** (el repo es público → protección gratis), así que un merge con build roto es imposible.
- **Tags: lista controlada** en el repo del blog, cada tag con etiqueta EN y ES; zod rechaza tags desconocidos. El agente lee la lista de `main` y Claude elige solo de ella. Si hace falta uno nuevo, el agente lo **agrega a la lista en el mismo PR** y lo señala en el mensaje de Telegram ("tag nuevo: `platform-engineering` / *ingeniería de plataformas*") para que Jesus lo apruebe junto con el post. *(Ruta del archivo: pendiente, la manda el blog cuando exista.)*
- **Archivos que escribe** (por post):
  ```
  src/content/posts/<AAAAMMDDHHmm-slug>/
    en.md
    es.md
    transcript.md         # solo en audioLang; transcripción limpia
    cover.webp
    audio.mp3
    img-1.webp …          # imágenes del cuerpo
    share/
      linkedin.en.txt
      linkedin.es.txt
      x.en.txt  x.es.txt
      devto.en.md  devto.es.md   # URL canónica = baseUrl/lang/slug
                          # audiograma MP4: NO va al repo, solo a Telegram
  ```
- **Schema v1 en borrador ya existe en el blog** (2026-10-31, sin congelar ni commitear; Jesus debe revisarlo): `src/lib/schema/post.ts`, `src/lib/schema/site.ts`, `src/lib/schema/validate.ts` (reglas de carpeta, puro, sin fs), `src/content/site.yaml`, y `schema/*.schema.json` generados con `npm run schema` (`npm run contract` en prebuild falla si están desactualizados).
- **Campos (borrador v1, frontmatter estricto: claves desconocidas = error):** `schemaVersion, title (≤120), slug (kebab, ≤50), lang, original, date (YYYY-MM-DD), description (≤200), cover (./x.webp), coverAlt, tags (1–5 ids de site.yaml), hashtags (≤10, sin '#'), sourceUrls, draft, audio, audioLang, duration`.
  - `translationOf` **eliminado**: `en.md` y `es.md` se enlazan por la carpeta (id).
  - `transcript` **eliminado del frontmatter**: va en `transcript.md`, solo en el idioma del audio; el blog lo muestra en ambas páginas con nota de idioma.
  - `canonical` **eliminado**: se deriva como `baseUrl/lang/slug` (`baseUrl` de `site.yaml`). El agente usa la misma fórmula en los share outputs.
  - `date` obligatorio: provisional (hoy) en commits de rama; el commit de ✅ la fija con la fecha del merge.
- **Reglas de carpeta** (`validate.ts`; el JSON Schema no las expresa): id `^\d{12}-kebab` con slug ≤ 30 · existen `en.md` y `es.md` y `lang` coincide con el nombre · exactamente un `original: true` · `date, cover, tags, draft, audio, audioLang, duration` idénticos en ambos · `cover` y `audio` existen · `audio/audioLang/duration` van juntos · audio ⇒ `transcript.md` · `audioLang` = idioma del original · slugs únicos por idioma.
- **Cómo valida el agente:** copia `post.ts`, `site.ts` y `validate.ts` a `src/core/schema/` con un script `npm run sync-schema` que los toma de `main` del blog y falla si `SCHEMA_VERSION` cambió sin actualizar el agente. Así valida con el mismo código zod que el build (no solo JSON Schema), incluidas las reglas de carpeta.
- **Acordado también:** id de carpeta `AAAAMMDDHHmm-slug` (el blog no deriva la fecha del id) · `img-N.webp` en la carpeta · `share/` solo texto e ignorada por el sitio público · sin MP4 en git · transcripción limpia · `America/Mexico_City`.
- **Pendiente del lado del blog:** ruta del archivo de tags y aviso de schema v1 congelado.

---

<a name="6"></a>
## 6. Redacción con Claude: reglas editoriales y anti-invención

**Formato editorial** (ajustable en `prompts/`, versionado):

```
# Título
> Postura en una línea (la tesis de Jesus)

[Portada]
[▶ Reproductor de audio · "Escúchalo en español · 3:42"]   ← solo si se publica audio

## Ideas clave
- 3–5 ideas, cada una 1–3 párrafos cortos

## Fuentes  (si hubo URLs)

<details> Transcripción completa (limpia) </details>   ← lo renderiza el blog
```

**Tono profesional** (`prompts/voice.md`): claro y directo, primera persona, frases cortas, vocabulario técnico preciso, sin jerga de marketing, sin exageraciones ni emojis en el cuerpo, sin "En este artículo exploraremos…". En ES: español neutro profesional; en EN: inglés profesional natural (no traducido).

**Llamadas a Claude por post (≈6–7, todas con `claude -p`):**
1. **Limpieza** de la transcripción (4.4).
2. **Estructura:** postura, ideas clave, título, slugs, tags elegidos de la lista controlada del blog (o propuesta de tag nuevo, justificada) (JSON).
3. **Redacción original** en el idioma de la voz.
4. **Adaptación** al otro idioma (no literal; hashtags propios).
5. **Confirmación de términos:** los términos que Whisper pudo reconocer mal (nombres, siglas, productos, lenguajes) se marcan `[así]` con una hipótesis. Antes del preview, el bot los pregunta en **un solo mensaje** con botones por término (`[CSI ✅] [✏️ otro]`); las respuestas se agregan al **glosario** (`config.yaml`) para que Whisper y Claude los acierten la próxima vez.
6. **Autorrevisión:** cada afirmación contra transcripción y fuentes; lo que no tenga respaldo se elimina y se reporta en Telegram ("quité: …").
7. **Metadatos:** `description` (~150 caracteres), alts, hashtags.
8. (Bajo demanda) **Cambios ✏️** con la misma autorrevisión.

**Reglas duras:**
- Solo ideas, datos, cifras, nombres, empresas y ejemplos presentes en la voz o las URLs.
- Ideas incompletas se omiten o quedan como pregunta abierta; nunca se completan con supuestos.
- Citas de URLs atribuidas y enlazadas.
- Se mantiene la postura de Jesus aunque las fuentes digan otra cosa.

---

<a name="7"></a>
## 7. Publicación: rama, preview, merge

1. `git checkout -b post/<id>` desde `main` actualizado (clon dedicado en la Pi).
2. Commit con **autor Jesus** y su **email personal** (`GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` en `.env`, aplicados al clon) y trailer:
   ```
   post: 202611031222-dashboards-lie (es → en)

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
   (el nombre/modelo del trailer es configurable).
   `date` en commits de rama = fecha provisional (ahora), para que el preview pase la validación.
   Notas del email personal: el repo del blog será **público**, así que el email queda visible en el historial; debe estar verificado en la cuenta de GitHub para que los commits se atribuyan; y si en GitHub está activo *"Block command line pushes that expose my email"*, el push fallaría (GH007) → desactivarlo o confirmar en etapa 0.
3. Push con el token fine-grained + **PR** `post/<id> → main`.
4. **URL del preview:** de los deployments/commit statuses que crea la integración Vercel↔GitHub, con el mismo token (lectura de *Deployments* / *Commit statuses*). Sin token de Vercel. Polling ~10 s, timeout ~5 min. Si el build falla → resumen a Telegram; Claude intenta corregir si es error de schema.
5. ✏️ **Cambios** → nuevo commit en la misma rama → nuevo preview.
6. ✅ **Publicar:**
   1. Commit final que sobrescribe la `date` provisional con la fecha actual (`America/Mexico_City`) en `en.md` y `es.md`, y regenera los share outputs con la URL canónica definitiva.
   2. Espera el check de Vercel en verde (~1 min).
   3. **Squash merge** del PR vía API (el commit en `main` lleva autor Jesus + coautor Claude) y borra la rama.
   4. Espera el deploy de producción y responde con `cabrera.systems/blog/<lang>/<slug>` + share outputs.
7. **Despublicar:** `/unpublish <id>` → PR con `draft: true`, merge tras confirmación.

**Notas:**
- Previews de Vercel Hobby con *Deployment Protection*: Jesus los ve logueado en Vercel desde el móvil.
- **Branch protection en `main`** exigiendo el check de Vercel: confirmada por el blog.
- El mensaje de preview en Telegram lista los **tags nuevos** que el PR agrega a la lista controlada.
- El token no necesita admin ni workflows.

---

<a name="8"></a>
## 8. Bot de Telegram

- Bot de @BotFather (gratis). **Whitelist por `chat_id`**: solo Jesus; el resto se ignora.
- Long polling desde la Pi.
- **Comandos:**
  | Comando | Acción |
  |---|---|
  | `/nuevo` | abre un job (fija la hora del id) |
  | `/listo` | cierra la ingesta y arranca el pipeline |
  | `/estado` | estado del job actual (paso, cola, si está en pausa) |
  | `/cancelar` | descarta el job (y borra la rama si existe) |
  | `/reintentar` | reintenta un job en pausa (p.ej. Claude no disponible) |
  | `/share <id>` | reenvía los share outputs |
  | `/unpublish <id>` | despublica |
- **Mensaje de preview:** título EN/ES, postura, avisos ("quité 1 afirmación sin respaldo", "no pude leer 1 URL"), links al preview EN y ES, botones `[✅ Publicar] [✏️ Cambios] [🗑 Descartar]`.
- ✏️ acepta texto o nota de voz.
- Progreso: el bot edita un solo mensaje ("Transcribiendo… → Redactando… → Esperando preview…") para no llenar el chat.
- Límite de la Bot API: 20 MB por archivo, de sobra.

---

<a name="9"></a>
## 9. Share outputs

Se generan en el commit final de ✅ (ya con la URL canónica), quedan en `share/` del post **y** se envían a Telegram:

| Salida | Cómo | Detalle |
|---|---|---|
| LinkedIn EN/ES | Claude: hook corto, texto plano, link + hashtags | Sin Markdown |
| X EN/ES | Texto ≤ 280 caracteres (cuenta gratis) con link + hashtags | Se cuenta la URL como 23 caracteres |
| Audiograma MP4 | `ffmpeg`: portada cuadrada 1080×1080 + onda en el acento `#f97316` + título + `@TalkingWMy` + subtítulos quemados del fragmento | **≤ 2:20** (límite X gratis), H.264 + AAC, < 512 MB. Fragmento: Claude elige 60–140 s más representativos usando los timestamps; cierra con "Escucha completo en cabrera.systems/blog". Sirve también para LinkedIn |
| dev.to / Hashnode | Markdown con `canonical_url`, imágenes con URL absoluta | Publicación por API: etapa 6 |
| Medium | Manual: "Import a story" con la URL | El bot manda el recordatorio |

**Peso en el repo:** decidido — el MP4 (~3–8 MB) **solo se envía a Telegram** y se regenera con `/share <id>`; en `share/` solo van textos. El render del audiograma se hace en `tmpfs`. En la Pi 5, 140 s a 1080×1080 deberían renderizarse en pocos minutos (medir en etapa 5; si es lento, bajar a 720×720 o `-preset veryfast`).

---

<a name="10"></a>
## 10. Seguridad y secrets

| Secret | Dónde (Pi) | Alcance |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `/etc/twm/agent.env` (`chmod 600`, dueño el usuario del servicio), cargado con `EnvironmentFile=` de systemd | Solo el bot |
| `TELEGRAM_ALLOWED_CHAT_ID` | `.env` | Whitelist |
| `GITHUB_TOKEN` (fine-grained, de la cuenta de Jesus) | `.env` | **Solo** `cabrera-systems-blog`: Contents RW, Pull requests RW, Metadata R, Deployments R, Commit statuses R. Expiración con aviso 7 días antes. **Nunca** `MyPortfolio` |
| `CLAUDE_CODE_OAUTH_TOKEN` | `.env` | Suscripción de Claude (`claude setup-token`) |

- `.gitignore`: `.env`, `data/`, modelos de Whisper.
- El servicio corre con un **usuario propio** sin acceso a los otros proyectos de la Pi.
- Contenido de URLs = **datos no confiables**: entra al prompt como fuente, nunca como instrucción. `claude -p` se ejecuta **sin herramientas** (solo genera texto), así una página maliciosa no puede ejecutar comandos ni leer archivos.
- Logs sin tokens.

---

<a name="11"></a>
## 11. Plan por etapas

| Etapa | Qué | Depende de | Resultado verificable |
|---|---|---|---|
| **0a. Prerrequisitos (Mac)** — ✅ 2026-10-31 | `whisper.cpp` 1.9.5 (brew) + `ggml-large-v3-turbo-q5_0` (547 MB, en `models/`); `claude -p` sin herramientas, salida JSON con schema, auth `claude.ai` (suscripción). Prueba con nota sintética en español (OGG Opus, 25 s): idioma `es` detectado, transcripción exacta en ~10 s, limpieza correcta en ~4 s, MP3 mono 48 kbps 154 KB. Audio real largo (31 min, varias personas; privado, procesado solo en local y borrado): `es` detectado, **75 s** para transcribir (~25× tiempo real en el M5), calidad alta; los errores se concentran en términos técnicos → confirma la necesidad del **glosario** y de la limpieza con Claude. Monólogo real (10 min, proyecto WiFi/ESP32): transcrito en **21 s**; Whisper en audio largo omite puntuación y repitió una línea (Claude lo corrige). Borrador ES de prueba con `claude -p` en **22 s**: tono profesional correcto, sin inventar, y reportó 5 términos dudosos (`sci`→CSI, `w room 32`→WROOM-32, `en si`→¿Rust/Zig?, Auro/Aurora, Prometheus) → se agrega el paso de **confirmación de términos** (sección 6). Ajuste pendiente: el borrador salió largo (~900 palabras); afinar el formato "ideas clave" en etapa 2 | — | Nota transcrita y limpia en la Mac |
| **1. Núcleo local (CLI)** — ✅ 2026-10-31 | `twm draft <carpeta> [--audio] [--yes]`, `twm resume <job> [--answer=…]`, `twm status <job>`. Pipeline reanudable por pasos; valida con el schema **v1 congelado** (copiado del blog con `npm run sync-schema`). Probado con la nota real de 10 min: ~1:40 de punta a punta en el M5, post EN+ES válido de ~700 palabras, portada provisional | 0a, schema v1 | Carpeta `data/<job>/post/<id>/` revisable a mano |
| **0b. Prerrequisitos (Pi 5)** — antes de la etapa 4 | `df -h`; usuario de servicio `twm`; Node 22, ffmpeg, whisper.cpp compilado; **benchmark de modelos**; Claude Code + `claude setup-token`; crear bot; token fine-grained; ajuste de privacidad de email en GitHub | Etapa 1 | Misma nota de prueba transcrita en tiempo aceptable y `claude -p` respondiendo en la Pi |
| **2. Portadas, tono y formato** — 🚧 2026-11-01 | ✅ Tono aprobado por Jesus. ✅ Alt de imágenes enviadas: Claude **ve** la imagen (`claude -p` con `--input-format stream-json`, sin herramientas) + caption. ✅ Pasajes `[?]` → pregunta a Jesus (`questions_pending`, `--clarify=`; Enter = sigue dudoso, `omitir` = se quita); sus respuestas entran como `aclaraciones_de_jesus` a redacción y revisión. ✅ Plantillas de portada: 3 motivos (órbita, onda de audio, terminal) × 3 fondos = 9 variantes; `twm covers "<título>"` las renderiza. Pendiente: Jesus elige/ajusta plantillas; probar con 2–3 notas más | Etapa 1 | Jesus aprueba tono, formato y plantillas |
| **3. Publicación GitHub/Vercel** | `twm publish <id>`: rama, commit con coautor, PR, preview, commit de `date`, merge, despublicar | Blog en Vercel + schema v1 congelado | Post de prueba en preview y luego en producción |
| **4. Telegram + despliegue en la Pi** | Bot con whitelist, comandos, botones, cambios por voz/texto, pausa/reintento, **pregunta y validación de portada**; servicio + timers systemd | Etapas 0b y 3 | Flujo completo desde el móvil, sobrevive a un reinicio de la Pi |
| **5. Share outputs** | LinkedIn/X EN+ES y dev.to/Hashnode en `share/`; audiograma ≤ 2:20 solo a Telegram; recordatorio Medium | Etapa 4 | Textos en el repo y todo en Telegram tras publicar |
| **6. Endurecimiento / opcional** | Limpieza de `data/`, aviso de expiración de tokens, publicación por API en dev.to/Hashnode | Etapa 5 | — |

**Hallazgos de la etapa 1:**
- Pasar el glosario a Whisper como lista ("Glosario: …") **empeoró** el reconocimiento ("a mí se me ocurría" → "cuando ocurría") y la limpieza convirtió una idea de Jesus en algo que "se llegó a hacer". Solución aplicada: detectar idioma primero y pasar el glosario como frase natural en ese idioma (`Hablo de CSI, Zig…`); con eso Whisper además puntúa bien.
- La limpieza ya no reinterpreta frases confusas (las marca `[?]`) y la autorrevisión compara también contra la transcripción **cruda**, con foco en la atribución (idea propia vs. algo que hicieron otros).
- Respuestas a términos dudosos aceptadas a ciegas (`--yes`) **no** entran al glosario; solo las de Jesus.
- ~~Pendiente para etapa 2: `coverAlt` de imágenes enviadas y pasajes `[?]` como pregunta a Jesus~~ → hecho en etapa 2.
- Para 0b: instalar en la Pi las fuentes de las portadas (Inter/Space Grotesk, JetBrains Mono); `sharp` usa las fuentes del sistema.

Orden: **0a → 1 → 2 en la Mac** (ya, en paralelo con el blog), luego 0b en la Pi. La 3 espera a que el blog esté en `*.vercel.app` con el schema congelado.

---

<a name="12"></a>
## 12. Costos

| Pieza | Costo |
|---|---|
| Raspberry Pi (ya existente) | $0 |
| whisper.cpp, ffmpeg, sharp, satori | $0 |
| Bot de Telegram | $0 |
| GitHub + previews Vercel | $0 |
| Claude vía suscripción (`claude -p`) | $0 adicional (comparte los límites de uso de la suscripción) |

---

<a name="13"></a>
## 13. Preguntas abiertas

Todas respondidas (2026-10-31): ingesta por comando · id `AAAAMMDDHHmm-slug` · Raspberry Pi 5 8 GB con SD · systemd (elegido por el agente; Jesus usa cron en otros proyectos) · `America/Mexico_City` · transcripción limpia · tono profesional · X gratis · commits de Jesus (email personal) con coautor Claude · textos de share en repo + Telegram, MP4 solo Telegram · solo suscripción · `date` = merge · imágenes por patrón `#portada`/`#n` · sin portada → preguntar y validar la generada.

Contrato con el blog acordado (sección 5); falta que el blog envíe la ruta del archivo de tags y avise cuando congele `schemaVersion: 1`.

Quedan solo verificaciones (no decisiones): resultado del benchmark de Whisper en la Pi, `claude -p` funcionando en la Pi, espacio libre en la SD y el ajuste de privacidad de email en GitHub.
