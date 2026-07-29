/// <reference lib="webworker" />

import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  handler.onmessage(event);
});
