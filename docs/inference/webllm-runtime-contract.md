# WebLLM runtime contract

## Supported runtime

Soko integrates `@mlc-ai/web-llm` 0.2.84 as a lazy-loaded, dedicated Web Worker adapter. It is
available only when the capability layer selects WebGPU. WebLLM is not imported by the Render API
and does not require a persistent inference service.

The initial approved profiles are:

| Soko profile                   | WebLLM model ID                     | Weight revision                            |
| ------------------------------ | ----------------------------------- | ------------------------------------------ |
| `smollm2-360m-instruct-webllm` | `SmolLM2-360M-Instruct-q4f16_1-MLC` | `3a622fd89e0216e8bb10c410c007c786baa8a033` |
| `qwen2.5-0.5b-instruct-webllm` | `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` | `32ff081fe7e4dfe4ffb167b94c66fdf11e02b8ad` |

The compatible WebAssembly model libraries are resolved from WebLLM's 0.2.84
`prebuiltAppConfig`, then rewritten from the mutable GitHub `main` URL to
`binary-mlc-llm-libs@025bcaf3780fa8254f5e5efd3bfea0a5397248f4`.

The MLC weights and model library are different artifacts. Both must remain pinned.

## Runtime contract

`BrowserRuntimeContract` is the stable Soko boundary:

```ts
interface BrowserRuntimeContract {
  schemaVersion: 1;
  adapterId: "transformers-js" | "webllm";
  adapterVersion: string;
  libraryRevision: string | null;
  runtime: "browser-webgpu" | "browser-wasm";
  backend: "webgpu" | "wasm";
  streaming: true;
  cancellation: true;
  tokenCounting: "exact" | "estimated";
  checkpointKinds: Array<"task-state" | "token-replay" | "native-kv">;
  nativeStateFormat: string | null;
}
```

WebLLM 0.2.84 does not expose a supported tokenizer-count API through
`MLCEngineInterface`, so Soko advertises `tokenCounting: "estimated"` and uses a conservative
message estimate. Its real generation still runs within the selected profile's context, output,
memory, and wall-time budgets.

## Checkpoint contract

`BrowserCheckpointCompatibilityContract` describes the portable representation:

```ts
interface BrowserCheckpointCompatibilityContract {
  schemaVersion: 1;
  checkpointKind: "task-state";
  taskStateSchema: "soko.browser-task-state.v2";
  modelFamilyId: string;
  sourceModelId: string;
  sourceModelRevision: string;
  sourceAdapterId: "transformers-js" | "webllm";
  promptRepresentation: "role-content-messages";
  portableAcrossAdapters: true;
}
```

A checkpoint can be restored through another adapter only when:

1. it is an unexpired interrupted task-state checkpoint;
2. account, shop, conversation, request, and objective scopes match;
3. both contracts use `soko.browser-task-state.v2`;
4. model family and role/content representation match.

The source model ID, revision, and adapter remain recorded for auditability but do not prevent
logical recovery across adapters in the same model family.

## Explicit non-contracts

The following are not portable contracts:

- a WebLLM KV cache;
- Transformers.js/ONNX Runtime tensors;
- WebGPU buffers;
- raw MLC model artifacts;
- GGUF files;
- sampler state not represented in the task checkpoint.

Soko therefore publishes only `checkpointKinds: ["task-state"]` and
`nativeStateFormat: null`. A future native or token-replay format must receive a new schema,
compatibility validator, corruption checks, and runtime-specific conformance tests before it can
be advertised.

## Lifecycle

1. Soko selects a compatible WebLLM profile.
2. The adapter builds an app configuration from WebLLM's pinned package catalogue.
3. Weight and model-library URLs are rewritten to immutable revisions.
4. `CreateWebWorkerMLCEngine` loads the profile in a dedicated worker.
5. A bounded readiness completion must succeed before the model is enabled.
6. Generation streams through the common `BrowserModelEngine` contract.
7. Deadline or cancellation calls `interruptGenerate`.
8. Page lifecycle and failure checkpoints use the common structured task-state store.
9. Model removal unloads the worker and deletes both Transformers.js and WebLLM caches.

## References

- [WebLLM documentation](https://webllm.mlc.ai/docs/)
- [WebLLM API reference](https://webllm.mlc.ai/docs/user/api_reference.html)
- [WebLLM repository](https://github.com/mlc-ai/web-llm)
