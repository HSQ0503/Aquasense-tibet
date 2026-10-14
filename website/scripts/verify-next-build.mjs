import { readFileSync } from "node:fs";

const routes = JSON.parse(readFileSync(new URL("../.next/routes-manifest.json", import.meta.url), "utf8"));
const appPaths = JSON.parse(readFileSync(new URL("../.next/server/app-paths-manifest.json", import.meta.url), "utf8"));
if (!routes.version || !appPaths["/page"] || !appPaths["/api/readings/route"]) {
  throw new Error("The Next.js build is missing the dashboard or readings route.");
}
console.log("Verified Next.js route manifests for Vercel.");
