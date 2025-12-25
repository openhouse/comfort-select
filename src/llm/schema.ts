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

const PanelNoteSchemaFactory = (speakers: string[]) => {
  const speakerSchema = speakers.length > 0 ? z.enum(speakers as [string, ...string[]]) : z.string().min(1);

  return z.object({
    speaker: speakerSchema,
    notes: z.string().min(1)
  });
};

export const buildDecisionSchema = (curatorLabels: string[]) => {
  const panelSchema =
    curatorLabels.length > 0
      ? z.array(PanelNoteSchemaFactory(curatorLabels)).length(curatorLabels.length)
      : z.array(PanelNoteSchemaFactory(curatorLabels)).min(1);

  return z.object({
    panel: panelSchema,
    actions: z.object({
      kitchen_transom: TransomStateSchema,
      bathroom_transom: TransomStateSchema,
      kitchen_vornado_630: PlugStateSchema,
      living_vornado_630: PlugStateSchema
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
};

export const DecisionSchema = buildDecisionSchema([]);
export type DecisionZod = z.infer<typeof DecisionSchema>;
