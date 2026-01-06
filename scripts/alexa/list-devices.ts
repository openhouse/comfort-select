import "../_load-env.js";
import pino from "pino";
import { fetchAlexaDevices, initAlexaRemote } from "../../services/actuator-bridge/lib.js";

const logger = pino({ name: "list-devices" });

function summarize(device: any) {
  return {
    accountName: device.accountName ?? device.name,
    serialNumber: device.serialNumber,
    deviceType: device.deviceType ?? device.deviceFamily ?? device.type
  };
}

function matchesDevice(
  device: ReturnType<typeof summarize>,
  configuredName?: string,
  configuredSerial?: string
): boolean {
  const normalizedName = configuredName?.trim().toLowerCase();
  const normalizedSerial = configuredSerial?.trim().toLowerCase();
  const name = device.accountName?.toLowerCase();
  const serial = device.serialNumber?.toLowerCase();
  return Boolean(
    (normalizedName && (name === normalizedName || serial === normalizedName)) ||
      (normalizedSerial && (serial === normalizedSerial || name === normalizedSerial))
  );
}

async function main() {
  const configuredName = process.env.ALEXA_ROUTINE_DEVICE_NAME ?? process.env.ALEXA_ROUTINE_DEVICE;
  const configuredSerial = process.env.ALEXA_ROUTINE_DEVICE_SERIAL;

  const { alexa } = await initAlexaRemote(logger);
  const devices = await fetchAlexaDevices(alexa, logger);
  const summarized = devices.map(summarize);
  const matched = summarized.find((device) => matchesDevice(device, configuredName, configuredSerial));

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        configuredName,
        configuredSerial,
        devices: summarized,
        matched: matched ?? null,
        matchedIndex: matched ? summarized.indexOf(matched) : -1
      },
      null,
      2
    )
  );

  summarized.forEach((device) => {
    // eslint-disable-next-line no-console
    console.log(
      `${device.serialNumber ?? "unknown-serial"}\t${device.accountName ?? "unknown-name"}\t${device.deviceType ?? "unknown-type"}`
    );
  });
}

main().catch((err) => {
  logger.error({ err }, "Failed to list devices");
  process.exit(1);
});
