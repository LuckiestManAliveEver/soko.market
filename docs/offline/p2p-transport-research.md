# P2P transport research and prototype

Bitchat uses nearby Bluetooth links to relay framed messages, with bounded forwarding and deduplication. Its project describes private messaging and protocol-level encryption; these are separate concerns from simply discovering a radio. The Soko prototype borrows the transport separation and bounded relay approach, without copying Bitchat source. Sources: [Bitchat repository](https://github.com/permissionlesstech/bitchat) and [protocol whitepaper](https://github.com/permissionlesstech/bitchat/blob/main/WHITEPAPER.md).

Web Bluetooth exposes selected GATT peripherals and requires browser support and permission. It is not a portable peer advertising/background mesh API. MDN marks the API as limited availability and secure-context restricted. Source: [Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API).

## Envelope and framing

Soko's existing `ConversationMessageSummary` in packages/shared-types/src/index.ts carries id, conversationId, clientMessageId, idempotencyKey, author, authorId, content and delivery metadata. A full JSON envelope cannot be assumed to fit a BLE packet. The adapter serializes UTF-8 JSON once, fragments bytes into transport-MTU-sized frames and reassembles them without altering the canonical object. The 22-byte binary header contains protocol version, hop budget, a random transfer ID, fragment index and fragment count. Payloads are limited to 64 KiB; files need another transport.

The prototype supports discovery and authenticated connection through an injected native transport. Its persistent outbox interface retains messages until explicit application acknowledgement, with a 24-hour expiry and a 100-message cap. Incomplete incoming transfers expire after 60 seconds, with bounded reassembly/deduplication tables and a seven-hop budget. No invoice, catalogue or payment operation is peer-capable. The resolver can accept this provider only for `conversations.message.send`.

## Platform boundary and recommendation

The current web Settings clearly reports nearby messaging as unavailable. There is no simulated browser radio and no production BLE binding. A native host must implement radio permissions, advertising, discovery, encrypted authenticated sessions and an outbox protected at rest. Peer identity must come from that authenticated transport, never a display name. Message content is still untrusted application input after transport decoding. The prototype's envelope validation is structural, not cryptographic verification or participant authorization.

Proceed with native-device experiments only. Keep PWA rollout limited to local business storage; do not claim production mesh support. Unit tests cover framing, UTF-8 reconstruction, duplicate suppression, disconnect queuing and acknowledgement. Real Android/iOS radios, adversarial peer authentication, battery drain and background relay require separate device testing before enabling peer calls in the application.
