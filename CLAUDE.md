# CLAUDE.md — Industrio

Guía para agentes de IA que trabajan en este repositorio. Leela completa antes de hacer cambios.

## Qué es el proyecto

Industrio es un sistema SCADA de práctica que usa una partida de **Factorio 2.0** como planta industrial simulada. Un mod en Lua exporta el estado de la fábrica; aplicaciones externas en Node/TypeScript lo leen, lo procesan y lo presentan como lo haría el sistema de supervisión de una planta real. La meta es supervisión **y** control (comandos hacia el juego), con alarmas, historial y auditoría.

Es un proyecto de portfolio orientado a roles de **IoT/IIoT Backend Developer**. El valor del proyecto está en la arquitectura de adquisición de datos, supervisión y control, no en el juego. Toda decisión debe poder explicarse en términos de un sistema industrial real.

## Contexto del autor

- El autor es desarrollador fullstack (React, Next.js, TypeScript, Node.js, PostgreSQL) y está aprendiendo el dominio industrial (SCADA, OPC-UA, MQTT, Lua de Factorio).
- Se avanza **paso a paso**: cada etapa debe quedar funcionando y verificada antes de empezar la siguiente.
- Al introducir un concepto nuevo (RCON, OPC-UA, Sparkplug, historian, interlock), explicalo brevemente y en lenguaje simple antes de usarlo.
- Comunicación con el autor en **español**. Evaluaciones directas y realistas; si algo es mala idea o tiene riesgos, decirlo.

## Estado actual

| Etapa | Estado |
|---|---|
| 1. Mod exporta telemetría a JSON | Funcionando, verificado en partida real |
| 2. Lector en consola (Node/TS) | Funcionando, verificado en partida real |
| 3. Gateway de telemetría (HTTP + SSE) | Implementado, verificado con datos simulados; **falta verificar en partida real** |
| 4. Dashboard web (Next.js) | **Siguiente** |
| 5. Servidor dedicado + RCON | Pendiente |
| 6. Primer comando remoto | Pendiente |
| 7. Historian y alarmas | Pendiente |
| 8. OPC-UA, MQTT Sparkplug B, AWS IoT Core | Pendiente |

Versión de Factorio del autor: **2.0.77**. Usá la documentación de la API de esa versión: https://lua-api.factorio.com/2.0.77/

## Estructura del repositorio

```
industrio/
├── README.md
├── CLAUDE.md
├── mods/
│   └── scada-bridge/        # mod de Factorio (Lua) — nombre interno "scada-bridge"
│       ├── info.json
│       └── control.lua
└── apps/
    ├── gateway/             # gateway de telemetría (Node/TS): validación, estado, HTTP + SSE
    │   ├── README.md        # configuración, API y contrato de salida
    │   ├── src/
    │   │   ├── index.ts     # arranque, conexión de piezas, apagado ordenado
    │   │   ├── config.ts    # variables de entorno validadas con zod
    │   │   ├── logger.ts
    │   │   ├── domain/      # snapshot.ts (esquema del mod), rates.ts (puras), plant-state.ts (store)
    │   │   ├── sources/     # SnapshotSource (interfaz) y FileSnapshotSource
    │   │   └── http/        # server.ts (rutas, CORS) y sse.ts (clientes SSE)
    │   └── test/            # node:test, un archivo *.test.ts por módulo
    └── scada-reader/        # lector de consola (Node/TS)
        ├── package.json
        ├── tsconfig.json
        └── src/index.ts
```

Las aplicaciones nuevas van en `apps/<nombre>/` (por ejemplo `apps/hmi/` para el dashboard Next.js). Código compartido entre apps (por ejemplo, los tipos del contrato de datos) va en `packages/<nombre>/` cuando exista más de un consumidor; no antes.

## Componentes

### Mod `scada-bridge` (Lua)

- Archivo principal: `mods/scada-bridge/control.lua`.
- Usa `script.on_nth_tick(60, ...)`: una lectura por segundo de juego.
- Escribe con `helpers.write_file("scada-bridge/latest.json", helpers.table_to_json(snapshot), false)`. El archivo se sobrescribe; siempre contiene el último estado.
- Superficie `nauvis`, fuerza `player`.
- Los estados de entidad se traducen de `defines.entity_status` (número) a nombre legible con una tabla inversa construida al cargar.

### `gateway` (Node/TypeScript)

Servicio continuo; detalle completo en `apps/gateway/README.md`.

- ESM, TypeScript estricto, ejecutado con `tsx`. Node 22+. Única dependencia de producción: `zod`. HTTP con `node:http`, sin framework.
- Flujo: `SnapshotSource` → `parseSnapshot` (zod) → `PlantStateStore` → `SseBroadcaster` / endpoints.
- `SnapshotSource` desacopla el transporte (decisión 6). Entrega JSON crudo o una falla clasificada (`missing`, `partial`, `error`); la validación es del dominio. Hoy la única implementación es `FileSnapshotSource` (polling, sin lecturas superpuestas).
- Validación: acepta solo `schema_version: 1`; los campos desconocidos se ignoran. `production` se normaliza quitando el sufijo `_total`.
- Estado del enlace: `no_data`, `incompatible`, `online`, `stale`. El primer snapshot tras arrancar queda en `stale` hasta ver avanzar el tick (no afirmar comunicación no confirmada). Ante `incompatible` y `no_data` se conserva el último estado válido.
- Tasas: funciones puras en `rates.ts`, en ticks, generalizadas por nombre de ítem. El historial se vacía si el tick retrocede.
- `PlantStateStore` notifica solo cuando cambia el tick o el estado del enlace. Reloj y logger inyectables para tests.
- Endpoints: `GET /health`, `GET /api/state`, `GET /api/stream` (SSE con evento inicial, `id` incremental, heartbeat de 15 s). CORS con `CORS_ORIGIN`. Escucha en `127.0.0.1:4000` por defecto, sin autenticación.
- Logs: se registran cambios (de estado, de motivo de error), no cada ciclo de lectura.

### `scada-reader` (Node/TypeScript)

Lector de consola previo al gateway. Lee el archivo directamente y no valida `schema_version`. Fuera del alcance actual: no modificarlo hasta decidir si se elimina o pasa a ser cliente del gateway.

- ESM (`"type": "module"`), TypeScript estricto, ejecutado con `tsx`.
- Lee el archivo cada 1000 ms.
- Calcula producción por minuto de juego con la diferencia entre la muestra más vieja y la más nueva dentro de una ventana de 60 s de juego (en ticks, no en tiempo real).
- Marca la planta como **SIN RESPUESTA** si el `tick` no cambia durante 5 s reales.
- Si el `tick` retrocede (se cargó otra partida), descarta el historial.
- Tolera dos fallas esperables: el archivo todavía no existe (`ENOENT`) y JSON incompleto leído mientras el juego escribía (`SyntaxError`). En ambos casos reintenta en el próximo ciclo.
- Ruta de datos: detecta la carpeta por sistema operativo; se puede forzar con la variable de entorno `FACTORIO_DATA_DIR`.

## Contrato de datos

Hay dos contratos, y los clientes solo dependen del segundo:

1. **Mod → gateway**: el JSON de `latest.json` (abajo). Hoy lo leen el gateway y, de forma directa, `scada-reader`.
2. **Gateway → clientes**: el contrato de salida con `apiVersion` (hoy `1`), documentado en `apps/gateway/README.md` y definido en `apps/gateway/src/domain/plant-state.ts`. El dashboard y cualquier cliente nuevo consumen este, **nunca** `latest.json`.

Forma actual de `latest.json`:

```ts
interface Snapshot {
  schema_version: 1;                              // sube solo ante cambios incompatibles
  tick: number;                                   // 60 ticks = 1 s de juego
  furnaces: { total: number; by_status: Record<string, number> };
  production: { iron_plate_total: number; copper_plate_total: number };
}
```

Reglas:
- **Un cambio en el contrato del mod requiere actualizar en el mismo cambio**: el mod, el esquema zod del gateway (`domain/snapshot.ts`) y la sección "Contrato de datos" del README.
- Los totales de producción son **acumulados**; las tasas se calculan en el gateway, no en el mod.
- `schema_version` (constante `SCHEMA_VERSION` en `control.lua`) se sube solo ante cambios incompatibles. Agregar campos nuevos no la cambia. El gateway rechaza versiones que no conoce (enlace `incompatible`).
- Un cambio incompatible en el contrato de salida sube `apiVersion` y requiere actualizar `apps/gateway/README.md` y los clientes. Agregar campos no lo sube.

## Comandos

```bash
# Gateway
cd apps/gateway
npm install
npm start           # ejecutar (http://127.0.0.1:4000)
npm run dev         # modo watch
npm run typecheck   # tsc --noEmit — debe pasar sin errores antes de dar algo por terminado
npm test            # tsx --test "test/**/*.test.ts" — debe pasar antes de dar algo por terminado

# Lector de consola
cd apps/scada-reader
npm install
npm start
npm run typecheck
```

El autor usa Windows con PowerShell: los scripts de `package.json` no deben usar sintaxis de variables de entorno de un shell concreto, y en la documentación se usa `$env:VAR="valor"; npm start` y `curl.exe` (no `curl`).

El mod no tiene build: se instala copiando o enlazando `mods/scada-bridge/` dentro de `<datos de Factorio>/mods/`. Tras modificar `control.lua` hay que recargar la partida (o reiniciar el juego si cambió `info.json`).

## Convenciones

### General
- Cambios pequeños, verificables y que dejen el sistema funcionando.
- No agregar dependencias sin justificarlo; preferir la librería estándar de Node.
- Configuración por variables de entorno con valores por defecto razonables; nunca rutas absolutas de una máquina concreta en el código.
- Comentarios en español, breves, explicando el *por qué*. Identificadores en inglés.
- No commitear `node_modules/`, salidas de `script-output/` ni partidas (`.zip`).

### TypeScript
- `strict: true`. Sin `any`; usar `unknown` y validar.
- ESM con `module`/`moduleResolution` `NodeNext`; imports de Node con prefijo `node:`.
- Tipos explícitos para el contrato de datos.
- Manejo de errores explícito: distinguir fallas esperables (reintentar) de inesperadas (registrar y propagar).
- Toda entrada externa (archivos, variables de entorno, en el futuro RCON/UDP) se valida con `zod` en tiempo de ejecución.
- Tests con `node:test` + `node:assert/strict`, ejecutados con `tsx --test`, en `apps/<app>/test/*.test.ts`. La lógica de dominio va en funciones puras o clases con reloj y logger inyectables, para testearla sin timers ni archivos.

### Lua (mod)
- Variables y funciones `local`. Nada en el ámbito global salvo lo que exige la API de Factorio.
- Constantes de configuración en MAYÚSCULAS al inicio del archivo.
- Verificar validez de objetos del juego (`entity.valid`, existencia de superficie) antes de usarlos.
- **Rendimiento**: el mod corre dentro del bucle del juego. No escanear todas las entidades del mapa en cada tick. Para telemetría por entidad, usar un registro de entidades marcadas (por nombre o por selección del jugador) y muestrear a intervalos de 1–2 s como mínimo.
- Al cambiar el comportamiento, subir `version` en `info.json` (semver).

## Decisiones de diseño (no revertir sin discutir con el autor)

1. **Partida dedicada al proyecto.** Nunca asumir ni modificar la partida personal del autor.
2. **Comandos acotados, no Lua arbitrario.** Cuando se implemente el control por RCON, el mod registrará comandos propios con validación (por ejemplo `/industrio-power-switch <id> on|off`). El gateway solo invocará esos comandos. No ejecutar `/c` ni `/sc` con código arbitrario desde servicios externos.
3. **Separación supervisión / control local.** Como en una planta real, el SCADA escribe *setpoints* (por ejemplo, valores en combinadores constantes) y la lógica local la resuelven los circuitos del juego. El acceso directo a entidades queda reservado para comandos discretos (interruptores, habilitar/deshabilitar).
4. **Todo comando se audita**: quién, qué, cuándo, resultado.
5. **Interlocks antes que comandos peligrosos**: no implementar un comando que pueda dejar la planta inoperable (por ejemplo, cortar la energía de las bombas de agua de las calderas) sin una regla que lo bloquee.
6. **Transporte por archivo es temporal.** Es suficiente para las etapas 1–4 (hasta el dashboard). Las alternativas previstas son `helpers.send_udp` (requiere lanzar el juego con `--enable-lua-udp`) para telemetría y RCON para comandos. El consumidor debe quedar desacoplado del transporte (una interfaz de "fuente de snapshots") para poder cambiarlo sin tocar el resto. En el gateway esa interfaz es `SnapshotSource` (`apps/gateway/src/sources/`).
7. **Los clientes consumen el contrato del gateway (`apiVersion`), nunca el JSON del mod.** Así el mod y el transporte pueden cambiar sin romper a los clientes.

## Cómo verificar un cambio

1. `npm run typecheck` sin errores en cada app modificada, y `npm test` en verde donde haya tests (gateway).
2. Si se tocó el mod: recargar la partida, confirmar que `latest.json` se actualiza cada segundo y que el contenido coincide con lo que muestra el juego (panel de producción, tecla **P**).
3. Si se tocó un consumidor: probarlo contra un `latest.json` de ejemplo (usando `FACTORIO_DATA_DIR` apuntando a una carpeta temporal) y, cuando sea posible, contra la partida real. Para el gateway: `curl.exe http://127.0.0.1:4000/api/state` y `curl.exe -N http://127.0.0.1:4000/api/stream`.
4. Comprobar los casos de borde: archivo inexistente (`no_data`), juego pausado (`stale` en el gateway, SIN RESPUESTA en el lector), cambio de partida (historial reiniciado, tasas en `null`), `schema_version` desconocido (`incompatible`), Ctrl+C con un cliente SSE conectado (sale con código 0).
5. Al probar procesos en segundo plano, confirmar que quedaron detenidos: en Windows, matar el proceso desde Git Bash puede dejar huérfano al `node.exe` real.
6. Actualizar README (raíz y de la app) y este archivo si cambió el estado, la estructura, el contrato o las decisiones.

## Lo que no hay que hacer

- No escribir en la carpeta de datos de Factorio salvo dentro de `mods/scada-bridge/` (instalación del mod).
- No reemplazar el contrato de datos de forma incompatible sin actualizar todos los consumidores.
- No introducir infraestructura (Docker, AWS, bases de datos) antes de la etapa que la requiere.
- No presentar el proyecto como "un dashboard de un videojuego": la documentación habla de planta, telemetría, supervisión y control.

## Referencias

- API de Factorio 2.0.77: https://lua-api.factorio.com/2.0.77/
- `LuaHelpers` (`write_file`, `table_to_json`, `send_udp`): https://lua-api.factorio.com/2.0.77/classes/LuaHelpers.html
- `LuaFlowStatistics` (estadísticas de producción): https://lua-api.factorio.com/2.0.77/classes/LuaFlowStatistics.html
- `LuaEntity` (estado, `power_switch_state`, `trains_limit`, `active`): https://lua-api.factorio.com/2.0.77/classes/LuaEntity.html
- `LuaSchedule` (itinerarios de trenes): https://lua-api.factorio.com/2.0.77/classes/LuaSchedule.html
- Mods similares existentes (solo lectura, Prometheus/Grafana): graftorio3, statfactory. Industrio se diferencia por el control, las alarmas y los protocolos industriales.
