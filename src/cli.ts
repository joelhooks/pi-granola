#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js"
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js"

const VERSION = "0.1.0"
const DEFAULT_SERVER_URL = "https://mcp.granola.ai/mcp"
const DEFAULT_CALLBACK_URL = "http://127.0.0.1:62841/callback/pi-granola"
const STATE_PATH = join(homedir(), ".config", "pi-granola", "auth.json")

type NextAction = { command: string; description: string; params?: Record<string, unknown> }
type Envelope =
  | { ok: true; command: string; result: unknown; next_actions: NextAction[] }
  | { ok: false; command: string; error: { message: string; code: string }; fix: string; next_actions: NextAction[] }

type AuthState = {
  serverUrl?: string
  redirectUrl?: string
  clientInformation?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  codeVerifier?: string
  discoveryState?: unknown
}

function print(value: Envelope): never {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n")
  process.exit(value.ok ? 0 : 1)
}

function commandString(): string {
  return ["pi-granola", ...process.argv.slice(2)].join(" ")
}

function ok(result: unknown, next_actions: NextAction[] = []): never {
  print({ ok: true, command: commandString(), result, next_actions })
}

function fail(message: string, code: string, fix: string, next_actions: NextAction[] = []): never {
  print({ ok: false, command: commandString(), error: { message, code }, fix, next_actions })
}

function loadState(): AuthState {
  if (!existsSync(STATE_PATH)) return {}
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as AuthState
}

function saveState(state: AuthState) {
  mkdirSync(dirname(STATE_PATH), { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 })
}

function flag(name: string, fallback?: string): string | undefined {
  const args = process.argv.slice(2)
  const ix = args.indexOf(name)
  return ix >= 0 ? args[ix + 1] : fallback
}

function positional(n: number): string | undefined {
  return process.argv.slice(3)[n]
}

class FileOAuthProvider implements OAuthClientProvider {
  constructor(private authState: AuthState, private onRedirect?: (url: URL) => void) {}

  get redirectUrl() {
    return this.authState.redirectUrl ?? DEFAULT_CALLBACK_URL
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "pi-granola",
      redirect_uris: [String(this.redirectUrl)],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post"
    }
  }

  clientInformation() { return this.authState.clientInformation }
  saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    this.authState.clientInformation = clientInformation
    saveState(this.authState)
  }
  tokens() { return this.authState.tokens }
  saveTokens(tokens: OAuthTokens) {
    this.authState.tokens = tokens
    saveState(this.authState)
  }
  redirectToAuthorization(authorizationUrl: URL) {
    this.onRedirect?.(authorizationUrl)
  }
  saveCodeVerifier(codeVerifier: string) {
    this.authState.codeVerifier = codeVerifier
    saveState(this.authState)
  }
  codeVerifier() {
    if (!this.authState.codeVerifier) throw new Error("No OAuth code verifier saved. Run `pi-granola login` first.")
    return this.authState.codeVerifier
  }
  saveDiscoveryState(state: unknown) {
    this.authState.discoveryState = state
    saveState(this.authState)
  }
  discoveryState() { return this.authState.discoveryState as never }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all") this.authState = { serverUrl: this.authState.serverUrl, redirectUrl: this.authState.redirectUrl }
    if (scope === "client") delete this.authState.clientInformation
    if (scope === "tokens") delete this.authState.tokens
    if (scope === "verifier") delete this.authState.codeVerifier
    if (scope === "discovery") delete this.authState.discoveryState
    saveState(this.authState)
  }
}

async function connectClient(options: { redirect?: (url: URL) => void } = {}) {
  const state = loadState()
  state.serverUrl ||= DEFAULT_SERVER_URL
  state.redirectUrl ||= DEFAULT_CALLBACK_URL
  const provider = new FileOAuthProvider(state, options.redirect)
  const transport = new StreamableHTTPClientTransport(new URL(state.serverUrl), { authProvider: provider })
  const client = new Client({ name: "pi-granola", version: VERSION }, { capabilities: {} })
  await client.connect(transport)
  return { client, transport, state, provider }
}

function commonNext(): NextAction[] {
  return [
    { command: "pi-granola tools", description: "List Granola MCP tools" },
    { command: "pi-granola call <tool> [--args <json>]", description: "Call a Granola MCP tool", params: { tool: { required: true }, json: { default: "{}" } } },
    { command: "pi-granola status", description: "Check auth and server reachability" }
  ]
}

async function main() {
  const cmd = process.argv[2] ?? "root"

  try {
    if (cmd === "root" || cmd === "help" || cmd === "--help") {
      ok({
        name: "pi-granola",
        version: VERSION,
        description: "Agent-first CLI wrapper for Granola's remote MCP server.",
        server_url: DEFAULT_SERVER_URL,
        state_path: STATE_PATH,
        commands: [
          { name: "login", usage: "pi-granola login [--callback-url <url>]", description: "Start OAuth and print the authorization URL" },
          { name: "auth-callback", usage: "pi-granola auth-callback <callback-url-or-code>", description: "Finish OAuth after browser redirect" },
          { name: "status", usage: "pi-granola status", description: "Check saved auth and MCP connection" },
          { name: "tools", usage: "pi-granola tools", description: "List available Granola MCP tools" },
          { name: "call", usage: "pi-granola call <tool> [--args <json>]", description: "Call a Granola MCP tool" }
        ]
      }, [
        { command: "pi-granola login", description: "Authenticate with Granola MCP" },
        { command: "pi-granola tools", description: "List tools after auth" }
      ])
    }

    if (cmd === "login") {
      const state = loadState()
      state.serverUrl = flag("--server-url", state.serverUrl ?? DEFAULT_SERVER_URL)
      state.redirectUrl = flag("--callback-url", state.redirectUrl ?? DEFAULT_CALLBACK_URL)
      saveState(state)
      let authorization_url: string | undefined
      try {
        await connectClient({ redirect: (url) => { authorization_url = url.toString() } })
        ok({ authenticated: true, server_url: state.serverUrl, state_path: STATE_PATH }, commonNext())
      } catch (error) {
        if (error instanceof UnauthorizedError && authorization_url) {
          ok({
            authenticated: false,
            authorization_url,
            callback_url: state.redirectUrl,
            state_path: STATE_PATH,
            next_step: "Open authorization_url, then run `pi-granola auth-callback '<full callback URL>'`."
          }, [
            { command: "pi-granola auth-callback <callback-url-or-code>", description: "Finish OAuth", params: { "callback-url-or-code": { required: true } } }
          ])
        }
        throw error
      }
    }

    if (cmd === "auth-callback") {
      const input = positional(0)
      if (!input) fail("Missing callback URL or code", "MISSING_CALLBACK", "Paste the full browser callback URL or the `code` value.", [{ command: "pi-granola login", description: "Restart OAuth" }])
      const code = input.startsWith("http") ? new URL(input).searchParams.get("code") : input
      if (!code) fail("No `code` query param found", "MISSING_CODE", "Pass the full callback URL containing ?code=... or pass only the code.", [{ command: "pi-granola login", description: "Restart OAuth" }])
      const state = loadState()
      const provider = new FileOAuthProvider(state)
      const transport = new StreamableHTTPClientTransport(new URL(state.serverUrl ?? DEFAULT_SERVER_URL), { authProvider: provider })
      await transport.finishAuth(code)
      await connectClient()
      ok({ authenticated: true, server_url: state.serverUrl ?? DEFAULT_SERVER_URL, state_path: STATE_PATH }, commonNext())
    }

    if (cmd === "status") {
      const state = loadState()
      const has_tokens = Boolean(state.tokens)
      if (!has_tokens) ok({ authenticated: false, server_url: state.serverUrl ?? DEFAULT_SERVER_URL, state_path: STATE_PATH }, [{ command: "pi-granola login", description: "Authenticate" }])
      const { client, transport } = await connectClient()
      await client.close()
      await transport.close()
      ok({ authenticated: true, reachable: true, server_url: state.serverUrl ?? DEFAULT_SERVER_URL, state_path: STATE_PATH }, commonNext())
    }

    if (cmd === "tools") {
      const { client, transport } = await connectClient()
      const result = await client.request({ method: "tools/list", params: {} }, ListToolsResultSchema)
      await client.close(); await transport.close()
      ok({ tools: result.tools ?? [], count: result.tools?.length ?? 0 }, commonNext())
    }

    if (cmd === "call") {
      const tool = positional(0)
      if (!tool) fail("Missing tool name", "MISSING_TOOL", "Run `pi-granola tools`, then call one of the listed tool names.", [{ command: "pi-granola tools", description: "List tools" }])
      const argsText = flag("--args", "{}") ?? "{}"
      let args: Record<string, unknown>
      try { args = JSON.parse(argsText) } catch { fail("Invalid JSON for --args", "INVALID_ARGS_JSON", "Pass valid JSON, for example `--args '{\"query\":\"foo\"}'`.", commonNext()) }
      const { client, transport } = await connectClient()
      const result = await client.request({ method: "tools/call", params: { name: tool, arguments: args } }, CallToolResultSchema)
      await client.close(); await transport.close()
      ok({ tool, response: result }, commonNext())
    }

    fail(`Unknown command: ${cmd}`, "UNKNOWN_COMMAND", "Run `pi-granola` for the command tree.", [{ command: "pi-granola", description: "Show commands" }])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail(message, "COMMAND_FAILED", "If auth failed, run `pi-granola login` and then `pi-granola auth-callback '<callback URL>'`.", commonNext())
  }
}

await main()
