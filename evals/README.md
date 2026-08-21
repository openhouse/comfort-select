# Actuation reliability evals

`actuation-reliability.json` is a deterministic gold set for the controller-to-bridge state boundary. It includes the failure sequence observed on 2026-08-21 plus success, partial failure, disabled-device, missing-transport, known-prior-state, and explicit-reassert cases.

Run `npm run eval` for the focused score. Run `npm run hill-climb` to require a perfect focused score, the full unit suite, and a TypeScript build. When a new production failure appears, add the smallest representative case before changing implementation, observe the score fall, then repair until the entire set returns to 100%.
