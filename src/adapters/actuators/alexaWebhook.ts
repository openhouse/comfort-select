import { TransomState } from "../../types.js";

export interface AlexaWebhookConfig {
  url?: string;
  token?: string;
  dryRun: boolean;
}

export async function setTransomState(
  cfg: AlexaWebhookConfig,
  params: { device: "kitchen_transom" | "bathroom_transom"; state: TransomState }
): Promise<void> {
  if (cfg.dryRun || !cfg.url) return;

  const resp = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {})
    },
    body: JSON.stringify({
      kind: "vornado_transom_ae",
      device: params.device,
      state: params.state
    })
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Alexa webhook failed: ${resp.status} ${resp.statusText} ${text}`);
  }
}
