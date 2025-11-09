#!/usr/bin/env node

/**
 * Test the MCP server tools directly with stdio protocol
 * This emulates what an IDE/chat assistant would do
 */

import { spawn } from "child_process";
import * as path from "path";

interface MCPRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: string;
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

async function testMCPServer() {
  console.log("Starting MCP server test...\n");

  const serverPath = path.resolve("src/mcp/server.ts");
  const server = spawn("npx", ["tsx", serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: process.cwd(),
  });

  let currentRequestId = 1;
  let buffer = "";
  const responsePromises: Map<number, Promise<MCPResponse>> = new Map();

  // Handle server stdout
  server.stdout.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          const response: MCPResponse = JSON.parse(line);
          console.log(`[MCP Response ${response.id}]`, JSON.stringify(response, null, 2));

          const pending = responsePromises.get(response.id);
          if (pending) {
            // Resolve promise
            responsePromises.delete(response.id);
          }
        } catch (e) {
          console.error(`Failed to parse response: ${line}`);
        }
      }
    }
  });

  server.stderr.on("data", (data) => {
    console.error("[MCP Error]", data.toString());
  });

  // Helper to send request and wait for response
  function sendRequest(method: string, params: Record<string, unknown>): MCPRequest {
    const id = currentRequestId++;
    const request: MCPRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    console.log(`\n[MCP Request ${id}] ${method}`);
    console.log(JSON.stringify(params, null, 2));

    server.stdin.write(JSON.stringify(request) + "\n");
    return request;
  }

  try {
    // First, initialize with "initialize" and get tools
    console.log("\n=== Step 1: Initialize ===");
    sendRequest("initialize", {
      protocolVersion: "2024-11",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    await new Promise((r) => setTimeout(r, 500));

    // List available tools
    console.log("\n=== Step 2: List Tools ===");
    sendRequest("tools/list", {});

    await new Promise((r) => setTimeout(r, 500));

    // Try to call gates.run with a minimal plan
    console.log("\n=== Step 3: Test gates.run ===");
    sendRequest("tools/call", {
      name: "gates.run",
      arguments: {
        planJson: JSON.stringify({
          schemaVersion: "1.0.0",
          items: [],
          integrationBranch: "test",
          targetBranch: "main",
        }),
        gateConfigs: JSON.stringify([
          { name: "lint", run: "npm run lint", timeout: 300 },
        ]),
      },
    });

    await new Promise((r) => setTimeout(r, 1000));

    console.log("\n=== Test Complete ===");
    server.kill();
  } catch (err) {
    console.error("Test error:", err);
    server.kill();
    process.exit(1);
  }
}

testMCPServer().catch(console.error);
