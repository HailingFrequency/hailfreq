import type { ReactNode } from "react";
import { ChannelType, type Channel } from "../matrix/channelTypes";
import type { ChatMessage } from "../matrix/messages";
import { TextChannelView } from "./TextChannelView";
import { resolveToggleTarget } from "./mainPanelHelpers";

interface MainPanelProps {
  /** The currently selected channel, or null when nothing is selected. */
  channel: Channel | null;
  /** All channels belonging to the same net as `channel`. */
  channelsInNet: Channel[];
  /** Display name for the parent net. */
  netName: string;
  /** Messages to display when the channel is a text channel. */
  messages: ChatMessage[];
  /** Called when the user sends a message from the text view. */
  onSend: (body: string) => Promise<void>;
  /** True while a send is in flight. */
  sending?: boolean;
  /** Called when the toggle navigates to a different channel. */
  onSelectChannel: (id: string) => void;
  /**
   * Voice content to render when the active channel is a VOICE channel.
   *
   * Decision: we use a prop slot rather than embedding the existing voice UI
   * directly because the voice experience (NetListPanel + NetRow) is deeply
   * entangled with VoiceEngine, PttController, ShareEngine, and per-net state
   * maps that cannot cleanly be extracted into a self-contained component at
   * this stage. The slot keeps MainPanel presentational and lets the wiring
   * task (next step) pass the appropriate subtree.
   *
   * If absent, a placeholder is shown so the panel renders meaningfully before
   * the wiring task is complete.
   */
  voiceContent?: ReactNode;
}

export function MainPanel({
  channel,
  channelsInNet,
  netName,
  messages,
  onSend,
  sending = false,
  onSelectChannel,
  voiceContent,
}: MainPanelProps) {
  // ── Empty state ─────────────────────────────────────────────────────────────
  if (channel === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-slate-500">Select a channel</p>
      </div>
    );
  }

  // ── Toggle resolution ────────────────────────────────────────────────────────
  const textTarget = resolveToggleTarget(channelsInNet, channel.id, "text");
  const voiceTarget = resolveToggleTarget(channelsInNet, channel.id, "voice");

  const isTextActive = channel.type === ChannelType.TEXT;
  const isVoiceActive = channel.type === ChannelType.VOICE;

  function handleTextToggle() {
    if (textTarget.available && !isTextActive) {
      onSelectChannel(textTarget.channelId);
    }
  }

  function handleVoiceToggle() {
    if (voiceTarget.available && !isVoiceActive) {
      onSelectChannel(voiceTarget.channelId);
    }
  }

  // ── Channel icon ─────────────────────────────────────────────────────────────
  const channelIcon = channel.type === ChannelType.TEXT ? "#" : "🎤";

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      {/* ── Header ── */}
      <header className="flex flex-col gap-2 border-b border-slate-800 px-4 py-3">
        {/* Channel title row */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-100">
              {channelIcon} {channel.name}
            </h2>
            <p className="text-xs text-slate-500">{netName}</p>
          </div>

          {/* Text / Voice toggle */}
          <div
            className="flex items-center rounded border border-slate-700 bg-slate-900"
            role="group"
            aria-label="View toggle"
          >
            <ToggleButton
              label="Text"
              icon="📝"
              active={isTextActive}
              disabled={!textTarget.available}
              disabledTooltip="No text channel in this net"
              onClick={handleTextToggle}
              side="left"
            />
            <div className="w-px self-stretch bg-slate-700" aria-hidden="true" />
            <ToggleButton
              label="Voice"
              icon="🎤"
              active={isVoiceActive}
              disabled={!voiceTarget.available}
              disabledTooltip="No voice channel in this net"
              onClick={handleVoiceToggle}
              side="right"
            />
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 overflow-hidden">
        {channel.type === ChannelType.TEXT ? (
          <TextChannelView
            channelName={channel.name}
            netName={netName}
            messages={messages}
            onSend={onSend}
            sending={sending}
            hideHeader
          />
        ) : voiceContent !== undefined ? (
          // Voice view — render whatever the parent provided (e.g. NetListPanel)
          voiceContent
        ) : (
          // Placeholder shown before wiring is complete
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-slate-500">
              Voice controls render here once wired
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToggleButton — internal presentational component
// ---------------------------------------------------------------------------

interface ToggleButtonProps {
  label: string;
  icon: string;
  active: boolean;
  disabled: boolean;
  disabledTooltip: string;
  onClick: () => void;
  side: "left" | "right";
}

function ToggleButton({
  label,
  icon,
  active,
  disabled,
  disabledTooltip,
  onClick,
  side,
}: ToggleButtonProps) {
  const rounded = side === "left" ? "rounded-l" : "rounded-r";

  const base = `flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors ${rounded}`;

  const colorClasses = active
    ? "bg-brand-500/20 text-brand-100"
    : disabled
      ? "cursor-not-allowed text-slate-600"
      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200";

  return (
    <button
      type="button"
      className={`${base} ${colorClasses}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={disabled ? disabledTooltip : undefined}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}
