// Static, always-synthetic phone preview for the existing Tailscale Serve daemon.
// No private API proxy, new server process, account or scheduler is needed.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const origin = "https://kotoleaf.wandering-sky-fcce.workers.dev";
mkdirSync(".preview", { recursive: true });
const html = readFileSync("src/learning.html", "utf8")
	.replace('src="/learn.js"', 'src="./learn.js"')
	.replace('href="/learn?demo=1"', `href="${origin}/learn?demo=1"`);
const script = readFileSync("src/learning-browser.txt", "utf8")
	.replace('const demo = new URL(location.href).searchParams.get("demo") === "1";', 'const demo = true;')
	.replace('location.href = "/learn";', `location.href = "${origin}/learn";`);
writeFileSync(".preview/index.html", html);
writeFileSync(".preview/learn.js", script);
console.log("Synthetic-only preview written to worker/.preview");
