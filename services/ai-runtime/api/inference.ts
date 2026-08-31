import { createVercelInferenceHandler, readVercelInferenceConfig } from "../src/vercel-handler.js";

const handler = createVercelInferenceHandler(readVercelInferenceConfig());

export default { fetch: handler };
