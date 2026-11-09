import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";
import { createApp } from "../../src/server/app.js";

/**
 * One Function, with the whole Express app behind it.
 *
 * Rewriting ~25 routes into ~25 Functions would have meant re-deriving the
 * middleware, the router mounting and the JSON handling in a programming model
 * that expresses none of them. Express listens on an ephemeral loopback port at
 * cold start and every invocation is forwarded to it.
 *
 * Static Web Apps caps a request at 45 seconds and the cap cannot be raised.
 * Nothing here comes close; anything that later does must become a queued job
 * rather than a slower route.
 */

let serverPromise: Promise<Server> | undefined;

function loopbackServer(): Promise<Server> {
    if (!serverPromise) {
        serverPromise = new Promise<Server>((resolve, reject) => {
            const server = createServer(createApp());
            server.once("error", reject);
            // Port 0: the OS picks a free one, so nothing collides with the host.
            server.listen(0, "127.0.0.1", () => resolve(server));
        });
    }
    return serverPromise;
}

/** Headers that describe a hop, not the message, and must not be forwarded. */
const HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "host",
]);

async function handler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    const server = await loopbackServer();
    const { port } = server.address() as AddressInfo;

    const incoming = new URL(request.url);
    const target = `http://127.0.0.1:${port}${incoming.pathname}${incoming.search}`;

    const headers = new Headers();
    for (const [name, value] of request.headers.entries()) {
        if (!HOP_BY_HOP.has(name.toLowerCase())) headers.set(name, value);
    }

    const hasBody = !["GET", "HEAD"].includes(request.method.toUpperCase());
    const body = hasBody ? Buffer.from(await request.arrayBuffer()) : undefined;

    try {
        const response = await fetch(target, {
            method: request.method,
            headers,
            body,
        });

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, name) => {
            if (!HOP_BY_HOP.has(name.toLowerCase())) responseHeaders[name] = value;
        });

        return {
            status: response.status,
            headers: responseHeaders,
            body: Buffer.from(await response.arrayBuffer()),
        };
    } catch (err) {
        // Without this the caller gets an opaque platform 500 and the log says
        // nothing about which route or why.
        context.error(`Failed proxying ${request.method} ${incoming.pathname}:`, err);
        return {
            status: 502,
            jsonBody: { error: "The API could not be reached." },
        };
    }
}

app.http("api", {
    route: "{*path}",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    authLevel: "anonymous",
    handler,
});
