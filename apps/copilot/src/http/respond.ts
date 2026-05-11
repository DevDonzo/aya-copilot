import type { ServerResponse } from "node:http";

export function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function html(response: ServerResponse, status: number, body: string) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}
