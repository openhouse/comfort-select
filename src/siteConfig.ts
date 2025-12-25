import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const RoomSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1)
});

const DeviceSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  label: z.string().min(1),
  room: z.string().min(1)
});

const SiteDetailsSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  timezone: z.string().min(1),
  address: z.string().min(1),
  notes: z.string().optional()
});

const CuratorsSchema = z.array(z.string().min(1)).min(1);

const SiteConfigSchema = z.object({
  site: SiteDetailsSchema,
  curators: CuratorsSchema,
  rooms: z.array(RoomSchema).min(1),
  devices: z.array(DeviceSchema).min(1)
});

export type SiteConfig = z.infer<typeof SiteConfigSchema> & { sourcePath: string };
export type CuratorsList = z.infer<typeof CuratorsSchema>;

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
