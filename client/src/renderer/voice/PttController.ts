import type { VoiceEngine } from "./VoiceEngine";
import { VoiceActivationDetector } from "./voiceActivation";
import { shouldGatePass } from "./focusGate";

export type PttMode = "toggle" | "hold" | "voice";

export interface PttFocusGateConfig {
  enabled: boolean;
  allowlist: string[];
}

interface PttBinding {
  matrixRoomId: string;
  mode: PttMode;
  /** For "toggle" and "hold" modes — the keybind accelerator. */
  accelerator?: string;
  /** For "toggle" and "hold" modes — the registered hotkey ID. */
  hotkeyId?: string;
  /** For "voice" mode — the threshold in dBFS (negative; -45 is typical sensitivity). */
  voiceThresholdDb?: number;
}

export class PttController {
  private readonly engine: VoiceEngine;
  private bindings = new Map<string, PttBinding>(); // matrixRoomId → binding
  private unsubscribeHotkeyListener: (() => void) | null = null;
  private unsubscribeNativeListener: (() => void) | null = null;
  /** Active voice-activation detectors, keyed by matrixRoomId. */
  private voiceDetectors = new Map<string, VoiceActivationDetector>();
  /** Currently transmitting net (single, since only one net at a time can be active). */
  private transmitting: string | null = null;
  /** Provider for the current focus-gate config. Returns default-off config until wired. */
  private getFocusGateConfig: () => PttFocusGateConfig = () => ({ enabled: false, allowlist: [] });

  /** Wire a live focus-gate config provider. The closure must return current settings. */
  setFocusGateConfig(provider: () => PttFocusGateConfig): void {
    this.getFocusGateConfig = provider;
  }

  constructor(engine: VoiceEngine) {
    this.engine = engine;
    this.unsubscribeHotkeyListener = window.hailfreq.onHotkey((event) => {
      const binding = Array.from(this.bindings.values()).find((b) => b.hotkeyId === event.id);
      if (!binding) return;
      // Tap-to-toggle is the only mode wired in this task.
      // Voice activation (Task 10C) extends this.
      if (binding.mode === "toggle") {
        void this.gatedTogglePtt(binding.matrixRoomId);
      }
    });
    this.unsubscribeNativeListener = window.hailfreq.onNativeHotkey((event) => {
      const binding = Array.from(this.bindings.values()).find((b) => b.hotkeyId === event.id);
      if (!binding || binding.mode !== "hold") return;
      // Key-RELEASE (direction "up") always fires — never gated.
      // Key-PRESS (direction "down") goes through the focus gate.
      if (event.direction === "down") void this.gatedHoldStart(binding.matrixRoomId);
      else void this.holdStop(binding.matrixRoomId);
    });
  }

  /** Toggle PTT with focus-gate check (key-press only). */
  private async gatedTogglePtt(matrixRoomId: string): Promise<void> {
    const config = this.getFocusGateConfig();
    if (config.enabled) {
      const focus = await window.hailfreq.invoke("focus:get");
      if (!shouldGatePass({ focus, allowlist: config.allowlist })) {
        return;
      }
    }
    await this.togglePtt(matrixRoomId);
  }

  /** Start hold-PTT with focus-gate check (key-press only). */
  private async gatedHoldStart(matrixRoomId: string): Promise<void> {
    const config = this.getFocusGateConfig();
    if (config.enabled) {
      const focus = await window.hailfreq.invoke("focus:get");
      if (!shouldGatePass({ focus, allowlist: config.allowlist })) {
        return;
      }
    }
    await this.holdStart(matrixRoomId);
  }

  /** Bind a net's PTT mode. For toggle/hold, accelerator is required. */
  async bind(opts: {
    matrixRoomId: string;
    mode: PttMode;
    accelerator?: string;
    voiceThresholdDb?: number;
  }): Promise<{ ok: boolean; error?: string }> {
    await this.unbind(opts.matrixRoomId);

    if (opts.mode === "toggle") {
      if (!opts.accelerator) {
        return { ok: false, error: "toggle mode requires a keybind" };
      }
      const result = await window.hailfreq.invoke("hotkeys:register", {
        accelerator: opts.accelerator,
        metadata: { matrixRoomId: opts.matrixRoomId, mode: opts.mode },
      });
      if ("error" in result) return { ok: false, error: result.error };
      this.bindings.set(opts.matrixRoomId, {
        matrixRoomId: opts.matrixRoomId,
        mode: opts.mode,
        accelerator: opts.accelerator,
        hotkeyId: result.id,
      });
      return { ok: true };
    }

    if (opts.mode === "hold") {
      if (!opts.accelerator) {
        return { ok: false, error: "hold mode requires a keybind" };
      }
      const result = await window.hailfreq.invoke("nativeHotkey:registerHold", {
        accelerator: opts.accelerator,
        metadata: { matrixRoomId: opts.matrixRoomId },
      });
      if ("error" in result) return { ok: false, error: result.error };
      this.bindings.set(opts.matrixRoomId, {
        matrixRoomId: opts.matrixRoomId,
        mode: "hold",
        accelerator: opts.accelerator,
        hotkeyId: result.id,
      });
      return { ok: true };
    }

    if (opts.mode === "voice") {
      const micSource = await this.engine.getMicSource();
      const detector = new VoiceActivationDetector({
        audioCtx: micSource.context as AudioContext,
        micSource,
        thresholdDb: opts.voiceThresholdDb ?? -45,
        onStart: () => void this.holdStart(opts.matrixRoomId),
        onStop: () => void this.holdStop(opts.matrixRoomId),
      });
      detector.start();
      this.bindings.set(opts.matrixRoomId, {
        matrixRoomId: opts.matrixRoomId,
        mode: "voice",
        voiceThresholdDb: opts.voiceThresholdDb ?? -45,
      });
      this.voiceDetectors.set(opts.matrixRoomId, detector);
      return { ok: true };
    }

    return { ok: false, error: `Unknown mode: ${opts.mode}` };
  }

  async unbind(matrixRoomId: string): Promise<void> {
    const existing = this.bindings.get(matrixRoomId);
    if (!existing) return;
    if (existing.mode === "voice") {
      const detector = this.voiceDetectors.get(matrixRoomId);
      if (detector) {
        detector.stop();
        this.voiceDetectors.delete(matrixRoomId);
      }
    } else if (existing.hotkeyId) {
      if (existing.mode === "hold") {
        await window.hailfreq.invoke("nativeHotkey:unregisterHold", { id: existing.hotkeyId });
      } else {
        await window.hailfreq.invoke("hotkeys:unregister", { id: existing.hotkeyId });
      }
    }
    this.bindings.delete(matrixRoomId);
    if (this.transmitting === matrixRoomId) {
      await this.engine.stopPtt();
      this.transmitting = null;
    }
  }

  private async togglePtt(matrixRoomId: string): Promise<void> {
    if (this.transmitting === matrixRoomId) {
      await this.engine.stopPtt();
      this.transmitting = null;
    } else {
      await this.engine.startPtt(matrixRoomId);
      this.transmitting = matrixRoomId;
    }
  }

  /** Called by press-and-hold (Task 10B) on keydown. */
  async holdStart(matrixRoomId: string): Promise<void> {
    if (this.transmitting === matrixRoomId) return;
    await this.engine.startPtt(matrixRoomId);
    this.transmitting = matrixRoomId;
  }

  /** Called by press-and-hold (Task 10B) on keyup, or by voice activation (Task 10C) when below threshold. */
  async holdStop(matrixRoomId: string): Promise<void> {
    if (this.transmitting !== matrixRoomId) return;
    await this.engine.stopPtt();
    this.transmitting = null;
  }

  getBinding(matrixRoomId: string): PttBinding | null {
    return this.bindings.get(matrixRoomId) ?? null;
  }

  getTransmittingNet(): string | null {
    return this.transmitting;
  }

  async shutdown(): Promise<void> {
    for (const detector of this.voiceDetectors.values()) {
      detector.stop();
    }
    this.voiceDetectors.clear();

    for (const binding of this.bindings.values()) {
      if (binding.hotkeyId) {
        if (binding.mode === "hold") {
          await window.hailfreq.invoke("nativeHotkey:unregisterHold", { id: binding.hotkeyId });
        } else {
          await window.hailfreq.invoke("hotkeys:unregister", { id: binding.hotkeyId });
        }
      }
    }
    this.bindings.clear();
    this.unsubscribeHotkeyListener?.();
    this.unsubscribeHotkeyListener = null;
    this.unsubscribeNativeListener?.();
    this.unsubscribeNativeListener = null;
  }
}
