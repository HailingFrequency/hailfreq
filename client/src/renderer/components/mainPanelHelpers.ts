import { ChannelType, type Channel } from "../matrix/channelTypes";

/**
 * Given the flat list of channels in the same net, find the first channel
 * whose type matches `targetType`. Returns null if none is found.
 *
 * NOTE: All channels in `channels` are assumed to belong to the same net
 * (i.e. the caller pre-filters by netId). The current channel itself is
 * eligible — if its type already matches targetType it is returned first.
 */
export function siblingChannelOfType(
  channels: Channel[],
  currentChannelId: string,
  targetType: ChannelType,
): Channel | null {
  // First: check the current channel itself
  const current = channels.find((c) => c.id === currentChannelId);
  if (current && current.type === targetType) return current;

  // Otherwise: find the first other channel in the same net with targetType
  const currentNetId = current?.netId;
  for (const ch of channels) {
    if (ch.type !== targetType) continue;
    // If we know the net, only match within the same net
    if (currentNetId !== undefined && ch.netId !== currentNetId) continue;
    return ch;
  }

  return null;
}

/**
 * Resolves the channel to navigate to when the user clicks a toggle button.
 *
 * - If the current channel already matches desiredView → same id, available true.
 * - Else if there is a sibling of the desired type → its id, available true.
 * - Else → current id, available false (toggle should render disabled).
 */
export function resolveToggleTarget(
  channels: Channel[],
  currentChannelId: string,
  desiredView: "text" | "voice",
): { channelId: string; available: boolean } {
  const targetType =
    desiredView === "text" ? ChannelType.TEXT : ChannelType.VOICE;

  const target = siblingChannelOfType(channels, currentChannelId, targetType);

  if (target !== null) {
    return { channelId: target.id, available: true };
  }

  return { channelId: currentChannelId, available: false };
}
