import pino from "pino";

import { config } from "../config.js";

export const logger = pino({
  name: "aya-copilot",
  level: config.LOG_LEVEL,
});

