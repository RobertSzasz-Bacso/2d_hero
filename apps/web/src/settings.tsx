import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.tsx";
import { heroFetch } from "./session.ts";

interface TitleBlock {
  company: string;
  project: string;
  address: string;
  drawnBy: string;
  date: string;
  sheetTitle: string;
  sheetNumber: string;
  revisionNote: string;
}

interface SettingsBody {
  cursorKeySet: boolean;
  dimensionUnit: "cm" | "mm";
  gridSpacingM: number;
  titleBlock: TitleBlock;
}

const EMPTY_TITLE: TitleBlock = {
  company: "",
  project: "",
  address: "",
  drawnBy: "",
  date: "",
  sheetTitle: "",
  sheetNumber: "",
  revisionNote: "",
};

const TITLE_FIELDS: { key: keyof TitleBlock; label: string }[] = [
  { key: "company", label: "Company" },
  { key: "project", label: "Project" },
  { key: "address", label: "Address" },
  { key: "drawnBy", label: "Drawn by" },
  { key: "date", label: "Date" },
  { key: "sheetTitle", label: "Sheet title" },
  { key: "sheetNumber", label: "Sheet number" },
  { key: "revisionNote", label: "Revision note" },
];

async function readDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.length > 0) {
      return body.detail;
    }
  } catch {
    return "Request failed.";
  }
  return "Request failed.";
}

export default function Settings() {
  const [titleBlock, setTitleBlock] = useState<TitleBlock>(EMPTY_TITLE);
  const [dimensionUnit, setDimensionUnit] = useState<"cm" | "mm">("cm");
  const [gridSpacing, setGridSpacing] = useState("1");
  const [cursorKeySet, setCursorKeySet] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    heroFetch("/api/settings", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readDetail(response));
        }
        return (await response.json()) as SettingsBody;
      })
      .then((body) => {
        if (!active) {
          return;
        }
        setTitleBlock(body.titleBlock);
        setDimensionUnit(body.dimensionUnit);
        setGridSpacing(String(body.gridSpacingM));
        setCursorKeySet(body.cursorKeySet);
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setMessage(error instanceof Error ? error.message : "Settings are unavailable.");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  function updateTitle(key: keyof TitleBlock, value: string) {
    setTitleBlock((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    const gridSpacingM = Number(gridSpacing);
    if (!Number.isFinite(gridSpacingM) || gridSpacingM <= 0) {
      setMessage("Grid spacing must be a positive number of metres.");
      return;
    }
    setMessage("");
    const response = await heroFetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titleBlock, dimensionUnit, gridSpacingM }),
    });
    if (!response.ok) {
      setMessage(await readDetail(response));
      return;
    }
    const body = (await response.json()) as SettingsBody;
    setTitleBlock(body.titleBlock);
    setDimensionUnit(body.dimensionUnit);
    setGridSpacing(String(body.gridSpacingM));
    setCursorKeySet(body.cursorKeySet);
    setMessage("Settings saved.");
  }

  async function saveKey(event: FormEvent) {
    event.preventDefault();
    const key = keyDraft.trim();
    if (!key) {
      return;
    }
    setMessage("");
    const response = await heroFetch("/api/settings/cursor-key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!response.ok) {
      const detail = await readDetail(response);
      setMessage(detail.includes(key) ? "The key was not saved." : detail);
      return;
    }
    setKeyDraft("");
    setCursorKeySet(true);
    setMessage("Cursor key saved.");
  }

  async function removeKey() {
    setMessage("");
    const response = await heroFetch("/api/settings/cursor-key", { method: "DELETE" });
    if (!response.ok) {
      setMessage(await readDetail(response));
      return;
    }
    setKeyDraft("");
    setCursorKeySet(false);
    setMessage("Cursor key removed.");
  }

  return (
    <section className="flex w-full max-w-xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-medium">Settings</h1>
        <p className="text-sm text-muted-foreground">
          The Cursor key is stored in Windows Credential Manager. It is never written into a
          project.
        </p>
        <p aria-live="polite">
          {cursorKeySet ? "A Cursor key is saved." : "No Cursor key is saved."}
        </p>
        <form className="flex flex-col gap-3" onSubmit={saveKey}>
          <label className="flex flex-col gap-1 text-sm" htmlFor="cursor-key">
            Cursor key
            <input
              id="cursor-key"
              className="h-8 rounded-lg border border-input bg-background px-2.5"
              type="password"
              name="cursor-key"
              autoComplete="off"
              value={keyDraft}
              placeholder="Enter a new key"
              onChange={(event) => setKeyDraft(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={!loaded || keyDraft.trim().length === 0}>
              Save key
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!loaded || !cursorKeySet}
              onClick={removeKey}
            >
              Remove key
            </Button>
          </div>
        </form>
      </div>

      <form className="flex flex-col gap-3" onSubmit={saveSettings}>
        <h2 className="text-base font-medium">Title block defaults</h2>
        {TITLE_FIELDS.map((field) => (
          <label key={field.key} className="flex flex-col gap-1 text-sm" htmlFor={field.key}>
            {field.label}
            <input
              id={field.key}
              className="h-8 rounded-lg border border-input bg-background px-2.5"
              value={titleBlock[field.key]}
              onChange={(event) => updateTitle(field.key, event.target.value)}
            />
          </label>
        ))}
        <label className="flex flex-col gap-1 text-sm" htmlFor="dimension-unit">
          Dimension display unit
          <select
            id="dimension-unit"
            className="h-8 rounded-lg border border-input bg-background px-2.5"
            value={dimensionUnit}
            onChange={(event) => setDimensionUnit(event.target.value === "mm" ? "mm" : "cm")}
          >
            <option value="cm">Centimetres (cm)</option>
            <option value="mm">Millimetres (mm)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor="grid-spacing">
          Grid spacing (m)
          <input
            id="grid-spacing"
            className="h-8 rounded-lg border border-input bg-background px-2.5"
            type="number"
            min="0.01"
            step="0.01"
            value={gridSpacing}
            onChange={(event) => setGridSpacing(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={!loaded}>
          Save settings
        </Button>
      </form>
      <p aria-live="polite">{message}</p>
    </section>
  );
}
