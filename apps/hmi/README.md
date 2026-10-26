# hmi

HMI web de Industrio. Una **HMI** (*Human-Machine Interface*) es la pantalla con la que un operador supervisa la planta: muestra el estado del proceso en tiempo real y deja claro, sin ambigüedad, cuándo los datos son confiables y cuándo no.

Esta HMI es una app Next.js con una sola pantalla de **vista general**. Consume en vivo el stream SSE del [gateway](../gateway/README.md) y nunca lee `latest.json`: depende solo del contrato de salida del gateway (`apiVersion: 1`).

```
Gateway  GET /api/stream (SSE)
   │  evento "state" (JSON, apiVersion 1)
   ▼
GatewayClient (src/lib/gateway-client.ts)    envuelve EventSource; sin React
   │  parseStateEvent (zod) → acción
   ▼
reduceHmi (src/lib/hmi-state.ts)             función pura: conexión + último estado + tendencia
   │  store externo (subscribe / getSnapshot)
   ▼
usePlantState() → useSyncExternalStore       hook React
   ▼
<PlantOverview/>
   ├── <CommStatusBar/>    comunicación, tiempo de juego, antigüedad del dato
   ├── <FurnacePanel/>     hornos por estado
   └── <ProductionPanel/>  total, por minuto y tendencia por ítem
```

La página es estática: Next.js solo sirve los archivos y el navegador se conecta **directo** al gateway. No hay rutas `app/api/*`, proxy ni renderizado con datos en el servidor.

## Qué muestra

- **Comunicación**: un indicador que combina los dos tramos (navegador ↔ gateway y gateway ↔ planta), el tiempo de juego, "Último cambio hace N s" y la URL del gateway.
- **Hornos**: total, barra apilada por estado y tabla con cantidad y porcentaje. Los estados anormales (`no_fuel`, `full_output`, etc.) se resaltan en ámbar.
- **Producción**: por ítem, total acumulado, producción por minuto de juego y una tendencia en vivo de los últimos 10 min de juego.

No hay alarmas con ciclo de vida, historial ni comandos: llegan en etapas posteriores.

---

## Requisitos

- Node.js 22 o superior.
- El gateway corriendo (por defecto en `http://127.0.0.1:4000`). Ver [`apps/gateway/README.md`](../gateway/README.md).

## Uso

Primero el gateway, después la HMI:

```powershell
# Terminal 1
cd apps/gateway
npm start

# Terminal 2
cd apps/hmi
npm install
npm run dev          # desarrollo, con recarga en caliente
```

Abrir **`http://localhost:3000`** (ver [por qué `localhost`](#por-qué-localhost3000)).

Para producción (build optimizado):

```powershell
npm run build
npm start
```

Otros scripts:

```powershell
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint (eslint-config-next)
npm test             # tests de la lógica pura (node:test + tsx)
```

`dev` y `start` escuchan solo en `localhost` (`-H localhost`): igual que el gateway, la HMI no se expone a la red sin una decisión explícita.

### Configuración

| Variable | Default | Descripción |
|---|---|---|
| `NEXT_PUBLIC_GATEWAY_URL` | `http://127.0.0.1:4000` | URL base del gateway: origen `http(s)` sin ruta ni barra final. Si es inválida, la pantalla muestra el motivo y no intenta conectarse. |

Las variables `NEXT_PUBLIC_*` se **incrustan en el código del navegador** al compilar: cambiarla requiere reiniciar `npm run dev` o volver a ejecutar `npm run build`.

En PowerShell:

```powershell
$env:NEXT_PUBLIC_GATEWAY_URL="http://127.0.0.1:4001"; npm run dev
```

### Por qué `localhost:3000`

El navegador solo deja que una página lea el stream del gateway si el gateway lo autoriza con CORS (*Cross-Origin Resource Sharing*). El gateway autoriza un único origen, `CORS_ORIGIN`, que por defecto es `http://localhost:3000`.

- Para el navegador, `http://localhost:3000` y `http://127.0.0.1:3000` son orígenes distintos. Además, con `-H localhost` Next.js puede escuchar solo en la dirección IPv6 (`::1`): en Windows se observó que `http://127.0.0.1:3000` directamente rechaza la conexión. Usar siempre `http://localhost:3000`.
- Si se cambia el puerto de la HMI (`npm run dev -- -p 3001`), hay que cambiar `CORS_ORIGIN` del gateway al mismo origen: `$env:CORS_ORIGIN="http://localhost:3001"; npm start`.
- Abrir la HMI desde otra máquina requiere exponer el gateway y ajustar CORS. Queda para una etapa futura, junto con la autenticación.

---

## Estados de comunicación

La HMI combina los dos tramos de comunicación en un solo indicador, con esta prioridad (de arriba hacia abajo):

| Mostrado | Condición | Severidad |
|---|---|---|
| Sin conexión con el gateway | Se cortó el stream después de haber recibido datos | crítica (rojo, ◆) |
| Conectando con el gateway… | Todavía no llegó ningún evento | info (gris, ○) |
| Versión de API incompatible | El evento no pasa la validación (`apiVersion` distinto de 1, JSON roto, forma inválida) | crítica |
| Sin datos de la planta | `link.status = no_data` | crítica |
| Telemetría incompatible | `link.status = incompatible` (el mod usa un `schema_version` que el gateway no conoce) | crítica |
| Planta sin respuesta | `link.status = stale` (juego pausado, cerrado o en el menú) | advertencia (ámbar, ▲) |
| En línea | `link.status = online` | normal (gris, ●) |

**Los valores solo se muestran como vigentes con "En línea".** En cualquier otro caso se atenúan con la leyenda "Último valor conocido" y su antigüedad. Si nunca hubo datos de la planta, se muestra "—" y un mensaje que explica por qué.

Reconexión: `EventSource` reintenta solo ante un corte (el gateway indica `retry: 2000`). Si el navegador abandona la conexión (por ejemplo, ante una respuesta HTTP que no es 200), el cliente la recrea a los 5 s. Hay una sola conexión SSE por pestaña, también con el doble montaje de React Strict Mode en desarrollo.

La antigüedad ("hace N s") se calcula con el reloj del navegador a partir de `link.lastTickChangeAt`, que pone el gateway. Se asume que ambos corren en la misma máquina, así que la diferencia de relojes es despreciable.

**Límite conocido**: si el proceso del gateway se cuelga sin cerrar la conexión, el navegador no se entera, porque los heartbeats del stream son comentarios SSE invisibles para `EventSource`. Resolverlo requiere un evento de heartbeat con nombre en el gateway.

---

## Tendencia en vivo

- Un punto por cada tick nuevo recibido, con la producción por minuto de cada ítem.
- Ventana fija de 10 min **de juego** (medida en ticks, como el gateway): el eje X termina en el último dato, así que la línea crece desde la derecha.
- Si el tick retrocede (se cargó otra partida), la tendencia se reinicia.
- Un valor `null` (el gateway todavía no puede calcular la tasa) corta la línea: no se dibuja como 0.
- El eje Y se ajusta a los valores de la ventana, con un alto mínimo del 10 % de su magnitud: una tasa estable se ve plana aunque varíe en los decimales, en vez de amplificar ese ruido a todo el alto del gráfico. Las etiquetas muestran los límites del eje.
- Vive **solo en memoria del navegador**: se pierde al recargar la página. El historial persistente es trabajo del historian (etapa 7).

---

## Diseño visual (ISA-101)

ISA-101 es la norma de diseño de HMIs industriales. Su idea central: **la pantalla es gris y tranquila cuando todo está normal; el color se reserva para lo anormal**, así lo anormal salta a la vista.

- Fondo y paneles en grises, sin degradados, sombras fuertes ni animaciones decorativas.
- Color solo para comunicación no normal (ámbar = advertencia, rojo = crítico) y estados anormales de hornos (ámbar). `working` es neutro.
- Nunca solo color: cada estado lleva texto y un símbolo (●, ○, ▲, ◆), legible para daltónicos.
- Números alineados a la derecha con dígitos de ancho fijo (`tabular-nums`) y unidades explícitas ("placas/min").
- La paleta está definida como variables CSS en `src/app/globals.css`; ningún otro archivo usa colores literales.
- Sin fuentes ni recursos de internet: la HMI funciona en una red aislada, como la de una planta.
- Usable a 1280×720 sin scroll horizontal; en pantallas angostas los paneles se apilan.

---

## Estructura

```
src/
├── app/            layout, página (server component) y estilos globales (paleta)
├── components/     PlantOverview ("use client") y paneles, con CSS Modules
├── hooks/          usePlantState (store externo) y useNow (reloj para antigüedades)
└── lib/            TypeScript puro, sin React ni Next
    ├── config.ts         NEXT_PUBLIC_GATEWAY_URL validada
    ├── contract.ts       esquema zod del contrato de salida v1
    ├── hmi-state.ts      reduceHmi, deriveCommStatus, mensajes
    ├── trend.ts          buffer de tendencia por tick
    ├── trend-chart.ts    geometría del gráfico de tendencia
    ├── furnaces.ts       desglose de hornos por estado
    ├── format.ts         números, tiempos y etiquetas en español
    └── gateway-client.ts EventSource → store externo
test/               un archivo *.test.ts por módulo de lib/
```

El esquema de `contract.ts` es una **copia** de la forma que define el gateway (`apps/gateway/src/domain/plant-state.ts`, fuente de verdad). No se importa código entre apps; cuando haya un segundo consumidor del contrato se extrae a `packages/`. El `apiVersion` estricto hace que una divergencia se vea como "Versión de API incompatible" en vez de datos mal interpretados.

## Decisiones

- **TypeScript ~5.9** (el gateway usa 7): `typescript-eslint`, que usa `eslint-config-next`, exige TypeScript < 6.1. Se fijó solo en esta app.
- **Sin librerías de gráficos ni de UI**: una línea por ítem se resuelve con un SVG propio.
- **Interfaz en español** con mapas de etiquetas para estados e ítems del juego. Un nombre sin traducir se muestra crudo (y un estado de horno desconocido se resalta como anormal): lo nuevo se ve sin cambiar código.
- Formato numérico `es-AR`, definido en una sola constante (`NUMBER_LOCALE` en `src/lib/format.ts`).
