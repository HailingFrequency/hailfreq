# Lounge Voice UX Redesign — Design Spec

**Date:** 2026-06-22  
**Status:** Approved  
**Scope:** Lounge mode only. Operations mode is deferred.

---

## Problem

The current voice UX opens a center console when a voice channel is clicked. That console shows P90/P70 net cards with Tap/Monitor buttons, volume sliders, and chirp settings. It is clunky — the user wants it to feel like Discord: click to join, right-click to monitor, with voice controls always visible but never in the way.

---

## Decision: Option C — Click-to-join + Thin Radio Bar

### Core interaction model

- **Click** a voice channel row → join immediately (no modal, no navigation)
- **Right-click** a voice channel row → context menu: Join / Monitor / PTT Settings… / Leave
- **Monitor mode** (listen-only): accessible only via right-click. Joining normally always activates PTT-capable mode.
- While connected, the **RadioBar** at the bottom of the sidebar is the sole voice control surface.

---

## Components

### 1. `RadioBar` (new — `client/src/renderer/components/RadioBar.tsx`)

Replaces the current voice status area at the bottom of the sidebar.

**Layout (two rows, ~68px total height):**
```
┌────────────────────────────────┐
│ 📻 Lounge P70         [P70]   │  ← channel name + freq tag
│ [  🎤 PTT  Space  ──────] 🔇 ↩ │  ← PTT btn + mute + disconnect
└────────────────────────────────┘
```

**Behaviour:**
- Rendered only when `voiceEngine` has an active connection
- PTT button glows cyan (`brand-500`) and pulses while the user is transmitting
- PTT button label shows the currently bound key (e.g. `Space`)
- Mute button toggles local mic mute via `voiceEngine.setMuted()`
- Disconnect button calls `voiceEngine.leave()`
- The component polls `voiceEngine` for transmit state at 100 ms intervals (same pattern as RosterPanel)

**Props:**
```ts
interface RadioBarProps {
  channelName: string;
  freqTag: string;        // e.g. "P70"
  pttKey: string;         // display label for the bound key
  isTransmitting: boolean;
  isMuted: boolean;
  onDisconnect: () => void;
  onToggleMute: () => void;
  onPttDown: () => void;
  onPttUp: () => void;
}
```

### 2. `ChannelList.tsx` — click and right-click behaviour

**Left-click on a voice channel:**
- If not connected: call `voiceEngine.join(roomId)` directly
- If connected to a different channel: leave current, then join new
- If connected to this same channel: no-op (already there)

**Right-click on a voice channel — context menu items:**
| Item | Action |
|---|---|
| 📻 Join Channel | `voiceEngine.join(roomId)` |
| 👂 Monitor (listen-only) | `voiceEngine.joinMonitor(roomId)` |
| ⌨️ PTT Key: `Space` | display only / opens PTT settings |
| ⚙️ PTT Settings… | open existing PTT settings panel |
| ↩ Leave Channel | `voiceEngine.leave()` |

Context menu is shown/hidden via local React state (`useState<{x,y}|null>`). Clicking outside dismisses it.

**Connected channel row styling:**
- Subtle cyan border + pulsing dot (`voice-live-dot` animation) while connected
- Participant sub-rows beneath — already implemented

### 3. `Home.tsx` / `LoungeSidebar` — remove center console

- Remove the `onClick → setActiveVoiceChannel` navigation that currently opens `VoiceChannelView`
- Pass `onVoiceChannelClick(roomId)` and `onVoiceChannelRightClick(roomId, x, y)` down to `ChannelList`
- Pass RadioBar props (transmitting state, muted state, handlers) down to the sidebar

### 4. `VoiceChannelView.tsx` — retired from Lounge mode

- The component itself is not deleted (may be reused in Operations mode later)
- It is simply no longer rendered in Lounge mode — the sidebar + RadioBar replace its role entirely

---

## VoiceEngine additions

**Existing API used directly:**
- `monitorNet({ matrixRoomId, priority })` — connect to a LiveKit room (listen + optional PTT). Used for both click-to-join and right-click Monitor.
- `unmonitorNet(matrixRoomId)` — disconnect from a channel.
- `startPtt(matrixRoomId)` / `stopPtt()` — key down / key up.
- `pttStateChanged` event — fired with the active net roomId (or null) when PTT starts/stops.

**New additions needed:**
- `getActivePttNet(): string | null` — public getter for `activePttNet`. Lets RadioBar poll transmit state without subscribing to the single-slot event. (1-line addition.)
- Mute: no `setMuted` exists. Mute is implemented as a RadioBar-local boolean flag. When muted, the PTT key handler in Home.tsx checks the flag and skips `startPtt`. RadioBar displays mic-off state visually.

---

## State flow

```
User clicks voice channel
  → ChannelList.onVoiceChannelClick(roomId)
    → Home: voiceEngine.monitorNet({ matrixRoomId: roomId, priority: 0 })
      → VoiceEngine connects LiveKit
        → Home polls every 500 ms (existing pattern)
          → voiceParticipants, activeSpeakers updated
            → ChannelList re-renders participant sub-rows
            → RadioBar shows connected state
```

PTT hold:
```
User holds Space (global key listener, existing)
  → Home/VoiceEngine.startPtt()
    → RadioBar polls isTransmitting → glows cyan
User releases Space
  → VoiceEngine.stopPtt()
    → RadioBar returns to idle state
```

---

## What is NOT changing

- PTT keybind registration (`node-global-key-listener`) — same mechanism
- Participant sub-rows in `ChannelList` — already shipped in v0.3.1
- `RosterPanel` — untouched
- `CreateChannelDialog` — untouched
- Operations mode — entirely deferred
- Old nets (Command P90, Lounge P70 as `private_chat` rooms) — no text channel fix in this spec

---

## Files to create / modify

| File | Change |
|---|---|
| `src/renderer/components/RadioBar.tsx` | **New** |
| `src/renderer/components/ChannelList.tsx` | Add click/right-click handlers; connected row style; context menu |
| `src/renderer/screens/Home.tsx` | Wire join/leave/monitor; pass RadioBar props; remove VoiceChannelView render |
| `src/renderer/voice/VoiceEngine.ts` | Add `joinMonitor`, `isTransmitting` if missing |

---

## Testing

- Unit: `RadioBar` renders correct channel name / PTT key / transmitting state
- Unit: `ChannelList` click calls `onVoiceChannelClick`; right-click shows context menu
- Manual: join Lounge P70, verify participant sub-rows appear, PTT glow fires, disconnect works
- Manual: Monitor mode — join via right-click Monitor, confirm mic is muted, audio still received
- Manual: switching channels — leave one, join another in one click
