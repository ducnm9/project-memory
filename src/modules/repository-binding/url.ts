import { type RepositoryConnector } from "./entities.js";

export interface ParsedRepository {
  url: string;
  host: string;
  path: string;
  connector: RepositoryConnector;
}

const SCP_LIKE = /^(?:([^@/\s]+)@)?([^:/\s]+):([^\s]+)$/;
const HOST = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*$/;

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
    const user = scp[1];
    const scpHost = scp[2];
    const scpPath = scp[3];
    // The no-user `host:path` form requires a dotted host, so
    // scheme-without-`//` input (`https:foo/bar`), `C:/x`, and `word:rest`
    // are rejected instead of being read as a host.
    if (!user && !scpHost.includes(".")) return null;
    host = scpHost;
    pathPart = scpPath;
  }

  host = host.toLowerCase();
  pathPart = pathPart.replace(/^\/+/, "").replace(/\/+$/, "");
  if (pathPart.toLowerCase().endsWith(".git")) pathPart = pathPart.slice(0, -4);
  pathPart = pathPart.replace(/\/+$/, "");

  if (pathPart.length === 0) return null;
  if (!HOST.test(host)) return null;

  return {
    url: `https://${host}/${pathPart}`,
    host,
    path: pathPart,
    connector: inferConnector(host),
  };
}
