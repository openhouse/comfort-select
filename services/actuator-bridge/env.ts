import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const repoRoot = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(repoRoot, ".env") });

export function resolveFromRepo(...segments: string[]): string {
  const combined = path.join(...segments);
  return path.isAbsolute(combined) ? combined : path.join(repoRoot, combined);
}
