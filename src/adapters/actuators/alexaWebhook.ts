import { TransomState } from "../../types.js";

import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js";

export interface AlexaWebhookConfig {
  url?: string;
  token?: string;
  dryRun: boolean;
  timeoutMs: number;
}

export async function setTransomState(
  cfg: AlexaWebhookConfig,
  params: { device: "kitchen_transom" | "bathroom_transom"; state: TransomState; decisionId: string }
): Promise<void> {
  if (cfg.dryRun) return;
  if (!cfg.url) {
    throw new Error("Alexa webhook missing URL");
  }

  const resp = await fetchWithTimeout(cfg.url, {
    method: "POST",
    timeoutMs: cfg.timeoutMs,
    headers: {
      "content-type": "application/json",
      ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {})
    },
    body: JSON.stringify({
      kind: "vornado_transom_ae",
      device: params.device,
      state: params.state,
      decision_id: params.decisionId
    })
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Alexa webhook failed: ${resp.status} ${resp.statusText} ${text}`);
  }
}
