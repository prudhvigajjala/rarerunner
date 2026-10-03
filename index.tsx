"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { GameMenu } from "@rarefriends/friendsdk/frame";
import { formatGameAmount } from "@rarefriends/friendsdk/ui";
import { createFriendSoundKit } from "@rarefriends/friendsdk/sounds";
import "@rarefriends/friendsdk/frame.css";
import "./style.css";
import { H, W, SURGE_COOLDOWN, createRun, familyFor, jump, moveLane, score, slide, step, surge, type Run } from "./engine";
import { COLOR, MONO, draw } from "./render";
import { buildSpriteCanvas, loadHeroSprite, type HeroSprite } from "./sprite";

// ---------------------------------------------------------------------------
// Simulated session economy. Nothing here is real RF: no wallet writes, no
// transactions, no signer. It lives in memory and resets when the session reloads.
// ---------------------------------------------------------------------------
const UNIT = 10n ** 18n;
const COIN_COST = 5n * 10n ** 16n; // 0.05 simulated RF per coin pickup
const START_BALANCE = 5n * UNIT;
const TOP_UP = 5n * UNIT;

const fmt = (v: bigint) => formatGameAmount(v, 18);
const sim = (v: bigint) => `${fmt(v)} RF simulated`;

interface Cosmetic {
  id: string;
  name: string;
  note: string;
  cost: bigint;
}

const COSMETICS: readonly Cosmetic[] = [
  { id: "trail-pulse", name: "Pulse Trail", note: "Afterimages follow your Friend.", cost: 5n * 10n ** 17n },
  { id: "halo-gold", name: "Gold Halo", note: "Swaps the white sprite halo for gold.", cost: 75n * 10n ** 16n },
  { id: "track-grid", name: "Grid Track", note: "Denser cross-lines on the track.", cost: UNIT },
];

interface FeedItem {
  id: number;
  text: string;
}

interface Eco {
  balance: bigint;
  burned: bigint;
  runPool: bigint;
  treasury: bigint;
  owned: string[];
  equipped: string[];
  feed: FeedItem[];
  feedId: number;
}

const newEco = (): Eco => ({ balance: START_BALANCE, burned: 0n, runPool: 0n, treasury: 0n, owned: [], equipped: [], feed: [], feedId: 1 });

function pushFeed(eco: Eco, text: string) {
  eco.feed = [{ id: eco.feedId++, text }, ...eco.feed].slice(0, 4);
}

// 50/50 split: half is burned, half goes to the rewards pool.
function split(amount: bigint): [bigint, bigint] {
  const burn = amount / 2n;
  return [burn, amount - burn];
}

type Phase = "ready" | "running" | "over";
type Menu = "shop" | "settings" | null;

interface Result {
  score: number;
  coins: number;
  burned: bigint;
  payout: bigint;
  best: number;
  newBest: boolean;
}

const useReducedMotion = () => {
  const [reduced, setReduced] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
};

export default function RareRunner({ friendId, client, paused }: GameComponentProps) {
  const family = useMemo(() => familyFor(friendId), [friendId]);
  const systemReduced = useReducedMotion();

  const [loaded, setLoaded] = useState<HeroSprite | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhaseState] = useState<Phase>("ready");
  const [menu, setMenu] = useState<Menu>(null);
  const [muted, setMuted] = useState(false);
  const [colorMode, setColorMode] = useState(false);
  const [reduceOverride, setReduceOverride] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const [shopMessage, setShopMessage] = useState("");
  const [, force] = useReducer((n: number) => n + 1, 0);

  const reduced = systemReduced || reduceOverride;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runRef = useRef<Run>(createRun(family.perk));
  const ecoRef = useRef<Eco>(newEco());
  const phaseRef = useRef<Phase>("ready");
  const bestRef = useRef(0);
  const resultRef = useRef<Result | null>(null);
  const runBurnedRef = useRef(0n);
  const overAtRef = useRef(0);
  const shakeRef = useRef(0);
  const emptyNoticeRef = useRef(0);
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const kitRef = useRef<ReturnType<typeof createFriendSoundKit> | null>(null);
  const spriteCache = useRef<Map<string, HTMLCanvasElement>>(new Map());

  // Latest-value refs so the animation loop and key handlers never go stale.
  const live = useRef({ paused, menu, autoPaused, reduced, colorMode, family, loaded });
  live.current = { paused, menu, autoPaused, reduced, colorMode, family, loaded };

  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  // --- Load: client.read() at startup (SDK rule) plus the Friend sprite -----
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoaded(null);
    setError("");
    ecoRef.current = newEco();
    bestRef.current = 0;
    resultRef.current = null;
    runRef.current = createRun(family.perk);
    phaseRef.current = "ready";
    setPhaseState("ready");
    spriteCache.current.clear();

    void Promise.all([client.read(), loadHeroSprite(friendId, controller.signal)])
      .then(([snapshot, sprite]) => {
        if (!active) return;
        if (snapshot.friendId !== friendId) {
          setError("This game session does not match the selected Friend.");
          return;
        }
        setLoaded(sprite);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load the game.");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [client, friendId, family, attempt]);

  // --- Sound kit (mute control via createFriendSoundKit) --------------------
  useEffect(() => {
    let kit: ReturnType<typeof createFriendSoundKit> | null = null;
    try {
      kit = createFriendSoundKit();
      kitRef.current = kit;
    } catch {
      kitRef.current = null;
    }
    return () => {
      try {
        kit?.dispose();
      } catch {
        // ignore
      }
      kitRef.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      kitRef.current?.setMuted(muted);
    } catch {
      // ignore
    }
  }, [muted]);

  const play = useCallback((cue: string) => {
    try {
      (kitRef.current?.play as unknown as ((name: string) => void) | undefined)?.call(kitRef.current, cue);
    } catch {
      // Audio is optional; never break the run.
    }
  }, []);

  const unlockAudio = useCallback(() => {
    try {
      void (kitRef.current?.unlock as unknown as (() => Promise<void> | void) | undefined)?.call(kitRef.current);
    } catch {
      // ignore
    }
  }, []);

  // --- Pause on blur / hidden tab ------------------------------------------
  useEffect(() => {
    const pause = () => {
      if (phaseRef.current === "running") {
        setAutoPaused(true);
        force();
      }
    };
    const onVisibility = () => {
      if (document.hidden) pause();
    };
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // --- Economy actions ------------------------------------------------------
  const spendCoin = useCallback(() => {
    const eco = ecoRef.current;
    if (eco.balance < COIN_COST) {
      const now = performance.now();
      if (now - emptyNoticeRef.current > 2500) {
        emptyNoticeRef.current = now;
        pushFeed(eco, "Simulated RF empty - coin counts for score only. Top up in the shop.");
      }
      return;
    }
    const [burn, rewards] = split(COIN_COST);
    eco.balance -= COIN_COST;
    eco.burned += burn;
    eco.runPool += rewards;
    runBurnedRef.current += burn;
    pushFeed(eco, `Coin: -${sim(COIN_COST)} | burn ${fmt(burn)} | rewards ${fmt(rewards)}`);
  }, []);

  const endRun = useCallback(() => {
    const eco = ecoRef.current;
    const run = runRef.current;
    const finalScore = score(run, live.current.family.perk);
    const payout = eco.runPool;
    eco.balance += payout;
    eco.runPool = 0n;
    if (payout > 0n) pushFeed(eco, `Run payout: +${sim(payout)} from the rewards pool`);
    const newBest = finalScore > bestRef.current;
    if (newBest) bestRef.current = finalScore;
    resultRef.current = { score: finalScore, coins: run.collected, burned: runBurnedRef.current, payout, best: bestRef.current, newBest };
    overAtRef.current = performance.now();
    shakeRef.current = 1;
    play("hit");
    setPhase("over");
  }, [play]);

  const begin = useCallback(() => {
    unlockAudio();
    runRef.current = createRun(live.current.family.perk);
    runBurnedRef.current = 0n;
    ecoRef.current.runPool = 0n;
    resultRef.current = null;
    shakeRef.current = 0;
    setAutoPaused(false);
    setPhase("running");
  }, [unlockAudio]);

  // --- Input ----------------------------------------------------------------
  const inputBlocked = () => live.current.paused || live.current.menu !== null;

  const tap = useCallback(() => {
    if (inputBlocked()) return;
    if (live.current.autoPaused) {
      setAutoPaused(false);
      return;
    }
    if (phaseRef.current === "ready") begin();
    else if (phaseRef.current === "over" && performance.now() - overAtRef.current > 500) begin();
  }, [begin]);

  const act = useCallback(
    (action: "left" | "right" | "jump" | "slide" | "surge") => {
      if (inputBlocked()) return;
      if (phaseRef.current !== "running") {
        if (action !== "surge") tap();
        return;
      }
      if (live.current.autoPaused) return;
      const run = runRef.current;
      if (action === "left") moveLane(run, -1);
      else if (action === "right") moveLane(run, 1);
      else if (action === "jump") {
        if (jump(run)) play("jump");
      } else if (action === "slide") slide(run);
      else if (surge(run)) play("powerup");
    },
    [play, tap],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const onButton = target?.tagName === "BUTTON";
      switch (event.key) {
        case "ArrowLeft":
          act("left");
          break;
        case "ArrowRight":
          act("right");
          break;
        case "ArrowUp":
          act("jump");
          break;
        case "ArrowDown":
          act("slide");
          break;
        case " ":
          if (onButton) return;
          act("jump");
          break;
        case "x":
        case "X":
        case "Shift":
          act("surge");
          break;
        case "Enter":
          if (onButton) return;
          tap();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, tap]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    swipeRef.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) {
      tap();
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) act(dx < 0 ? "left" : "right");
    else act(dy < 0 ? "jump" : "slide");
  };

  // --- Animation loop -------------------------------------------------------
  useEffect(() => {
    if (!loaded) return;
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;

    let raf = 0;
    let last = performance.now();
    let hudClock = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const state = live.current;
      const run = runRef.current;
      const eco = ecoRef.current;
      const running = phaseRef.current === "running" && !state.paused && !state.autoPaused && state.menu === null;

      if (running) {
        const result = step(run, dt, state.family.perk);
        for (let i = 0; i < result.collected; i++) spendCoin();
        if (result.collected > 0) play("coin");
        if (result.smashed || result.shieldBroke) shakeRef.current = 0.6;
        if (result.hit) endRun();
      } else if (!state.reduced && !state.paused && !state.autoPaused && state.menu === null) {
        run.dist += 220 * dt; // idle scenery drift on the ready and results screens
      }
      shakeRef.current = Math.max(0, shakeRef.current - dt * 2.2);

      const halo = eco.equipped.includes("halo-gold") ? "#FFD84A" : "#FFFFFF";
      const key = halo;
      let sprite = spriteCache.current.get(key);
      if (!sprite) {
        sprite = buildSpriteCanvas(state.loaded?.mask ?? [], halo);
        spriteCache.current.set(key, sprite);
      }
      draw(g, run, {
        pal: state.colorMode ? COLOR : MONO,
        cos: { trail: eco.equipped.includes("trail-pulse"), grid: eco.equipped.includes("track-grid") },
        sprite,
        reduced: state.reduced,
        time: now / 1000,
        shake: shakeRef.current,
      });

      hudClock += dt;
      if (hudClock > 0.12) {
        hudClock = 0;
        force();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [loaded, spendCoin, endRun, play]);

  // --- Shop -----------------------------------------------------------------
  const buyCosmetic = (item: Cosmetic) => {
    const eco = ecoRef.current;
    if (eco.owned.includes(item.id)) {
      eco.equipped = eco.equipped.includes(item.id) ? eco.equipped.filter((id) => id !== item.id) : [...eco.equipped, item.id];
      setShopMessage("");
      force();
      return;
    }
    if (eco.balance < item.cost) {
      setShopMessage("Not enough simulated RF. Collect coins or top up.");
      return;
    }
    const [burn, rewards] = split(item.cost);
    eco.balance -= item.cost;
    eco.burned += burn;
    eco.treasury += rewards;
    eco.owned = [...eco.owned, item.id];
    eco.equipped = [...eco.equipped, item.id];
    pushFeed(eco, `Shop: ${item.name} -${sim(item.cost)} | burn ${fmt(burn)} | rewards ${fmt(rewards)}`);
    setShopMessage(`${item.name} equipped.`);
    play("confirm");
    force();
  };

  const topUp = () => {
    ecoRef.current.balance += TOP_UP;
    pushFeed(ecoRef.current, `Preview top-up: +${sim(TOP_UP)}`);
    force();
  };

  // --- Render ---------------------------------------------------------------
  if (error || !loaded) {
    return (
      <div className="runner-loading" role={error ? "alert" : "status"}>
        <div className="runner-loading-mark">&gt;&gt;&gt;</div>
        <strong>{error || "Syncing your Friend..."}</strong>
        {error && (
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        )}
      </div>
    );
  }

  const run = runRef.current;
  const eco = ecoRef.current;
  const result = resultRef.current;
  const cooldown = run.player.cooldown;
  const surgeReady = phase === "running" && cooldown <= 0 && run.player.surge <= 0;
  const stopped = paused || autoPaused;

  return (
    <section className="runner" aria-label="Rare Runner" aria-busy={false}>
      <div className="runner-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (swipeRef.current = null)}>
        <canvas ref={canvasRef} className="runner-canvas" width={W} height={H} role="img" aria-label="Endless runner track with your Rare Friend running down three lanes" />

        <div className="hud hud-score">
          <span>DISTANCE</span>
          <strong>{score(run, family.perk)} m</strong>
          <small>BEST {bestRef.current} m</small>
        </div>

        <div className="hud hud-balance">
          <span>SIMULATED RF</span>
          <strong>{fmt(eco.balance)} RF</strong>
          <small>
            burned {fmt(eco.burned)} | rewards pool {fmt(eco.runPool + eco.treasury)}
          </small>
        </div>

        <div className="hud hud-buttons">
          <button type="button" onClick={() => setMenu("shop")}>Shop</button>
          <button type="button" onClick={() => setMenu("settings")}>Settings</button>
          <button type="button" aria-pressed={muted} onClick={() => setMuted((v) => !v)}>{muted ? "Sound off" : "Sound on"}</button>
        </div>

        <ul className="hud hud-feed" aria-label="Simulated RF activity feed">
          {eco.feed.map((item) => (
            <li key={item.id}>{item.text}</li>
          ))}
        </ul>

        <div className="hud hud-run">
          <span>COINS (SIMULATED)</span>
          <strong>{run.collected}</strong>
          <small>{family.name} | {family.passive}</small>
        </div>

        {phase === "running" && (
          <button type="button" className="ability-button" disabled={!surgeReady || stopped} onClick={() => act("surge")}>
            <span>{family.ability}</span>
            <small>{cooldown > 0 && run.player.surge <= 0 ? `${Math.ceil(cooldown)}s` : run.player.surge > 0 ? "ACTIVE" : "READY (X)"}</small>
          </button>
        )}

        {phase === "ready" && !stopped && menu === null && (
          <div className="overlay" role="dialog" aria-label="Start">
            <p className="eyebrow">RARE FRIENDS / ENDLESS RUN</p>
            <h1>Rare<span>Runner</span></h1>
            <div className="hero-card">
              <strong>{family.name} family</strong>
              <p><b>Passive - {family.passive}:</b> {family.passiveText}</p>
              <p><b>Signature - {family.ability}:</b> {SURGE_COOLDOWN}s cooldown; smash through obstacles for 2.5s at higher speed.</p>
              <small>Traits are game-defined from your Friend ID, not canonical Rare Friends data.</small>
              {loaded.source === "fallback" && <small className="warn">Showing a fallback sprite: the SDK sprite reader call needs wiring (see README).</small>}
            </div>
            <p className="controls">Arrows / swipe: lanes, jump, slide | X or button: ability</p>
            <p className="cta">TAP OR PRESS SPACE TO RUN</p>
            <p className="fine">Every coin is a simulated 0.05 RF spend, split 50/50 burn and rewards. All RF here is simulated.</p>
          </div>
        )}

        {phase === "over" && result && !stopped && menu === null && (
          <div className="overlay" role="dialog" aria-label="Run results">
            <p className="eyebrow">RUN OVER</p>
            <h2>{result.score} m</h2>
            {result.newBest && <p className="best">NEW SESSION BEST</p>}
            <dl className="results">
              <div><dt>Best (session)</dt><dd>{result.best} m</dd></div>
              <div><dt>Coins (simulated)</dt><dd>{result.coins}</dd></div>
              <div><dt>Burned</dt><dd>{sim(result.burned)}</dd></div>
              <div><dt>Rewards paid out</dt><dd>{sim(result.payout)}</dd></div>
            </dl>
            <p className="cta">TAP OR PRESS SPACE TO RETRY</p>
            <p className="fine">Scores and simulated RF reset when the session reloads.</p>
          </div>
        )}

        {stopped && (
          <div className="overlay overlay-pause" role="status">
            <h2>Paused</h2>
            <p className="cta">{paused ? "Close the menu to continue" : "TAP TO RESUME"}</p>
          </div>
        )}
      </div>

      {menu && (
        <GameMenu title={menu === "shop" ? "Cosmetics shop" : "Settings"} onClose={() => setMenu(null)}>
          {menu === "shop" && (
            <div className="menu-stack">
              <p>
                Balance: <b>{sim(eco.balance)}</b>. Purchases split 50/50: half burned, half to the rewards pool. All simulated.
              </p>
              {COSMETICS.map((item) => {
                const owned = eco.owned.includes(item.id);
                const equipped = eco.equipped.includes(item.id);
                return (
                  <div className="shop-row" key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <small>{item.note} {owned ? (equipped ? "Equipped." : "Owned.") : `${sim(item.cost)}`}</small>
                    </div>
                    <button type="button" onClick={() => buyCosmetic(item)}>{owned ? (equipped ? "Unequip" : "Equip") : "Buy"}</button>
                  </div>
                );
              })}
              <button type="button" onClick={topUp}>Preview top-up: +{sim(TOP_UP)}</button>
              {shopMessage && <p role="status">{shopMessage}</p>}
              <p className="fine-print">Prototype shop: a real RF adapter would replace these in-memory balances later. Nothing is persisted or on-chain.</p>
            </div>
          )}
          {menu === "settings" && (
            <div className="menu-stack">
              <button type="button" aria-pressed={!muted} onClick={() => setMuted((v) => !v)}>{muted ? "Sound off" : "Sound on"}</button>
              <button type="button" aria-pressed={colorMode} onClick={() => setColorMode((v) => !v)}>{colorMode ? "Colour mode: on" : "Colour mode: off (monochrome)"}</button>
              <button type="button" aria-pressed={reduced} disabled={systemReduced} onClick={() => setReduceOverride((v) => !v)}>
                {systemReduced ? "Reduced motion: on (system setting)" : reduceOverride ? "Reduced motion: on" : "Reduced motion: off"}
              </button>
              <p>Wallet connection, Friend selection and the ownership gate come from FriendSDK. This game adds no wallet flow.</p>
              <p className="fine-print">Controls: arrows or swipe to change lanes, jump, slide. X or the ability button for your signature ability. The game pauses when this tab loses focus.</p>
            </div>
          )}
        </GameMenu>
      )}
    </section>
  );
}
