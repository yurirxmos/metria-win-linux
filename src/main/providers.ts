import { homedir } from "node:os";
import type {
  AppSettings,
  ProviderID,
  ProviderKind,
  ProviderSourceChoice,
  ProviderSourceInfo,
  ProviderUsage,
  WslPresence
} from "../shared/types";
import { parseProviderId, PRESENCE_CACHE_TTL_MS } from "../shared/types";
import { providerPaths, type ProviderPaths } from "./provider-paths";
import { ProviderRegistry } from "./providers/registry";
import type { Provider } from "./providers/types";
import { makeWslShell, type WslProviderPresence, type WslShell } from "./wsl";

export { parseCodexAuth } from "./providers/codex";
export { parseOpenCodeGoWindows } from "./providers/opencode";
export { ProviderRegistry, createDefaultProviders } from "./providers/registry";
export type { Provider } from "./providers/types";

const defaultPaths: ProviderPaths = providerPaths({ platform: process.platform, home: homedir(), env: process.env });

export class ProviderService {
  readonly paths: ProviderPaths;
  private readonly registry: ProviderRegistry;
  private readonly presenceResults = new Map<string, { at: number; presence: WslProviderPresence }>();

  constructor(
    private readonly loadSettings: () => AppSettings,
    private readonly wsl: WslShell = makeWslShell(),
    paths: ProviderPaths = defaultPaths,
    providers?: Provider[] | ProviderRegistry
  ) {
    this.paths = paths;
    if (providers instanceof ProviderRegistry) {
      this.registry = providers;
    } else if (Array.isArray(providers)) {
      this.registry = new ProviderRegistry({ paths, providers });
    } else {
      this.registry = new ProviderRegistry({ paths });
    }
  }

  async fetch(enabled: (string | ProviderID)[]): Promise<ProviderUsage[]> {
    const entries = await this.sources(enabled);
    return Promise.all(
      entries.map(async (entry) => {
        const id = entry.id ?? entry.kind;
        const provider = this.providerFor(id);
        if (!provider) return unavailable(id, entry.kind, "");
        const source = chooseSource(entry, entry.source);
        if (!source) return unavailable(provider.id, provider.kind, provider.hint);
        try {
          return source.location === "wsl"
            ? await provider.fetchWsl(this.wsl, source.distro ?? "")
            : await provider.fetchHost();
        } catch (error) {
          return {
            ...unavailable(provider.id, provider.kind, provider.hint),
            available: true,
            error: error instanceof Error ? error.message : "Unable to load usage."
          };
        }
      })
    );
  }

  async sources(targets: (string | ProviderID)[]): Promise<ProviderSourceInfo[]> {
    const saved = this.loadSettings().providerSource ?? {};
    const distros = await this.wsl.distros();
    const presences = new Map<string, WslProviderPresence>();
    for (const distro of distros) presences.set(distro, await this.presence(distro));
    return targets.map((target) => {
      const providerId = typeof target === "string" ? parseProviderId(target) : target;
      const provider = this.providerFor(providerId.id);
      const populationKey = POPULATION_BY_KIND[providerId.kind];
      const wsl: WslPresence[] = distros.map((distro) => ({
        distro,
        present: populationKey ? (presences.get(distro)?.[populationKey] ?? false) : false
      }));
      const host = provider?.hasHostCredentials() ?? false;
      const source = saved[providerId.id] ?? saved[providerId.kind] ?? null;
      const needsChoice = host && wsl.some((entry) => entry.present) && !source;
      return { id: providerId.id, kind: providerId.kind, host, wsl, source, needsChoice };
    });
  }

  getProvider(id: string): Provider | undefined {
    return this.providerFor(id);
  }

  getProviders(): Provider[] {
    return this.registry.all();
  }

  private providerFor(id: string): Provider | undefined {
    return this.registry.get(id);
  }

  private async presence(distro: string): Promise<WslProviderPresence> {
    const cached = this.presenceResults.get(distro);
    if (cached && Date.now() - cached.at < PRESENCE_CACHE_TTL_MS) return cached.presence;
    const presence = await this.wsl.presence(distro);
    this.presenceResults.set(distro, { at: Date.now(), presence });
    return presence;
  }
}

const POPULATION_BY_KIND: Record<ProviderKind, keyof WslProviderPresence | undefined> = {
  Claude: "claude",
  Codex: "codex",
  "OpenCode Go": "openCode",
  Cursor: undefined,
  Antigravity: "antigravity"
};

/** Pick the data source for a provider given saved preference (if any) and presence. */
export function chooseSource(
  info: Pick<ProviderSourceInfo, "host" | "wsl">,
  saved: ProviderSourceChoice | null
): ProviderSourceChoice | null {
  const wslSource = (): ProviderSourceChoice | null => {
    const present = info.wsl.find((entry) => entry.present);
    return present ? { location: "wsl", distro: present.distro } : null;
  };
  if (saved) {
    if (saved.location === "host") return info.host ? saved : wslSource();
    return info.wsl.some((entry) => entry.distro === saved.distro && entry.present)
      ? saved
      : info.host
        ? { location: "host" }
        : wslSource();
  }
  return info.host ? { location: "host" } : wslSource();
}

function unavailable(id: string, kind: ProviderKind, setupHint: string): ProviderUsage {
  return {
    id,
    kind,
    accountLabel: null,
    windows: [],
    updatedAt: null,
    error: null,
    available: false,
    setupHint
  };
}
