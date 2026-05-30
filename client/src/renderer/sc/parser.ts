import type { ScEvent } from "./events";

// L6: values parsed from the (locally-writable) Game.log flow into Matrix room
// names and UI. There's no HTML sink today, but clamp length defensively so a
// crafted log line can't inject an absurdly long ship/owner/handle string.
const MAX_FIELD = 64;
const clamp = (s: string): string => s.slice(0, MAX_FIELD);

// Anchors (case-sensitive; SC logs are consistent)
const TIMESTAMP_RE = /^<([0-9TZ:.\-]+)>/;
const LOGIN_RE = /<Expect Incoming Connection>.*nickname="([^"]+)".*playerGEID=(\d+)/;
const YOU_JOINED_RE = /<SHUDEvent_OnNotification>.*Added notification "You have joined channel '([^:']+?) : ([^']+?)'/;
const OTHER_JOINED_RE = /^<[0-9TZ:.\-]+>\s+([A-Za-z0-9_-]+)\s+has joined the channel '([^:']+?) : ([^']+?)'/;
// Placeholder — implementer should refine against real destruction log lines
const DESTROYED_RE = /(?:<Vehicle Destruction>|<EntityDestroyed>).*?(?:vehicleType|className)=["']?([A-Za-z0-9_]+)/;

export function parseLine(line: string): ScEvent | null {
  const ts = line.match(TIMESTAMP_RE)?.[1] ?? new Date().toISOString();

  // YOU_JOINED — check FIRST because it's more specific than OTHER_JOINED's looser pattern
  let m = line.match(YOU_JOINED_RE);
  if (m) {
    return {
      kind: "you-joined-channel",
      timestamp: ts,
      shipType: clamp(m[1].trim()),
      owner: clamp(m[2].trim()),
    };
  }

  // OTHER_JOINED — matches lines like "<TS> Playername has joined the channel '...'"
  m = line.match(OTHER_JOINED_RE);
  if (m) {
    return {
      kind: "other-joined-channel",
      timestamp: ts,
      player: clamp(m[1].trim()),
      shipType: clamp(m[2].trim()),
      owner: clamp(m[3].trim()),
    };
  }

  // LOGIN
  m = line.match(LOGIN_RE);
  if (m) {
    return {
      kind: "login",
      timestamp: ts,
      nickname: clamp(m[1]),
      geid: m[2],
    };
  }

  // SHIP_DESTROYED — best-effort
  m = line.match(DESTROYED_RE);
  if (m) {
    return {
      kind: "ship-destroyed",
      timestamp: ts,
      shipType: clamp(m[1]),
      owner: null,
    };
  }

  return null;
}
