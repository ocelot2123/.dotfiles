import { fileURLToPath } from "node:url"
import { playSoundNotification } from "../play-sound-notification.js"

const SERVICE = "idle sound notification"
const SOUNDS = [
  fileURLToPath(new URL("../sounds/wc3_peasant_ready_to_work.wav", import.meta.url)),
  fileURLToPath(new URL("../sounds/wc3_peon_ready_to_work.wav", import.meta.url)),
]

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)]
}

export const IdleSoundNotificationPlugin = async ({ client }) => {
  return {
    async event({ event }) {
      if (event.type !== "session.idle") return

      playSoundNotification({
        client,
        service: SERVICE,
        soundFile: pickRandom(SOUNDS),
      })
    },
  }
}

export default IdleSoundNotificationPlugin
