import { type RepositoryConnector } from "./entities.js";

export interface ParsedRepository {
  url: string;
  host: string;
  path: string;
  connector: RepositoryConnector;
}

const SCP_LIKE = /^(?:[^@/]+@)?([^:/@]+):(.+)$/;

function inferConnector(host: string): RepositoryConnector {
  switch (host) {
    case "github.com":
      return "github";
    case "gitlab.com":
      return "gitlab";
    case "bitbucket.org":
      return "bitbucket";
    default:
      return "git";
  }
}

/**
 * Normalizes every supported repository URL form to
 * `https://<host>/<path>`. Returns null when there is no usable host or path.
 * No network access: format validation only.
 */
export function parseRepositoryUrl(input: string): ParsedRepository | null {
  const raw = input.trim();
  if (raw.length === 0) return null;

  let host: string;
  let pathPart: string;

  if (raw.includes("://")) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    const allowed = ["http:", "https:", "ssh:", "git:"];
    if (!allowed.includes(parsed.protocol)) return null;
    host = parsed.hostname;
    pathPart = parsed.pathname;
  } else {
    const scp = raw.match(SCP_LIKE);
    if (!scp) return null;
    host = scp[1];
    pathPart = scp[2];
  }

  host = host.toLowerCase();
  pathPart = pathPart.replace(/^\/+/, "").replace(/\/+$/, "");
  if (pathPart.toLowerCase().endsWith(".git")) pathPart = pathPart.slice(0, -4);
  pathPart = pathPart.replace(/\/+$/, "");

  if (host.length === 0 || pathPart.length === 0) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;

  return {
    url: `https://${host}/${pathPart}`,
    host,
    path: pathPart,
    connector: inferConnector(host),
  };
}
