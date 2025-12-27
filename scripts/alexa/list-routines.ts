import pino from "pino";
import { initAlexaRemote, routineId } from "../../services/actuator-bridge/lib.js";

const logger = pino({ name: "list-routines" });

async function main() {
  const { routines } = await initAlexaRemote(logger);
  routines.forEach((routine: any) => {
    // eslint-disable-next-line no-console
    console.log(`${routineId(routine) ?? "unknown"}\t${routine.name ?? routine.automationName ?? "unnamed routine"}`);
  });
}

main().catch((err) => {
  logger.error({ err }, "Failed to list routines");
  process.exit(1);
});
