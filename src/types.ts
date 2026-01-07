export type SensorRole = "ambient" | "radiator_proximity" | "window_proximity" | "unknown";

export interface RoomDimensionsFt {
  length_ft?: number;
  width_ft?: number;
  height_ft?: number;
  notes?: string;
}

export interface RoomIrregularity {
  description: string;
  size_ft?: {
    length_ft?: number;
    width_ft?: number;
    height_ft?: number;
  };
}

export interface Room {
  id: string;
  name: string;
  kind: string;
  dimensions_ft?: RoomDimensionsFt;
  irregularities?: RoomIrregularity[];
  windows?: {
    count: number;
    notes?: string;
  };
  connected_room_ids?: string[];
  notes?: string[];
  tags?: string[];
  exterior?: boolean;
}

export interface RoomConnection {
  from: string;
  to: string;
  kind?: string;
  notes?: string;
}

export interface Sensor {
  id: string;
  name: string;
  room_id: string;
  role?: SensorRole;
  placement_notes?: string;
  measures?: string[];
  is_primary_for_room?: boolean;
  tags?: string[];
  manufacturer?: string;
}

export interface DeviceCapabilities {
  power: boolean;
  direction_modes?: string[];
  speed_levels?: number[];
  power_only?: boolean;
  constraints?: string[];
}

export interface Device {
  id: string;
  name: string;
  room_id: string;
  kind: string;
  control: "alexa" | "meross" | string;
  capabilities: DeviceCapabilities;
  placement_notes?: string;
  notes?: string[];
}

export interface SiteFeature {
  id: string;
  description: string;
  sensors?: string[];
  rooms?: string[];
  formula?: string;
}

export interface WeatherNow {
  temp_f: number;
  rh_pct: number;
  wind_mph?: number;
  wind_dir_deg?: number;
  precip_in_hr?: number;
  conditions?: string;
  observation_time_utc: string;
}

export interface SensorsNow {
  observation_time_utc: string;
  readings: SensorReading[];
  raw?: unknown;
}

export interface SensorReading {
  sensorId: string;
  temp_f: number;
  rh_pct: number;
}

export interface SensorWithReading {
  sensorId: string;
  sensor?: Sensor;
  reading?: SensorReading;
}

export interface StatSummary {
  min?: number;
  max?: number;
  mean?: number;
  count: number;
}

export interface RoomTelemetry {
  roomId: string;
  room?: Room;
  sensors: SensorWithReading[];
  stats?: {
    temp_f?: StatSummary;
    rh_pct?: StatSummary;
  };
  representative?: {
    sensorId?: string;
    temp_f?: number;
    rh_pct?: number;
    method: string;
  };
}

export interface DerivedFeatures {
  living_radiator_delta_f?: number | null;
  [key: string]: number | null | undefined;
}

export interface TelemetrySummary {
  rooms: RoomTelemetry[];
  features: DerivedFeatures;
}

export type TransomDirection = "EXHAUST" | "DIRECT";
export type TransomSpeed = "LOW" | "MED" | "HIGH" | "TURBO";

export interface TransomState {
  power: "ON" | "OFF";
  direction: TransomDirection;
  speed: TransomSpeed;
  auto: boolean;
  set_temp_f: number; // 60-90 (meaningful if auto=true)
}

export interface PlugState {
  power: "ON" | "OFF";
}

export interface DecisionPanelNote {
  speaker: string;
  notes: string;
}

export interface PredictionEntry {
  target_id: string;
  temp_f_delta: number | null;
  rh_pct_delta: number | null;
}

export interface Decision {
  panel: DecisionPanelNote[];
  actions: {
    kitchen_transom: TransomState;
    bathroom_transom: TransomState;
    kitchen_vornado_630: PlugState;
    living_vornado_630: PlugState;
  };
  hypothesis: string;
  confidence_0_1: number;
  openai_response_id?: string;
  predictions: PredictionEntry[];
}

export interface ActuationResult {
  applied: Decision["actions"];
  errors: string[];
  actuation_ok: boolean;
}

export interface CycleRecord {
  decision_id: string;
  llm_model: string;
  prompt_template_version?: string;
  site_config_id?: string;
  timestamp_local_iso: string;
  timestamp_utc_iso: string;

  weather: WeatherNow;
  sensors: SensorsNow;
  telemetry: TelemetrySummary;
  features: DerivedFeatures;

  decision: Decision;
  actuation: ActuationResult;
}
