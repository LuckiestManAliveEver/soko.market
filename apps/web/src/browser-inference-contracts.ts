import type {
  BrowserCheckpointCompatibilityContract,
  BrowserInferenceBackend,
  BrowserModelDescriptor,
  BrowserRuntimeContract
} from "./browser-inference-types";

export const sokoBrowserRuntimeContractVersion = 1 as const;
export const sokoBrowserCheckpointContractVersion = 1 as const;

export function browserRuntimeContract(input: {
  adapterId: BrowserRuntimeContract["adapterId"];
  adapterVersion: string;
  libraryRevision?: string;
  backend: Exclude<BrowserInferenceBackend, "none">;
}): BrowserRuntimeContract {
  const runtime = input.backend === "webgpu" ? "browser-webgpu" : "browser-wasm";
  if (input.adapterId === "webllm" && input.backend !== "webgpu") {
    throw new Error("WebLLM requires WebGPU.");
  }
  return {
    schemaVersion: sokoBrowserRuntimeContractVersion,
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    libraryRevision: input.libraryRevision ?? null,
    runtime,
    backend: input.backend,
    streaming: true,
    cancellation: true,
    tokenCounting: input.adapterId === "transformers-js" ? "exact" : "estimated",
    checkpointKinds: ["task-state"],
    nativeStateFormat: null
  };
}

export function browserRuntimeContractForModel(
  model: BrowserModelDescriptor,
  backend: Exclude<BrowserInferenceBackend, "none">
): BrowserRuntimeContract {
  const runtime = backend === "webgpu" ? "browser-webgpu" : "browser-wasm";
  if (!model.supportedBackends.includes(backend) || !model.supportedRuntimes.includes(runtime)) {
    throw new Error("The model does not support the requested browser runtime.");
  }
  return browserRuntimeContract({
    adapterId: model.runtimeAdapter,
    adapterVersion: model.runtimeAdapterVersion,
    ...(model.runtimeLibraryRevision === undefined
      ? {}
      : { libraryRevision: model.runtimeLibraryRevision }),
    backend
  });
}

export function browserCheckpointCompatibilityContract(
  model: BrowserModelDescriptor
): BrowserCheckpointCompatibilityContract {
  return {
    schemaVersion: sokoBrowserCheckpointContractVersion,
    checkpointKind: "task-state",
    taskStateSchema: "soko.browser-task-state.v2",
    modelFamilyId: model.modelFamilyId,
    sourceModelId: model.id,
    sourceModelRevision: model.modelRevision,
    sourceAdapterId: model.runtimeAdapter,
    promptRepresentation: "role-content-messages",
    portableAcrossAdapters: true
  };
}

export function taskStateContractsArePortable(
  source: BrowserCheckpointCompatibilityContract | null | undefined,
  target: BrowserCheckpointCompatibilityContract
): boolean {
  return (
    source?.schemaVersion === sokoBrowserCheckpointContractVersion &&
    source.checkpointKind === "task-state" &&
    source.taskStateSchema === target.taskStateSchema &&
    source.modelFamilyId === target.modelFamilyId &&
    source.promptRepresentation === target.promptRepresentation &&
    source.portableAcrossAdapters === true &&
    target.portableAcrossAdapters === true
  );
}
