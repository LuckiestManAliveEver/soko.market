# On-device AI models

The Soko agent model library exposes five llama.cpp-compatible GGUF models that are small enough
for Android-class hardware. Each upstream repository identifies its license as Apache-2.0, which
permits commercial use subject to the license's notice and attribution terms.

| Soko model     | Hugging Face source                        | Quantization | Download | Device profile |
| -------------- | ------------------------------------------ | ------------ | -------: | -------------- |
| SmolLM2 360M   | `HuggingFaceTB/SmolLM2-360M-Instruct-GGUF` | Q8_0         |   386 MB | 2 GB+ RAM      |
| TinyLlama 1.1B | `TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF`   | Q3_K_M       |   551 MB | 3 GB+ RAM      |
| TinyLlama 1.1B | `TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF`   | Q4_K_M       |   669 MB | 4 GB+ RAM      |
| Qwen2.5 0.5B   | `Qwen/Qwen2.5-0.5B-Instruct-GGUF`          | Q4_K_M       |   491 MB | 3 GB+ RAM      |
| Qwen2.5 1.5B   | `Qwen/Qwen2.5-1.5B-Instruct-GGUF`          | Q4_K_M       |  1.12 GB | 6 GB+ RAM      |

Model files are streamed to the browser's origin-private file system. The download manager checks
for working storage, requests persistent storage, reports progress, and removes partial files after
a failed transfer. No model weights pass through the Soko API.

The agent AI model dropdown separates models that are installed on the current phone from catalog
models that still require a download. A catalog model cannot be activated until its GGUF weights
are present in private device storage. Completing a download installs and selects that model; the
merchant then saves the agent settings to activate it.

The web/PWA build does not silently bundle these large weight files or download them without the
merchant's action. In the interface, “installed on this phone” means the merchant has completed the
one-time predownload into origin-private storage on that Android device.

The Android model library searches both the curated Soko registry and public GitHub releases:

- `/v1/ai-models?search=...` searches the curated registry.
- `/v1/ai-models/github?search=...` searches GitHub repositories and published release assets.

GitHub discovery accepts only repositories that GitHub identifies as Apache-2.0 and release assets
that are uploaded `.gguf` files between 50 MB and 2 GB. Download URLs must be HTTPS links under the
same repository's GitHub Releases path. Draft releases, prereleases, oversized files, non-GGUF
assets, and repositories without an allowlisted license are excluded. Results are cached for 15
minutes. Set `GITHUB_TOKEN` on the API to increase GitHub API rate limits; public discovery still
works without a token subject to GitHub's anonymous limits.

The API reports whether discovery is using the authenticated or public GitHub REST API. An empty
`GITHUB_TOKEN` is treated as public access rather than sending an invalid authorization header.
Render declares `GITHUB_TOKEN` as a secret environment value for the API service.

The “Built-in and hosted” selector also exposes the configured llama.cpp runtime. A loopback
`LOCAL_MODEL_ENDPOINT` is labeled built-in; a remote endpoint is labeled hosted. The option is
enabled only when `LOCAL_MODEL_ENABLED=true`, so it never advertises an unavailable runtime.

The phone ranks compatible Hugging Face and GitHub candidates using reported RAM, free private
storage, model size, useful capabilities, and catalog recommendations. An install remains a
merchant-initiated action. Before a downloaded file is retained, the browser checks the GGUF magic
header and rejects a transfer that grows materially beyond the size reported by the catalog.

Custom model import is enabled only when the browser reports at least 6 GB RAM, 6 logical CPU
threads, and 2 GB free origin storage. If Android does not report RAM, 8 logical CPU threads plus
the storage threshold are required. Imports must use GGUF files with a valid `GGUF` header, and the
merchant must affirm that the model's license permits their commercial use.

License metadata is a product safeguard, not legal advice. Recheck an upstream model card and
license before shipping a model as part of a separately distributed application bundle.
