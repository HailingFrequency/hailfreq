import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button } from "./Button";
import { Input } from "./Input";
import { formatMessageTime, type ChatMessage } from "../matrix/messages";

interface TextChannelViewProps {
  channelName: string;
  netName: string;
  messages: ChatMessage[];
  onSend: (body: string) => Promise<void>;
  sending?: boolean;
  /** When true, the channel header is suppressed (use when a parent already renders one). */
  hideHeader?: boolean;
}

export function TextChannelView({
  channelName,
  netName,
  messages,
  onSend,
  sending = false,
  hideHeader = false,
}: TextChannelViewProps) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom whenever the messages list changes.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;
    try {
      await onSend(body);
      setDraft("");
    } catch {
      // Intentionally not surfacing send errors here — the parent can handle them.
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Channel header — suppressed when parent already renders one */}
      {!hideHeader && (
        <header className="flex flex-col border-b border-slate-800 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-100">
            # {channelName}
          </h2>
          <p className="text-xs text-slate-500">{netName}</p>
        </header>
      )}

      {/* Scrollable message list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="text-center text-sm text-slate-500">
            No messages yet. Be the first to say something.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((msg) => (
              <li
                key={msg.eventId}
                className={`flex flex-col gap-0.5 ${
                  msg.isOwn ? "items-end" : "items-start"
                }`}
              >
                {/* Sender name + timestamp row */}
                <div
                  className={`flex items-baseline gap-2 text-xs ${
                    msg.isOwn ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  <span
                    className={`font-medium ${
                      msg.isOwn ? "text-brand-400" : "text-slate-300"
                    }`}
                  >
                    {msg.senderName}
                  </span>
                  <span className="text-slate-600">
                    {formatMessageTime(msg.timestamp)}
                  </span>
                </div>

                {/* Message bubble — plain text, never dangerouslySetInnerHTML */}
                <div
                  className={`max-w-[80%] rounded px-3 py-1.5 text-sm ${
                    msg.isOwn
                      ? "bg-brand-500/20 text-brand-100"
                      : "bg-slate-800 text-slate-200"
                  }`}
                >
                  {msg.body}
                </div>
              </li>
            ))}
            <div ref={bottomRef} aria-hidden="true" />
          </ul>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-slate-800 px-4 py-3">
        <div className="flex-1">
          <Input
            label=""
            placeholder={`Message #${channelName}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
            aria-label={`Message input for ${channelName}`}
          />
        </div>
        <Button
          type="button"
          variant="primary"
          disabled={!draft.trim() || sending}
          onClick={() => void handleSend()}
          className="mb-0.5"
        >
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
