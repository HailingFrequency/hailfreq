# Lounge Voice UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the clunky center-console voice UX with click-to-join channels and a thin RadioBar at the bottom of the sidebar, Discord-style.

**Architecture:** Voice channel left-click calls `voiceEngine.monitorNet()` directly (no navigation). A new `RadioBar` component at the bottom of the lounge sidebar shows the connected channel, PTT key indicator, mute, and disconnect. A fixed-position context menu triggered by right-click on any voice row provides Join / Monitor / Leave / PTT key display. `VoiceChannelView` and `NetListPanel` are removed from the Lounge main area; Operations mode is untouched.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vitest (node env — no jsdom, no RTL; all component verification is manual via `npm run dev`)

## Global Constraints

- Lounge mode only — Operations mode (`mode === "ops"`) paths must remain unchanged
- `VoiceChannelView` is NOT deleted — only removed from the Lounge render path
- `NetListPanel` is NOT deleted — only removed from the Lounge main-area fallback
- Brand colour: `brand-400 = #22d3ee`, `brand-500 = #06b6d4` (tailwind.config.js)
- Test environment is `node` — no DOM available in unit tests; component changes verified manually
- All async handlers must not throw unhandled rejections — wrap in `void` or `.catch`

---

### Task 1: VoiceEngine — add `getActivePttNet()` public getter

**Files:**
- Modify: `client/src/renderer/voice/VoiceEngine.ts` (around line 140, after `getConnectedParticipantIds`)

**Interfaces:**
- Produces: `getActivePttNet(): string | null` — public getter for `this.activePttNet`

- [ ] **Step 1: Add the getter**

  In `VoiceEngine.ts`, after the closing brace of `getConnectedParticipantIds` (line ~148), insert:

  ```ts
  /** Returns the Matrix room ID of the net currently being transmitted on, or null. */
  getActivePttNet(): string | null {
    return this.activePttNet;
  }
  ```

- [ ] **Step 2: Verify TypeScript**

  ```bash
  cd /home/shreen/code/tactical-radio/client && npm run lint
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add client/src/renderer/voice/VoiceEngine.ts
  git commit -m "feat(voice): expose getActivePttNet() public getter"
  ```

---

### Task 2: Create `RadioBar` component

**Files:**
- Create: `client/src/renderer/components/RadioBar.tsx`

**Interfaces:**
- Consumes: nothing from other tasks (pure presentational)
- Produces: `RadioBar` React component with the props interface below — consumed by Task 5 (Home.tsx)

```ts
interface RadioBarProps {
  channelName: string;
  freqTag: string;        // e.g. "P70"
  pttKey: string;         // display label for bound key, e.g. "Space" or "–"
  isTransmitting: boolean;
  isMuted: boolean;
  onDisconnect: () => void;
  onToggleMute: () => void;
  onPttDown: () => void;
  onPttUp: () => void;
}
```

- [ ] **Step 1: Create `RadioBar.tsx`**

  ```tsx
  // client/src/renderer/components/RadioBar.tsx
  interface RadioBarProps {
    channelName: string;
    freqTag: string;
    pttKey: string;
    isTransmitting: boolean;
    isMuted: boolean;
    onDisconnect: () => void;
    onToggleMute: () => void;
    onPttDown: () => void;
    onPttUp: () => void;
  }

  export function RadioBar({
    channelName,
    freqTag,
    pttKey,
    isTransmitting,
    isMuted,
    onDisconnect,
    onToggleMute,
    onPttDown,
    onPttUp,
  }: RadioBarProps) {
    return (
      <div className="flex-shrink-0 border-t-2 border-brand-500/30 bg-slate-950">
        {/* Row 1: channel name + freq tag */}
        <div className="flex items-center gap-2 px-2.5 pt-2 pb-1">
          <span className="text-xs" aria-hidden="true">📻</span>
          <span className="flex-1 truncate text-xs font-semibold text-brand-400">
            {channelName}
          </span>
          {freqTag && (
            <span className="shrink-0 rounded-full border border-brand-500/30 bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-600">
              {freqTag}
            </span>
          )}
        </div>

        {/* Row 2: PTT + mute + disconnect */}
        <div className="flex items-center gap-1.5 px-2.5 pb-2">
          {/* PTT button — spans most of the width */}
          <button
            type="button"
            onMouseDown={onPttDown}
            onMouseUp={onPttUp}
            onMouseLeave={onPttUp}
            aria-label="Push to talk"
            aria-pressed={isTransmitting}
            className={[
              "flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-semibold transition-all select-none",
              isTransmitting
                ? "animate-pulse border border-brand-500/60 bg-brand-500/30 text-brand-300"
                : "border border-slate-700 bg-slate-800 text-slate-400 hover:border-brand-500/40 hover:bg-brand-500/10 hover:text-brand-400",
            ].join(" ")}
          >
            <span aria-hidden="true">🎤</span>
            <span>PTT</span>
            <kbd className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 font-mono text-[10px] text-slate-500">
              {pttKey}
            </kbd>
          </button>

          {/* Mute toggle */}
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
            title={isMuted ? "Unmute" : "Mute"}
            className={[
              "flex h-7 w-7 items-center justify-center rounded text-sm transition-colors",
              isMuted
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200",
            ].join(" ")}
          >
            {isMuted ? "🔇" : "🎙️"}
          </button>

          {/* Disconnect */}
          <button
            type="button"
            onClick={onDisconnect}
            aria-label="Disconnect from channel"
            title="Disconnect"
            className="flex h-7 w-7 items-center justify-center rounded bg-slate-800 text-sm text-slate-400 transition-colors hover:bg-red-500/20 hover:text-red-400"
          >
            ↩
          </button>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Verify TypeScript**

  ```bash
  cd /home/shreen/code/tactical-radio/client && npm run lint
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add client/src/renderer/components/RadioBar.tsx
  git commit -m "feat(ui): add RadioBar component for lounge voice controls"
  ```

---

### Task 3: `ChannelList` — voice click, right-click, connected row styling

**Files:**
- Modify: `client/src/renderer/components/ChannelList.tsx`

**Interfaces:**
- Consumes: nothing from prior tasks
- Produces (new optional props threaded through `ChannelListProps` and `ChannelListRowProps`):
  - `onVoiceChannelClick?: (netRoomId: string) => void` — called on left-click of a voice node
  - `onVoiceChannelRightClick?: (netRoomId: string, x: number, y: number) => void` — called on right-click
  - `connectedVoiceRoomId?: string` — net room ID of the currently connected channel (for styling)

- [ ] **Step 1: Add new props to `ChannelListProps` interface**

  In `ChannelList.tsx`, after the existing `resolveDisplayName?` prop in `ChannelListProps` (line ~30), add:

  ```ts
  /** Called when user left-clicks a voice channel — joins immediately. Net room ID passed (node.netId ?? node.id). */
  onVoiceChannelClick?: (netRoomId: string) => void;
  /** Called when user right-clicks a voice channel. Passes net room ID + pointer position for context menu. */
  onVoiceChannelRightClick?: (netRoomId: string, x: number, y: number) => void;
  /** Net room ID of the currently connected channel — used to style the connected row. */
  connectedVoiceRoomId?: string;
  ```

  Add the same three props to `ChannelListRowProps` (the internal interface, around line ~52).

- [ ] **Step 2: Accept the new props in `ChannelListRow` function signature**

  The existing function signature (line ~54) destructures many props. Add the three new ones:

  ```ts
  function ChannelListRow({
    node,
    selectedChannelId,
    expandedIds,
    onSelectChannel,
    onToggleExpand,
    onAddChannel,
    voiceParticipants,
    activeSpeakers,
    localUserId,
    resolveDisplayName,
    onVoiceChannelClick,
    onVoiceChannelRightClick,
    connectedVoiceRoomId,
    depth,
  }: ChannelListRowProps) {
  ```

- [ ] **Step 3: Add computed values and handlers**

  After the existing `const icon = nodeIcon(node);` line, add:

  ```ts
  // The net room ID for voice nodes (parent Space ID for child voice channels,
  // or the node's own ID for backwards-compat private_chat nets).
  const voiceNetId = node.type === "voice" ? (node.netId ?? node.id) : null;
  const isConnected = voiceNetId !== null && voiceNetId === connectedVoiceRoomId;

  function handleVoiceContextMenu(e: React.MouseEvent) {
    if (!voiceNetId || !onVoiceChannelRightClick) return;
    e.preventDefault();
    onVoiceChannelRightClick(voiceNetId, e.clientX, e.clientY);
  }
  ```

- [ ] **Step 4: Update `handleRowClick` to intercept voice clicks**

  Replace the existing `handleRowClick` function:

  ```ts
  function handleRowClick() {
    if (node.type === "voice" && onVoiceChannelClick && voiceNetId) {
      onVoiceChannelClick(voiceNetId);
      return;
    }
    if (selectable) {
      onSelectChannel(node.id);
    } else {
      onToggleExpand(node.id);
      // Auto-select the voice child only when NOT in click-to-join mode
      // (i.e., when onVoiceChannelClick is not provided — Operations mode).
      if (!onVoiceChannelClick && !isExpanded && node.children.length > 0) {
        const voiceChild = node.children.find((c) => c.type === "voice");
        if (voiceChild) onSelectChannel(voiceChild.id);
      }
    }
  }
  ```

- [ ] **Step 5: Update the row content button JSX**

  Find the `<button type="button" className={[...].join(" ")} onClick={handleRowClick} ...>` element (the row content button, around line ~139). Change its className to include the connected state and add `onContextMenu`:

  ```tsx
  <button
    type="button"
    className={[
      "flex flex-1 items-center gap-1.5 rounded py-1 text-left text-sm transition-colors min-w-0",
      isSelected
        ? "bg-brand-500/20 text-brand-50"
        : isConnected
        ? "border border-brand-500/30 bg-brand-500/10 text-brand-50"
        : "text-slate-300 hover:bg-slate-800 hover:text-slate-100",
    ].join(" ")}
    onClick={handleRowClick}
    onContextMenu={handleVoiceContextMenu}
    tabIndex={0}
    aria-selected={selectable ? isSelected : undefined}
  >
    {/* Node type icon */}
    {icon && (
      <span className="shrink-0 text-slate-400 select-none" aria-hidden="true">
        {icon}
      </span>
    )}

    {/* Node name */}
    <span className="truncate flex-1 font-medium">
      {node.name}
    </span>

    {/* Live dot — shown while connected to this voice channel */}
    {isConnected && (
      <span
        className="shrink-0 h-2 w-2 animate-pulse rounded-full bg-brand-400"
        aria-label="Connected"
      />
    )}

    {/* Priority badge — only shown for broadcast nodes */}
    {node.isBroadcast && node.priority !== undefined && (
      <span
        className="shrink-0 ml-1 rounded px-1 py-0.5 text-xs font-semibold bg-amber-700/30 text-amber-300"
        title={`Priority ${node.priority}`}
      >
        P{node.priority}
      </span>
    )}
  </button>
  ```

- [ ] **Step 6: Pass new props through recursive `ChannelList` call**

  In the recursive `<ChannelList ... />` inside `ChannelListRow` (around line ~190), add the three new props:

  ```tsx
  <ChannelList
    nodes={node.children}
    selectedChannelId={selectedChannelId}
    expandedIds={expandedIds}
    onSelectChannel={onSelectChannel}
    onToggleExpand={onToggleExpand}
    onAddChannel={onAddChannel}
    voiceParticipants={voiceParticipants}
    activeSpeakers={activeSpeakers}
    localUserId={localUserId}
    resolveDisplayName={resolveDisplayName}
    onVoiceChannelClick={onVoiceChannelClick}
    onVoiceChannelRightClick={onVoiceChannelRightClick}
    connectedVoiceRoomId={connectedVoiceRoomId}
    depth={depth + 1}
  />
  ```

- [ ] **Step 7: Accept + pass through in the exported `ChannelList` function**

  In the exported `ChannelList` function (bottom of the file, ~line 258), destructure the three new props and pass them to each `ChannelListRow`:

  ```tsx
  export function ChannelList({
    nodes,
    selectedChannelId,
    expandedIds,
    onSelectChannel,
    onToggleExpand,
    onAddChannel,
    voiceParticipants,
    activeSpeakers,
    localUserId,
    resolveDisplayName,
    onVoiceChannelClick,
    onVoiceChannelRightClick,
    connectedVoiceRoomId,
    depth = 0,
  }: ChannelListProps) {
    const listRole = depth === 0 ? "tree" : "group";
    return (
      <ul role={listRole} className="list-none m-0 p-0">
        {nodes.map((node) => (
          <ChannelListRow
            key={node.id}
            node={node}
            selectedChannelId={selectedChannelId}
            expandedIds={expandedIds}
            onSelectChannel={onSelectChannel}
            onToggleExpand={onToggleExpand}
            onAddChannel={onAddChannel}
            voiceParticipants={voiceParticipants}
            activeSpeakers={activeSpeakers}
            localUserId={localUserId}
            resolveDisplayName={resolveDisplayName}
            onVoiceChannelClick={onVoiceChannelClick}
            onVoiceChannelRightClick={onVoiceChannelRightClick}
            connectedVoiceRoomId={connectedVoiceRoomId}
            depth={depth}
          />
        ))}
      </ul>
    );
  }
  ```

- [ ] **Step 8: Verify TypeScript**

  ```bash
  cd /home/shreen/code/tactical-radio/client && npm run lint
  ```

  Expected: no errors.

- [ ] **Step 9: Commit**

  ```bash
  git add client/src/renderer/components/ChannelList.tsx
  git commit -m "feat(ui): add voice click-to-join and right-click props to ChannelList"
  ```

---

### Task 4: `LoungeSidebar` — thread new ChannelList props

**Files:**
- Modify: `client/src/renderer/components/LoungeSidebar.tsx`

**Interfaces:**
- Consumes: `onVoiceChannelClick`, `onVoiceChannelRightClick`, `connectedVoiceRoomId` from Task 3
- Produces: same three props added to `LoungeSidebarProps` — consumed by Task 5 (Home.tsx)

- [ ] **Step 1: Add three new optional props to `LoungeSidebarProps`**

  After the existing `resolveDisplayName?` prop in the interface (around line ~27):

  ```ts
  /** Called when a voice channel is left-clicked — passed through to ChannelList. */
  onVoiceChannelClick?: (netRoomId: string) => void;
  /** Called when a voice channel is right-clicked — passed through to ChannelList. */
  onVoiceChannelRightClick?: (netRoomId: string, x: number, y: number) => void;
  /** Net room ID of the currently connected channel — passed through to ChannelList. */
  connectedVoiceRoomId?: string;
  ```

- [ ] **Step 2: Accept the new props in the `LoungeSidebar` function**

  Add to the destructuring in `export function LoungeSidebar({ ... })`:

  ```ts
  onVoiceChannelClick,
  onVoiceChannelRightClick,
  connectedVoiceRoomId,
  ```

- [ ] **Step 3: Pass the new props to all three `ChannelList` instances**

  The Ships section and Your Nets section both render `<ChannelList ...>`. Add the three props to each:

  ```tsx
  <ChannelList
    nodes={ships}              // or yourNets
    selectedChannelId={selectedChannelId}
    expandedIds={expandedIds}
    onSelectChannel={onSelectChannel}
    onToggleExpand={onToggleExpand}
    onAddChannel={(netId) => setAddingChannelToNet(netId)}
    voiceParticipants={voiceParticipants}
    activeSpeakers={activeSpeakers}
    localUserId={localUserId}
    resolveDisplayName={resolveDisplayName}
    onVoiceChannelClick={onVoiceChannelClick}
    onVoiceChannelRightClick={onVoiceChannelRightClick}
    connectedVoiceRoomId={connectedVoiceRoomId}
  />
  ```

- [ ] **Step 4: Verify TypeScript**

  ```bash
  cd /home/shreen/code/tactical-radio/client && npm run lint
  ```

  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add client/src/renderer/components/LoungeSidebar.tsx
  git commit -m "feat(ui): thread voice click/right-click props through LoungeSidebar"
  ```

---

### Task 5: `Home.tsx` — full wiring (state, PttController, RadioBar, context menu, remove center console)

**Files:**
- Modify: `client/src/renderer/screens/Home.tsx`

**Interfaces:**
- Consumes: `RadioBar` from Task 2; `onVoiceChannelClick/Right`, `connectedVoiceRoomId` from Tasks 3/4; `getActivePttNet()` from Task 1
- Produces: complete lounge voice UX — voice join/leave/monitor, RadioBar at sidebar bottom, context menu

- [ ] **Step 1: Add new imports**

  At the top of `Home.tsx`, add:

  ```ts
  import { RadioBar } from "../components/RadioBar";
  import { PttController, type PttMode } from "../voice/PttController";
  ```

  Also add `useRef` to the existing React import if not already there (it's already imported at line 1).

- [ ] **Step 2: Add voice connection state and refs**

  Inside the `Home` function, after the existing `const [activeSpeakers, ...]` state (around line ~146), add:

  ```ts
  // ── Lounge voice connection state ────────────────────────────────────────
  const [activeVoiceRoomId, setActiveVoiceRoomId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isMonitorOnly, setIsMonitorOnly] = useState(false);
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; roomId: string } | null>(null);
  const pttRef = useRef<PttController | null>(null);

  // Keep a live ref to focusedAppPtt so the PttController focus-gate closure
  // reads the current value without stale-closure issues.
  const focusedAppPttRef = useRef<typeof focusedAppPtt>(focusedAppPtt);
  focusedAppPttRef.current = focusedAppPtt;
  ```

- [ ] **Step 3: Add PttController lifecycle effect**

  After the existing `useEffect` blocks (e.g., after the activeSpeakers poll effect around line ~196), add:

  ```ts
  // Create a single PttController for the lounge sidebar's voice controls.
  // Torn down on voiceEngine change or unmount.
  useEffect(() => {
    if (!voiceEngine) return;
    const ptt = new PttController(voiceEngine);
    pttRef.current = ptt;
    ptt.setFocusGateConfig(() => ({
      enabled: focusedAppPttRef.current?.enabled ?? false,
      allowlist: focusedAppPttRef.current?.allowlistEntries ?? [],
    }));
    return () => {
      void ptt.shutdown();
      pttRef.current = null;
    };
  }, [voiceEngine]);
  ```

- [ ] **Step 4: Add transmitting-state poll effect**

  ```ts
  // Poll VoiceEngine every 100 ms to update the RadioBar transmit indicator
  // and keep onTransmittingChange (used by AppState for window chrome) in sync.
  useEffect(() => {
    if (!voiceEngine) return;
    const id = setInterval(() => {
      const activePtt = voiceEngine.getActivePttNet();
      setIsTransmitting(activePtt === activeVoiceRoomId && !isMuted);
      onTransmittingChange(activePtt);
    }, 100);
    return () => clearInterval(id);
  }, [voiceEngine, activeVoiceRoomId, isMuted, onTransmittingChange]);
  ```

- [ ] **Step 5: Add context menu dismiss effect**

  ```ts
  // Dismiss the voice-channel context menu on any mousedown outside it.
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [contextMenu]);
  ```

- [ ] **Step 6: Add voice channel action handlers**

  After `resolveDisplayName` (around line ~359), add:

  ```ts
  async function handleVoiceChannelClick(netRoomId: string): Promise<void> {
    if (!voiceEngine) return;
    // No-op if already connected here
    if (activeVoiceRoomId === netRoomId) return;
    // Leave previous channel first
    if (activeVoiceRoomId) {
      await pttRef.current?.unbind(activeVoiceRoomId);
      await voiceEngine.unmonitorNet(activeVoiceRoomId);
    }
    const net = listNets(client).find((n) => n.matrixRoomId === netRoomId);
    if (!net) return;
    await voiceEngine.monitorNet({ matrixRoomId: netRoomId, priority: net.properties.priority ?? 0 });
    // Bind stored PTT keybind if one exists for this net
    const keybind = serverEntry.voicePrefs?.keybinds[netRoomId] ?? null;
    const pttMode = (serverEntry.voicePrefs?.pttModes[netRoomId] as PttMode | undefined) ?? "toggle";
    if (keybind && pttRef.current) {
      await pttRef.current.bind({ matrixRoomId: netRoomId, mode: pttMode, accelerator: keybind });
    }
    setActiveVoiceRoomId(netRoomId);
    setIsMuted(false);
    setIsMonitorOnly(false);
  }

  async function handleVoiceChannelMonitor(netRoomId: string): Promise<void> {
    if (!voiceEngine) return;
    // If already connected to this net, just switch to monitor-only
    if (activeVoiceRoomId === netRoomId) {
      await pttRef.current?.unbind(netRoomId);
      setIsMonitorOnly(true);
      return;
    }
    if (activeVoiceRoomId) {
      await pttRef.current?.unbind(activeVoiceRoomId);
      await voiceEngine.unmonitorNet(activeVoiceRoomId);
    }
    const net = listNets(client).find((n) => n.matrixRoomId === netRoomId);
    if (!net) return;
    await voiceEngine.monitorNet({ matrixRoomId: netRoomId, priority: net.properties.priority ?? 0 });
    setActiveVoiceRoomId(netRoomId);
    setIsMonitorOnly(true);
    setIsMuted(false);
  }

  async function handleVoiceLeave(): Promise<void> {
    if (!activeVoiceRoomId || !voiceEngine) return;
    await pttRef.current?.unbind(activeVoiceRoomId);
    await voiceEngine.unmonitorNet(activeVoiceRoomId);
    setActiveVoiceRoomId(null);
    setIsMonitorOnly(false);
    setIsMuted(false);
  }

  function handlePttDown(): void {
    if (!activeVoiceRoomId || !voiceEngine || isMuted || isMonitorOnly) return;
    void voiceEngine.startPtt(activeVoiceRoomId);
  }

  function handlePttUp(): void {
    if (!voiceEngine) return;
    void voiceEngine.stopPtt();
  }
  ```

- [ ] **Step 7: Compute RadioBar display values**

  After the handlers, add:

  ```ts
  // Values used by RadioBar — computed from active net and stored prefs.
  const activeNet = activeVoiceRoomId
    ? listNets(client).find((n) => n.matrixRoomId === activeVoiceRoomId)
    : null;
  const radioBarChannelName = activeNet?.properties.name ?? activeVoiceRoomId ?? "";
  const radioBarFreqTag =
    activeNet?.properties.priority != null ? `P${activeNet.properties.priority}` : "";
  const radioBarPttKey =
    (activeVoiceRoomId ? serverEntry.voicePrefs?.keybinds[activeVoiceRoomId] : null) ?? "–";
  ```

- [ ] **Step 8: Update the lounge sidebar container and add RadioBar**

  Find the lounge sidebar `<div>` wrapper (around line ~511):

  ```tsx
  <div className="w-60 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-950">
    {mode === "ops" ? (
      ...
    ) : (
      <LoungeSidebar ... />
    )}
  </div>
  ```

  Replace the outer div and its contents with:

  ```tsx
  <div className="flex w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-950">
    <div className="flex-1 overflow-y-auto">
      {mode === "ops" ? (
        <OperationsSidebar
          operation={selectedOperation}
          nodes={opNodes}
          selectedChannelId={selectedChannelId}
          expandedIds={expandedIds}
          onSelectChannel={setSelectedChannelId}
          onToggleExpand={handleToggleExpand}
          onInvite={selectedOperation ? handleOpenInvite : undefined}
          onCreateOperation={() => setCreatingOp(true)}
        />
      ) : (
        <LoungeSidebar
          client={client}
          nodes={loungeNodes}
          availableNets={availableNets}
          selectedChannelId={selectedChannelId}
          expandedIds={expandedIds}
          onSelectChannel={setSelectedChannelId}
          onToggleExpand={handleToggleExpand}
          onJoinNet={(id) => void client.joinRoom(id)}
          voiceParticipants={voiceParticipants}
          activeSpeakers={activeSpeakers}
          localUserId={client.getSafeUserId() ?? undefined}
          resolveDisplayName={resolveDisplayName}
          onVoiceChannelClick={(roomId) => void handleVoiceChannelClick(roomId)}
          onVoiceChannelRightClick={(roomId, x, y) => setContextMenu({ x, y, roomId })}
          connectedVoiceRoomId={activeVoiceRoomId ?? undefined}
        />
      )}
    </div>
    {/* RadioBar — rendered below the scrollable sidebar only when connected in lounge mode */}
    {mode === "lounge" && activeVoiceRoomId && (
      <RadioBar
        channelName={radioBarChannelName}
        freqTag={radioBarFreqTag}
        pttKey={radioBarPttKey}
        isTransmitting={isTransmitting}
        isMuted={isMuted}
        onDisconnect={() => void handleVoiceLeave()}
        onToggleMute={() => setIsMuted((m) => !m)}
        onPttDown={handlePttDown}
        onPttUp={handlePttUp}
      />
    )}
  </div>
  ```

- [ ] **Step 9: Update main area logic — remove VoiceChannelView and NetListPanel from Lounge**

  Find the `let mainArea: React.ReactNode;` block (around line ~417). Replace it:

  ```tsx
  let mainArea: React.ReactNode;
  if (selected && mode === "lounge") {
    // Lounge: show text channel content only — voice channels no longer navigate
    mainArea = (
      <ChannelMainPanel
        client={client}
        channel={selected.channel}
        netName={selected.netName}
        onSelectChannel={setSelectedChannelId}
        voiceContent={undefined}
      />
    );
  } else if (selected) {
    // Ops mode: keep VoiceChannelView for voice channels (unchanged)
    mainArea = (
      <ChannelMainPanel
        client={client}
        channel={selected.channel}
        netName={selected.netName}
        onSelectChannel={setSelectedChannelId}
        voiceContent={
          selected.channel.type === ChannelType.VOICE ? (
            <VoiceChannelView
              client={client}
              netId={selected.channel.netId}
              netName={selected.netName}
              channelName={selected.channel.name}
              voiceEngine={voiceEngine}
              serverEntry={serverEntry}
              onTransmittingChange={onTransmittingChange}
              focusedAppPtt={focusedAppPtt}
            />
          ) : undefined
        }
      />
    );
  } else if (mode === "lounge") {
    // Lounge with nothing selected: clean empty state (no center console)
    mainArea = (
      <div className="flex h-full items-center justify-center text-sm text-slate-600">
        Select a channel to start chatting
      </div>
    );
  } else {
    // Ops mode fallback — keep NetListPanel for operations voice controls
    mainArea = <div className="h-full overflow-auto">{netListPanel}</div>;
  }
  ```

- [ ] **Step 10: Add context menu rendering**

  Inside the main `return (...)`, just before the closing `</div>` of the outermost flex container (around line ~587), add:

  ```tsx
  {/* Voice channel context menu — fixed-position overlay, dismissed on outside click */}
  {contextMenu && (
    <div
      style={{ position: "fixed", top: contextMenu.y, left: contextMenu.x, zIndex: 100 }}
      className="min-w-[180px] rounded-md border border-slate-700 bg-slate-800 py-1 shadow-xl"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-500">
        {listNets(client).find((n) => n.matrixRoomId === contextMenu.roomId)?.properties.name ??
          contextMenu.roomId}
      </div>
      <button
        type="button"
        className="w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-brand-500/20 hover:text-brand-50"
        onClick={() => {
          void handleVoiceChannelClick(contextMenu.roomId);
          setContextMenu(null);
        }}
      >
        📻 Join Channel
      </button>
      <button
        type="button"
        className="w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-brand-500/20 hover:text-brand-50"
        onClick={() => {
          void handleVoiceChannelMonitor(contextMenu.roomId);
          setContextMenu(null);
        }}
      >
        👂 Monitor (listen-only)
      </button>
      <div className="my-1 border-t border-slate-700" />
      <div className="px-3 py-1.5 text-sm text-slate-500">
        ⌨️ PTT:{" "}
        <kbd className="rounded border border-slate-700 bg-slate-900 px-1 font-mono text-[10px] text-slate-400">
          {serverEntry.voicePrefs?.keybinds[contextMenu.roomId] ?? "Not set"}
        </kbd>
      </div>
      <div className="my-1 border-t border-slate-700" />
      {activeVoiceRoomId === contextMenu.roomId ? (
        <button
          type="button"
          className="w-full px-3 py-1.5 text-left text-sm text-red-400 hover:bg-red-500/20 hover:text-red-300"
          onClick={() => {
            void handleVoiceLeave();
            setContextMenu(null);
          }}
        >
          ↩ Leave Channel
        </button>
      ) : null}
    </div>
  )}
  ```

- [ ] **Step 11: Verify TypeScript**

  ```bash
  cd /home/shreen/code/tactical-radio/client && npm run lint
  ```

  Expected: no errors. If TypeScript complains about `listNets` in the context menu JSX, move the lookup into a `const contextMenuNetName = ...` variable in the render body above the return.

- [ ] **Step 12: Run unit tests**

  ```bash
  cd /home/shreen/code/tactical-radio/client && npm run test:unit
  ```

  Expected: all existing tests pass. No new unit tests are added in this task (component changes verified manually).

- [ ] **Step 13: Manual verification**

  Start the dev server:
  ```bash
  cd /home/shreen/code/tactical-radio/client && npm run dev
  ```

  Check each of the following:
  - [ ] Clicking a voice channel in the sidebar joins it — RadioBar appears at sidebar bottom with channel name
  - [ ] RadioBar shows correct PTT key label (or "–" if no keybind set)
  - [ ] Holding PTT key → RadioBar PTT button pulses cyan
  - [ ] Mute button toggles 🎙️ ↔ 🔇; PTT is suppressed while muted
  - [ ] Disconnect button (↩) leaves the channel and RadioBar disappears
  - [ ] Right-clicking a voice channel shows context menu (Join / Monitor / PTT key display / Leave)
  - [ ] Right-click → Monitor joins in listen-only mode (no PTT glow when key held)
  - [ ] Connected channel row shows pulsing cyan dot
  - [ ] Clicking a text channel still navigates normally (shows text chat in main area)
  - [ ] No center console / NetListPanel shown in Lounge mode main area
  - [ ] Operations mode (if accessible) still shows VoiceChannelView for voice channels — unchanged

- [ ] **Step 14: Commit**

  ```bash
  git add client/src/renderer/screens/Home.tsx
  git commit -m "feat(lounge): click-to-join voice channels with RadioBar, remove center console"
  ```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Click voice channel → join immediately | Task 3 (`onVoiceChannelClick`), Task 5 (`handleVoiceChannelClick`) |
| Right-click → context menu (Join/Monitor/Leave/PTT display) | Task 3 (`onVoiceChannelRightClick`), Task 5 (context menu rendering) |
| Monitor mode via right-click | Task 5 (`handleVoiceChannelMonitor`, `isMonitorOnly` flag) |
| RadioBar at sidebar bottom | Task 2 (component), Task 5 (sidebar wrapper restructure) |
| PTT glow when transmitting | Task 2 (`isTransmitting` → `animate-pulse`) |
| VoiceChannelView retired from Lounge | Task 5 (Step 9 — mode-aware `mainArea` logic) |
| NetListPanel removed from Lounge fallback | Task 5 (Step 9) |
| `getActivePttNet()` for RadioBar polling | Task 1, Task 5 (Step 4) |
| Mute suppresses PTT | Task 5 (`handlePttDown` guard + `isMuted` state) |
| Connected row styling (border + pulse dot) | Task 3 (`isConnected` computed value + JSX) |
| Participant sub-rows unchanged | No change needed — already shipping in v0.3.1 |
| Operations mode untouched | Task 5 — `mode === "ops"` paths preserved verbatim |

**Placeholder scan:** No TBD or TODO in the plan. PTT Settings dialog deferred as noted — context menu shows current keybind as a display-only item.

**Type consistency:** `netRoomId: string` used consistently across Tasks 3/4/5. `PttMode` imported from `../voice/PttController` in Task 5 Step 1. `getActivePttNet()` defined in Task 1 and called in Task 5 Step 4.
