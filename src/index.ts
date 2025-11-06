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
                        const results = await this.fastalertClient.searchChannelEvents(
                            query
                        );
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
                        const results = await this.fastalertClient.sendMessageEvents(
                            payload,
                            headers
                        );
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

function createOAuthUrls() {
    return {
        issuer: CONFIG.baseUrl,
        authorization_endpoint: CONFIG.frontUrl + '/login',
        token_endpoint: CONFIG.tokenEndPoint,
        registration_endpoint: CONFIG.baseUrl + '/register',
    };
}

const app = express();
app.use(express.json());
const oauthUrls = createOAuthUrls();

const oauthMetadata: OAuthMetadata = {
    ...oauthUrls,
    response_types_supported: ["code"],
};

const tokenVerifier = {
    verifyAccessToken: async (token: string) => {
        console.log("[auth] verifying token:", token);
        if (token) {
            return {
                token,
                clientId: "mcp-server",
                scopes: [],
                expiresAt: Math.floor(Date.now() / 1000) + 3600,
            };
        }
        console.error("[auth] invalid token received:", token);
        throw new Error("Invalid or expired token");
    },
};

const registeredClients: Record<string, any> = {};


app.post("/register", (req: Request, res: Response) => {
    const { redirect_uris, client_name, grant_types, response_types, token_endpoint_auth_method } = req.body;

    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
        return res.status(400).json({
            error: "invalid_client_metadata",
            error_description: "redirect_uris is required and must be a non-empty array",
        });
    }

    const client_id = `client-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const client_secret = `secret-${Math.random().toString(36).substring(2, 15)}`;

    const registration = {
        client_id,
        client_secret,
        redirect_uris,
        client_name: client_name || "Unnamed Client",
        grant_types: grant_types || ["authorization_code"],
        response_types: response_types || ["code"],
        token_endpoint_auth_method: token_endpoint_auth_method || "client_secret_basic",
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_secret_expires_at: 0,
    };

    registeredClients[client_id] = registration;

    console.log("[/register] Registered client:", registration);
    res.status(201).json(registration);
});

app.post("/token", (req: Request, res: Response) => {
    const { code } = req.body;

    if (!code || !registeredClients[code]) {
        return res.status(400).json({
            error: "invalid_grant",
            error_description: "Invalid or expired authorization code",
        });
    }

    const data = registeredClients[code];
    res.json({
        access_token: data.access_token,
        token_type: data.token_type || "Bearer",
        expires_in: Math.floor((data.expires_at - Date.now()) / 1000),
    });
    delete registeredClients[code];
});


app.use(
    mcpAuthMetadataRouter({
        oauthMetadata,
        resourceServerUrl: new URL(CONFIG.baseUrl),
    })
);

function simpleAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        const authorizeUrl = `${oauthUrls.authorization_endpoint}?response_type=code&client_id=mcp-server`;
        res.status(401).json({
            error: {
                code: "unauthorized",
                message: "Access token required",
                authorization_url: authorizeUrl,
            },
        });
        return;
    }

    const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : authHeader;

    if (!token.trim()) {
        res.status(401).json({
            error: {
                code: "invalid_token",
                message: "Empty token",
            },
        });
        return;
    }

    req.fastalertAuth = {
        token,
        clientId: "fastalert-client",
        scopes: [],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    next();
}

app.post("/mcp", simpleAuthMiddleware, async (req: Request, res: Response) => {
    try {
        const token = req.fastalertAuth?.token;
        if (!token) {
            res.status(401).json({
                error: {
                    code: "unauthorized",
                    message: "Token missing after middleware",
                },
            });
            return;
        }

        const server = new FastalertServer();
        server.fastalertClient.setToken(token);

        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        await server.server.connect(transport);
        server.transport = transport;

        await transport.handleRequest(req, res, req.body);
    } catch (err) {
        console.error("Error handling mcp request", err);
        if (!res.headersSent) {
            res.status(400).json({
                jsonrpc: "2.0",
                error: {
                    code: -32602,
                    message: err instanceof Error ? err.message : "Invalid Request",
                },
                id: null,
            });
        }
    }
});


app.get("/mcp", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    console.log("[/mcp GET] SSE client connected from", req.ip);

    res.write(": sse connection established\n\n");

    const interval = setInterval(() => {
        try {
            res.write(": ping\n\n");
        } catch (e) {
        }
    }, 15000);

    req.on("close", () => {
        clearInterval(interval);
        console.log("[/mcp GET] SSE client disconnected");
    });
});

app.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`✅ MCP Server listening at http://${CONFIG.host}:${CONFIG.port}`);
});
