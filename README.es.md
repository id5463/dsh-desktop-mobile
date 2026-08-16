# dshd — Red & Blue

GUI de escritorio nativa + control remoto para Android de [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) — el agente de codificación de IA de código abierto donde *todo es un plugin*.

> Proyecto de la comunidad, no es un producto oficial de DeepSeek.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Desktop](https://img.shields.io/badge/dshd-Red-E05252.svg)](red/)
[![Android](https://img.shields.io/badge/dshd-Blue-3DDC84.svg)](blue/)

**Idiomas:** [English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · Español · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

---

## Qué incluye

| | Aplicación de escritorio | Aplicación Android |
|---|---|---|
| Qué es | Ventana nativa de Electron con la Web UI oficial de DSH | Control remoto de tu DSH desde cualquier lugar |
| Instalación | Cero configuración: instala Node.js + DSH automáticamente en el primer inicio (con barra de progreso) | Instala el APK y escanea un código QR |
| Remoto | Código corto + emparejamiento QR, reenvío de puertos UPnP automático, WebRTC P2P | Descubrimiento automático en LAN + remoto por Internet |

### Escritorio

- **Inicio sin configuración**: si falta Node.js o DSH, la aplicación los descarga e instala automáticamente con barra de progreso. Doble clic y listo.
- **Web UI completa de DSH** en una ventana nativa, con bandeja del sistema, reinicio del servidor y cambio de idioma (中文 / English).
- **Compartir en LAN**: la aplicación hace de proxy de DSH hacia tu LAN (HTTP + WebSocket) y lo anuncia por mDNS, así tu teléfono lo encuentra automáticamente.
- **Emparejamiento remoto**: abre la ventana de conexión para ver un código corto (sin prefijo `dsh-`) y un código QR. Escanéalo desde la app del teléfono para conectar.
- **Acceso remoto sin configuración**: la aplicación puede reenviar automáticamente un puerto del router mediante UPnP y publicar tu IP pública, de modo que un teléfono por Internet llegue directamente sin tocar la configuración del router.
- **Respaldo WebRTC P2P**: cuando el acceso directo no es posible, se negocia automáticamente un canal punto a punto cifrado (con respaldo de retransmisión TURN).

### Android

- Escanea el código QR o escribe el código corto de la aplicación de escritorio.
- Descubrimiento automático de escritorios en el mismo Wi-Fi (mDNS).
- Web UI completa de DSH en tu teléfono: inicia tareas, observa el progreso del agente, aprueba llamadas a herramientas, envía seguimientos.
- Funciona por Internet mediante P2P/retransmisión: sin registro, sin cuenta, nada que configurar.

## Inicio rápido

### Escritorio

Requisito: Node.js ≥ 18 (la aplicación también puede preparar su propio runtime).

```bash
cd red
npm install
npm start
```

En el primer inicio la aplicación comprueba DSH, lo descarga si es necesario (barra de progreso) y abre la Web UI.

### Android

Usa el APK precompilado en `blue/dist/dshd-blue.apk` y haz sideload (habilita "instalar apps desconocidas"), o compílalo tú mismo:

```powershell
cd blue
.\build-apk-aapt.ps1    # genera dist/dshd-blue.apk, sin Android Studio/Gradle
```

Abre la app → la ventana de conexión del escritorio muestra un código + QR → escanea con el teléfono → conectado.

## Cómo funciona la conexión remota

1. El escritorio genera un código corto (p. ej. `K7X9`) y muestra un QR.
2. La señalización se intercambia por MQTT (un broker público gratuito por defecto; puedes apuntar ambas apps a tu propio broker).
3. El teléfono y el escritorio negocian una conexión WebRTC; si ambos están tras NAT, el reenvío de puertos UPnP o un relay TURN los conecta.
4. El tráfico fluye de extremo a extremo (o por el relay): sin cuenta, sin registro.

### Nota sobre las restricciones de puertos del ISP

La aplicación funciona en redes de banda ancha y móviles normales. Algunos ISP móviles (por ejemplo, la red de datos de China Mobile en la China continental) interceptan o bloquean de forma transparente los **puertos entrantes no estándar**; en esa red, una conexión entrante directa puede ser rechazada. Es una política del operador, no una limitación de la app: en esas redes usa una conexión LAN, otro operador, o apunta ambas apps a tu propio servidor MQTT/TURN.

## Estructura del proyecto

```
red/   Aplicación de escritorio Electron (Node.js, Electron, mqtt.js, simple-peer)
blue/   Aplicación Android (WebView Java, proxy local, escáner QR, mDNS, WebRTC)
```

## Hoja de ruta

- [ ] Servidor de retransmisión propio (relay WAN con tu propia infraestructura)
- [ ] Aplicación iOS
- [ ] Empaquetar lo remoto/puerta de enlace como un plugin instalable de `dsh` (`dsh plugin add`)
- [ ] Fusión de funciones de la comunidad (adoptar funciones con licencia MIT) — lista completa en [README.md](README.md#community-feature-merge-permissive-licenses)

## Seguridad

El acceso remoto expone tu DSH local a la red. La aplicación de escritorio solo habilita las funciones remotas al abrir la ventana de conexión; en esta versión temprana, para el acceso por Internet tras un router se intenta el reenvío de puertos UPnP al iniciar: asegúrate de confiar en tu red y considera desactivarlo en entornos públicos. Está prevista una capa de autenticación basada en tokens.

## Licencia

[MIT](LICENSE). Construido sobre [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT). No está afiliado ni respaldado por DeepSeek.
