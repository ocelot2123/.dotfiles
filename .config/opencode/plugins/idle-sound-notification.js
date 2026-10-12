import { Plugin } from "@opencode/plugin"
import { fileURLToPath } from "node:url"
import { playSoundNotification } from "../play-sound-notification.js"

const SERVICE = "idle sound notification"
const SOUNDS = [
  fileURLToPath(new URL("../sounds/wc3_peasant_ready_to_work.wav", import.meta.url)),
  fileURLToPath(new URL("../sounds/wc3_peon_ready_to_work.wav", import.meta.url)),
]

/**
 * @typedef {{ status: "running" | "suppressed" | "completed" | "notified" } | { status: "step", stepID: string }} NotificationTurn
 */

export const IdleSoundNotificationPlugin = Plugin.define({
  id: "idle-sound-notification",
  setup(ctx) {
    const controller = new AbortController()
    const { signal } = controller
    /** @type {Map<string, NotificationTurn>} */
    const turns = new Map()

    const subscription = (async () => {
      for await (const event of ctx.event.subscribe({ signal })) {
        if (signal.aborted) break
        // The V2 stream is server-wide; each location has its own plugin instance.
        if (event.location && event.location.directory !== ctx.location.directory) continue

        switch (event.type) {
          case "session.deleted":
            turns.delete(event.data.sessionID)
            break
          case "session.execution.started":
            turns.set(event.data.sessionID, { status: "running" })
            break
          case "session.execution.failed":
          case "session.execution.interrupted":
            turns.set(event.data.sessionID, { status: "suppressed" })
            break
          case "session.step.started": {
            const turn = turns.get(event.data.sessionID)
            if (turn?.status === "suppressed" || turn?.status === "notified") break
            turns.set(event.data.sessionID, { status: "step", stepID: event.data.assistantMessageID })
            break
          }
          case "session.step.ended": {
            const turn = turns.get(event.data.sessionID)
            // Reloads can subscribe mid-step, without seeing execution/step start.
            if (turn && (turn.status !== "step" || turn.stepID !== event.data.assistantMessageID)) break
            turns.set(event.data.sessionID, {
              status: ["stop", "length", "content-filter"].includes(event.data.finish) ? "completed" : "running",
            })
            break
          }
          case "session.step.failed": {
            const turn = turns.get(event.data.sessionID)
            if (turn?.status === "step" && turn.stepID === event.data.assistantMessageID) {
              turns.set(event.data.sessionID, { status: "running" })
            }
            break
          }
          case "session.execution.succeeded": {
            const { sessionID } = event.data
            if (turns.get(sessionID)?.status !== "completed") break
            /** @type {NotificationTurn} */
            const notified = { status: "notified" }
            turns.set(sessionID, notified)

            // Keep consuming events while looking up the session, so cancellation can win.
            void ctx.session.get({ sessionID }, { signal }).then((session) => {
              if (signal.aborted || turns.get(sessionID) !== notified) return
              if (session.parentID || session.outcome !== "succeeded") return
              if (session.location.directory !== ctx.location.directory) return
              const soundFile = SOUNDS[Math.floor(Math.random() * SOUNDS.length)]
              if (soundFile) playSoundNotification({ service: SERVICE, soundFile, signal })
            }).catch((error) => {
              if (!signal.aborted) console.warn(`[${SERVICE}] Session lookup failed`, error)
            })
            break
          }
        }
      }
    })().catch((error) => {
      if (!signal.aborted) console.warn(`[${SERVICE}] Event subscription failed`, error)
    })

    return async () => {
      controller.abort()
      turns.clear()
      await subscription
    }
  },
})

export default IdleSoundNotificationPlugin
