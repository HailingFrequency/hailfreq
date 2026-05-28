/**
 * Normalize a KeyboardEvent into an Electron-compatible accelerator string.
 * https://www.electronjs.org/docs/latest/api/accelerator
 *
 * Examples:
 *   "F13"
 *   "Control+Shift+P"
 *   "Alt+Numpad0"
 */
export function eventToAccelerator(event: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");

  let main = event.code;
  // Map a few common DOM codes to accelerator names
  if (main.startsWith("Key") && main.length === 4) main = main.slice(3);
  if (main.startsWith("Digit") && main.length === 6) main = main.slice(5);
  if (main.startsWith("Numpad")) main = main.replace(/^Numpad/, "num");

  // Filter modifier-only events
  if (["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"].includes(main)) {
    return null;
  }

  parts.push(main);
  return parts.join("+");
}

export function formatAccelerator(accel: string): string {
  return accel;
}
