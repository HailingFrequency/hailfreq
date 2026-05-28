import type { VoiceEngine } from "./VoiceEngine";

export type PttMode = "toggle" | "hold" | "voice";

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
  /** Currently transmitting net (single, since only one net at a time can be active). */
  private transmitting: string | null = null;

  constructor(engine: VoiceEngine) {
    this.engine = engine;
    this.unsubscribeHotkeyListener = window.hailfreq.onHotkey((event) => {
      const binding = Array.from(this.bindings.values()).find((b) => b.hotkeyId === event.id);
      if (!binding) return;
      // Tap-to-toggle is the only mode wired in this task.
      // Voice activation (Task 10C) extends this.
      if (binding.mode === "toggle") {
        void this.togglePtt(binding.matrixRoomId);
      }
    });
    this.unsubscribeNativeListener = window.hailfreq.onNativeHotkey((event) => {
      const binding = Array.from(this.bindings.values()).find((b) => b.hotkeyId === event.id);
      if (!binding || binding.mode !== "hold") return;
      if (event.direction === "down") void this.holdStart(binding.matrixRoomId);
      else void this.holdStop(binding.matrixRoomId);
    });
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
      this.bindings.set(opts.matrixRoomId, {
        matrixRoomId: opts.matrixRoomId,
        mode: "voice",
        voiceThresholdDb: opts.voiceThresholdDb ?? -45,
      });
      // Task 10C wires the actual voice-activation analyzer
      return { ok: true };
    }

    return { ok: false, error: `Unknown mode: ${opts.mode}` };
  }

  async unbind(matrixRoomId: string): Promise<void> {
    const existing = this.bindings.get(matrixRoomId);
    if (!existing) return;
    if (existing.hotkeyId) {
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
