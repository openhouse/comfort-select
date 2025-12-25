import type { AppConfig } from "./config.js";
import { CuratorsList, SiteConfig, loadSiteConfig, parseCuratorsJson } from "./siteConfig.js";
import { PromptTemplate, loadPromptTemplate } from "./llm/promptTemplate.js";

export interface PromptAssets {
  siteConfig: SiteConfig;
  curators: CuratorsList;
  curatorLabels: string[];
  template: PromptTemplate;
}

export function loadPromptAssets(params: {
  siteConfigPath: string;
  promptTemplatePath: string;
  curatorsJson?: string;
}): PromptAssets {
  const siteConfig = loadSiteConfig(params.siteConfigPath);

  const curatorsFromEnv = params.curatorsJson ? parseCuratorsJson(params.curatorsJson) : null;
  const curators = curatorsFromEnv ?? siteConfig.curators;

  const template = loadPromptTemplate(params.promptTemplatePath);

  const curatorLabels = curators.map((name) => `${name} (imagined panel)`);

  return {
    siteConfig: { ...siteConfig, curators },
    curators,
    curatorLabels,
    template
  };
}

export function loadPromptAssetsFromConfig(cfg: AppConfig): PromptAssets {
  return loadPromptAssets({
    siteConfigPath: cfg.SITE_CONFIG_PATH,
    promptTemplatePath: cfg.PROMPT_TEMPLATE_PATH,
    curatorsJson: cfg.CURATORS_JSON
  });
}
