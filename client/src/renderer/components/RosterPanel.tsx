import { useEffect, useMemo, useState } from "react";
import type { MatrixClient, RoomMember } from "matrix-js-sdk";
import type { VoiceEngine } from "../voice/VoiceEngine";

/** How often to poll the VoiceEngine for active speakers (ms). */
const SPEAKER_POLL_MS = 250;

export interface RosterPanelProps {
  client: MatrixClient;
  /** The net whose members to show. When null, the panel shows nothing. */
  netId: string | null;
  /** Shared VoiceEngine used to render per-member speaking indicators. */
  voiceEngine?: VoiceEngine;
}

interface RosterMember {
  userId: string;
  displayName: string;
}

/** Pure projection of a Matrix RoomMember into the minimal shape we render. */
function toRosterMember(member: RoomMember): RosterMember {
  const displayName = member.name?.trim() || member.userId;
  return { userId: member.userId, displayName };
}

/** Read the joined members of a room as a sorted, immutable list. */
function readMembers(client: MatrixClient, netId: string | null): RosterMember[] {
  if (!netId) return [];
  const room = client.getRoom(netId);
  if (!room) return [];
  return room
    .getJoinedMembers()
    .map(toRosterMember)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** First character of a display name, upper-cased, for the avatar fallback. */
function avatarInitial(displayName: string): string {
  const trimmed = displayName.replace(/^[@!#]/, "").trim();
  return (trimmed[0] ?? "?").toUpperCase();
}

/**
 * RosterPanel — right-side member list for the selected net.
 *
 * Lists joined members of the net room, renders an avatar fallback (initial)
 * plus display name, and a speaking indicator when the VoiceEngine reports the
 * member as an active speaker. Re-reads membership on RoomMember.membership
 * events and polls the engine for active speakers.
 *
 * Width is controlled by the parent container.
 */
export function RosterPanel({ client, netId, voiceEngine }: RosterPanelProps) {
  const [members, setMembers] = useState<RosterMember[]>(() =>
    readMembers(client, netId),
  );
  const [activeSpeakers, setActiveSpeakers] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // Re-read members when the net changes or membership events fire.
  useEffect(() => {
    const refresh = () => setMembers(readMembers(client, netId));
    refresh();
    client.on("RoomMember.membership" as never, refresh as never);
    client.on("RoomState.members" as never, refresh as never);
    return () => {
      client.off("RoomMember.membership" as never, refresh as never);
      client.off("RoomState.members" as never, refresh as never);
    };
  }, [client, netId]);

  // Poll the VoiceEngine for active speakers in this net. `on()` is a
  // single-handler subscription (already used by VoiceChannelView), so we poll
  // the snapshot getter instead of subscribing here.
  useEffect(() => {
    if (!voiceEngine || !netId) {
      setActiveSpeakers(new Set());
      return;
    }
    const tick = () =>
      setActiveSpeakers(new Set(voiceEngine.getActiveSpeakers(netId)));
    tick();
    const id = setInterval(tick, SPEAKER_POLL_MS);
    return () => clearInterval(id);
  }, [voiceEngine, netId]);

  // A member is "speaking" when their user id matches an active-speaker
  // identity. LiveKit identities are server-assigned; match exactly or by
  // substring to tolerate prefixed/suffixed identity formats.
  const isSpeaking = useMemo(() => {
    const speakers = Array.from(activeSpeakers);
    return (userId: string): boolean =>
      speakers.some((s) => s === userId || s.includes(userId));
  }, [activeSpeakers]);

  if (!netId) {
    return (
      <div className="flex h-full flex-col bg-slate-900 p-3 text-slate-300">
        <p className="text-xs text-slate-500">No net selected.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-900 text-slate-300">
      <div className="border-b border-slate-800 px-3 py-2 text-xs uppercase tracking-wider text-slate-500">
        {members.length} member{members.length === 1 ? "" : "s"}
      </div>
      <ul className="m-0 flex-1 list-none overflow-y-auto p-0">
        {members.map((m) => {
          const speaking = isSpeaking(m.userId);
          return (
            <li
              key={m.userId}
              className="flex items-center gap-2 px-3 py-1.5"
              title={m.userId}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-200"
                aria-hidden
              >
                {avatarInitial(m.displayName)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {m.displayName}
              </span>
              {speaking && (
                <span className="shrink-0 text-sm" title="Speaking" aria-label="Speaking">
                  🔊
                </span>
              )}
            </li>
          );
        })}
        {members.length === 0 && (
          <li className="px-3 py-2 text-xs text-slate-500">No members.</li>
        )}
      </ul>
    </div>
  );
}
