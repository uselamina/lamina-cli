# `@uselamina/cli`

Terminal interface for the Lamina public `/v1` API.

Lamina is an agentic creative API for generating videos, movies, and images for products, brands, social, and ads. The CLI lets you discover apps, run executions, set up webhook listeners, and launch the MCP server -- all from the terminal.

**Use the CLI when:** you're prototyping, scripting, testing webhooks locally, or launching the MCP server for agent integration.

See also: [`@uselamina/sdk`](https://github.com/uselamina/lamina-sdk) for programmatic Node.js/TypeScript integration, [`@uselamina/mcp`](https://github.com/uselamina/lamina-mcp) for direct agent tool access.

## Install

```bash
npm install -g @uselamina/cli
```

## Quick start

```bash
# Authenticate
lamina login

# Discover apps
lamina apps list --search catalog
lamina apps get <appId>

# Run an app and wait for results
lamina run <appId> --file inputs.json --wait

# Set up a local webhook listener for testing
lamina webhook serve --public-url https://example.ngrok.dev --save-default

# Run with webhook delivery
lamina run <appId> --file inputs.json --webhook default

# Launch MCP server (for Claude, Cursor, etc.)
lamina mcp serve
```

## Docs

- https://docs.uselamina.ai/guides/use-the-cli-and-sdk
- https://docs.uselamina.ai/guides/test-webhooks-locally
- https://docs.uselamina.ai/guides/agent-integration-patterns
