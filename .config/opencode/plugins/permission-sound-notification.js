import { fileURLToPath } from "node:url"
import { playSoundNotification } from "../play-sound-notification.js"

const SERVICE = "prompt sound notification"
const SOUND_FILE = fileURLToPath(
  new URL("../sounds/wc3_peasant_yes_me_lord.wav", import.meta.url),
)
const RECENT_REQUEST_IDS = new Set()

function rememberRequest(id) {
  if (RECENT_REQUEST_IDS.has(id)) return false

  RECENT_REQUEST_IDS.add(id)
  setTimeout(() => {
    RECENT_REQUEST_IDS.delete(id)
  }, 5000)

  return true
}

export const PermissionSoundNotificationPlugin = async ({ client }) => {
  return {
    async event({ event }) {
      // Support current question/permission prompts plus older permission event names.
      if (
        event.type !== "permission.asked"
        && event.type !== "permission.updated"
        && event.type !== "question.asked"
      ) {
        return
      }

      if (typeof event.properties.id === "string") {
        if (!rememberRequest(event.properties.id)) return
      }

      playSoundNotification({
        client,
        service: SERVICE,
        soundFile: SOUND_FILE,
      })
    },
  }
}

export default PermissionSoundNotificationPlugin
