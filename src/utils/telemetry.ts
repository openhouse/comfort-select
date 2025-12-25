import { SiteConfig } from "../siteConfig.js";
import {
  DerivedFeatures,
  RoomTelemetry,
  SensorReading,
  SensorWithReading,
  SensorsNow,
  StatSummary,
  TelemetrySummary
} from "../types.js";

function toStats(values: number[]): StatSummary | undefined {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length === 0) return undefined;
  const min = Number(Math.min(...nums).toFixed(2));
  const max = Number(Math.max(...nums).toFixed(2));
  const mean = Number((nums.reduce((acc, n) => acc + n, 0) / nums.length).toFixed(2));
  return { min, max, mean, count: nums.length };
}

function readingMap(readings: SensorReading[]): Map<string, SensorReading> {
  return new Map(readings.map((r) => [r.sensorId, r]));
}

function summarizeRoom(
  params: {
    roomId: string;
    sensors: SiteConfig["sensors"];
    roomDefinition?: SiteConfig["rooms"][number];
    readingLookup: Map<string, SensorReading>;
  }
): RoomTelemetry {
  const roomSensors = params.sensors.filter((s) => s.room_id === params.roomId);
  const sensorSummaries: SensorWithReading[] = roomSensors.map((sensor) => ({
    sensorId: sensor.id,
    sensor,
    reading: params.readingLookup.get(sensor.id)
  }));

  const comfortSensors = roomSensors.filter((s) => s.role !== "radiator_proximity");
  const statsSensorIds = (comfortSensors.length > 0 ? comfortSensors : roomSensors).map((s) => s.id);
  const sensorSummariesForStats = sensorSummaries.filter((s) => statsSensorIds.includes(s.sensorId));

  const tempValues = sensorSummariesForStats
    .map((s) => s.reading?.temp_f)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const rhValues = sensorSummariesForStats
    .map((s) => s.reading?.rh_pct)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  const primary = roomSensors.find((s) => s.is_primary_for_room);
  const primaryReading = primary ? params.readingLookup.get(primary.id) : undefined;
  const fallbackReading = sensorSummaries.find((s) => s.reading);

  const representative =
    primaryReading || fallbackReading
      ? {
          sensorId: primaryReading ? primary?.id : fallbackReading?.sensorId,
          temp_f:
            primaryReading?.temp_f !== undefined
              ? Number(primaryReading.temp_f.toFixed(2))
              : fallbackReading?.reading?.temp_f !== undefined
                ? Number(fallbackReading.reading.temp_f.toFixed(2))
                : undefined,
          rh_pct:
            primaryReading?.rh_pct !== undefined
              ? Number(primaryReading.rh_pct.toFixed(2))
              : fallbackReading?.reading?.rh_pct !== undefined
                ? Number(fallbackReading.reading.rh_pct.toFixed(2))
                : undefined,
          method: primaryReading ? "primary_sensor" : "first_available"
        }
      : undefined;

  return {
    roomId: params.roomId,
    room: params.roomDefinition,
    sensors: sensorSummaries,
    stats: {
      temp_f: toStats(tempValues),
      rh_pct: toStats(rhValues)
    },
    representative
  };
}

function computeLivingRadiatorDelta(readingLookup: Map<string, SensorReading>): number | null {
  const radiator = readingLookup.get("living_radiator");
  const center = readingLookup.get("living_center");
  if (radiator && center && Number.isFinite(radiator.temp_f) && Number.isFinite(center.temp_f)) {
    return radiator.temp_f - center.temp_f;
  }
  return null;
}

export function summarizeTelemetry(siteConfig: SiteConfig, sensorsNow: SensorsNow): TelemetrySummary {
  const readings = sensorsNow.readings ?? [];
  const lookup = readingMap(readings);

  const rooms: RoomTelemetry[] = siteConfig.rooms.map((room) =>
    summarizeRoom({
      roomId: room.id,
      sensors: siteConfig.sensors,
      roomDefinition: room,
      readingLookup: lookup
    })
  );

  const features: DerivedFeatures = {
    living_radiator_delta_f: computeLivingRadiatorDelta(lookup)
  };

  return { rooms, features };
}
