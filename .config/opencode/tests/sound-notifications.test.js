import assert from "node:assert/strict"
import childProcess from "node:child_process"
import { EventEmitter } from "node:events"
import { syncBuiltinESMExports } from "node:module"
import { PassThrough } from "node:stream"
import { setImmediate } from "node:timers/promises"
import { test } from "node:test"
import IdleSoundNotificationPlugin from "../plugins/idle-sound-notification.js"
import PermissionSoundNotificationPlugin from "../plugins/permission-sound-notification.js"
import { playSoundNotification } from "../play-sound-notification.js"

const DIRECTORY = "/workspace/project"

function mockSound(t) {
  const child = new EventEmitter()
  child.unref = t.mock.fn()
  const spawn = t.mock.method(childProcess, "spawn", () => child)
  syncBuiltinESMExports()
  t.after(() => {
    spawn.mock.restore()
    syncBuiltinESMExports()
  })
  return { spawn, child }
}

async function fixture(t, plugin = IdleSoundNotificationPlugin, session = {}) {
  const { spawn, child } = mockSound(t)
  const warn = t.mock.method(console, "warn", () => {})
  const events = new PassThrough({ objectMode: true })
  const get = t.mock.fn(async ({ sessionID }) => ({
    id: sessionID,
    outcome: "succeeded",
    location: { directory: DIRECTORY },
    ...session,
  }))
  const subscribe = t.mock.fn(({ signal }) => {
    signal.addEventListener("abort", () => events.end(), { once: true })
    return events
  })
  const cleanup = await plugin.setup({
    location: { directory: DIRECTORY },
    event: { subscribe },
    session: { get },
  })
  assert.equal(typeof cleanup, "function")
  t.after(cleanup)
  let sequence = 0
  async function emit(type, data = { sessionID: "session" }, location = { directory: DIRECTORY }) {
    events.write({ id: `event-${++sequence}`, created: Date.now(), type, data, location })
    await setImmediate()
  }
  async function completedStep(sessionID = "session", assistantMessageID = "response") {
    await emit("session.step.started", { sessionID, assistantMessageID })
    await emit("session.step.ended", { sessionID, assistantMessageID, finish: "stop" })
  }
  async function completedTurn(sessionID = "session") {
    await emit("session.execution.started", { sessionID })
    await completedStep(sessionID)
    await emit("session.execution.succeeded", { sessionID })
  }
  return { spawn, child, warn, get, subscribe, emit, completedStep, completedTurn, cleanup }
}

test("successful main-session completion sounds once through V2 subscription", async (t) => {
  const f = await fixture(t)
  await f.completedTurn()
  await f.emit("session.execution.succeeded")
  await f.emit("session.idle")
  assert.equal(f.spawn.mock.callCount(), 1)
  assert.deepEqual(f.get.mock.calls[0].arguments[0], { sessionID: "session" })
  const [command, [sound], options] = f.spawn.mock.calls[0].arguments
  assert.equal(command, "paplay")
  assert.match(sound, /wc3_(peasant|peon)_ready_to_work\.wav$/)
  assert.equal(options.env.PULSE_SERVER, "tcp:192.168.50.195:4713")
  assert.equal(options.signal, f.subscribe.mock.calls[0].arguments[0].signal)
})

for (const [scenario, session] of [
  ["subagent", { parentID: "parent" }],
  ["failed", { outcome: "failed" }],
  ["interrupted", { outcome: "interrupted" }],
  ["different location", { location: { directory: "/workspace/other" } }],
]) {
  test(`${scenario}: no completion sound`, async (t) => {
    const f = await fixture(t, IdleSoundNotificationPlugin, session)
    await f.completedTurn()
    assert.equal(f.spawn.mock.callCount(), 0)
  })
}

for (const finish of ["tool-calls", "unknown", "error"]) {
  test(`${finish}: not a completed assistant response`, async (t) => {
    const f = await fixture(t)
    await f.emit("session.execution.started")
    await f.emit("session.step.started", { sessionID: "session", assistantMessageID: "response" })
    await f.emit("session.step.ended", { sessionID: "session", assistantMessageID: "response", finish })
    await f.emit("session.execution.succeeded")
    assert.equal(f.spawn.mock.callCount(), 0)
    assert.equal(f.get.mock.callCount(), 0)
  })
}

for (const type of ["session.compaction.ended", "session.shell.ended", "session.idle"]) {
  test(`${type}: success without an assistant response stays silent`, async (t) => {
    const f = await fixture(t)
    await f.emit("session.execution.started")
    await f.emit(type)
    await f.emit("session.execution.succeeded")
    assert.equal(f.spawn.mock.callCount(), 0)
  })
}

for (const type of ["session.execution.interrupted", "session.execution.failed"]) {
  test(`${type}: cancellation survives late step events; a new turn can notify`, async (t) => {
    const f = await fixture(t)
    await f.emit("session.execution.started")
    await f.completedStep()
    await f.emit(type)
    await f.emit("session.step.failed", { sessionID: "session", assistantMessageID: "response" })
    await f.completedStep()
    await f.emit("session.execution.succeeded")
    await f.emit("session.idle")
    assert.equal(f.spawn.mock.callCount(), 0)
    await f.completedTurn()
    assert.equal(f.spawn.mock.callCount(), 1)
  })
}

for (const type of ["session.execution.interrupted", "session.execution.failed", "session.execution.started", "session.deleted"]) {
  test(`${type} during session lookup suppresses pending completion`, async (t) => {
    const f = await fixture(t)
    const lookup = Promise.withResolvers()
    f.get.mock.mockImplementation(() => lookup.promise)
    await f.completedTurn()
    await f.emit(type)
    lookup.resolve({ id: "session", outcome: "succeeded", location: { directory: DIRECTORY } })
    await setImmediate()
    assert.equal(f.spawn.mock.callCount(), 0)
  })
}

test("later assistant step invalidates earlier completion, including stale step endings", async (t) => {
  const f = await fixture(t)
  await f.emit("session.execution.started")
  await f.completedStep()
  await f.emit("session.step.started", { sessionID: "session", assistantMessageID: "next" })
  await f.emit("session.step.ended", { sessionID: "session", assistantMessageID: "response", finish: "stop" })
  await f.emit("session.execution.succeeded")
  assert.equal(f.spawn.mock.callCount(), 0)
  await f.emit("session.step.ended", { sessionID: "session", assistantMessageID: "next", finish: "stop" })
  await f.emit("session.execution.succeeded")
  assert.equal(f.spawn.mock.callCount(), 1)
})

test("successful retry after a failed step can notify", async (t) => {
  const f = await fixture(t)
  await f.emit("session.execution.started")
  await f.emit("session.step.started", { sessionID: "session", assistantMessageID: "response" })
  await f.emit("session.step.failed", { sessionID: "session", assistantMessageID: "response" })
  await f.completedStep("session", "retry")
  await f.emit("session.execution.succeeded")
  assert.equal(f.spawn.mock.callCount(), 1)
})

for (const midStep of [false, true]) {
  test(`reload ${midStep ? "mid-step" : "mid-execution"} still notifies successful completion`, async (t) => {
    const f = await fixture(t)
    if (midStep) {
      await f.emit("session.step.ended", { sessionID: "session", assistantMessageID: "response", finish: "stop" })
    } else {
      await f.completedStep()
    }
    await f.emit("session.execution.succeeded")
    assert.equal(f.spawn.mock.callCount(), 1)
  })
}

test("cancelling one session does not suppress another", async (t) => {
  const f = await fixture(t)
  await f.emit("session.execution.started")
  await f.completedStep()
  await f.emit("session.execution.interrupted")
  await f.completedTurn("other-session")
  await f.emit("session.execution.succeeded")
  assert.equal(f.spawn.mock.callCount(), 1)
})

for (const type of ["permission.asked", "form.created"]) {
  for (const parentID of [undefined, "parent"]) {
    test(`${type}: main and subagent prompts notify once`, async (t) => {
      const f = await fixture(t, PermissionSoundNotificationPlugin, { parentID })
      const request = { id: "request", sessionID: "session" }
      const data = type === "form.created" ? { form: request } : request
      await f.emit(type, data)
      await f.emit(type, data)
      assert.equal(f.spawn.mock.callCount(), 1)
      assert.match(f.spawn.mock.calls[0].arguments[1][0], /wc3_peasant_yes_me_lord\.wav$/)
    })
  }
}

test("prompt dedup expires without leaking timers", async (t) => {
  const f = await fixture(t, PermissionSoundNotificationPlugin)
  const now = t.mock.method(Date, "now", () => 1000)
  const request = { id: "request", sessionID: "session" }
  await f.emit("permission.asked", request)
  now.mock.mockImplementation(() => 6000)
  await f.emit("permission.asked", request)
  assert.equal(f.spawn.mock.callCount(), 2)
})

for (const [asked, settled] of [
  ["permission.asked", "permission.replied"],
  ["form.created", "form.replied"],
  ["form.created", "form.cancelled"],
  ["permission.asked", "session.deleted"],
  ["form.created", "session.execution.interrupted"],
  ["permission.asked", "session.execution.failed"],
]) {
  test(`${settled} suppresses a pending ${asked} sound`, async (t) => {
    const f = await fixture(t, PermissionSoundNotificationPlugin)
    const lookup = Promise.withResolvers()
    f.get.mock.mockImplementation(() => lookup.promise)
    const request = { id: "request", sessionID: "session" }
    const data = asked === "form.created" ? { form: request } : request
    await f.emit(asked, data)
    await f.emit(settled, { ...request, requestID: request.id })
    await f.emit(asked, data)
    lookup.resolve({ id: "session", location: { directory: DIRECTORY } })
    await setImmediate()
    assert.equal(f.spawn.mock.callCount(), 0)
  })
}

for (const plugin of [IdleSoundNotificationPlugin, PermissionSoundNotificationPlugin]) {
  test(`${plugin.id}: other locations do not notify`, async (t) => {
    const f = await fixture(t, plugin)
    await f.emit("session.execution.started")
    await f.completedStep()
    const location = { directory: "/workspace/other" }
    await f.emit("session.execution.succeeded", { sessionID: "session" }, location)
    await f.emit("permission.asked", { id: "request", sessionID: "session" }, location)
    assert.equal(f.get.mock.callCount(), 0)
    assert.equal(f.spawn.mock.callCount(), 0)
  })

  test(`${plugin.id}: failed session lookup stays silent and is logged`, async (t) => {
    const f = await fixture(t, plugin)
    f.get.mock.mockImplementation(async () => { throw new Error("Session not found") })
    await f.completedTurn()
    await f.emit("permission.asked", { id: "request", sessionID: "session" })
    assert.equal(f.spawn.mock.callCount(), 0)
    assert.equal(f.warn.mock.callCount(), 1)
  })

  test(`${plugin.id}: unload aborts subscription and suppresses pending sound`, async (t) => {
    const f = await fixture(t, plugin)
    const lookup = Promise.withResolvers()
    f.get.mock.mockImplementation(() => lookup.promise)
    await f.completedTurn()
    await f.emit("permission.asked", { id: "request", sessionID: "session" })
    await f.cleanup()
    assert.equal(f.subscribe.mock.calls[0].arguments[0].signal.aborted, true)
    lookup.resolve({ id: "session", outcome: "succeeded", location: { directory: DIRECTORY } })
    await setImmediate()
    assert.equal(f.spawn.mock.callCount(), 0)
    assert.equal(f.warn.mock.callCount(), 0)
  })
}

test("sound process failures use V2-compatible logging", (t) => {
  const { child } = mockSound(t)
  const warn = t.mock.method(console, "warn", () => {})
  playSoundNotification({ service: "test", soundFile: "/sound.wav" })
  child.emit("error", new Error("paplay missing"))
  child.emit("exit", 1, null)
  assert.equal(warn.mock.callCount(), 1)
  assert.match(warn.mock.calls[0].arguments[0], /Failed to start/)
})

test("nonzero sound exit is logged", (t) => {
  const { child } = mockSound(t)
  const warn = t.mock.method(console, "warn", () => {})
  playSoundNotification({ service: "test", soundFile: "/sound.wav" })
  child.emit("exit", 1, null)
  assert.equal(warn.mock.callCount(), 1)
})

test("plugin cleanup does not log sound cancellation as failure", (t) => {
  const { child } = mockSound(t)
  const warn = t.mock.method(console, "warn", () => {})
  const controller = new AbortController()
  playSoundNotification({ service: "test", soundFile: "/sound.wav", signal: controller.signal })
  controller.abort()
  child.emit("exit", null, "SIGTERM")
  assert.equal(warn.mock.callCount(), 0)
})
