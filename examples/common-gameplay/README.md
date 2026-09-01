# Common gameplay example

This external-style browser example composes the public UI/HUD, Trigger Area,
Health/Damage, Spawn/Prefab, and Game State/Flow APIs. It imports only package
entry points, uses shared deterministic models for rule state, and installs the
client wrappers for prediction, presentation, and lifecycle ownership.

Run `pnpm test:common-gameplay` for the Chromium acceptance test or
`pnpm verify:common-gameplay` for type, Node, and browser coverage.
