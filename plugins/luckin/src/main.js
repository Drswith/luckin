import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLuckinServer } from "./server.js";

const server = createLuckinServer();
const transport = new StdioServerTransport();
await server.connect(transport);
