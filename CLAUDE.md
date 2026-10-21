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
| 3. Dashboard web (Next.js) | **Siguiente** |
| 4. Servidor dedicado + RCON | Pendiente |
| 5. Primer comando remoto | Pendiente |
| 6. Historian y alarmas | Pendiente |
| 7. OPC-UA, MQTT Sparkplug B, AWS IoT Core | Pendiente |

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
    └── scada-reader/        # lector de consola (Node/TS)
        ├── package.json
        ├── tsconfig.json
        └── src/index.ts
```

Las aplicaciones nuevas van en `apps/<nombre>/` (por ejemplo `apps/hmi/` para el dashboard Next.js, `apps/gateway/` para el gateway de borde). Código compartido entre apps (por ejemplo, los tipos del contrato de datos) va en `packages/<nombre>/` cuando exista más de un consumidor; no antes.

## Componentes

### Mod `scada-bridge` (Lua)

- Archivo principal: `mods/scada-bridge/control.lua`.
- Usa `script.on_nth_tick(60, ...)`: una lectura por segundo de juego.
- Escribe con `helpers.write_file("scada-bridge/latest.json", helpers.table_to_json(snapshot), false)`. El archivo se sobrescribe; siempre contiene el último estado.
- Superficie `nauvis`, fuerza `player`.
- Los estados de entidad se traducen de `defines.entity_status` (número) a nombre legible con una tabla inversa construida al cargar.

### `scada-reader` (Node/TypeScript)

- ESM (`"type": "module"`), TypeScript estricto, ejecutado con `tsx`.
- Lee el archivo cada 1000 ms.
- Calcula producción por minuto de juego con la diferencia entre la muestra más vieja y la más nueva dentro de una ventana de 60 s de juego (en ticks, no en tiempo real).
- Marca la planta como **SIN RESPUESTA** si el `tick` no cambia durante 5 s reales.
- Si el `tick` retrocede (se cargó otra partida), descarta el historial.
- Tolera dos fallas esperables: el archivo todavía no existe (`ENOENT`) y JSON incompleto leído mientras el juego escribía (`SyntaxError`). En ambos casos reintenta en el próximo ciclo.
- Ruta de datos: detecta la carpeta por sistema operativo; se puede forzar con la variable de entorno `FACTORIO_DATA_DIR`.

## Contrato de datos

El JSON de `latest.json` es la interfaz entre el mod y todo lo demás. Forma actual:

```ts
interface Snapshot {
  schema_version: 1;                              // sube solo ante cambios incompatibles
  tick: number;                                   // 60 ticks = 1 s de juego
  furnaces: { total: number; by_status: Record<string, number> };
  production: { iron_plate_total: number; copper_plate_total: number };
}
```

Reglas:
- **Un cambio en el contrato requiere actualizar en el mismo cambio**: el mod, los tipos en TypeScript de cada consumidor y la sección "Contrato de datos" del README.
- Los totales de producción son **acumulados**; las tasas se calculan en el consumidor, no en el mod.
- `schema_version` (constante `SCHEMA_VERSION` en `control.lua`) se sube solo ante cambios incompatibles. Agregar campos nuevos no la cambia. Los consumidores rechazan versiones que no conocen.

## Comandos

```bash
# Lector
cd apps/scada-reader
npm install
npm start           # ejecutar
npm run dev         # modo watch
npm run typecheck   # tsc --noEmit — debe pasar sin errores antes de dar algo por terminado
```

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
6. **Transporte por archivo es temporal.** Es suficiente para las etapas 1–3. Las alternativas previstas son `helpers.send_udp` (requiere lanzar el juego con `--enable-lua-udp`) para telemetría y RCON para comandos. El consumidor debe quedar desacoplado del transporte (una interfaz de "fuente de snapshots") para poder cambiarlo sin tocar el resto.

## Cómo verificar un cambio

1. `npm run typecheck` sin errores en cada app modificada.
2. Si se tocó el mod: recargar la partida, confirmar que `latest.json` se actualiza cada segundo y que el contenido coincide con lo que muestra el juego (panel de producción, tecla **P**).
3. Si se tocó un consumidor: probarlo contra un `latest.json` de ejemplo (usando `FACTORIO_DATA_DIR` apuntando a una carpeta temporal) y, cuando sea posible, contra la partida real.
4. Comprobar los casos de borde: archivo inexistente, juego pausado (debe pasar a SIN RESPUESTA), cambio de partida (historial reiniciado).
5. Actualizar README y este archivo si cambió el estado, la estructura, el contrato o las decisiones.

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
