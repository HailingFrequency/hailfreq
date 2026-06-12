import type { MatrixClient, Room } from "matrix-js-sdk";

/**
 * Represents a single text message in a Matrix room.
 */
export interface ChatMessage {
  eventId: string;
  senderId: string;
  senderName: string;
  body: string;
  timestamp: number;
  isOwn: boolean;
}

/**
 * Map a Matrix room's live timeline events to a sorted ChatMessage[].
 *
 * Rules:
 *   - Only m.room.message events with msgtype: "m.text" are included.
 *   - Redacted events are skipped.
 *   - senderName falls back to senderId when no room member display name is found.
 *   - Results are sorted oldest→newest by origin_server_ts (getTs()).
 *   - isOwn is true when the event sender matches ownUserId.
 */
export function timelineToMessages(room: Room, ownUserId: string): ChatMessage[] {
  const events = room.getLiveTimeline().getEvents();

  const messages: ChatMessage[] = [];

  for (const event of events) {
    if (event.getType() !== "m.room.message") continue;
    if (event.isRedacted()) continue;

    const content = event.getContent();
    if (content.msgtype !== "m.text") continue;

    const senderId = event.getSender() ?? "";
    const member = room.getMember(senderId);
    const senderName = member?.name ?? senderId;

    messages.push({
      eventId: event.getId() ?? "",
      senderId,
      senderName,
      body: content.body as string,
      timestamp: event.getTs(),
      isOwn: senderId === ownUserId,
    });
  }

  // Sort oldest → newest by timestamp (timeline order may already be sorted,
  // but sort explicitly to guarantee it).
  messages.sort((a, b) => a.timestamp - b.timestamp);

  return messages;
}

/**
 * Send a plain-text message to a Matrix room.
 *
 * Trims the body. Rejects with a descriptive Error if the resulting body is
 * empty or whitespace-only (does not call the SDK). Otherwise calls
 * client.sendTextMessage(roomId, body).
 */
export async function sendTextMessage(
  client: MatrixClient,
  roomId: string,
  body: string,
): Promise<void> {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new Error("Message body must not be empty or whitespace-only.");
  }
  await client.sendTextMessage(roomId, trimmed);
}

/**
 * Format a Unix millisecond timestamp as HH:MM local time.
 * Examples: "09:05", "14:32", "00:00".
 */
export function formatMessageTime(timestamp: number): string {
  const d = new Date(timestamp);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
