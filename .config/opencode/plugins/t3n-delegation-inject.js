import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"

const INJECT = "__inject__"
const DEFAULT_TOKEN_FILE = "~/.config/opencode/t3n-delegation-token.json"

const TOOL_FUNCTIONS = new Map([
  ["validateCredentials", "validate-credentials"],
  ["runPayrollComputation", "compute-payroll"],
  ["submitEscalationResolutions", "submit-escalations"],
  ["executeDisbursement", "execute-disbursement"],
  ["finalizeAudit", "finalize-audit"],
])

const CREDENTIAL_TOOLS = new Set([
  "listMyContext",
  "listScopeEntries",
  "previewPayrollComputation",
  "validateCredentials",
  "runPayrollComputation",
  "submitEscalationResolutions",
  "executeDisbursement",
  "finalizeAudit",
])

const SIGNED_TOOLS = new Set([
  "validateCredentials",
  "runPayrollComputation",
  "submitEscalationResolutions",
  "executeDisbursement",
  "finalizeAudit",
])

const ORG_TOOLS = new Set([
  "listScopeEntries",
  "previewPayrollComputation",
  "validateCredentials",
  "runPayrollComputation",
  "submitEscalationResolutions",
  "executeDisbursement",
  "finalizeAudit",
])

const TOOL_NAMES = new Set([
  ...CREDENTIAL_TOOLS,
])

const DID_RE = /^did:t3n:[0-9a-f]{40}$/i

function disabled() {
  const value = process.env.T3N_DELEGATION_INJECT
  if (value === undefined) return false
  return ["0", "false", "off", "no"].includes(value.trim().toLowerCase())
}

function expandPath(path) {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2))
  return isAbsolute(path) ? path : resolve(process.cwd(), path)
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(record, keys) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim() !== "") return value.trim()
  }
  return undefined
}

function decodeBase64Url(value) {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/")
  const padding = "=".repeat((4 - (normalised.length % 4)) % 4)
  return Buffer.from(`${normalised}${padding}`, "base64").toString("utf8")
}

function parseJson(text, label) {
  try {
    return JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`T3N delegation token ${label} is not valid JSON: ${message}`)
  }
}

function normaliseDid(value, label) {
  if (!DID_RE.test(value)) {
    throw new Error(`T3N delegation token ${label} is not a did:t3n:<40 hex> DID`)
  }
  return value.toLowerCase()
}

function orgDidFromCredential(credentialJcsB64u) {
  const decoded = decodeBase64Url(credentialJcsB64u)
  const credential = parseJson(decoded, "credential_jcs")
  if (!isRecord(credential)) {
    throw new Error("T3N delegation token credential_jcs is not a JSON object")
  }

  const orgDid = readString(credential, ["org_did", "orgDid"])
  if (orgDid === undefined) {
    throw new Error("T3N delegation token credential_jcs has no org_did")
  }
  return normaliseDid(orgDid, "credential_jcs.org_did")
}

function tokenFromRecord(record, toolName, source) {
  if (typeof record.value === "string" && record.value.trim() !== "") {
    const inner = parseJson(record.value, `${source}.value`)
    if (!isRecord(inner)) {
      throw new Error(`T3N delegation token ${source}.value is not a JSON object`)
    }
    return tokenFromRecord(inner, toolName, `${source}.value`)
  }

  if (isRecord(record.slots)) {
    const functionName = TOOL_FUNCTIONS.get(toolName)
    if (functionName === undefined) {
      throw new Error(`T3N delegation token ${source}.slots cannot satisfy ${toolName}`)
    }
    const slot = record.slots[functionName]
    if (!isRecord(slot)) {
      throw new Error(`T3N delegation token ${source}.slots has no ${functionName} slot`)
    }
    const token = tokenFromRecord(slot, toolName, `${source}.slots.${functionName}`)
    const orgDid = readString(record, ["org_did", "orgDid"])
    return orgDid === undefined
      ? token
      : { ...token, orgDid: normaliseDid(orgDid, `${source}.org_did`) }
  }

  const credentialJcsB64u = readString(record, [
    "credential_jcs_b64u",
    "credentialJcsB64u",
    "credential_jcs",
    "credentialJcs",
  ])
  const userSigB64u = readString(record, [
    "user_sig_b64u",
    "userSigB64u",
    "user_sig",
    "userSig",
  ])
  if (credentialJcsB64u === undefined || userSigB64u === undefined) {
    throw new Error(
      `T3N delegation token ${source} must contain credential_jcs_b64u/credential_jcs and user_sig_b64u/user_sig`,
    )
  }

  const orgDid = readString(record, ["org_did", "orgDid"])
  return {
    credentialJcsB64u,
    userSigB64u,
    orgDid: orgDid === undefined
      ? orgDidFromCredential(credentialJcsB64u)
      : normaliseDid(orgDid, `${source}.org_did`),
    source,
  }
}

function tokenFromEnvFields() {
  const credentialJcsB64u = readString(process.env, [
    "T3N_DELEGATION_CREDENTIAL_JCS_B64U",
    "CREDENTIAL_JCS_B64U",
  ])
  const userSigB64u = readString(process.env, [
    "T3N_DELEGATION_USER_SIG_B64U",
    "USER_SIG_B64U",
  ])
  if (credentialJcsB64u === undefined && userSigB64u === undefined) return undefined
  if (credentialJcsB64u === undefined || userSigB64u === undefined) {
    throw new Error(
      "Set both T3N_DELEGATION_CREDENTIAL_JCS_B64U and T3N_DELEGATION_USER_SIG_B64U, or neither.",
    )
  }

  const orgDid = readString(process.env, ["T3N_DELEGATION_ORG_DID", "ORG_DID"])
  return {
    credentialJcsB64u,
    userSigB64u,
    orgDid: orgDid === undefined
      ? orgDidFromCredential(credentialJcsB64u)
      : normaliseDid(orgDid, "T3N_DELEGATION_ORG_DID"),
    source: "env fields",
  }
}

function tokenFromJsonEnv(toolName) {
  const raw = process.env.T3N_DELEGATION_TOKEN
  if (raw === undefined || raw.trim() === "") return undefined
  const parsed = parseJson(raw, "from T3N_DELEGATION_TOKEN")
  if (!isRecord(parsed)) {
    throw new Error("T3N_DELEGATION_TOKEN is not a JSON object")
  }
  return tokenFromRecord(parsed, toolName, "T3N_DELEGATION_TOKEN")
}

function tokenFromFile(toolName) {
  const configuredPath = process.env.T3N_DELEGATION_TOKEN_FILE
  const path = configuredPath === undefined || configuredPath.trim() === ""
    ? DEFAULT_TOKEN_FILE
    : configuredPath.trim()
  const expanded = expandPath(path)
  if (!existsSync(expanded)) return undefined
  const raw = readFileSync(expanded, "utf8")
  const parsed = parseJson(raw, expanded)
  if (!isRecord(parsed)) {
    throw new Error(`T3N delegation token file ${expanded} is not a JSON object`)
  }
  return tokenFromRecord(parsed, toolName, expanded)
}

function loadToken(toolName) {
  return tokenFromJsonEnv(toolName) ?? tokenFromEnvFields() ?? tokenFromFile(toolName)
}

function resolveToolName(tool) {
  for (const name of TOOL_NAMES) {
    if (tool === name || tool.endsWith(`_${name}`)) return name
  }
  return undefined
}

function shouldReplace(value) {
  return value === undefined || value === "" || value === INJECT
}

function hasInjectPlaceholder(args) {
  return args.org_did === INJECT
    || args.credential_jcs_b64u === INJECT
    || args.user_sig_b64u === INJECT
}

function assertOrgMatches(args, token, toolName) {
  if (!ORG_TOOLS.has(toolName) || shouldReplace(args.org_did)) return
  if (typeof args.org_did !== "string") return
  if (normaliseDid(args.org_did, "args.org_did") !== token.orgDid) {
    throw new Error(
      `T3N delegation token org_did does not match ${toolName} args.org_did`,
    )
  }
}

function injectArgs(toolName, args, token) {
  const injectCredential = CREDENTIAL_TOOLS.has(toolName)
    && shouldReplace(args.credential_jcs_b64u)
  const injectSig = SIGNED_TOOLS.has(toolName)
    && shouldReplace(args.user_sig_b64u)
  const injectOrg = ORG_TOOLS.has(toolName)
    && shouldReplace(args.org_did)

  if (!injectCredential && !injectSig && !injectOrg) return
  assertOrgMatches(args, token, toolName)

  if (injectOrg) args.org_did = token.orgDid
  if (injectCredential) args.credential_jcs_b64u = token.credentialJcsB64u
  if (injectSig) args.user_sig_b64u = token.userSigB64u
}

export const T3nDelegationInjectPlugin = async () => {
  return {
    async "tool.execute.before"(input, output) {
      if (disabled()) return

      const toolName = resolveToolName(input.tool)
      if (toolName === undefined || !isRecord(output.args)) return

      const token = loadToken(toolName)
      if (token === undefined) {
        if (hasInjectPlaceholder(output.args)) {
          throw new Error(
            "T3N delegation injection requested but no token is configured. Set T3N_DELEGATION_TOKEN_FILE, T3N_DELEGATION_TOKEN, or T3N_DELEGATION_CREDENTIAL_JCS_B64U/T3N_DELEGATION_USER_SIG_B64U.",
          )
        }
        return
      }

      injectArgs(toolName, output.args, token)
    },
  }
}

export default T3nDelegationInjectPlugin
