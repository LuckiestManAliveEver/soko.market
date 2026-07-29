import { describe, expect, it } from "vitest";
import {
  browserCheckpointCompatibilityContract,
  browserRuntimeContractForModel,
  taskStateContractsArePortable
} from "../apps/web/src/browser-inference-contracts";
import { getBrowserModel } from "../apps/web/src/browser-model-registry";

describe("browser inference portability contracts", () => {
  it("ports structured SmolLM task state between Transformers.js and WebLLM", () => {
    const transformersModel = getBrowserModel("smollm2-360m-instruct-browser")!;
    const webLlmModel = getBrowserModel("smollm2-360m-instruct-webllm")!;

    expect(
      taskStateContractsArePortable(
        browserCheckpointCompatibilityContract(transformersModel),
        browserCheckpointCompatibilityContract(webLlmModel)
      )
    ).toBe(true);
    expect(browserRuntimeContractForModel(webLlmModel, "webgpu")).toEqual({
      schemaVersion: 1,
      adapterId: "webllm",
      adapterVersion: "0.2.84",
      libraryRevision: "025bcaf3780fa8254f5e5efd3bfea0a5397248f4",
      runtime: "browser-webgpu",
      backend: "webgpu",
      streaming: true,
      cancellation: true,
      tokenCounting: "estimated",
      checkpointKinds: ["task-state"],
      nativeStateFormat: null
    });
  });

  it("does not treat different model families or native state as portable", () => {
    const smol = getBrowserModel("smollm2-360m-instruct-webllm")!;
    const qwen = getBrowserModel("qwen2.5-0.5b-instruct-webllm")!;
    expect(
      taskStateContractsArePortable(
        browserCheckpointCompatibilityContract(smol),
        browserCheckpointCompatibilityContract(qwen)
      )
    ).toBe(false);
    expect(browserRuntimeContractForModel(smol, "webgpu")).toMatchObject({
      checkpointKinds: ["task-state"],
      nativeStateFormat: null
    });
  });
});
