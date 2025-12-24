import { z } from "zod";

export const TransomDirectionSchema = z.enum(["EXHAUST", "DIRECT"]);
export const TransomSpeedSchema = z.enum(["LOW", "MED", "HIGH", "TURBO"]);

export const TransomStateSchema = z.object({
  power: z.enum(["ON", "OFF"]),
  direction: TransomDirectionSchema,
  speed: TransomSpeedSchema,
  auto: z.boolean(),
  set_temp_f: z.number().int().min(60).max(90)
});

export const PlugStateSchema = z.object({
  power: z.enum(["ON", "OFF"])
});

export const PanelUtteranceSchema = z.object({
  speaker: z.string().min(1),
  say: z.string().min(1)
});

export const DecisionSchema = z.object({
  panel: z.array(PanelUtteranceSchema).min(1),
  actions: z.object({
    kitchen_transom: TransomStateSchema,
    bathroom_transom: TransomStateSchema,
    kitchen_630_plug: PlugStateSchema,
    living_room_630_plug: PlugStateSchema
  }),
  hypothesis: z.string().min(1),
  confidence_0_1: z.number().min(0).max(1),
  predictions: z
    .record(
      z.string(),
      z.object({
        temp_f_delta: z.number().optional(),
        rh_pct_delta: z.number().optional()
      })
    )
    .optional()
});

export type DecisionZod = z.infer<typeof DecisionSchema>;
