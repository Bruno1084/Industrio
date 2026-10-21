# Industrio

**Un sistema SCADA de práctica que usa una fábrica de Factorio como planta industrial simulada.**

Industrio lee en tiempo real el estado de una partida de Factorio (máquinas, producción, energía, trenes) y lo presenta como lo haría el sistema de supervisión de una planta real. El objetivo final es cerrar el lazo de control: que un operador pueda supervisar *y* actuar sobre la fábrica (abrir interruptores, habilitar estaciones de tren, cambiar setpoints) desde una interfaz externa, con alarmas, historial y auditoría.

> Proyecto de portfolio orientado a IoT/IIoT backend. Factorio cumple el rol de planta simulada; el foco del proyecto está en la arquitectura de adquisición de datos, supervisión y control.

---

## Estado actual

| Etapa | Descripción | Estado |
|---|---|---|
| 1 | Mod de Factorio que exporta telemetría a un archivo JSON | ✅ Funcionando |
| 2 | Lector externo en Node/TypeScript (consola) | ✅ Funcionando |
| 3 | Gateway de telemetría: validación, estado del enlace, API HTTP y stream SSE | ✅ Funcionando |
| 4 | Dashboard web (Next.js) | ⏳ Siguiente |
| 5 | Partida en servidor dedicado + canal de comandos (RCON) | Pendiente |
| 6 | Primer control remoto (interruptor de energía, estaciones) | Pendiente |
| 7 | Historian (base de series temporales) y alarmas | Pendiente |
| 8 | Protocolos industriales (OPC-UA, MQTT Sparkplug B) y AWS IoT Core | Pendiente |

---

## Arquitectura

### Actual

```
┌──────────────────────────┐   escribe cada 1 s   ┌─────────────────────────────┐
│  Factorio 2.0            │ ───────────────────▶ │ script-output/scada-bridge/ │
│  + mod "scada-bridge"    │                      │ latest.json                 │
└──────────────────────────┘                      └──────────────┬──────────────┘
                                                                 │ lee cada 1 s
                                       ┌─────────────────────────┴─────────┐
                                       ▼                                   ▼
                     ┌──────────────────────────────────┐   ┌────────────────────────────┐
                     │ gateway (Node/TS)                │   │ scada-reader (Node/TS)     │
                     │ validación, estado del enlace,   │   │ consola, lectura directa   │
                     │ tasas de producción              │   └────────────────────────────┘
                     └────────────────┬─────────────────┘
                                      │ HTTP + SSE (127.0.0.1:4000)
                                      ▼
                     clientes: dashboard (próximo), curl, ...
```

El gateway publica un contrato propio (`apiVersion`) y los clientes dependen de ese, no del JSON del mod. `scada-reader` sigue leyendo el archivo directamente; su futuro (eliminarlo o convertirlo en cliente del gateway) está pendiente de decidir.

### Objetivo

```
Factorio (servidor dedicado)
   │  telemetría (archivo/UDP)        ▲ comandos (RCON → comandos registrados por el mod)
   ▼                                  │
Gateway de borde (Node/TS) ── OPC-UA server / MQTT Sparkplug B
   │
   ├── Historian (TimescaleDB) ── motor de alarmas ── auditoría de comandos
   │
   ├── HMI web (Next.js): pantallas de proceso, tendencias, alarmas, comandos
   │
   └── AWS IoT Core (telemetría hacia la nube, comandos nube → borde)
```

---

## Componentes

### `scada-bridge` (mod de Factorio, Lua)

Cada 60 ticks (1 segundo de juego) escribe un snapshot del estado de la fábrica en `script-output/scada-bridge/latest.json`, sobrescribiendo el anterior.

Datos actuales:
- Hornos: total y cantidad por estado real del juego (`working`, `no_fuel`, `no_input_fluid`, `full_output`, etc.).
- Producción acumulada de placas de hierro y cobre.

### `gateway` (Node.js / TypeScript)

Servicio continuo que lee la telemetría, la valida, calcula datos derivados y los expone por HTTP:
- `GET /api/state`: estado actual de la planta (hornos, producción con tasas por minuto de juego, estado del enlace).
- `GET /api/stream`: Server-Sent Events; empuja el estado cada vez que cambia el tick o el estado del enlace.
- `GET /health`: el proceso está vivo.

Estados del enlace: `no_data`, `incompatible` (el archivo no pasa la validación), `online` y `stale` (el tick no avanza: juego pausado, cerrado o en el menú). Detalles, configuración y contrato de salida en [`apps/gateway/README.md`](apps/gateway/README.md).

### `scada-reader` (Node.js / TypeScript)

Lee el archivo cada segundo y muestra en consola:
- Estado de hornos por categoría.
- Producción por minuto de juego (calculada a partir de los totales acumulados en una ventana de 60 s).
- Estado del enlace: **EN LINEA** o **SIN RESPUESTA** si el reloj del juego no avanza durante 5 s (juego pausado, cerrado o en el menú).

---

## Requisitos

- **Factorio 2.0** (desarrollado y probado en 2.0.77).
- **Node.js 22** o superior.
- Una partida dedicada al proyecto (los mods desactivan logros). Se recomienda mapa sin enemigos o en modo pacífico.

---

## Instalación y uso

### 1. Instalar el mod

1. Ubicá la carpeta de datos de Factorio:
   - Windows: `%APPDATA%\Factorio`
   - Linux: `~/.factorio`
   - macOS: `~/Library/Application Support/factorio`
2. Copiá la carpeta `mods/scada-bridge/` del repositorio dentro de `<datos de Factorio>/mods/`.
   Para desarrollo es preferible un enlace simbólico, así los cambios del repo se reflejan sin copiar:
   - Windows (cmd): `mklink /J "%APPDATA%\Factorio\mods\scada-bridge" "<ruta-al-repo>\mods\scada-bridge"`
   - Linux/macOS: `ln -s <ruta-al-repo>/mods/scada-bridge ~/.factorio/mods/scada-bridge`
3. Abrí Factorio → **Mods** → verificá que *SCADA Bridge* esté activo.
4. Cargá la partida del proyecto.
5. Verificá que exista `<datos de Factorio>/script-output/scada-bridge/latest.json` y que su contenido cambie cada segundo.

### 2. Ejecutar el gateway

```powershell
cd apps/gateway
npm install
npm start          # ejecutar
npm test           # tests automatizados
```

Con la partida corriendo, en otra terminal (en PowerShell, `curl.exe` y no `curl`):

```powershell
curl.exe http://127.0.0.1:4000/api/state     # estado actual
curl.exe -N http://127.0.0.1:4000/api/stream # eventos en vivo
```

Variables de configuración, endpoints y contrato de salida: [`apps/gateway/README.md`](apps/gateway/README.md).

### 3. Ejecutar el lector de consola (opcional)

```powershell
cd apps/scada-reader
npm install
npm start          # ejecutar
npm run dev        # recarga al modificar el código
npm run typecheck  # verificación de tipos
```

Si la carpeta de datos de Factorio no está en la ubicación por defecto (aplica también al gateway):

```powershell
# PowerShell
$env:FACTORIO_DATA_DIR="D:\ruta\a\Factorio"; npm start
```

```bash
# Linux/macOS
FACTORIO_DATA_DIR="/ruta/a/Factorio" npm start
```

---

## Contrato de datos (`latest.json`)

Es la interfaz entre el mod y el gateway. Los clientes (dashboard y demás) **no** leen este archivo: consumen el contrato de salida del gateway (`apiVersion`), documentado en [`apps/gateway/README.md`](apps/gateway/README.md#contrato-de-salida-apiversion-1).

```json
{
  "schema_version": 1,
  "tick": 69840,
  "furnaces": {
    "total": 48,
    "by_status": { "working": 33, "no_fuel": 15 }
  },
  "production": {
    "iron_plate_total": 203,
    "copper_plate_total": 0
  }
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `schema_version` | entero | Versión del formato del snapshot. Hoy es `1`. Cambia solo ante cambios incompatibles; los consumidores rechazan versiones que no conocen. |
| `tick` | entero | Reloj de la partida. 60 ticks = 1 segundo de juego. |
| `furnaces.total` | entero | Cantidad de hornos del jugador en Nauvis. |
| `furnaces.by_status` | objeto | Cantidad de hornos por estado (`defines.entity_status` del juego). Solo aparecen los estados presentes. |
| `production.*_total` | entero | Producción acumulada desde el inicio de la partida. |

Agregar campos no cambia `schema_version`: el gateway ignora los campos que no conoce, y un ítem nuevo con la forma `<item>_total` aparece en su API sin cambios de código.

---

## Estructura del repositorio

```
industrio/
├── README.md
├── CLAUDE.md                 # guía para agentes de IA que trabajan en el repo
├── mods/
│   └── scada-bridge/         # mod de Factorio (Lua)
│       ├── info.json
│       └── control.lua
└── apps/
    ├── gateway/              # gateway de telemetría: validación, estado, HTTP + SSE
    │   ├── README.md
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── src/
    │   │   ├── index.ts      # arranque y apagado ordenado
    │   │   ├── config.ts
    │   │   ├── logger.ts
    │   │   ├── domain/       # contrato del mod, tasas, estado de la planta
    │   │   ├── sources/      # fuentes de snapshots (hoy: archivo)
    │   │   └── http/         # servidor y stream SSE
    │   └── test/
    └── scada-reader/         # lector de consola en Node/TypeScript
        ├── package.json
        ├── tsconfig.json
        └── src/index.ts
```

---

## Hoja de ruta

- [x] Exportar telemetría básica de hornos y producción.
- [x] Lector externo con tasas de producción y detección de enlace caído.
- [x] Agregar `schema_version` al contrato de datos.
- [x] Gateway de telemetría con validación, estado del enlace, API HTTP y stream SSE.
- [ ] Dashboard web en Next.js con datos en vivo.
- [ ] Decidir el futuro de `scada-reader`: eliminarlo o convertirlo en cliente de consola del gateway.
- [ ] Ampliar telemetría: red eléctrica, estaciones de tren, entidades registradas por nombre.
- [ ] Ejecutar la partida en servidor dedicado (headless) con RCON habilitado.
- [ ] Comandos SCADA registrados en el mod, con validación y auditoría.
- [ ] Historian, tendencias y alarmas con ciclo de vida (activa → reconocida → normalizada).
- [ ] Interlocks: reglas que bloquean comandos inseguros.
- [ ] Servidor OPC-UA y publicación MQTT Sparkplug B desde el gateway.
- [ ] Integración con AWS IoT Core e infraestructura como código.

---

## Aviso

Proyecto personal sin afiliación con Wube Software. Factorio es una marca registrada de Wube Software Ltd. Industrio solo lee y modifica partidas propias mediante la API pública de mods del juego.

## Licencia

Pendiente de definir.
