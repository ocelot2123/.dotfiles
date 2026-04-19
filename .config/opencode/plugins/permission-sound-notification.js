import { fileURLToPath } from "node:url"
import { playSoundNotification } from "../play-sound-notification.js"

const SERVICE = "permission sound notification"
const SOUND_FILE = fileURLToPath(
  new URL("../sounds/wc3_peasant_yes_me_lord.wav", import.meta.url),
)
const RECENT_PERMISSION_IDS = new Set()

function rememberPermission(id) {
  if (RECENT_PERMISSION_IDS.has(id)) return false

  RECENT_PERMISSION_IDS.add(id)
  setTimeout(() => {
    RECENT_PERMISSION_IDS.delete(id)
  }, 5000)

  return true
}

export const PermissionSoundNotificationPlugin = async ({ client }) => {
  return {
    async event({ event }) {
      // Support both current and older permission event names.
      if (event.type !== "permission.asked" && event.type !== "permission.updated") {
        return
      }

      if (typeof event.properties.id === "string") {
        if (!rememberPermission(event.properties.id)) return
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
