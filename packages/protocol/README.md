# `@three-game-kit/protocol`

Protocol defines the bounded version 1 JSON message schemas, types, encoding, decoding, and public limits for client/server communication.

## Public imports

- `@three-game-kit/protocol`

```js
import { JoinMessageSchema, PROTOCOL_VERSION } from "@three-game-kit/protocol";

const join = JoinMessageSchema.parse({ protocolVersion: PROTOCOL_VERSION, kind: "join" });
```

## Ownership and disposal

Protocol schemas and codecs own no runtime resources and require no disposal. Successful decoding establishes message shape only: the server owns connection identity, ownership resolution, command admission, and authoritative state mutation.

## Bounded MVP

- The wire format is version 1 JSON carried as bounded text frames.
- Public schemas cover join, command, joined, snapshot, rejected, movement, and interaction data.
- IDs, coordinates, sequences, ticks, queues, snapshots, and encoded messages have explicit limits.
- Direction, phase, ownership, tick-window, and gameplay checks remain server responsibilities beyond schema validation.

See the [Three Game Kit repository documentation](https://github.com/takahirox/three-game-kit#documentation) for the normative protocol and authority contract.

## Environment and verification

- Node.js 24
- Native ESM
- License: UNLICENSED
- Repository verification: `pnpm verify:m5`
