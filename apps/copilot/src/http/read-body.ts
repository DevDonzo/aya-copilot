import type { IncomingMessage } from "node:http";

export async function readBody(request: IncomingMessage) {
  return await new Promise<string>((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += String(chunk);
    });

    request.on("end", () => {
      resolve(body);
    });

    request.on("error", (error) => {
      reject(error);
    });
  });
}
