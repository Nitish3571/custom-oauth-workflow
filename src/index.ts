#!/usr/bin/env node
import express from "express";
import FormData from "form-data";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    mcpAuthMetadataRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { FastalertClient } from "./FastalertClient.js";
import { respond, respondError } from "./utils/apiResponse.js";
import "dotenv/config";
import { Request, Response, NextFunction } from "express";
import axios from "axios";

declare global {
    namespace Express {
        interface Request {
            fastalertAuth?: {
                token: string;
                clientId: string;
                scopes: string[];
                expiresAt: number;
            };
        }
    }
}

const CONFIG = {
    host: process.env.HOST || "localhost",
    port: Number(process.env.PORT) || 3000,
    baseUrl: process.env.BASE_URL || "http://localhost:3000",
    frontUrl: process.env.FRONT_URL || "http://localhost:5173",
    tokenEndPoint: process.env.API_URL ? (process.env.API_URL + "/token") : "http://alert_api_new.test/api/token",
};
const TOKEN_ENDPOINT = "https://apialert.testflight.biz/api/token";
const fastalertClient = new FastalertClient();

class FastalertServer {
    public readonly server: Server;
    public readonly fastalertClient: FastalertClient;
    public transport?: StreamableHTTPServerTransport;

    constructor() {
        this.fastalertClient = fastalertClient;
        this.server = new Server(
            {
                name: "fastalert",
                version: "1.0.0",
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.server.onerror = (err) => console.error("[MCP Error]", err);
        this.setupHandlers();
    }

    public async close() {
        if (this.transport) this.transport.close();
        await this.server.close();
    }

    private setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "list_channels",
                    description: "List all channels, optionally filtered by name.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            name: { type: "string", description: "Optional channel name" },
                        },
                    },
                },
                {
                    name: "send_message",
                    description: "Send a message to one or more channels.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            "channel-uuid": {
                                type: "array",
                                items: { type: "string" },
                                minItems: 1,
                            },
                            title: { type: "string" },
                            content: { type: "string" },
                            action: {
                                type: "string",
                                enum: ["call", "email", "website", "image"],
                            },
                            action_value: { type: "string" },
                            image: { type: "string" },
                        },
                        required: ["channel-uuid", "title", "content"],
                    },
                },
            ],
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
            const { name, arguments: args } = req.params;
            try {
                switch (name) {
                    case "list_channels": {
                        const query = { name: args?.name as string | undefined };
                        const results = await this.fastalertClient.searchChannelEvents(query);
                        return respond(results);
                    }
                    case "send_message": {
                        const payload = args as any;
                        const formData = new FormData();
                        formData.append("channel-uuid", JSON.stringify(payload["channel-uuid"]));
                        formData.append("title", payload.title);
                        formData.append("content", payload.content);
                        if (payload.action) formData.append("action", payload.action);
                        if (payload.action_value)
                            formData.append("action_value", payload.action_value);
                        if (payload.image) formData.append("image", payload.image);
                        const headers = formData.getHeaders?.() ?? {};
                        const results = await this.fastalertClient.sendMessageEvents(payload, headers);
                        return respond(results);
                    }
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
                }
            } catch (err) {
                return respondError(err);
            }
        });
    }
}

const app = express();
app.use(express.json());

const oauthMetadata: OAuthMetadata = {
    issuer: CONFIG.baseUrl,
    authorization_endpoint: CONFIG.frontUrl + "/login",
    token_endpoint: TOKEN_ENDPOINT,
    response_types_supported: ["code"],
};

app.use(
  mcpAuthMetadataRouter({
    oauthMetadata,
    resourceServerUrl: new URL(CONFIG.baseUrl),
  })
);

app.get("/login", (req, res) => {
    const params = new URLSearchParams({
        response_type: "code",
        client_id: req.query.client_id as string,
        redirect_uri: req.query.redirect_uri as string,
        state: req.query.state as string,
    });
    res.redirect(`https://htmlalert.testflight.biz/login?${params.toString()}`);
});

app.post("/token", async (req, res) => {
    try {
        const apiRes = await axios.post(TOKEN_ENDPOINT, req.body, { headers: { "Content-Type": "application/json" } });
        res.json(apiRes.data);
    } catch (err: any) {
        res.status(400).json({ error: "invalid_grant", details: err?.response?.data });
    }
});

function simpleAuthMiddleware(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: "unauthorized", message: "Missing Authorization" });

    const token = header.replace(/^Bearer\s+/i, "").trim();
    req.fastalertAuth = { token, clientId: "", scopes: [], expiresAt: 0 };
    next();
}

app.post("/mcp", simpleAuthMiddleware, async (req, res) => {
    const server = new FastalertServer();
    server.fastalertClient.setToken(req.fastalertAuth!.token);
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined});
    await server.server.connect(transport);
    server.transport = transport;
    await transport.handleRequest(req, res, req.body);
});

app.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`✅ MCP Server running → http://${CONFIG.host}:${CONFIG.port}`);
});
