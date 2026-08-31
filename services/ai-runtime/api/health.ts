import { createVercelHealthHandler, readVercelInferenceConfig } from "../src/vercel-handler.js";

const handler = createVercelHealthHandler(readVercelInferenceConfig());

export function GET(): Response {
  return handler();
}
