import { spawn } from "node:child_process"

const PULSE_SERVER = "tcp:192.168.50.195:4713"

export function playSoundNotification({ client, service, soundFile }) {
  const child = spawn("paplay", [soundFile], {
    detached: true,
    env: {
      ...process.env,
      PULSE_SERVER,
    },
    stdio: "ignore",
  })

  let failed = false

  child.once("error", (error) => {
    failed = true
    void client.app.log({
      body: {
        service,
        level: "warn",
        message: "Failed to start sound notification",
        extra: {
          soundFile,
          pulseServer: PULSE_SERVER,
          error: error.message,
        },
      },
    })
  })

  child.once("exit", (exitCode, signal) => {
    if (failed || exitCode === 0) return

    void client.app.log({
      body: {
        service,
        level: "warn",
        message: "Sound notification exited non-zero",
        extra: {
          soundFile,
          pulseServer: PULSE_SERVER,
          exitCode,
          signal,
        },
      },
    })
  })

  child.unref()
}
