export type RoomId =
  | "kitchen"
  | "living_room"
  | "bedroom"
  | "bathroom"
  | "front_hall"
  | "back_hall"
  | "radiator";

export interface WeatherNow {
  temp_f: number;
  rh_pct: number;
  wind_mph?: number;
  wind_dir_deg?: number;
  precip_in_hr?: number;
  conditions?: string;
  observation_time_utc: string;
}

export interface RoomReading {
  room: RoomId;
  temp_f: number;
  rh_pct: number;
}

export interface SensorsNow {
  observation_time_utc: string;
  readings: RoomReading[];
  raw?: unknown;
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

export interface DecisionPanelUtterance {
  speaker: string; // e.g. "Gail S. Brager (imagined panel)"
  say: string;
}

export interface Decision {
  panel: DecisionPanelUtterance[];
  actions: {
    kitchen_transom: TransomState;
    bathroom_transom: TransomState;
    kitchen_630_plug: PlugState;
    living_room_630_plug: PlugState;
  };
  hypothesis: string;
  confidence_0_1: number;
  predictions?: Record<
    string,
    {
      temp_f_delta?: number;
      rh_pct_delta?: number;
    }
  >;
}

export interface ActuationResult {
  applied: Decision["actions"];
  errors: string[];
}

export interface CycleRecord {
  timestamp_local_iso: string;
  timestamp_utc_iso: string;

  weather: WeatherNow;
  sensors: SensorsNow;

  decision: Decision;
  actuation: ActuationResult;
}
