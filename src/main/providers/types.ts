import type { ProviderKind, ProviderUsage } from "../../shared/types";
import type { WslShell } from "../wsl";

export interface Provider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly hint: string;
  hasHostCredentials(): boolean;
  fetchHost(): Promise<ProviderUsage>;
  fetchWsl(shell: WslShell, distro: string): Promise<ProviderUsage>;
}
