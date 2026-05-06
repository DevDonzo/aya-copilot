import { Permissions, PermissionTypes } from 'librechat-data-provider';
import { useGetStartupConfig } from '~/data-provider/Endpoints/queries';
import { useMCPServersQuery, useMCPToolsQuery } from '~/data-provider/MCP/queries';
import useHasAccess from '~/hooks/Roles/useHasAccess';
import { useMCPConnectionStatus } from './useMCPConnectionStatus';

const AYA_SERVER_NAME = 'aya_ops';

export type AyaRuntimeState =
  | 'hidden'
  | 'loading'
  | 'ready'
  | 'write_auth_needed'
  | 'unavailable'
  | 'not_configured';

export interface AyaRuntimeStatus {
  state: AyaRuntimeState;
  label: string;
  detail: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
  visible: boolean;
}

export function useAyaRuntimeStatus(): AyaRuntimeStatus {
  const canUseMcp = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });
  const { data: startupConfig, isFetched: isStartupConfigFetched } = useGetStartupConfig();
  const { data: loadedServers, isLoading: isServersLoading } = useMCPServersQuery({
    enabled: canUseMcp,
  });

  const hasAyaServer = Boolean(loadedServers?.[AYA_SERVER_NAME]);
  const ayaServerConfig = loadedServers?.[AYA_SERVER_NAME];

  const { data: mcpToolsData, isLoading: isToolsLoading, isError: isToolsError } = useMCPToolsQuery({
    enabled: canUseMcp && hasAyaServer,
  });
  const { connectionStatus } = useMCPConnectionStatus({
    enabled: canUseMcp && hasAyaServer,
  });

  if (!canUseMcp) {
    return {
      state: 'hidden',
      label: '',
      detail: '',
      tone: 'neutral',
      visible: false,
    };
  }

  if (!isStartupConfigFetched || isServersLoading || (hasAyaServer && isToolsLoading)) {
    return {
      state: 'loading',
      label: 'Aya loading',
      detail: 'Aya is loading its internal tools and connection state.',
      tone: 'neutral',
      visible: true,
    };
  }

  if (!hasAyaServer) {
    return {
      state: 'not_configured',
      label: 'Aya missing',
      detail: 'This shell is missing the Aya backend connection.',
      tone: 'danger',
      visible: true,
    };
  }

  const ayaToolServer = mcpToolsData?.servers?.[AYA_SERVER_NAME];
  const ayaServerStatus = connectionStatus?.[AYA_SERVER_NAME];
  const hasWriteCredentialFields =
    Boolean(ayaServerConfig?.customUserVars) &&
    Object.keys(ayaServerConfig?.customUserVars ?? {}).length > 0;

  if (ayaServerStatus?.inspectionFailed || isToolsError || !ayaToolServer) {
    return {
      state: 'unavailable',
      label: 'Aya unavailable',
      detail: 'Aya backend is unreachable. Blue actions and audit-backed workflows are offline.',
      tone: 'danger',
      visible: true,
    };
  }

  if (hasWriteCredentialFields && ayaToolServer.authenticated !== true) {
    return {
      state: 'write_auth_needed',
      label: 'Aya read-only',
      detail:
        'Reads are available. Connect Blue once in Aya settings to unlock attributable comments, moves, and lead creation.',
      tone: 'warning',
      visible: true,
    };
  }

  const productTitle = startupConfig?.appTitle?.trim() || 'Aya';

  return {
    state: 'ready',
    label: `${productTitle} ready`,
    detail: 'Aya is connected for internal search, summaries, and auditable Blue workflows.',
    tone: 'success',
    visible: true,
  };
}
