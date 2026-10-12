import { Plugin } from "@opencode/plugin"
import { fileURLToPath } from "node:url"
import { playSoundNotification } from "../play-sound-notification.js"

const SERVICE = "prompt sound notification"
const SOUND_FILE = fileURLToPath(
  new URL("../sounds/wc3_peasant_yes_me_lord.wav", import.meta.url),
)

export const PermissionSoundNotificationPlugin = Plugin.define({
  id: "permission-sound-notification",
  setup(ctx) {
    const controller = new AbortController()
    const { signal } = controller
    /** @type {Map<string, number>} */
    const recentRequests = new Map()
    /** @type {Map<string, { sessionID: string }>} */
    const pending = new Map()

    const subscription = (async () => {
      for await (const event of ctx.event.subscribe({ signal })) {
        if (signal.aborted) break
        if (event.location && event.location.directory !== ctx.location.directory) continue
        if (event.type === "permission.replied") {
          pending.delete(`permission.asked:${event.data.sessionID}:${event.data.requestID}`)
          continue
        }
        if (event.type === "form.replied" || event.type === "form.cancelled") {
          pending.delete(`form.created:${event.data.sessionID}:${event.data.id}`)
          continue
        }
        if (event.type === "session.deleted" || event.type === "session.execution.interrupted" || event.type === "session.execution.failed") {
          for (const [key, request] of pending) {
            if (request.sessionID === event.data.sessionID) pending.delete(key)
          }
          continue
        }
        // Questions are forms in V2; permissions keep their own event.
        if (event.type !== "permission.asked" && event.type !== "form.created") continue
        const request = event.type === "form.created" ? event.data.form : event.data
        const now = Date.now()
        for (const [id, expires] of recentRequests) {
          if (expires <= now) recentRequests.delete(id)
        }
        const key = `${event.type}:${request.sessionID}:${request.id}`
        if (recentRequests.has(key)) continue
        recentRequests.set(key, now + 5000)
        const notification = { sessionID: request.sessionID }
        pending.set(key, notification)

        void ctx.session.get({ sessionID: request.sessionID }, { signal }).then((session) => {
          if (pending.get(key) !== notification) return
          pending.delete(key)
          if (signal.aborted || session.location.directory !== ctx.location.directory) return
          // Subagent permission/question prompts also need the user's attention.
          playSoundNotification({ service: SERVICE, soundFile: SOUND_FILE, signal })
        }).catch((error) => {
          if (pending.get(key) === notification) pending.delete(key)
          if (!signal.aborted) console.warn(`[${SERVICE}] Session lookup failed`, error)
        })
      }
    })().catch((error) => {
      if (!signal.aborted) console.warn(`[${SERVICE}] Event subscription failed`, error)
    })

    return async () => {
      controller.abort()
      recentRequests.clear()
      pending.clear()
      await subscription
    }
  },
})

export default PermissionSoundNotificationPlugin
