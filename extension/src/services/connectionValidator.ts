/**
 * Pure, testable URL validation, secret scrubbing, and error classification
 * utilities for NetBox Phase 8 secure backend connectivity.
 */

export interface UrlValidationResult {
  valid: boolean;
  normalized?: string;
  error?: string;
  isLocalhost?: boolean;
}

export type ConnectionErrorCategory = "none" | "auth_error" | "forbidden" | "connectivity_error" | "invalid_url" | "server_error";

export function validateBackendUrl(rawUrl: string): UrlValidationResult {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    return { valid: false, error: "Backend URL cannot be empty." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      error: "Invalid URL format. Use http://127.0.0.1:8000 or http://<HOST_LAN_IP>:8000.",
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      valid: false,
      error: `Unsupported URL protocol '${parsed.protocol}'. Only http:// and https:// are allowed.`,
    };
  }

  if (!parsed.hostname) {
    return { valid: false, error: "Backend URL must include a valid hostname or IPv4 address." };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: "Do not embed credentials in the URL. Store LAN access tokens securely via NetBox SecretStorage.",
    };
  }

  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return { valid: false, error: `Invalid port '${parsed.port}'. Port must be between 1 and 65535.` };
    }
  }

  const hostLower = parsed.hostname.toLowerCase();
  const isLocalhost = hostLower === "127.0.0.1" || hostLower === "localhost" || hostLower === "::1" || hostLower === "[::1]";
  const normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`;

  return { valid: true, normalized, isLocalhost };
}

export function sanitizeSecretFromText(text: string, secret?: string | null): string {
  let out = String(text || "");
  if (secret && secret.trim().length >= 4) {
    const escaped = secret.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "g"), "[REDACTED]");
  }
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]");
  out = out.replace(/(nbx-[a-f0-9]{6,})/gi, "[REDACTED_TOKEN]");
  return out;
}

export function classifyConnectionError(statusCode?: number, errorMessage?: string): ConnectionErrorCategory {
  if (statusCode === 401) return "auth_error";
  if (statusCode === 403) return "forbidden";
  if (statusCode && statusCode >= 500) return "server_error";
  const msg = String(errorMessage || "").toLowerCase();
  if (msg.includes("http 401") || msg.includes("unauthorized") || msg.includes("token required")) {
    return "auth_error";
  }
  if (msg.includes("http 403") || msg.includes("forbidden")) {
    return "forbidden";
  }
  if (
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("enotfound") ||
    msg.includes("ehostunreach") ||
    msg.includes("enetunreach") ||
    msg.includes("timed out") ||
    msg.includes("socket hang up") ||
    msg.includes("unreachable")
  ) {
    return "connectivity_error";
  }
  return statusCode ? "server_error" : "connectivity_error";
}
