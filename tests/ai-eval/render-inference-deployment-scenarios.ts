export interface RenderInferenceDeploymentScenario {
  name: string;
  hasPersistentDisk: boolean;
}

/** Frozen production deployment cases for the Render inference Blueprint. */
export const renderInferenceDeploymentScenarios: RenderInferenceDeploymentScenario[] = [
  {
    name: "private SmolLM service with durable model storage",
    hasPersistentDisk: true
  }
];
