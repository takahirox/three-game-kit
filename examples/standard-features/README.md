# Standard Features browser example

This external-style page composes the public Audio, Asset Manager, Animation,
and Character Controller entrypoints. Click **Run standard Features** to unlock
Web Audio from a user gesture, load a glTF asset through a manifest group,
advance animation and character locomotion on fixed ticks, then shut down and
verify that every owned resource is disposed.

Run `pnpm test:standard-features` for the Chromium acceptance test or
`pnpm typecheck:standard-features` for the consumer-facing type boundary.
