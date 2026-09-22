import { buildComputerRuntimeApp } from "./app.js";

const serviceToken = process.env.COMPUTER_RUNTIME_SERVICE_TOKEN?.trim();
if (!serviceToken) throw new Error("COMPUTER_RUNTIME_SERVICE_TOKEN is required.");
const port = Number.parseInt(process.env.PORT ?? "8790", 10);
const app = buildComputerRuntimeApp({ serviceToken });
await app.listen({ host: "0.0.0.0", port });
