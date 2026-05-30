import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import type { NetSummary } from "../matrix/nets";
import type { RosterMember } from "../matrix/roster";
import type { AdminCapabilities } from "../matrix/permissions";
import { Button } from "./Button";
import { inviteToNet, kickFromNet, setPowerLevel, banFromServer } from "../matrix/memberActions";
import { kickFromVoice, authBaseUrlFromHomeserver } from "../voice/auth";

interface AdminDetailProps {
  client: MatrixClient;
  member: RosterMember | null;
  nets: NetSummary[];
  caps: AdminCapabilities;
}

export function AdminDetail({ client, member, nets, caps }: AdminDetailProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmBan, setConfirmBan] = useState(false);
  const [assigning, setAssigning] = useState(false);

  if (!member) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
        Select an operator to see details + actions.
      </div>
    );
  }

  async function runAction(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const adminableNets = nets.filter((n) => caps.adminNets.has(n.matrixRoomId));
  const notYetAssigned = adminableNets.filter((n) => !member.joinedNets.has(n.matrixRoomId));

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-slate-800 p-4">
        <h2 className="text-base font-semibold text-slate-100">{member.displayName}</h2>
        <p className="mt-1 text-xs text-slate-500">{member.userId}</p>
        {member.rsiVerified && (
          <p className="mt-1 text-xs text-emerald-300" title="Self-reported via CitizenID account-data; not server-verified">
            RSI (self-reported) · {member.rsiHandle ?? "—"}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">Presence: {member.presence}</p>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* Assigned nets section */}
        <section className="mb-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Assigned nets
          </h3>
          {member.joinedNets.size === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Not assigned to any net.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {Array.from(member.joinedNets).map((roomId) => {
                const net = nets.find((n) => n.matrixRoomId === roomId);
                if (!net) return null;
                const pl = member.perNetPowerLevel.get(roomId) ?? 0;
                const canAdmin = caps.adminNets.has(roomId);
                return (
                  <li
                    key={roomId}
                    className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: net.properties.color }}
                      />
                      <span className="text-slate-200">{net.properties.name}</span>
                      <span className="text-xs text-slate-500">PL {pl}</span>
                    </div>
                    {canAdmin && (
                      <div className="flex gap-1">
                        {pl < 75 && (
                          <button
                            className="rounded border border-brand-700 px-2 py-0.5 text-[11px] text-brand-300 hover:bg-brand-700/20 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={busy !== null}
                            onClick={() =>
                              runAction(`promote:${roomId}`, () =>
                                setPowerLevel(client, roomId, member.userId, 75),
                              )
                            }
                          >
                            ↑ Sqd Lead
                          </button>
                        )}
                        {pl >= 75 && pl < 100 && (
                          <button
                            className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-700/30 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={busy !== null}
                            onClick={() =>
                              runAction(`demote:${roomId}`, () =>
                                setPowerLevel(client, roomId, member.userId, 0),
                              )
                            }
                          >
                            ↓ Demote
                          </button>
                        )}
                        <button
                          className="rounded border border-rose-800 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-800/20 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={busy !== null}
                          onClick={() =>
                            runAction(`kick:${roomId}`, () =>
                              kickFromNet(client, roomId, member.userId, "Removed by admin"),
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {notYetAssigned.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setAssigning(true)}
                className="w-full rounded border border-dashed border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-brand-400 hover:text-brand-400"
              >
                + Assign to net…
              </button>
            </div>
          )}
        </section>

        {/* Voice section */}
        <section className="mb-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Voice
          </h3>
          <Button
            variant="ghost"
            disabled={busy !== null}
            onClick={async () => {
              const token = client.getAccessToken();
              if (!token) {
                setError("No access token available");
                return;
              }
              const baseUrl = authBaseUrlFromHomeserver(client.getHomeserverUrl());
              for (const roomId of member.joinedNets) {
                if (!caps.adminNets.has(roomId)) continue;
                await runAction(`voiceKick:${roomId}`, () =>
                  kickFromVoice({
                    hailfreqAuthBaseUrl: baseUrl,
                    matrixAccessToken: token,
                    matrixRoomId: roomId,
                    targetUserId: member.userId,
                  }),
                );
              }
            }}
            className="mt-2 w-full"
          >
            Disconnect from voice (chat unaffected)
          </Button>
        </section>

        {/* Server admin section */}
        {caps.isServerAdmin && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-400">
              Server admin
            </h3>
            {!confirmBan ? (
              <Button
                variant="ghost"
                className="mt-2 w-full !border-rose-800 !text-rose-300"
                disabled={busy !== null}
                onClick={() => setConfirmBan(true)}
              >
                Ban from server…
              </Button>
            ) : (
              <div className="mt-2 rounded border border-rose-800 bg-rose-950/20 p-3">
                <p className="text-xs text-rose-200">
                  Deactivate this account on Synapse. The user cannot authenticate again,
                  cannot fetch tokens, and is fully cut off from the server. Encrypted history
                  they've already decrypted on their devices is unaffected.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    className="!bg-rose-600 !text-white hover:!bg-rose-500"
                    disabled={busy !== null}
                    onClick={() => runAction("ban", () => banFromServer(client, member.userId))}
                  >
                    Confirm ban
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmBan(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        {error && (
          <div className="mt-4 rounded border border-rose-800 bg-rose-950/20 p-2 text-xs text-rose-200">
            {error}
          </div>
        )}
      </div>

      {/* Net picker dialog */}
      {assigning && (
        <NetPickerDialog
          client={client}
          nets={notYetAssigned}
          targetUserId={member.userId}
          onClose={() => setAssigning(false)}
        />
      )}
    </div>
  );
}

interface NetPickerDialogProps {
  client: MatrixClient;
  nets: NetSummary[];
  targetUserId: string;
  onClose: () => void;
}

function NetPickerDialog({ client, nets, targetUserId, onClose }: NetPickerDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAssign(net: NetSummary) {
    setBusy(true);
    setError(null);
    try {
      await inviteToNet(client, net.matrixRoomId, targetUserId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-lg border border-slate-800 bg-slate-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-brand-400">Assign to net</h3>
        <ul className="mt-3 flex flex-col gap-1">
          {nets.map((net) => (
            <li key={net.matrixRoomId}>
              <button
                disabled={busy}
                onClick={() => handleAssign(net)}
                className="flex w-full items-center gap-2 rounded border border-slate-800 px-3 py-2 text-left text-sm hover:border-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: net.properties.color }}
                />
                <span>{net.properties.name}</span>
              </button>
            </li>
          ))}
        </ul>
        {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
        <div className="mt-3 text-right">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
