import React, { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { Command } from '../../commands.js';
import type { Tool } from '../../Tool.js';
import type { MCPServerConnection, ScopedMcpServerConfig, ServerResource } from './types.js';
import { useManageMCPConnections } from './useManageMCPConnections.js';

interface MCPConnectionContextValue {
  reconnectMcpServer: (serverName: string) => Promise<{
    client: MCPServerConnection;
    tools: Tool[];
    commands: Command[];
    resources?: ServerResource[];
  }>;
  toggleMcpServer: (serverName: string) => Promise<void>;
}

const MCPConnectionContext = createContext<MCPConnectionContextValue | null>(null);

export function useMcpReconnect() {
  const context = useContext(MCPConnectionContext);
  if (!context) {
    return (serverName: string) =>
      Promise.reject(new Error(`useMcpReconnect: MCPConnectionManager not in tree (${serverName})`));
  }
  return context.reconnectMcpServer;
}

export function useMcpToggleEnabled() {
  const context = useContext(MCPConnectionContext);
  if (!context) {
    return () => Promise.resolve();
  }
  return context.toggleMcpServer;
}

interface MCPConnectionManagerProps {
  children: ReactNode;
  dynamicMcpConfig: Record<string, ScopedMcpServerConfig> | undefined;
  isStrictMcpConfig: boolean;
}

// TODO (ollie): We may be able to get rid of this context by putting these function on app state
export function MCPConnectionManager({
  children,
  dynamicMcpConfig,
  isStrictMcpConfig,
}: MCPConnectionManagerProps): React.ReactNode {
  const { reconnectMcpServer, toggleMcpServer } = useManageMCPConnections(dynamicMcpConfig, isStrictMcpConfig);
  const value = useMemo(() => ({ reconnectMcpServer, toggleMcpServer }), [reconnectMcpServer, toggleMcpServer]);

  return <MCPConnectionContext.Provider value={value}>{children}</MCPConnectionContext.Provider>;
}
