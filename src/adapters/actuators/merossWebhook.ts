import { PlugState } from "../../types.js";

import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js";

export interface MerossWebhookConfig {
  url?: string;
  token?: string;
  dryRun: boolean;
  timeoutMs: number;
}

export async function setPlugState(
  cfg: MerossWebhookConfig,
  params: { plug: "kitchen_630_plug" | "living_room_630_plug"; state: PlugState; decisionId: string }
): Promise<void> {
  if (cfg.dryRun) return;
  if (!cfg.url) {
    throw new Error("Meross webhook missing URL");
  }

  const resp = await fetchWithTimeout(cfg.url, {
    method: "POST",
    timeoutMs: cfg.timeoutMs,
    headers: {
      "content-type": "application/json",
      ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {})
    },
    body: JSON.stringify({
      kind: "meross_smart_plug",
      plug: params.plug,
      state: params.state,
      decision_id: params.decisionId
    })
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Meross webhook failed: ${resp.status} ${resp.statusText} ${text}`);
  }
}
