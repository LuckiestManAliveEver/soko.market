# On-device AI models

The Soko agent model library exposes three llama.cpp-compatible GGUF models that are small enough
for Android-class hardware. Each upstream repository identifies its license as Apache-2.0, which
permits commercial use subject to the license's notice and attribution terms.

| Soko model   | Hugging Face source                        | Quantization | Download | Device profile |
| ------------ | ------------------------------------------ | ------------ | -------: | -------------- |
| SmolLM2 360M | `HuggingFaceTB/SmolLM2-360M-Instruct-GGUF` | Q8_0         |   386 MB | 2 GB+ RAM      |
| Qwen2.5 0.5B | `Qwen/Qwen2.5-0.5B-Instruct-GGUF`          | Q4_K_M       |   491 MB | 3 GB+ RAM      |
| Qwen2.5 1.5B | `Qwen/Qwen2.5-1.5B-Instruct-GGUF`          | Q4_K_M       |  1.12 GB | 6 GB+ RAM      |

Model files are streamed to the browser's origin-private file system. The download manager checks
for working storage, requests persistent storage, reports progress, and removes partial files after
a failed transfer. No model weights pass through the Soko API.

Custom model import is enabled only when the browser reports at least 6 GB RAM, 6 logical CPU
threads, and 2 GB free origin storage. If Android does not report RAM, 8 logical CPU threads plus
the storage threshold are required. Imports must use GGUF files with a valid `GGUF` header, and the
merchant must affirm that the model's license permits their commercial use.

License metadata is a product safeguard, not legal advice. Recheck an upstream model card and
license before shipping a model as part of a separately distributed application bundle.
