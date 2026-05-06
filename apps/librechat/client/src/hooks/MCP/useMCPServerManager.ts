import { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import { useAtom } from 'jotai';
import { useToastContext } from '@librechat/client';
import { useQueryClient } from '@tanstack/react-query';
import {
  Constants,
  QueryKeys,
  MCPOptions,
  Permissions,
  ResourceType,
  PermissionTypes,
} from 'librechat-data-provider';
import {
  useCancelMCPOAuthMutation,
  useUpdateUserPluginsMutation,
  useReinitializeMCPServerMutation,
  useGetAllEffectivePermissionsQuery,
} from 'librechat-data-provider/react-query';
import type { TUpdateUserPlugins, TPlugin, MCPServersResponse } from 'librechat-data-provider';
import type { ConfigFieldDetail } from '~/common';
import {
  useAuthContext,
  useLocalize,
  useHasAccess,
  useMCPSelect,
  useMCPConnectionStatus,
} from '~/hooks';
import {
  useGetStartupConfig,
  useMCPServersQuery,
  useMCPToolsQuery,
  useUserTermsQuery,
} from '~/data-provider';
import { mcpServerInitStatesAtom, getServerInitState } from '~/store/mcp';
import type { MCPServerInitState } from '~/store/mcp';

export interface MCPServerDefinition {
  serverName: string;
  config: MCPOptions;
  dbId?: string; // MongoDB ObjectId for database servers (used for permissions)
  effectivePermissions: number; // Permission bits (VIEW=1, EDIT=2, DELETE=4, SHARE=8)
  consumeOnly?: boolean;
}

// Poll intervals are kept local since they're timer references that can't be serialized
// The init states (isInitializing, isCancellable, etc.) are stored in the global Jotai atom
type PollIntervals = Record<string, NodeJS.Timeout | null>;

export function useMCPServerManager({
  conversationId,
  storageContextKey,
  autoPromptMissingAuth = false,
}: {
  conversationId?: string | null;
  storageContextKey?: string;
  autoPromptMissingAuth?: boolean;
} = {}) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();
  /** Retained for `interface.mcpServers.placeholder` used by `placeholderText` below */
  const { isAuthenticated } = useAuthContext();
  const { data: startupConfig, isFetched: isStartupConfigFetched } = useGetStartupConfig();
  const canUseMcp = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });
  const requiresTermsAcceptance = startupConfig?.interface?.termsOfService?.modalAcceptance === true;
  const { data: termsData, isFetched: isTermsFetched } = useUserTermsQuery({
    enabled: isAuthenticated && requiresTermsAcceptance,
  });

  const { data: loadedServers, isLoading } = useMCPServersQuery({ enabled: canUseMcp });
  const { data: mcpToolsData } = useMCPToolsQuery({
    enabled: canUseMcp && !isLoading && !!loadedServers && Object.keys(loadedServers).length > 0,
  });

  // Fetch effective permissions for all MCP servers
  const { data: permissionsMap } = useGetAllEffectivePermissionsQuery(ResourceType.MCPSERVER, {
    enabled: canUseMcp,
  });

  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [selectedToolForConfig, setSelectedToolForConfig] = useState<TPlugin | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const hasAutoPromptedRef = useRef(false);
  const hadPendingTermsRef = useRef(false);
  const [termsAcceptedSignal, setTermsAcceptedSignal] = useState(0);

  const availableMCPServers: MCPServerDefinition[] = useMemo<MCPServerDefinition[]>(() => {
    const definitions: MCPServerDefinition[] = [];
    if (loadedServers) {
      for (const [serverName, metadata] of Object.entries(loadedServers)) {
        const { dbId, consumeOnly, ...config } = metadata;

        // Get effective permissions from the permissions map using _id
        // Fall back to 1 (VIEW) for YAML-based servers without _id
        const effectivePermissions = dbId && permissionsMap?.[dbId] ? permissionsMap[dbId] : 1;

        definitions.push({
          serverName,
          dbId,
          effectivePermissions,
          consumeOnly,
          config,
        });
      }
    }
    return definitions;
  }, [loadedServers, permissionsMap]);

  // Memoize filtered servers for useMCPSelect to prevent infinite loops
  const selectableServers = useMemo(
    () => availableMCPServers.filter((s) => s.config.chatMenu !== false && !s.consumeOnly),
    [availableMCPServers],
  );

  const { mcpValues, setMCPValues, isPinned, setIsPinned } = useMCPSelect({
    conversationId,
    storageContextKey,
    servers: selectableServers,
  });

  useEffect(() => {
    if (requiresTermsAcceptance && termsData?.termsAccepted === false) {
      hadPendingTermsRef.current = true;
    }
  }, [requiresTermsAcceptance, termsData?.termsAccepted]);

  useEffect(() => {
    if (typeof window === 'undefined' || !autoPromptMissingAuth) {
      return;
    }

    const handleTermsAccepted = () => {
      setTermsAcceptedSignal((current) => current + 1);
    };

    window.addEventListener('librechat:terms-accepted', handleTermsAccepted);

    return () => {
      window.removeEventListener('librechat:terms-accepted', handleTermsAccepted);
    };
  }, [autoPromptMissingAuth]);
  const mcpValuesRef = useRef(mcpValues);

  // fixes the issue where OAuth flows would deselect all the servers except the one that is being authenticated on success
  useEffect(() => {
    mcpValuesRef.current = mcpValues;
  }, [mcpValues]);

  // Check if specific permission bit is set
  const checkEffectivePermission = useCallback(
    (effectivePermissions: number, permissionBit: number): boolean => {
      return (effectivePermissions & permissionBit) !== 0;
    },
    [],
  );

  const reinitializeMutation = useReinitializeMCPServerMutation();
  const cancelOAuthMutation = useCancelMCPOAuthMutation();

  const updateUserPluginsMutation = useUpdateUserPluginsMutation({
    onSuccess: async (_data, variables) => {
      const isRevoke = variables.action === 'uninstall';
      const message = isRevoke
        ? localize('com_nav_mcp_access_revoked')
        : localize('com_nav_mcp_vars_updated');
      showToast({ message, status: 'success' });

      /** Deselect server from mcpValues when revoking access */
      if (isRevoke && variables.pluginKey?.startsWith(Constants.mcp_prefix)) {
        const serverName = variables.pluginKey.replace(Constants.mcp_prefix, '');
        const currentValues = mcpValuesRef.current ?? [];
        const filteredValues = currentValues.filter((name) => name !== serverName);
        setMCPValues(filteredValues);
      }

      await Promise.all([
        queryClient.invalidateQueries([QueryKeys.mcpServers]),
        queryClient.invalidateQueries([QueryKeys.mcpTools]),
        queryClient.invalidateQueries([QueryKeys.mcpAuthValues]),
        queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]),
      ]);
    },
    onError: (error: unknown) => {
      console.error('Error updating MCP auth:', error);
      showToast({
        message: localize('com_nav_mcp_vars_update_error'),
        status: 'error',
      });
    },
  });

  // Global atom for init states - shared across all useMCPServerManager instances
  // This enables canceling OAuth from both chat dropdown and settings panel
  const [serverInitStates, setServerInitStates] = useAtom(mcpServerInitStatesAtom);

  // Poll intervals are kept local (not serializable)
  const pollIntervalsRef = useRef<PollIntervals>({});

  const { connectionStatus } = useMCPConnectionStatus({
    enabled: !isLoading && availableMCPServers.length > 0,
  });

  const updateServerInitState = useCallback(
    (serverName: string, updates: Partial<MCPServerInitState>) => {
      setServerInitStates((prev) => {
        const currentState = getServerInitState(prev, serverName);
        return {
          ...prev,
          [serverName]: { ...currentState, ...updates },
        };
      });
    },
    [setServerInitStates],
  );

  const cleanupServerState = useCallback(
    (serverName: string) => {
      // Clear local poll interval
      const pollInterval = pollIntervalsRef.current[serverName];
      if (pollInterval) {
        clearTimeout(pollInterval);
        pollIntervalsRef.current[serverName] = null;
      }
      // Reset global init state
      updateServerInitState(serverName, {
        isInitializing: false,
        oauthUrl: null,
        oauthStartTime: null,
        isCancellable: false,
      });
    },
    [updateServerInitState],
  );

  const startServerPolling = useCallback(
    (serverName: string) => {
      // Prevent duplicate polling for the same server
      if (pollIntervalsRef.current[serverName]) {
        console.debug(`[MCP Manager] Polling already active for ${serverName}, skipping duplicate`);
        return;
      }

      let pollAttempts = 0;
      let timeoutId: NodeJS.Timeout | null = null;

      /** OAuth typically completes in 5 seconds to 3 minutes
       * We enforce a strict 3-minute timeout with gradual backoff
       */
      const getPollInterval = (attempt: number): number => {
        if (attempt < 12) return 5000; // First minute: every 5s (12 polls)
        if (attempt < 22) return 6000; // Second minute: every 6s (10 polls)
        return 7500; // Final minute: every 7.5s (8 polls)
      };

      const maxAttempts = 30; // Exactly 3 minutes (180 seconds) total
      const OAUTH_TIMEOUT_MS = 180000; // 3 minutes in milliseconds

      const pollOnce = async () => {
        try {
          pollAttempts++;
          const state = getServerInitState(serverInitStates, serverName);

          /** Stop polling after 3 minutes or max attempts */
          const elapsedTime = state?.oauthStartTime
            ? Date.now() - state.oauthStartTime
            : pollAttempts * 5000; // Rough estimate if no start time

          if (pollAttempts > maxAttempts || elapsedTime > OAUTH_TIMEOUT_MS) {
            console.warn(
              `[MCP Manager] OAuth timeout for ${serverName} after ${(elapsedTime / 1000).toFixed(0)}s (attempt ${pollAttempts})`,
            );
            showToast({
              message: localize('com_ui_mcp_oauth_timeout', { 0: serverName }),
              status: 'error',
            });
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            cleanupServerState(serverName);
            return;
          }

          await queryClient.refetchQueries([QueryKeys.mcpConnectionStatus]);

          const freshConnectionData = queryClient.getQueryData([
            QueryKeys.mcpConnectionStatus,
          ]) as any;
          const freshConnectionStatus = freshConnectionData?.connectionStatus || {};

          const serverStatus = freshConnectionStatus[serverName];

          if (serverStatus?.connectionState === 'connected') {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }

            showToast({
              message: localize('com_ui_mcp_authenticated_success', { 0: serverName }),
              status: 'success',
            });

            const currentValues = mcpValuesRef.current ?? [];
            if (!currentValues.includes(serverName)) {
              setMCPValues([...currentValues, serverName]);
            }

            await queryClient.invalidateQueries([QueryKeys.mcpTools]);

            // This delay is to ensure UI has updated with new connection status before cleanup
            // Otherwise servers will show as disconnected for a second after OAuth flow completes
            setTimeout(() => {
              cleanupServerState(serverName);
            }, 1000);
            return;
          }

          // Check for OAuth timeout (should align with maxAttempts)
          if (state?.oauthStartTime && Date.now() - state.oauthStartTime > OAUTH_TIMEOUT_MS) {
            showToast({
              message: localize('com_ui_mcp_oauth_timeout', { 0: serverName }),
              status: 'error',
            });
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            cleanupServerState(serverName);
            return;
          }

          if (serverStatus?.connectionState === 'error') {
            showToast({
              message: localize('com_ui_mcp_init_failed'),
              status: 'error',
            });
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            cleanupServerState(serverName);
            return;
          }

          // Schedule next poll with smart intervals based on OAuth timing
          const nextInterval = getPollInterval(pollAttempts);

          // Log progress periodically
          if (pollAttempts % 5 === 0 || pollAttempts <= 2) {
            console.debug(
              `[MCP Manager] Polling ${serverName} attempt ${pollAttempts}/${maxAttempts}, next in ${nextInterval / 1000}s`,
            );
          }

          timeoutId = setTimeout(pollOnce, nextInterval);
          pollIntervalsRef.current[serverName] = timeoutId;
        } catch (error) {
          console.error(`[MCP Manager] Error polling server ${serverName}:`, error);
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          cleanupServerState(serverName);
          return;
        }
      };

      // Start the first poll
      timeoutId = setTimeout(pollOnce, getPollInterval(0));
      pollIntervalsRef.current[serverName] = timeoutId;
    },
    [queryClient, serverInitStates, showToast, localize, setMCPValues, cleanupServerState],
  );

  const initializeServer = useCallback(
    async (serverName: string, autoOpenOAuth: boolean = true) => {
      updateServerInitState(serverName, { isInitializing: true });
      try {
        const response = await reinitializeMutation.mutateAsync(serverName);
        if (!response.success) {
          showToast({
            message: localize('com_ui_mcp_init_failed', { 0: serverName }),
            status: 'error',
          });
          cleanupServerState(serverName);
          return response;
        }

        if (response.oauthRequired && response.oauthUrl) {
          updateServerInitState(serverName, {
            oauthUrl: response.oauthUrl,
            oauthStartTime: Date.now(),
            isCancellable: true,
            isInitializing: true,
          });

          if (autoOpenOAuth) {
            window.open(response.oauthUrl, '_blank', 'noopener,noreferrer');
          }

          startServerPolling(serverName);
        } else {
          await Promise.all([
            queryClient.invalidateQueries([QueryKeys.mcpServers]),
            queryClient.invalidateQueries([QueryKeys.mcpTools]),
            queryClient.invalidateQueries([QueryKeys.mcpAuthValues]),
            queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]),
          ]);

          await Promise.all([
            queryClient.refetchQueries([QueryKeys.mcpServers], { type: 'active' }),
            queryClient.refetchQueries([QueryKeys.mcpTools], { type: 'active' }),
            queryClient.refetchQueries([QueryKeys.mcpAuthValues], { type: 'active' }),
            queryClient.refetchQueries([QueryKeys.mcpConnectionStatus], { type: 'active' }),
          ]);

          const refreshedServers = queryClient.getQueryData<MCPServersListResponse | undefined>([
            QueryKeys.mcpServers,
          ]);
          const refreshedTools = queryClient.getQueryData<MCPServersResponse | undefined>([
            QueryKeys.mcpTools,
          ]);
          const refreshedServerConfig = refreshedServers?.[serverName];
          const refreshedServerData = refreshedTools?.servers?.[serverName];
          const hasCustomUserVars =
            !!refreshedServerConfig?.customUserVars &&
            Object.keys(refreshedServerConfig.customUserVars).length > 0;

          if (hasCustomUserVars && refreshedServerData?.authenticated !== true) {
            cleanupServerState(serverName);
            return response;
          }

          showToast({
            message: localize('com_ui_mcp_initialized_success', { 0: serverName }),
            status: 'success',
          });

          const currentValues = mcpValues ?? [];
          if (!currentValues.includes(serverName)) {
            setMCPValues([...currentValues, serverName]);
          }

          cleanupServerState(serverName);
        }
        return response;
      } catch (error) {
        console.error(`[MCP Manager] Failed to initialize ${serverName}:`, error);
        showToast({
          message: localize('com_ui_mcp_init_failed', { 0: serverName }),
          status: 'error',
        });
        cleanupServerState(serverName);
      }
    },
    [
      updateServerInitState,
      reinitializeMutation,
      startServerPolling,
      queryClient,
      showToast,
      localize,
      mcpValues,
      cleanupServerState,
      setMCPValues,
    ],
  );

  const cancelOAuthFlow = useCallback(
    (serverName: string) => {
      cancelOAuthMutation.mutate(serverName, {
        onSuccess: () => {
          cleanupServerState(serverName);
          Promise.all([
            queryClient.invalidateQueries([QueryKeys.mcpServers]),
            queryClient.invalidateQueries([QueryKeys.mcpTools]),
            queryClient.invalidateQueries([QueryKeys.mcpAuthValues]),
            queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]),
          ]);

          showToast({
            message: localize('com_ui_mcp_oauth_cancelled', { 0: serverName }),
            status: 'warning',
          });
        },
        onError: (error) => {
          console.error(`[MCP Manager] Failed to cancel OAuth for ${serverName}:`, error);
          showToast({
            message: localize('com_ui_mcp_init_failed', { 0: serverName }),
            status: 'error',
          });
        },
      });
    },
    [queryClient, cleanupServerState, showToast, localize, cancelOAuthMutation],
  );

  const isInitializing = useCallback(
    (serverName: string) => {
      return getServerInitState(serverInitStates, serverName).isInitializing;
    },
    [serverInitStates],
  );

  const isCancellable = useCallback(
    (serverName: string) => {
      return getServerInitState(serverInitStates, serverName).isCancellable;
    },
    [serverInitStates],
  );

  const getOAuthUrl = useCallback(
    (serverName: string) => {
      return getServerInitState(serverInitStates, serverName).oauthUrl;
    },
    [serverInitStates],
  );

  const placeholderText = useMemo(
    () => startupConfig?.interface?.mcpServers?.placeholder || localize('com_ui_mcp_servers'),
    [startupConfig?.interface?.mcpServers?.placeholder, localize],
  );

  const toggleServerSelection = useCallback(
    (serverName: string) => {
      if (isInitializing(serverName)) {
        return;
      }

      const currentValues = mcpValues ?? [];
      const isCurrentlySelected = currentValues.includes(serverName);

      if (isCurrentlySelected) {
        const filteredValues = currentValues.filter((name) => name !== serverName);
        setMCPValues(filteredValues);
      } else {
        setMCPValues([...currentValues, serverName]);
      }
    },
    [mcpValues, setMCPValues, isInitializing],
  );

  const handleConfigSave = useCallback(
    (targetName: string, authData: Record<string, string>) => {
      if (selectedToolForConfig && selectedToolForConfig.name === targetName) {
        const payload: TUpdateUserPlugins = {
          pluginKey: `${Constants.mcp_prefix}${targetName}`,
          action: 'install',
          auth: authData,
        };
        updateUserPluginsMutation.mutate(payload);
      }
    },
    [selectedToolForConfig, updateUserPluginsMutation],
  );

  const handleConfigRevoke = useCallback(
    (targetName: string) => {
      if (selectedToolForConfig && selectedToolForConfig.name === targetName) {
        const payload: TUpdateUserPlugins = {
          pluginKey: `${Constants.mcp_prefix}${targetName}`,
          action: 'uninstall',
          auth: {},
        };
        updateUserPluginsMutation.mutate(payload);
        /** Deselection is now handled centrally in updateUserPluginsMutation.onSuccess */
      }
    },
    [selectedToolForConfig, updateUserPluginsMutation],
  );

  /** Standalone revoke function for OAuth servers - doesn't require selectedToolForConfig */
  const revokeOAuthForServer = useCallback(
    (serverName: string) => {
      const payload: TUpdateUserPlugins = {
        pluginKey: `${Constants.mcp_prefix}${serverName}`,
        action: 'uninstall',
        auth: {},
      };
      updateUserPluginsMutation.mutate(payload);
    },
    [updateUserPluginsMutation],
  );

  const handleSave = useCallback(
    (authData: Record<string, string>) => {
      if (selectedToolForConfig) {
        handleConfigSave(selectedToolForConfig.name, authData);
      }
    },
    [selectedToolForConfig, handleConfigSave],
  );

  const handleRevoke = useCallback(() => {
    if (selectedToolForConfig) {
      handleConfigRevoke(selectedToolForConfig.name);
    }
  }, [selectedToolForConfig, handleConfigRevoke]);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setIsConfigModalOpen(open);

    if (!open && previousFocusRef.current) {
      setTimeout(() => {
        if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
          previousFocusRef.current.focus();
        }
        previousFocusRef.current = null;
      }, 0);
    }
  }, []);

  const openConfigDialogForServer = useCallback(
    (serverName: string) => {
      const serverData = mcpToolsData?.servers?.[serverName];
      const serverConfig = loadedServers?.[serverName];
      if (!serverConfig) {
        return;
      }

      const configTool: TPlugin = {
        name: serverName,
        pluginKey: `${Constants.mcp_prefix}${serverName}`,
        authConfig:
          serverData?.authConfig ||
          (serverConfig.customUserVars
            ? Object.entries(serverConfig.customUserVars).map(([key, config]) => ({
                authField: key,
                label: config.title,
                description: config.description,
              }))
            : []),
        authenticated: serverData?.authenticated ?? false,
      };

      setSelectedToolForConfig(configTool);
      setIsConfigModalOpen(true);
    },
    [loadedServers, queryClient],
  );

  const hasResolvedTermsAcceptance = termsData?.termsAccepted === true || termsAcceptedSignal > 0;
  const isWaitingForTermsResolution =
    !isStartupConfigFetched ||
    (requiresTermsAcceptance && (!isTermsFetched || !hasResolvedTermsAcceptance));
  const isWaitingForTermsModalClosure =
    requiresTermsAcceptance && hadPendingTermsRef.current && termsAcceptedSignal === 0;

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !autoPromptMissingAuth ||
      isConfigModalOpen ||
      hasAutoPromptedRef.current ||
      isWaitingForTermsResolution ||
      isWaitingForTermsModalClosure
    ) {
      return;
    }

    if (!loadedServers || !mcpToolsData?.servers) {
      return;
    }

    const preferredTargets = ['aya_ops', ...Object.keys(mcpToolsData.servers)];
    const targetServerName = preferredTargets.find((serverName) => {
      const serverData = mcpToolsData.servers?.[serverName];
      const serverConfig = loadedServers?.[serverName];
      const hasCustomUserVars =
        !!serverConfig?.customUserVars && Object.keys(serverConfig.customUserVars).length > 0;

      return hasCustomUserVars && serverData?.authenticated === false;
    });

    if (!targetServerName) {
      return;
    }

    hasAutoPromptedRef.current = true;
    openConfigDialogForServer(targetServerName);
  }, [
    autoPromptMissingAuth,
    isConfigModalOpen,
    isWaitingForTermsModalClosure,
    isWaitingForTermsResolution,
    loadedServers,
    mcpToolsData,
    openConfigDialogForServer,
  ]);

  const getServerStatusIconProps = useCallback(
    (serverName: string) => {
      const mcpData = queryClient.getQueryData<MCPServersResponse | undefined>([
        QueryKeys.mcpTools,
      ]);
      const serverData = mcpData?.servers?.[serverName];
      const rawServerStatus = connectionStatus?.[serverName];
      const serverConfig = loadedServers?.[serverName];

      const handleConfigClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        previousFocusRef.current = document.activeElement as HTMLElement;

        openConfigDialogForServer(serverName);
      };

      const handleCancelClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        cancelOAuthFlow(serverName);
      };

      const hasCustomUserVars =
        serverConfig?.customUserVars && Object.keys(serverConfig.customUserVars).length > 0;
      const missingCustomUserAuth = hasCustomUserVars && serverData?.authenticated === false;
      const serverStatus = missingCustomUserAuth
        ? {
            requiresOAuth: true,
            connectionState: 'disconnected' as const,
          }
        : rawServerStatus;

      return {
        serverName,
        serverStatus,
        tool: serverData
          ? ({
              name: serverName,
              pluginKey: `${Constants.mcp_prefix}${serverName}`,
              icon: serverData.icon,
              authenticated: serverData.authenticated,
            } as TPlugin)
          : undefined,
        onConfigClick: handleConfigClick,
        isInitializing: isInitializing(serverName),
        canCancel: isCancellable(serverName),
        onCancel: handleCancelClick,
        hasCustomUserVars,
      };
    },
    [
      queryClient,
      isCancellable,
      isInitializing,
      cancelOAuthFlow,
      connectionStatus,
      loadedServers,
      openConfigDialogForServer,
    ],
  );

  const getConfigDialogProps = useCallback(() => {
    if (!selectedToolForConfig) return null;

    const fieldsSchema: Record<string, ConfigFieldDetail> = {};
    if (selectedToolForConfig?.authConfig) {
      selectedToolForConfig.authConfig.forEach((field) => {
        fieldsSchema[field.authField] = {
          title: field.label || field.authField,
          description: field.description,
        };
      });
    }

    const initialValues: Record<string, string> = {};
    if (selectedToolForConfig?.authConfig) {
      selectedToolForConfig.authConfig.forEach((field) => {
        initialValues[field.authField] = '';
      });
    }

    return {
      serverName: selectedToolForConfig.name,
      serverStatus: connectionStatus?.[selectedToolForConfig.name],
      isOpen: isConfigModalOpen,
      onOpenChange: handleDialogOpenChange,
      fieldsSchema,
      initialValues,
      onSave: handleSave,
      onRevoke: handleRevoke,
      isSubmitting: updateUserPluginsMutation.isLoading,
    };
  }, [
    selectedToolForConfig,
    connectionStatus,
    isConfigModalOpen,
    handleDialogOpenChange,
    handleSave,
    handleRevoke,
    updateUserPluginsMutation.isLoading,
  ]);

  return {
    availableMCPServers,
    /** MCP servers filtered for chat menu selection (chatMenu !== false && !consumeOnly) */
    selectableServers,
    availableMCPServersMap: loadedServers,
    isLoading,
    connectionStatus,
    initializeServer,
    cancelOAuthFlow,
    isInitializing,
    isCancellable,
    getOAuthUrl,
    mcpValues,
    setMCPValues,

    isPinned,
    setIsPinned,
    placeholderText,
    toggleServerSelection,
    localize,

    isConfigModalOpen,
    handleDialogOpenChange,
    selectedToolForConfig,
    setSelectedToolForConfig,
    handleSave,
    handleRevoke,
    revokeOAuthForServer,
    getServerStatusIconProps,
    getConfigDialogProps,
    checkEffectivePermission,
  };
}
