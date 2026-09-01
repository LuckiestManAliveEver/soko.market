import { createVercelHealthHandler } from "../src/vercel-handler.js";

const handler = createVercelHealthHandler();

export function GET(): Response {
  return handler();
}
