#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./tools.js";

void serveStdio(createServer);
console.error("YesWeHack MCP running on stdio (read-only, credentials + TOTP)");
