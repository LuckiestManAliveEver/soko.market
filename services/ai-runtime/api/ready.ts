import { createVercelReadyHandler } from "../src/vercel-handler.js";

const handler = createVercelReadyHandler();

export function GET(): Response {
  return handler();
}
