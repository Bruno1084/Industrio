-- SCADA Bridge v0.3.1
-- Cada segundo escribe un archivo JSON con datos basicos de la fabrica.
-- El archivo queda en: <carpeta de datos de Factorio>/script-output/scada-bridge/latest.json
--
-- v0.3.0: el snapshot incluye "schema_version" para que los consumidores puedan
-- rechazar un formato que no conocen en vez de malinterpretarlo.
-- v0.3.1: compatible con Factorio 2.1 (sin cambios en la API usada ni en el snapshot).

local SCHEMA_VERSION = 1      -- subir solo ante cambios incompatibles en la forma del snapshot
local SURFACE = "nauvis"      -- el planeta inicial
local FORCE = "player"        -- tu "equipo"
local INTERVAL_TICKS = 60     -- el juego corre a 60 ticks por segundo -> 1 lectura por segundo

-- Tabla inversa: numero de estado -> nombre legible ("working", "no_fuel", ...)
local STATUS_NAMES = {}
for name, value in pairs(defines.entity_status) do
  STATUS_NAMES[value] = name
end

local function read_furnaces(surface)
  local furnaces = surface.find_entities_filtered{ type = "furnace", force = FORCE }
  local by_status = {}

  for _, furnace in pairs(furnaces) do
    local name = STATUS_NAMES[furnace.status] or "unknown"
    by_status[name] = (by_status[name] or 0) + 1
  end

  return { total = #furnaces, by_status = by_status }
end

local function read_production(surface)
  local stats = game.forces[FORCE].get_item_production_statistics(surface)
  return {
    -- totales acumulados desde el inicio de la partida
    iron_plate_total = stats.get_input_count("iron-plate"),
    copper_plate_total = stats.get_input_count("copper-plate"),
  }
end

script.on_nth_tick(INTERVAL_TICKS, function(event)
  local surface = game.surfaces[SURFACE]
  if not surface then return end

  local snapshot = {
    schema_version = SCHEMA_VERSION,
    tick = event.tick,                  -- "reloj" del juego
    furnaces = read_furnaces(surface),
    production = read_production(surface),
  }

  -- false = sobrescribir el archivo cada vez (siempre contiene el ultimo estado)
  helpers.write_file("scada-bridge/latest.json", helpers.table_to_json(snapshot), false)
end)
