import { Decision } from "../types.js";

/**
 * Minimal post-processing.
 * This is intentionally light-touch (MVP), but still prevents impossible/contradictory states.
 */
export function applySanity(decision: Decision): Decision {
  // If a transom is OFF, its speed/direction are still recorded but won't matter.
  // We keep them as-is for learning/logging.
  return decision;
}
