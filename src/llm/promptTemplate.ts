import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Handlebars from "handlebars";

export interface PromptTemplate {
  path: string;
  version: string;
  render: (context: unknown) => string;
}

export function loadPromptTemplate(templatePath: string): PromptTemplate {
  const resolvedPath = path.resolve(templatePath);

  let templateSource: string;
  try {
    templateSource = fs.readFileSync(resolvedPath, "utf-8");
  } catch (e: any) {
    throw new Error(`Failed to read prompt template at ${resolvedPath}: ${e?.message ?? String(e)}`);
  }

  const compiled = Handlebars.compile(templateSource, { noEscape: true });
  const hash = crypto.createHash("sha256").update(templateSource).digest("hex").slice(0, 8);

  return {
    path: resolvedPath,
    version: `${path.basename(resolvedPath)}#${hash}`,
    render: (context: unknown) => compiled(context)
  };
}
