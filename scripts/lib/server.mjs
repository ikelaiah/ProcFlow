/* Minimal static file server for the browser test suites. Node's built-in
   http module is enough to serve the repository over 127.0.0.1 on an
   ephemeral port; nothing binds to a public interface and no external
   request is ever made. */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8"
};

export function startStaticServer(root) {
  const base = resolve(root);
  const server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const requested = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
      const filePath = normalize(join(base, requested));
      if (filePath !== base && !filePath.startsWith(base + sep)) {
        response.writeHead(403);
        response.end("forbidden");
        return;
      }
      if (!statSync(filePath).isFile()) {
        response.writeHead(404);
        response.end("not found");
        return;
      }
      response.writeHead(200, {
        "content-type": CONTENT_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream"
      });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });

  return new Promise((resolveReady) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolveReady({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolveClosed) => server.close(resolveClosed))
      });
    });
  });
}
