# Relic Frontier architecture and co-op evolution

## Current boundary

Relic Frontier is a local authoritative host today, but game rules already follow:

```text
keyboard / mouse / QA adapter
  → semantic movement and action input
  → intent (attack, ability, interact, item use)
  → shared public gameplay runtimes
  → simulation snapshot and bounded events
  → camera / HUD / animation transforms / VFX / Three.js presentation
```

Device events never enter combat or progression rules. The game-specific scheduled Feature consumes semantic actions and asks public Health, Trigger, Inventory, Ability, Projectile, AI, and Game Flow runtimes to mutate validated state. Presentation reads immutable snapshots and cannot grant damage, items, Relic ownership, or progression.

## Migration to authoritative 2–4 player co-op

The local host can move to `@three-game-kit/server` without rewriting presentation:

| State/rule | Future owner | Client role |
| --- | --- | --- |
| Player movement and dash | server validation with client prediction | send semantic commands, reconcile snapshots |
| Health, enemy AI, projectile hits | authoritative server Features | predict feedback; accept correction |
| Pickup, inventory, upgrades, Relic | server transaction and ownership IDs | request intent; display accepted state |
| Abilities/cooldowns | server Ability Feature | predict cast; handle structured rejection |
| Triggers, mechanisms, encounters, flow | server gameplay tick | interpolate/announce replicated events |
| Spawn/despawn | server stable entity IDs | instantiate presentation prefabs |
| Camera, HUD, animation, audio, VFX, post-processing | client only | derive from snapshots/events |
| Objective guidance, prompts, onboarding | client derivation per player from replicated state | keep `snapshot.guidance[playerId]` local; it never gates progression |

The next version would add connection-owned player IDs, protocol routes for bounded intents and snapshots, server-side actor positions for Trigger evaluation, and replication IDs for enemies/projectiles/items. Existing stable string IDs and tick-based cooldowns can cross that boundary unchanged. The client-only renderer and QA camera remain unaware of transport.

No networking is included now: this document preserves the seam without prematurely adding lobbies, matchmaking, identity, or backend infrastructure.
