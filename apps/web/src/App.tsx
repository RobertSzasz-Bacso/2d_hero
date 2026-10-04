import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import Settings from "./settings.tsx";
import { heroFetch } from "./session.ts";

export default function App() {
  const [health, setHealth] = useState("checking");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    heroFetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!active) {
          return;
        }
        if (!response.ok) {
          setHealth("unavailable");
          return;
        }
        const body = (await response.json()) as { ok?: boolean };
        if (!active) {
          return;
        }
        setHealth(body.ok === true ? "ok" : "unavailable");
      })
      .catch(() => {
        if (active) {
          setHealth("unavailable");
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return (
    <main className="flex min-h-svh flex-col items-start gap-4 p-8">
      <Button type="button">2D Hero</Button>
      <p>Health: {health}</p>
      <Settings />
    </main>
  );
}
