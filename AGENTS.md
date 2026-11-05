# Talking With Myself (`twm`) — Memoria y Reglas del Proyecto

Este archivo contiene las directrices, convenciones, arquitectura y decisiones permanentes para el desarrollo y operación de `talkingwithmyself-agent`.

---

## 1. Identidad y Git
- **Autor**: `Jesus Cabrera`
- **GitHub**: `@JesusCabreraReveles` (`https://github.com/JesusCabreraReveles`)
- **Email oficial de commits**: **`jcr1984@gmail.com`** (único correo verificado en GitHub; **NUNCA** usar proton.me ni otro correo).
- **Trailer de coautoría**: `Co-Authored-By: Claude <noreply@anthropic.com>` en todos los commits generados por el agente.
- **Rama principal**: Siempre **`master`** en ambos repositorios (`talkingwithmyself-agent` y `cabrera-systems-blog`). Nunca usar `main`.

---

## 2. Repositorios y Rutas
- **Agente local**: `/Users/jesus/code/talkingwithmyself-agent`
- **Blog local**: `/Users/jesus/code/cabrera-systems-blog`
- **Base path del blog**: `/blog` (configurado en SvelteKit `paths: { base: '/blog' }`). La URL canónica es `https://cabrera.systems/blog`.

---

## 3. Modelo y Costo $0
- **Inferencia**: Claude Code vía CLI (`claude -p`).
- **Política de costo**: **$0 adicional**. Usar exclusivamente la suscripción de Claude. Nunca configurar APIs de pago ni llamadas a endpoints comerciales directos.
- **Autenticación headless en Pi**: Token de larga duración (1 año) en `CLAUDE_CODE_OAUTH_TOKEN` dentro de `/etc/twm/agent.env`.

---

## 4. Despliegue en Producción (Raspberry Pi 5)
- **Host**: `chch@raspberrypi.local`
- **Usuario de ejecución**: `twm` (`/var/lib/twm`)
- **Rutas en la Pi**:
  - Código: `/var/lib/twm/agent`
  - Datos: `/var/lib/twm/data`
  - Blog: `/var/lib/twm/blog`
  - Modelos Whisper: `/var/lib/twm/models/ggml-large-v3-turbo-q5_0.bin`
  - Variables de entorno: `/etc/twm/agent.env` (`root:twm`, `640`)
- **Servicios systemd**:
  - `twm.service`: Bot de Telegram activo 24/7 (`Nice=10`, `CPUQuota=300%`, `MemoryMax=3G`, `Restart=always`).
  - `twm-cleanup.timer`: Limpieza automática semestral (cada 1 de enero y 1 de julio a las 03:00 hrs) con `twm cleanup --days=180`.
- **Despliegue automatizado**:
  ```bash
  ./deploy/deploy-pi.sh
  ```

---

## 5. Reglas Editoriales y Pipeline
- **Anti-Alucinación estricta**: El revisor compara el borrador contra la transcripción cruda. Cero métricas, hechos o tecnologías inventadas no mencionadas en la nota o fotos.
- **Bilingüe (ES / EN)**: Redacción nativa adaptada en ambos idiomas, sin traducciones literales palabra por palabra.
- **Límites de difusión (Stage 5)**:
  - **X / Twitter**: Longitud total ≤ 280 caracteres (la URL canónica cuenta como 23 caracteres).
  - **Audiograma para X**: Video MP4 1080x1080 con onda naranja (`#f97316`) acotado a ≤ 140 segundos (límite de cuentas gratuitas de X).
- **Publicación de audio**: Opt-in por post (`publishAudio: true` para audio.mp3 en el blog web), pero los copies y audiogramas para redes sociales siempre se generan si hubo nota de voz.
