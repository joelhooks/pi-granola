# pi-granola

Agent-first CLI wrapper for Granola's remote MCP server, built for Pi.

- MCP endpoint: `https://mcp.granola.ai/mcp`
- State: `~/.config/pi-granola/auth.json`
- Output: JSON envelopes only, with `next_actions`

## Install

```bash
bun install
bun run build
cp bin/pi-granola ~/.bun/bin/pi-granola
```

## Usage

```bash
pi-granola
pi-granola login
pi-granola auth-callback '<full callback URL from browser>'
pi-granola status
pi-granola tools
pi-granola call <tool-name> --args '{"key":"value"}'
```

If the browser lands on a dead localhost callback, copy the full URL and pass it to `auth-callback`.

## Notes

Granola MCP is OAuth-backed. The CLI persists MCP dynamic client info, PKCE verifier, discovery state, and tokens locally. Keep `~/.config/pi-granola/auth.json` private.
