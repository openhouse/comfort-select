import crypto from "node:crypto";
import { MongoClient, Db, Collection } from "mongodb";
import { CycleRecord } from "../../types.js";
import { SiteConfig } from "../../siteConfig.js";

export interface MongoStoreConfig {
  uri: string;
  dbName: string;
  collectionName: string;
}

export interface CycleRecordDocument extends CycleRecord {
  _id: string;
  created_at: Date;
  timestamp_utc: Date;
  site_config_hash?: string;
}

export interface MongoStore {
  client: MongoClient;
  db: Db;
  cyclesCollection: Collection<CycleRecordDocument>;
}

let cachedStore: MongoStore | null = null;

function stableStringify(value: any): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

export function hashSiteConfig(siteConfig: SiteConfig): string {
  return crypto.createHash("sha256").update(stableStringify(siteConfig)).digest("hex");
}

async function ensureIndexes(cyclesCollection: Collection<CycleRecordDocument>) {
  await cyclesCollection.createIndex({ _id: 1 }, { unique: true });
  await cyclesCollection.createIndex({ timestamp_utc: -1 });
  await cyclesCollection.createIndex({ timestamp_utc_iso: -1 });
  await cyclesCollection.createIndex({ site_config_hash: 1 });
}

export async function initMongo(cfg: MongoStoreConfig): Promise<MongoStore> {
  if (cachedStore) return cachedStore;

  const client = new MongoClient(cfg.uri);
  await client.connect();
  const db = client.db(cfg.dbName);
  const cyclesCollection = db.collection<CycleRecordDocument>(cfg.collectionName);
  await ensureIndexes(cyclesCollection);

  cachedStore = { client, db, cyclesCollection };
  return cachedStore;
}

export async function insertCycleRecord(
  store: MongoStore,
  record: CycleRecord,
  params?: { siteConfigHash?: string }
): Promise<void> {
  const doc: CycleRecordDocument = {
    ...record,
    _id: record.decision_id,
    created_at: new Date(),
    timestamp_utc: new Date(record.timestamp_utc_iso),
    site_config_hash: params?.siteConfigHash
  };

  await store.cyclesCollection.updateOne(
    { _id: doc._id },
    { $setOnInsert: doc },
    { upsert: true }
  );
}

function toCycleRecord(doc: CycleRecordDocument): CycleRecord {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, created_at, timestamp_utc, site_config_hash, ...rest } = doc;
  return rest;
}

export async function getRecentCycleRecords(store: MongoStore, limit?: number): Promise<CycleRecord[]> {
  const cursor = store.cyclesCollection.find({}, { sort: { timestamp_utc: -1, _id: -1 }, ...(limit ? { limit } : {}) });
  const docs = await cursor.toArray();
  return docs.reverse().map(toCycleRecord);
}

export async function getLatestCycleRecord(store: MongoStore): Promise<CycleRecord | null> {
  const doc = await store.cyclesCollection.findOne({}, { sort: { timestamp_utc: -1, _id: -1 } });
  return doc ? toCycleRecord(doc) : null;
}
