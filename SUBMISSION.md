# Rare Friends Vibeathon: Rare Runner

**Builder / contact:** TODO
**Category:** Character Spotlight (also designed for Token Activity and Economy Potential)

## One-line pitch

**Rare Runner** is a three-lane endless runner where your Rare Friend's own sprite is the hero, every coin is a simulated RF spend split between burn and rewards, and a cosmetics shop turns coins into a session economy.

## What is implemented

- FriendSDK runtime for wallet connection, Friend selection and the ownership gate; no second wallet flow, signer or contract.
- Endless runner: three lanes, jump / slide / lane change, low barriers, high bars, blocked lanes, coin lines and arcs, speed ramp, session best score.
- Keyboard and swipe controls, tap to start and retry, pause on blur and hidden tab, mute, reduced motion, loading and error states.
- Character Spotlight: canonical-style 16x16 one-bit sprite with white halo; game-defined family passive and signature ability.
- Token Activity: each coin pickup is a simulated 0.05 RF spend, split 50% burn / 50% rewards, with a live HUD feed.
- Economy Potential: simulated-RF cosmetics shop (Pulse Trail, Gold Halo, Grid Track), 50/50 burn and rewards on purchases.

## Economy (all simulated)

| Action | Simulated cost | Burn | Rewards |
|---|---:|---:|---:|
| Coin pickup | 0.05 RF | 0.025 | 0.025 (paid back to the runner at run end) |
| Pulse Trail | 0.50 RF | 0.25 | 0.25 |
| Gold Halo | 0.75 RF | 0.375 | 0.375 |
| Grid Track | 1.00 RF | 0.50 | 0.50 |

No real RF, no wallet writes. `game.json` holds placeholder chance-game terms the runtime requires; they are not game mechanics.

## Future direction (needs SDK support)

A real RF adapter for per-coin spends, burn and reward-pool accounting, and persistent cosmetics. The v0.1 SDK has no upgrade, additional-currency or persistence API.

## Source and preview

Source: `games/rare-runner` (SDK v0.1.x). Public preview: `TODO: GitHub Pages URL`

## Checks and known issues

TODO: paste results of `npm test`, `npm run typecheck`, `npm run check:games`, `npm run check:browser`.
Known: sprite adapter may show a fallback sprite until wired to the exact reader API (see README).
