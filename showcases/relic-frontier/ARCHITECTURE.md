# Relic Frontier architecture and co-op evolution

## Current boundary

Relic Frontier is a local authoritative host today, but game rules already follow:

```text
keyboard / mouse / QA adapter
  → semantic movement and action input (attack-light, attack-heavy, dodge, lock-on, ability, interact, use-item)
  → tick-authoritative combat state (startup / active / recovery, dodge invulnerability, reactions)
  → shared public runtimes (Hit Query, Lock-On, Health, Projectile, Ability, Simple AI, Trigger, Checkpoint, Inventory, Game Flow)
  → simulation snapshot, animation cues, and bounded events
  → camera / HUD / animation mixers / telegraphs / VFX / Three.js presentation
```

Device events never enter combat or progression rules. The game-specific scheduled Feature consumes semantic actions, advances the combat timers, asks the public Hit Query for targets, and asks Health, Trigger, Inventory, Ability, Projectile, AI, Lock-On, Checkpoint, and Game Flow runtimes to mutate validated state. Presentation reads immutable snapshots: animation runtimes are told which clip to play and how fast, telegraphs read attack phase and tick counters, and the reticle reads `snapshot.lockOn`. Nothing in the presentation can grant damage, invulnerability, a target, items, Relic ownership, a checkpoint, or progression.

## Migration to authoritative 2–4 player co-op

The local host can move to `@three-game-kit/server` without rewriting presentation:

| State/rule | Future owner | Client role |
| --- | --- | --- |
| Player movement, dodge, facing | server validation with client prediction | send semantic commands, reconcile snapshots |
| Attack windows, hit queries, damage, reactions, knockback | authoritative server tick using the same shared Hit Query and Health runtimes | predict swings and feedback; accept corrections |
| Lock-on target | client intent; server validates the target on each attack | keep the Lock-On runtime local for camera/HUD, send `targetId` with attack intents |
| Enemy AI, telegraphs, projectile hits | authoritative server Features | interpolate positions; derive telegraphs from replicated attack state |
| Checkpoints and respawn | server Checkpoint runtime with a per-player respawn policy | display the downed state and countdown from replicated events |
| Pickup, inventory, upgrades, Relic | server transaction and ownership IDs | request intent; display accepted state |
| Abilities/cooldowns | server Ability Feature | predict cast; handle structured rejection |
| Triggers, mechanisms, encounters, flow | server gameplay tick | announce replicated events |
| Spawn/despawn | server stable entity IDs | instantiate rig clones per replicated character |
| Camera, HUD, animation, audio, VFX, telegraphs | client only | derive from snapshots, animation cues, and events |
| Objective guidance, prompts, onboarding | client derivation per player from replicated state | keep `snapshot.guidance[playerId]` local; it never gates progression |

The animation cue contract (`state`, `oneShot`, `sequence`, `durationTicks`) is already a replicable value type: a server that replicates it lets every client play the same one-shot at the same rate without replicating mixer state. Existing stable string IDs and tick-based timers cross that boundary unchanged; the client-only renderer and QA camera remain unaware of transport.

No networking is included now: this document preserves the seam without prematurely adding lobbies, matchmaking, identity, or backend infrastructure.
