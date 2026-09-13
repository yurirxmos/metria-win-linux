import { homedir } from "node:os";
import type { ProviderKind } from "../../shared/types";
import type { ProviderPaths } from "../provider-paths";
import { AntigravityProvider } from "./antigravity";
import { ClaudeProfile, ClaudeProvider } from "./claude";
import { CodexProvider } from "./codex";
import { CursorProvider } from "./cursor";
import { OpenCodeGoProvider } from "./opencode";
import type { Provider } from "./types";

export interface ProviderRegistryOptions {
  paths: ProviderPaths;
  home?: string;
  providers?: Provider[];
}

export class ProviderRegistry {
  private readonly providers: Provider[];

  constructor(options: ProviderRegistryOptions) {
    if (options.providers) {
      this.providers = [...options.providers];
    } else {
      const home = options.home ?? homedir();
      const profiles = ClaudeProfile.discover(home);
      const claudeProviders = profiles.map((profile) => new ClaudeProvider(profile));
      this.providers = [
        ...claudeProviders,
        new CodexProvider(options.paths),
        new OpenCodeGoProvider(options.paths),
        new CursorProvider(options.paths),
        new AntigravityProvider(options.paths)
      ];
    }
  }

  all(): Provider[] {
    return [...this.providers];
  }

  get(id: string): Provider | undefined {
    return this.providers.find((provider) => provider.id === id);
  }

  byKind(kind: ProviderKind): Provider[] {
    return this.providers.filter((provider) => provider.kind === kind);
  }
}

export function createDefaultProviders(paths: ProviderPaths, home: string = homedir()): Provider[] {
  return new ProviderRegistry({ paths, home }).all();
}
