import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Button } from "../components/Button";

interface HomeProps {
  client: MatrixClient;
  onLogout: () => Promise<void>;
}

export function Home({ client, onLogout }: HomeProps) {
  const [roomCount, setRoomCount] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const update = () => setRoomCount(client.getRooms().length);
    update();
    client.on("sync" as any, update);
    return () => {
      client.off("sync" as any, update);
    };
  }, [client]);

  async function handleLogout() {
    setBusy(true);
    try {
      await onLogout();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-400">Hailfreq</h1>
          <p className="mt-1 text-xs text-slate-500">
            Signed in as {client.getSafeUserId()} · {roomCount} rooms
          </p>
        </div>
        <Button variant="ghost" onClick={handleLogout} disabled={busy}>
          {busy ? "Logging out…" : "Log out"}
        </Button>
      </header>
      <div className="mt-12 text-center text-sm text-slate-400">
        <p>Tactical-radio features coming in Plan 4.</p>
      </div>
    </div>
  );
}
