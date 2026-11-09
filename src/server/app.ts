import express, { type Express, type RequestHandler } from "express";
import portalRoutes from "./routes/portal.js";
import leaderRoutes from "./routes/leader.js";
import adminRoutes from "./routes/admin.js";
import { getAccessCode, verifyAccessCode, serverError, isConnRefused } from "./auth.js";
import { listAll } from "./repo.js";

/**
 * The Express application, without a listener.
 *
 * Local dev adds Vite middleware and listens (see server.ts); on Azure the
 * managed Function starts it on loopback and forwards to it (see api/).
 */
export function createApp(options: { beforeRoutes?: RequestHandler[] } = {}): Express {
    const app = express();

    app.use(express.json({ limit: "50mb" }));

    // Must run before the routers, not after - anything that shapes the request
    // (such as the local stand-in for the SWA principal) is useless downstream.
    for (const middleware of options.beforeRoutes ?? []) {
        app.use(middleware);
    }

    app.use("/api/portal", portalRoutes);
    app.use("/api/leader", leaderRoutes);
    app.use("/api/admin", adminRoutes);

    /**
     * Proves the app is serving *and* reaching the database in one request.
     * A read rather than a write - a health check should not leave a trail.
     */
    app.get("/api/health", async (_req, res) => {
        try {
            await listAll("groupTypes");
            res.json({ status: "ok", message: "Cosmos DB connected" });
        } catch (err) {
            if (isConnRefused(err)) {
                const endpoint = process.env.COSMOS_ENDPOINT || "(COSMOS_ENDPOINT unset)";
                console.error(`health: Cannot reach Cosmos at ${endpoint} – is the emulator running?`);
            } else {
                console.error("health:", err);
            }
            res.status(503).json({ status: "error", message: "Cosmos DB unreachable" });
        }
    });

    /**
     * Resolve an access code to a person, for the portal's initial page load.
     *
     * Returns the role and id only. The Firebase version's comment about custom
     * tokens no longer applies - there is no token here to mint.
     */
    app.post("/api/link-session", async (req, res) => {
        try {
            const accessCode = getAccessCode(req);
            if (!accessCode) return res.status(400).json({ error: "Missing accessCode" });

            const caller = await verifyAccessCode(accessCode);
            if (!caller) return res.status(401).json({ error: "Invalid access code" });

            res.json({
                success: true,
                personId: caller.id,
                role: caller.data.type || caller.data.role || "member",
            });
        } catch (err) {
            serverError(res, "link-session", err);
        }
    });

    return app;
}
