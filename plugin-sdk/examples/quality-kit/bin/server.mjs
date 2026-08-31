#!/usr/bin/env node

import readline from "node:readline"

const lines = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value })
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } })
}

lines.on("line", (line) => {
  let request
  try {
    request = JSON.parse(line)
  } catch {
    error(null, -32700, "JSON inválido")
    return
  }

  if (request.method === "initialize") {
    result(request.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "quality-kit", version: "1.0.0" },
    })
    return
  }

  if (request.method === "notifications/initialized") return

  if (request.method === "tools/list") {
    result(request.id, {
      tools: [
        {
          name: "quality_echo",
          title: "Eco de qualidade",
          description: "Devolve um texto para provar o caminho MCP do plugin",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      ],
    })
    return
  }

  if (request.method === "tools/call") {
    if (request.params?.name !== "quality_echo") {
      error(request.id, -32602, "tool desconhecida")
      return
    }
    const text = request.params?.arguments?.text
    if (typeof text !== "string") {
      error(request.id, -32602, "text precisa ser string")
      return
    }
    result(request.id, {
      content: [{ type: "text", text }],
      isError: false,
    })
    return
  }

  if (request.id !== undefined) {
    error(request.id, -32601, "método não encontrado")
  }
})
