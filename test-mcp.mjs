#!/usr/bin/env node
/**
 * Simple test for the MCP server
 * Tests the stdio JSON-RPC protocol
 */

import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log("Testing lexrunner MCP server...\n");

const serverPath = resolve(__dirname, "mcp-server.mjs");
const server = spawn("node", [serverPath], {
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    LEX_PR_PROFILE_DIR: resolve(__dirname, ".smartergpt"),
  },
});

let buffer = "";
let requestId = 0;

// Handle server responses
server.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const response = JSON.parse(line);
      console.log("← Response:", JSON.stringify(response, null, 2), "\n");
    } catch (error) {
      console.error("Failed to parse response:", line);
    }
  }
});

// Helper to send requests
function sendRequest(method, params = {}) {
  const id = ++requestId;
  const request = {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };
  console.log("→ Request:", JSON.stringify(request, null, 2), "\n");
  server.stdin.write(JSON.stringify(request) + "\n");
}

// Test sequence
setTimeout(() => {
  console.log("1. Initialize handshake");
  sendRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.1.0" },
  });
}, 100);

setTimeout(() => {
  console.log("2. Send initialized notification");
  server.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }) + "\n"
  );
}, 200);

setTimeout(() => {
  console.log("3. List available tools");
  sendRequest("tools/list");
}, 300);

setTimeout(() => {
  console.log("4. Call health check tool");
  sendRequest("tools/call", {
    name: "health",
    arguments: { includeMetrics: true },
  });
}, 400);

setTimeout(() => {
  console.log("5. Call profile.resolve tool");
  sendRequest("tools/call", {
    name: "profile.resolve",
    arguments: {},
  });
}, 500);

// Shutdown after tests
setTimeout(() => {
  console.log("Tests complete. Shutting down...");
  server.stdin.end();
  setTimeout(() => {
    server.kill();
    process.exit(0);
  }, 100);
}, 1000);

// Handle errors
server.on("error", (error) => {
  console.error("Server error:", error);
  process.exit(1);
});

server.on("exit", (code) => {
  console.log(`Server exited with code ${code}`);
});
