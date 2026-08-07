import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export interface AuthSecrets {
  dashboardUsername: string;
  dashboardPassword: string;
  adminToken: string;
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    timingSafeEqual(leftBuffer, Buffer.alloc(leftBuffer.length));
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function basicCredentials(header: string | undefined): [string, string] | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return [decoded.slice(0, separator), decoded.slice(separator + 1)];
  } catch {
    return null;
  }
}

function bearerToken(header: string | undefined): string | null {
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

export function createAccessGuard(secrets: AuthSecrets) {
  return async function accessGuard(request: FastifyRequest, reply: FastifyReply) {
    const pathname = request.url.split("?", 1)[0];
    if (pathname === "/health") return;

    if (pathname.startsWith("/internal/")) {
      const token = bearerToken(request.headers.authorization);
      if (token && secureEqual(token, secrets.adminToken)) return;
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const credentials = basicCredentials(request.headers.authorization);
    if (
      credentials &&
      secureEqual(credentials[0], secrets.dashboardUsername) &&
      secureEqual(credentials[1], secrets.dashboardPassword)
    ) {
      return;
    }
    reply.header("www-authenticate", 'Basic realm="AI Radar", charset="UTF-8"');
    return reply.code(401).type("text/plain").send("Authentication required");
  };
}
