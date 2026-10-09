import { describe, expect, it } from "vitest"
import { runIdentify } from "./identifyRun"

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function html(status: number): Response {
  return new Response("<!DOCTYPE html><html>524</html>", { status })
}

const noWait = async () => {}

describe("runIdentify", () => {
  it("starts the run, polls until it is done, and returns the stored result", async () => {
    const calls: string[] = []
    const answers = [json({ id: "r1", state: "running" }), json({ state: "running" }), json({ state: "done", status: 200, body: { cursorKeySet: true, detail: "ok" } })]
    const fetcher = async (path: string) => {
      calls.push(path)
      return answers.shift() as Response
    }

    const result = await runIdentify("p1", {}, fetcher, noWait)

    expect(calls).toEqual(["/api/projects/p1/identify/start", "/api/identify/r1", "/api/identify/r1"])
    expect(result).toEqual({ status: 200, body: { cursorKeySet: true, detail: "ok" } })
  })

  it("reports a 409 from start as its message", async () => {
    const fetcher = async () => json({ detail: "Furniture detection is already running for this project." }, 409)

    const result = await runIdentify("p1", {}, fetcher, noWait)

    expect(result.status).toBe(409)
    expect(result.body.detail).toContain("already running")
  })

  it("never shows a JSON parse error when a gateway answers with an HTML page", async () => {
    const fetcher = async () => html(524)

    const result = await runIdentify("p1", {}, fetcher, noWait)

    expect(result.status).toBe(524)
    expect(result.body.detail).toBe("The connection was cut before the server answered. Try again.")
  })

  it("keeps polling through a few gateway hiccups", async () => {
    const answers = [
      json({ id: "r1", state: "running" }),
      html(502),
      html(524),
      json({ state: "done", status: 200, body: { cursorKeySet: true } }),
    ]
    const fetcher = async () => answers.shift() as Response

    const result = await runIdentify("p1", {}, fetcher, noWait)

    expect(result.status).toBe(200)
  })

  it("gives up after 5 failed polls in a row", async () => {
    const answers = [json({ id: "r1", state: "running" })]
    const fetcher = async () => answers.shift() ?? html(502)

    const result = await runIdentify("p1", {}, fetcher, noWait)

    expect(result.body.detail).toBe("The connection was cut before the server answered. Try again.")
  })
})
