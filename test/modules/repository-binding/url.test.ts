import { describe, expect, it } from "vitest";
import { parseRepositoryUrl } from "../../../src/modules/repository-binding/url.js";

describe("parseRepositoryUrl", () => {
  it("canonicalizes an https url", () => {
    expect(parseRepositoryUrl("https://github.com/acme/widgets")).toEqual({
      url: "https://github.com/acme/widgets",
      host: "github.com",
      path: "acme/widgets",
      connector: "github",
    });
  });

  it("strips a trailing .git", () => {
    expect(parseRepositoryUrl("https://github.com/acme/widgets.git")?.url)
      .toBe("https://github.com/acme/widgets");
  });

  it("strips a trailing slash", () => {
    expect(parseRepositoryUrl("https://github.com/acme/widgets/")?.url)
      .toBe("https://github.com/acme/widgets");
  });

  it("upgrades http to https in the canonical url", () => {
    expect(parseRepositoryUrl("http://github.com/acme/widgets")?.url)
      .toBe("https://github.com/acme/widgets");
  });

  it("accepts scp-style git@host:owner/repo.git", () => {
    expect(parseRepositoryUrl("git@github.com:acme/widgets.git")).toEqual({
      url: "https://github.com/acme/widgets",
      host: "github.com",
      path: "acme/widgets",
      connector: "github",
    });
  });

  it("accepts ssh:// urls and strips userinfo", () => {
    const parsed = parseRepositoryUrl("ssh://git@gitlab.com/acme/widgets.git");
    expect(parsed?.url).toBe("https://gitlab.com/acme/widgets");
    expect(parsed?.connector).toBe("gitlab");
  });

  it("accepts git:// urls on bitbucket", () => {
    const parsed = parseRepositoryUrl("git://bitbucket.org/acme/widgets.git");
    expect(parsed?.url).toBe("https://bitbucket.org/acme/widgets");
    expect(parsed?.connector).toBe("bitbucket");
  });

  it("strips credentials from the url", () => {
    expect(parseRepositoryUrl("https://user:pass@github.com/acme/widgets")?.url)
      .toBe("https://github.com/acme/widgets");
  });

  it("lowercases the host but preserves path case", () => {
    const parsed = parseRepositoryUrl("https://GitHub.com/Acme/Widgets");
    expect(parsed?.host).toBe("github.com");
    expect(parsed?.path).toBe("Acme/Widgets");
    expect(parsed?.url).toBe("https://github.com/Acme/Widgets");
  });

  it("infers a generic git connector for unknown hosts", () => {
    expect(parseRepositoryUrl("https://git.mycorp.io/team/repo.git")?.connector).toBe("git");
  });

  it("rejects malformed input", () => {
    expect(parseRepositoryUrl("")).toBeNull();
    expect(parseRepositoryUrl("not a url")).toBeNull();
    expect(parseRepositoryUrl("https://github.com")).toBeNull();
    expect(parseRepositoryUrl("ftp://github.com/a/b")).toBeNull();
  });
});
