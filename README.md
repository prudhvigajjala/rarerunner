# Rare Runner

Play here : https://rarerunner.netlify.app/

An endless runner for the Rare Friends Vibeathon, built for FriendSDK v0.1.x. Your selected Rare Friend runs down three lanes, jumping low barriers, sliding under high bars and dodging blocked lanes. One hit ends the run.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Change lane | Left / Right arrows | Swipe left / right |
| Jump (also fast-fall mid-air with Down) | Up arrow or Space | Swipe up |
| Slide | Down arrow | Swipe down |
| Signature ability | X or Shift | On-screen ability button |
| Start / retry / resume | Space, Enter | Tap |

The game pauses when the runtime menus are open (`paused` prop), when the tab is hidden, and when the window loses focus. Tap to resume.

## Rules

- Distance score in metres; speed ramps from 620 to a cap of 1400 units/s over about 100 seconds. Best score is kept for the session only.
- Obstacles: low barriers (jump), high bars (slide), blocked lanes (change lane). Every row has a way through.
- Coins appear in lines and arcs. Arc coins reward a well-timed jump.
- **Character Spotlight:** the Friend's one-bit 16x16 sprite is the hero, drawn at integer scale with a black mask and one-pixel white halo. Each Friend gets a game-defined family (derived from the Friend ID: Volt, Gale, Shell, Wake or Redline) with a passive and a signature ability (2.5s of smashing through obstacles at higher speed, 18s cooldown). These traits are game-defined, not canonical Rare Friends data.
- **Token Activity:** every coin pickup is a simulated spend of **0.05 RF**, split 50/50: half is burned, half goes to a rewards pool. A live HUD feed shows each split. The runner's rewards share is paid back at the end of the run.
- **Economy Potential:** a cosmetics shop spends simulated RF (Pulse Trail 0.5, Gold Halo 0.75, Grid Track 1.0; each split 50/50 burn and rewards). A free preview top-up button refills the simulated balance. The in-memory ledger is written so a real RF adapter could replace it later.

## Everything economic is simulated

All balances, coin spends, burns, rewards and shop purchases live in memory and reset when the session reloads. The game uses no real RF, no signer, no transaction adapter and no contracts. Coins are labelled "simulated" wherever they appear.

`game.json` contains placeholder terms only (price 1 RF, two outcomes totalling 10,000 bp). The current runtime requires a chance-game definition even for games that do not use its economy actions. Rare Runner does not implement or use those terms as mechanics.

## Look and feel

Monochrome signal green (`#CCFF00`) on dark by default. An optional colour mode is in Settings (a local palette, since `GAME_PALETTE`'s import path is not documented in API.md). Reduced motion (system setting or Settings toggle) disables screen shake, afterimages, flashes and idle scenery drift. Mute is provided through `createFriendSoundKit`.

## Run it (from the FriendSDK checkout)

Node.js 22+ required.

```bash
npm ci
npm run build
# copy this folder to games/rare-runner, then:
npm run dev:game -- games/rare-runner --host 0.0.0.0 --port 4173
```

Open `http://YOUR_COMPUTER_LAN_IP:4173` on your phone, in a browser with your wallet. A wallet on Robinhood mainnet (chain 4663) holding a Generations NFT (generation 1 or higher) is required, even for previews.

## Checks

```bash
npm test
npm run typecheck
npm run check:games
npx playwright install --with-deps chromium
npm run check:browser
npx friendsdk test games/rare-runner --screenshot ./artifacts/runner.png --width 360
```

## Files

- `index.tsx` React component, SDK integration, input, loop, simulated economy, shop, HUD
- `engine.ts` pure game logic (lanes, physics, obstacles, coins, families)
- `render.ts` canvas renderer
- `sprite.ts` Friend sprite adapter and mask/halo pre-render
- `game.json`, `host.css`, `style.css`

## Known gaps

- `sprite.ts` is the one place that depends on the exact `createFriendReader` / `spriteFrame` signatures. It tries the documented entry points and falls back to a built-in sprite (with an on-screen notice) if they do not return a 16x16 mask. Wire `read` to the real API if the notice appears.
- Sound cue names (`jump`, `coin`, `hit`, `powerup`, `confirm`) are guesses; unknown cues fail silently.
- `RewardReveal` is not used; the results screen is custom.
