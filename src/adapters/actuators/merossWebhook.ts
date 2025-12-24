import { PlugState } from "../../types.js";

export interface MerossWebhookConfig {
  url?: string;
  token?: string;
  dryRun: boolean;
}

export async function setPlugState(
  cfg: MerossWebhookConfig,
  params: { plug: "kitchen_630_plug" | "living_room_630_plug"; state: PlugState }
): Promise<void> {
  if (cfg.dryRun || !cfg.url) return;

  const resp = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {})
    },
    body: JSON.stringify({
      kind: "meross_smart_plug",
      plug: params.plug,
      state: params.state
    })
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Meross webhook failed: ${resp.status} ${resp.statusText} ${text}`);
  }
}
