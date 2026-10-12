import { spawn } from "node:child_process"

const PULSE_SERVER = "tcp:192.168.50.195:4713"

/** @param {{ service: string, soundFile: string, signal?: AbortSignal }} options */
export function playSoundNotification({ service, soundFile, signal }) {
  const child = spawn("paplay", [soundFile], {
    detached: true,
    env: {
      ...process.env,
      PULSE_SERVER,
    },
    stdio: "ignore",
    signal,
  })

  let failed = false

  child.once("error", (error) => {
    failed = true
    if (signal?.aborted) return
    console.warn(`[${service}] Failed to start sound notification`, {
      soundFile,
      pulseServer: PULSE_SERVER,
      error: error.message,
    })
  })

  child.once("exit", (exitCode, exitSignal) => {
    if (failed || exitCode === 0 || signal?.aborted) return

    console.warn(`[${service}] Sound notification exited non-zero`, {
      soundFile,
      pulseServer: PULSE_SERVER,
      exitCode,
      signal: exitSignal,
    })
  })

  child.unref()
}
