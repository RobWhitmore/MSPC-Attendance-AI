import "dotenv/config";
import path from "path";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createApp } from "./src/server/app.js";

/**
 * Local development server.
 *
 * On Azure this file is not used at all - the managed Function starts the same
 * Express app on loopback. See api/src/index.ts.
 */

async function start() {
    const PORT = parseInt(process.env.PORT || "3000", 10);
    const isProduction = process.env.NODE_ENV === "production";

    const app = createApp({ beforeRoutes: isProduction ? [] : [devPrincipal()] });

    if (!isProduction) {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: "spa",
        });
        app.use(vite.middlewares);
    } else {
        const distPath = path.join(process.cwd(), "dist");
        app.use(express.static(distPath));
        app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
    }

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

/**
 * Stand in for the principal that Static Web Apps injects, so admin routes can
 * be exercised locally.
 *
 * Refuses to arm itself in production even if the variable is set - a
 * dev-convenience header that forges an identity is the last thing that should
 * survive a deployment.
 */
function devPrincipal(): express.RequestHandler {
    const email = process.env.DEV_ADMIN_EMAIL;

    if (!email) {
        return (_req, _res, next) => next();
    }
    if (process.env.NODE_ENV === "production") {
        throw new Error("DEV_ADMIN_EMAIL is set with NODE_ENV=production. Refusing to start.");
    }

    console.warn(
        `\n  DEV_ADMIN_EMAIL is set: every request is treated as "${email}".\n` +
        `  This forges the header Static Web Apps would inject. Local use only.\n`
    );

    const header = Buffer.from(
        JSON.stringify({
            identityProvider: "aad",
            userId: "dev-local",
            userDetails: email,
            userRoles: ["authenticated"],
        })
    ).toString("base64");

    return (req, _res, next) => {
        req.headers["x-ms-client-principal"] = header;
        next();
    };
}

start().catch(err => {
    console.error("Failed to start server:", err);
    process.exit(1);
});
