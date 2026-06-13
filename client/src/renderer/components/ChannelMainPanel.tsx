import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { RoomEvent } from "matrix-js-sdk";
import { ChannelType, type Channel } from "../matrix/channelTypes";
import { getChannelsInNet } from "../matrix/channels";
import {
  timelineToMessages,
  sendTextMessage,
  type ChatMessage,
} from "../matrix/messages";
import { MainPanel } from "./MainPanel";

interface ChannelMainPanelProps {
  client: MatrixClient;
  /** The selected channel (text or voice), or null when nothing is selected. */
  channel: Channel | null;
  /** Display name for the parent net (shown in the header). */
  netName: string;
  /** Navigate to a different channel (e.g. via the text/voice toggle). */
  onSelectChannel: (id: string) => void;
  /**
   * Voice content to render when the active channel is a VOICE channel.
   * Passed straight through to MainPanel's `voiceContent` slot — this is the
   * existing voice UI (NetListPanel) for the parent net.
   */
  voiceContent?: ReactNode;
}

/**
 * Data wrapper around the presentational MainPanel.
 *
 * Responsibilities:
 *   - Resolve the sibling channels in the same net (for the text/voice toggle).
 *   - For text channels: subscribe to the room's live timeline and keep the
 *     messages list current; send via sendTextMessage.
 *   - For voice channels: forward the supplied voiceContent slot.
 *
 * Kept separate from Home so the timeline/send wiring stays self-contained and
 * Home remains an orchestration layer.
 */
export function ChannelMainPanel({
  client,
  channel,
  netName,
  onSelectChannel,
  voiceContent,
}: ChannelMainPanelProps) {
  const [channelsInNet, setChannelsInNet] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);

  // Stable identity fields for effect deps. `channel` is rebuilt on every parent
  // render (it comes from a useMemo keyed on the live hierarchy), so depending on
  // the object identity would re-fire effects on every Matrix event. We depend on
  // the underlying IDs instead so effects only re-run on a real selection change.
  const channelId = channel?.id ?? null;
  const channelNetId = channel?.netId ?? null;
  const isTextChannel = channel?.type === ChannelType.TEXT;

  // Resolve sibling channels in the same net so MainPanel can offer the
  // text/voice toggle. Re-runs only when the selected net changes.
  useEffect(() => {
    if (!channelNetId || !channelId) {
      setChannelsInNet([]);
      return;
    }
    let cancelled = false;
    void getChannelsInNet(client, channelNetId).then((channels) => {
      if (cancelled) return;
      setChannelsInNet(channels);
    });
    return () => {
      cancelled = true;
    };
  }, [client, channelNetId, channelId]);

  // Subscribe to the live timeline for text channels; clear for voice/none.
  useEffect(() => {
    if (!channelId || !isTextChannel) {
      setMessages([]);
      return;
    }
    const room = client.getRoom(channelId);
    if (!room) {
      setMessages([]);
      return;
    }

    // Resolve the own-user id lazily inside the effect so it is always current
    // for the client this effect is bound to (avoids a stale derived value).
    const ownUserId = client.getUserId() ?? "";
    const refresh = () => setMessages(timelineToMessages(room, ownUserId));
    refresh();

    // RoomEvent.Timeline fires for live message events. Channels are E2EE, so a
    // message often arrives encrypted and is decrypted asynchronously — listen
    // for "Event.decrypted" too and re-render once the plaintext lands.
    const onTimeline = (_event: MatrixEvent, eventRoom: Room | undefined) => {
      if (eventRoom?.roomId === channelId) refresh();
    };
    const onDecrypted = (event: MatrixEvent) => {
      if (event.getRoomId() === channelId) refresh();
    };
    client.on(RoomEvent.Timeline, onTimeline as never);
    client.on("Event.decrypted" as never, onDecrypted as never);

    return () => {
      client.off(RoomEvent.Timeline, onTimeline as never);
      client.off("Event.decrypted" as never, onDecrypted as never);
    };
  }, [client, channelId, isTextChannel]);

  const handleSend = useCallback(
    async (body: string) => {
      if (!channel) return;
      setSending(true);
      try {
        await sendTextMessage(client, channel.id, body);
      } finally {
        setSending(false);
      }
    },
    [client, channel],
  );

  // Guarantee the active channel is present for the toggle even if the
  // hierarchy query hasn't caught up yet (it was selected from the live tree).
  const mergedChannels =
    channel && !channelsInNet.some((c) => c.id === channel.id)
      ? [...channelsInNet, channel]
      : channelsInNet;

  return (
    <MainPanel
      channel={channel}
      channelsInNet={mergedChannels}
      netName={netName}
      messages={messages}
      onSend={handleSend}
      sending={sending}
      onSelectChannel={onSelectChannel}
      voiceContent={voiceContent}
    />
  );
}
