# gateway

Gateway de telemetría de Industrio. Es la pieza "cerca de la máquina" del sistema de supervisión: lee el estado de la planta que exporta el mod `scada-bridge`, lo valida, calcula datos derivados (tasas de producción, estado del enlace) y lo expone por HTTP para que otros clientes lo consuman en tiempo real.

```
Factorio + scada-bridge
   │  escribe latest.json cada 1 s de juego
   ▼
SnapshotSource (hoy: FileSnapshotSource, polling cada 1 s)
   │  JSON crudo o falla clasificada (archivo inexistente, JSON incompleto, error)
   ▼
Validación (zod, schema_version = 1)
   ▼
PlantStateStore ── estado actual, historial para tasas, estado del enlace
   │  notifica solo cuando cambia el tick o el estado del enlace
   ▼
HTTP (node:http)
   ├── GET /health
   ├── GET /api/state
   └── GET /api/stream   (Server-Sent Events)
```

La fuente de datos está detrás de la interfaz `SnapshotSource`: cambiar el archivo por UDP u otro transporte no toca la validación, el estado ni la API.

En etapas futuras el gateway también va a enviar comandos por RCON y publicar por OPC-UA y MQTT. Hoy es solo lectura.

---

## Requisitos

- Node.js 22 o superior.
- El mod `scada-bridge` 0.3.0 o superior (el que incluye `schema_version`) instalado en la partida del proyecto. Ver el [README raíz](../../README.md).

## Uso

```powershell
cd apps/gateway
npm install
npm start           # ejecutar
npm run dev         # recarga al modificar el código
npm run typecheck   # verificación de tipos
npm test            # tests automatizados
```

Al arrancar, el gateway muestra la configuración efectiva. Para detenerlo, Ctrl+C: deja de leer el archivo, cierra las conexiones abiertas y sale con código 0.

### Configuración

Todas las variables son opcionales. Se validan al arrancar; si alguna es inválida, el proceso termina con un mensaje que indica cuál y por qué.

| Variable | Default | Descripción |
|---|---|---|
| `FACTORIO_DATA_DIR` | según sistema operativo | Carpeta de datos de Factorio. Windows `%APPDATA%\Factorio`, Linux `~/.factorio`, macOS `~/Library/Application Support/factorio`. |
| `GATEWAY_HOST` | `127.0.0.1` | Interfaz de escucha. Por defecto solo acepta conexiones de la misma máquina. |
| `GATEWAY_PORT` | `4000` | Puerto HTTP. |
| `POLL_INTERVAL_MS` | `1000` | Frecuencia de lectura del archivo (100 a 60000). |
| `STALE_AFTER_MS` | `5000` | Tiempo sin cambios de tick para marcar el enlace como `stale`. Debe ser mayor que `POLL_INTERVAL_MS`. |
| `RATE_WINDOW_SECONDS` | `60` | Ventana de cálculo de tasas, en segundos **de juego** (1 a 3600). |
| `CORS_ORIGIN` | `http://localhost:3000` | Origen web autorizado (donde corre la HMI, `apps/hmi`). Formato `esquema://host:puerto`, sin barra final. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` o `error`. |

En PowerShell:

```powershell
$env:GATEWAY_PORT="4001"; npm start
```

La variable queda definida en esa ventana de PowerShell hasta cerrarla. Para quitarla: `Remove-Item Env:GATEWAY_PORT`.

Para probar sin el juego, se puede apuntar a una carpeta temporal con un `latest.json` escrito a mano en `<carpeta>\script-output\scada-bridge\latest.json`:

```powershell
$env:FACTORIO_DATA_DIR="C:\temp\factorio-prueba"; npm start
```

---

## API HTTP

| Método y ruta | Respuesta |
|---|---|
| `GET /health` | `200` `{ "status": "ok", "uptimeSeconds": 42 }`. Indica que el proceso está vivo, no que la planta responda. |
| `GET /api/state` | `200` con el [contrato de salida](#contrato-de-salida-apiversion-1). |
| `GET /api/stream` | `200` `text/event-stream`. Ver [Stream SSE](#stream-sse-apistream). |
| `OPTIONS` en cualquier ruta anterior | `204` (consulta previa de CORS). |
| Otro método en una ruta existente | `405` `{ "error": "method_not_allowed" }`, con encabezado `Allow: GET, OPTIONS`. |
| Ruta inexistente | `404` `{ "error": "not_found" }`. |

Todas las respuestas incluyen `Access-Control-Allow-Origin` con el valor de `CORS_ORIGIN`. Las respuestas JSON llevan `Cache-Control: no-store`.

En PowerShell usar `curl.exe` (`curl` a secas es un alias de otro comando):

```powershell
curl.exe http://127.0.0.1:4000/health
curl.exe http://127.0.0.1:4000/api/state
curl.exe -N http://127.0.0.1:4000/api/stream
```

### Stream SSE (`/api/stream`)

Server-Sent Events: una respuesta HTTP que queda abierta y por la que el servidor envía eventos de texto. El flujo es de un solo sentido (gateway → cliente), que es lo que necesita la supervisión; los comandos futuros irán por solicitudes HTTP normales.

- Al conectarse, el cliente recibe **de inmediato** el estado actual como evento `state`.
- Después, un evento `state` cada vez que cambia el `tick` o `link.status`. Nunca se reenvía un estado idéntico: con el juego pausado solo llegan heartbeats.
- Cada evento lleva un `id` incremental. El evento inicial repite el `id` del último evento difundido, porque es el mismo estado.
- Cada 15 s se envía un comentario `: ping` para que proxies y navegadores no cierren la conexión por inactividad.
- `retry: 2000`: si la conexión se corta, el navegador reintenta a los 2 s.
- Un cliente que no consume los eventos (más de 1 MB pendiente de envío) se desconecta para no acumular memoria.

Ejemplo de lo que se recibe:

```
retry: 2000

id: 4
event: state
data: {"apiVersion":1,"link":{"status":"online",...},"plant":{...}}

: ping
```

Desde un navegador:

```js
const source = new EventSource("http://127.0.0.1:4000/api/stream");
source.addEventListener("state", (event) => {
  const state = JSON.parse(event.data);
  console.log(state.link.status, state.plant?.tick);
});
```

**Latencia**: el juego escribe una vez por segundo de juego y el gateway lee una vez por segundo, así que un cambio en la planta llega a los clientes en unos 2 s como máximo. Es aceptable para supervisión; no para control de lazo cerrado.

---

## Contrato de salida (`apiVersion` 1)

Es un contrato **propio del gateway**, independiente del JSON que escribe el mod. Los clientes dependen de este, nunca de `latest.json`: así el mod puede cambiar su formato (o el transporte) sin romper a los clientes.

```json
{
  "apiVersion": 1,
  "link": {
    "status": "online",
    "lastTickChangeAt": "2026-10-21T18:04:12.000Z",
    "lastReadAt": "2026-10-21T18:04:12.500Z"
  },
  "plant": {
    "tick": 69840,
    "gameTimeSeconds": 1164,
    "furnaces": {
      "total": 48,
      "byStatus": { "working": 33, "no_fuel": 15 }
    },
    "production": {
      "iron_plate": { "total": 203, "perMinute": 120.5 },
      "copper_plate": { "total": 0, "perMinute": null }
    }
  }
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `apiVersion` | `1` | Versión de este contrato. Sube solo ante cambios incompatibles. |
| `link.status` | texto | Estado del enlace con la planta (ver tabla siguiente). |
| `link.lastTickChangeAt` | fecha ISO o `null` | Última vez que el gateway vio avanzar el tick. `null` hasta verlo avanzar por primera vez. |
| `link.lastReadAt` | fecha ISO o `null` | Última lectura de un snapshot **válido**. Sigue actualizándose con el juego pausado (el archivo se lee aunque no cambie); no se actualiza mientras el enlace está en `incompatible`. |
| `plant` | objeto o `null` | Último estado válido conocido. `null` solo si nunca hubo un snapshot válido. Se conserva en `incompatible` y `no_data`, así que hay que mirar `link.status` antes de confiar en él. |
| `plant.tick` | entero | Reloj de la partida. 60 ticks = 1 s de juego. |
| `plant.gameTimeSeconds` | entero | `tick / 60`, redondeado hacia abajo. |
| `plant.furnaces.total` | entero | Cantidad de hornos. |
| `plant.furnaces.byStatus` | objeto | Hornos por estado del juego (`working`, `no_fuel`, `full_output`, ...). Solo aparecen los estados presentes. |
| `plant.production.<item>.total` | número | Producción acumulada desde el inicio de la partida. |
| `plant.production.<item>.perMinute` | número o `null` | Producción por minuto **de juego**, sin redondear. `null` mientras no haya dos muestras para comparar. |

Fechas en ISO 8601 UTC. Claves en camelCase, salvo los nombres que vienen del juego (estados de entidad, nombres de ítems), que se conservan tal cual. Los ítems de `production` salen de los campos `<item>_total` del mod, sin el sufijo: un ítem nuevo en el mod aparece en la API sin cambiar el gateway.

### Estado del enlace

| `link.status` | Condición |
|---|---|
| `no_data` | El archivo no existe, o nunca se leyó un snapshot válido. |
| `incompatible` | El archivo existe pero no pasa la validación (por ejemplo, `schema_version` desconocido). Se conserva el último estado válido. |
| `online` | El tick avanzó en los últimos `STALE_AFTER_MS`. |
| `stale` | Hay un snapshot válido pero el tick no avanza hace más de `STALE_AFTER_MS`: juego pausado, cerrado o en el menú. |

Detalles:

- **Al arrancar, el primer snapshot queda en `stale`** hasta ver avanzar el tick. El archivo puede ser de una partida ya cerrada, y el gateway no afirma comunicación que no confirmó. Con el juego corriendo, pasa a `online` en un segundo.
- Si el **tick retrocede** (se cargó otra partida), el historial de tasas se vacía: `perMinute` vuelve a `null` y se recalcula con muestras de la partida nueva.
- Un **JSON incompleto** (el gateway leyó el archivo mientras el juego lo escribía) no cambia el estado: se descarta y se reintenta en el próximo ciclo. Se cuenta y, con `LOG_LEVEL=debug`, se registra.

---

## Validación de la entrada

El `latest.json` es entrada externa y se valida en cada lectura con [zod](https://zod.dev):

- `schema_version` debe ser exactamente `1`. Cualquier otro valor, o su ausencia, pasa el enlace a `incompatible`.
- Los campos conocidos se validan con su tipo: `tick` y los conteos de hornos son enteros no negativos; los totales de producción, números no negativos.
- Los campos desconocidos se ignoran. Agregar un campo al mod no sube `schema_version`, así que no debe tirar abajo el enlace.

El contrato de entrada está documentado en el [README raíz](../../README.md#contrato-de-datos-latestjson).

## Logs

Una línea por evento: `<fecha ISO> <NIVEL> <mensaje> <contexto JSON>`. `debug` e `info` van a la salida estándar; `warn` y `error`, a la de errores.

Se registran los cambios, no cada lectura:

- `info`: arranque, cambios de estado del enlace, tick que retrocede, clientes SSE que se conectan o desconectan, apagado.
- `warn`: snapshot incompatible (una vez por motivo, no en cada ciclo), carpeta de datos inexistente.
- `error`: fallas inesperadas de lectura (una vez hasta que se recupera), puerto ocupado.
- `debug`: cada solicitud HTTP y cada JSON incompleto descartado.

## Estructura

```
src/
├── index.ts                 # arranque, conexión de las piezas y apagado ordenado
├── config.ts                # variables de entorno con defaults y validación
├── logger.ts                # logger mínimo con niveles
├── domain/
│   ├── snapshot.ts          # esquema zod del contrato del mod
│   ├── rates.ts             # historial y tasas por minuto de juego (funciones puras)
│   └── plant-state.ts       # PlantStateStore y contrato de salida
├── sources/
│   ├── snapshot-source.ts   # interfaz SnapshotSource
│   └── file-source.ts       # lectura del archivo por polling
└── http/
    ├── server.ts            # rutas, CORS y errores
    └── sse.ts               # clientes SSE, difusión y heartbeat
test/                        # node:test, ejecutado con tsx --test
```

## Decisiones

| Decisión | Motivo |
|---|---|
| `node:http` sin framework | Tres endpoints y SSE no justifican una dependencia. |
| `zod` como única dependencia de producción | Validación en tiempo de ejecución y tipos desde un solo esquema. |
| Polling en vez de `fs.watch` | `fs.watch` es poco confiable en Windows con archivos que se sobrescriben. El juego escribe a 1 Hz; leer a 1 Hz alcanza. |
| SSE en vez de WebSocket | El flujo es de un solo sentido. SSE funciona sobre HTTP normal y el navegador reconecta solo. |
| Escuchar en `127.0.0.1` | No exponer el servicio a la red local sin una decisión explícita. No hay autenticación. |
| Tasas en ticks, no en tiempo real | Con el juego pausado o lento, el tiempo real no refleja la producción. |
