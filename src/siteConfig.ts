import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Device, Room, RoomConnection, Sensor, SiteFeature } from "./types.js";

const RoomDimensionsSchema = z
  .object({
    length_ft: z.number().optional(),
    width_ft: z.number().optional(),
    height_ft: z.number().optional(),
    notes: z.string().optional()
  })
  .optional();

const RoomIrregularitySchema = z.object({
  description: z.string().min(1),
  size_ft: z
    .object({
      length_ft: z.number().optional(),
      width_ft: z.number().optional(),
      height_ft: z.number().optional()
    })
    .optional()
});

const RoomSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  dimensions_ft: RoomDimensionsSchema,
  irregularities: z.array(RoomIrregularitySchema).optional(),
  windows: z
    .object({
      count: z.number().int().nonnegative(),
      notes: z.string().optional()
    })
    .optional(),
  connected_room_ids: z.array(z.string().min(1)).optional(),
  notes: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  exterior: z.boolean().optional()
});

const RoomConnectionSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.string().optional(),
  notes: z.string().optional()
});

const SensorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  room_id: z.string().min(1),
  role: z.enum(["ambient", "radiator_proximity", "window_proximity", "unknown"]).optional(),
  placement_notes: z.string().optional(),
  measures: z.array(z.string().min(1)).optional(),
  is_primary_for_room: z.boolean().optional(),
  tags: z.array(z.string().min(1)).optional(),
  manufacturer: z.string().optional()
});

const DeviceCapabilitiesSchema = z.object({
  power: z.boolean(),
  direction_modes: z.array(z.string().min(1)).optional(),
  speed_levels: z.array(z.number()).optional(),
  power_only: z.boolean().optional(),
  constraints: z.array(z.string().min(1)).optional()
});

const DeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  room_id: z.string().min(1),
  kind: z.string().min(1),
  control: z.string().min(1),
  capabilities: DeviceCapabilitiesSchema,
  placement_notes: z.string().optional(),
  notes: z.array(z.string().min(1)).optional()
});

const SiteDetailsSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  timezone: z.string().min(1),
  address: z.string().min(1),
  location: z
    .object({
      lat: z.number(),
      lon: z.number(),
      elevation_ft: z.number().optional()
    })
    .optional(),
  materials: z.array(z.string().min(1)).optional(),
  notes: z.array(z.string().min(1)).optional()
});

const SiteFeatureSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  sensors: z.array(z.string().min(1)).optional(),
  rooms: z.array(z.string().min(1)).optional(),
  formula: z.string().optional()
});

const CuratorsSchema = z.array(z.string().min(1)).min(1);

const SiteConfigSchema = z.object({
  site: SiteDetailsSchema,
  curators: CuratorsSchema,
  rooms: z.array(RoomSchema).min(1),
  connections: z.array(RoomConnectionSchema).default([]),
  sensors: z.array(SensorSchema).min(1),
  devices: z.array(DeviceSchema).min(1),
  features: z.array(SiteFeatureSchema).optional()
});

export type RoomConfig = z.infer<typeof RoomSchema>;
export type RoomConnectionConfig = z.infer<typeof RoomConnectionSchema>;
export type SensorConfig = z.infer<typeof SensorSchema>;
export type DeviceConfig = z.infer<typeof DeviceSchema>;
export type SiteConfig = z.infer<typeof SiteConfigSchema> & { sourcePath: string };
export type CuratorsList = z.infer<typeof CuratorsSchema>;
export type SiteFeatureConfig = z.infer<typeof SiteFeatureSchema>;

export function parseCuratorsJson(raw: string): CuratorsList {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`Failed to parse CURATORS_JSON: ${e?.message ?? String(e)}`);
  }
  try {
    return CuratorsSchema.parse(parsed);
  } catch (e: any) {
    throw new Error(`CURATORS_JSON failed validation: ${e?.message ?? String(e)}`);
  }
}

export function loadSiteConfig(siteConfigPath: string): SiteConfig {
  const resolvedPath = path.resolve(siteConfigPath);
  let raw: string;
  try {
    raw = fs.readFileSync(resolvedPath, "utf-8");
  } catch (e: any) {
    throw new Error(`Failed to read site config at ${resolvedPath}: ${e?.message ?? String(e)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`Site config JSON parse error (${resolvedPath}): ${e?.message ?? String(e)}`);
  }

  try {
    const validated = SiteConfigSchema.parse(parsed);
    return { ...validated, sourcePath: resolvedPath };
  } catch (e: any) {
    throw new Error(`Site config validation error (${resolvedPath}): ${e?.message ?? String(e)}`);
  }
}
