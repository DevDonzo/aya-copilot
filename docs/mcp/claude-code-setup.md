# Blue MCP For Claude Code

This setup uses your existing Blue credentials from `~/.config/blue/config.env`.

## Register Blue MCP In Claude Code

From the repository root, run:

```bash
./scripts/add_blue_mcp_to_claude_code.sh
```

Then verify:

```bash
claude mcp list
```

Blue's documented Claude Code command is:

```bash
claude mcp add \
  -t http \
  -H "x-bloo-token-id: YOUR_TOKEN_ID" \
  -H "x-bloo-token-secret: YOUR_TOKEN_SECRET" \
  -H "x-bloo-company-id: YOUR_COMPANY_SLUG" \
  -- blue https://mcp.blue.cc/mcp
```

For Aya Financial, the company slug is `aya`. The helper script above pulls token values from the local Blue CLI config so they do not need to be pasted manually.

## Guardrails

Use the rules in [blue-guardrails.md](./blue-guardrails.md) as your system prompt or pinned operating instructions.

Critical restriction:

- Only allowed workspace: `03 - AYA x Hamza/ AI` with ID `cmn524yr800e101mh7kn44mhf`
- Never touch `AYA sales CRM 3` with ID `cmhazc4rl1vkand1eonnmiyjy`

## Important

Prompt guardrails are not a hard permission boundary. If you want real enforcement, use a separate Blue token or a proxy layer limited to the allowed workspace.
