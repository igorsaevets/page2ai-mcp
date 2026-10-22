// Agent Bridge WebSocket protocol types.
// Transport: JSON text frames over ws://127.0.0.1:PORT.
// Security model: BrowserTools MCP v2.0 (post GHSA-xvrv-w8pg-f25f).

export const BRIDGE_PROTOCOL = 'page2ai-bridge/1';
export const DEFAULT_BRIDGE_PORT = 3025;

// --- Extension → Server ---

export interface HelloMessage {
  type: 'hello';
  protocol: typeof BRIDGE_PROTOCOL;
  extensionId: string;
  extensionVersion: string;
}

export interface PingMessage {
  type: 'ping';
  token: string;
}

export interface ConvertResultMessage {
  type: 'result';
  id: string;
  token: string;
  markdown: string;
  title: string;
  url: string;
  charCount: number;
  source: 'extension';
}

export interface ConvertErrorMessage {
  type: 'error';
  id: string;
  token: string;
  code: 'TAB_LOAD_FAILED' | 'EXTRACTION_FAILED' | 'TIMEOUT' | 'RESTRICTED_URL';
  message: string;
}

export type ExtensionMessage = HelloMessage | PingMessage | ConvertResultMessage | ConvertErrorMessage;

// --- Server → Extension ---

export interface WelcomeMessage {
  type: 'welcome';
  protocol: typeof BRIDGE_PROTOCOL;
  serverVersion: string;
  token: string;
}

export interface ServerErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface ConvertRequestMessage {
  type: 'convert';
  id: string;
  url: string;
  options: {
    includeImages: boolean;
    includeFrontmatter: boolean;
    timeoutMs: number;
  };
}

export interface PongMessage {
  type: 'pong';
}

export type ServerMessage = WelcomeMessage | ServerErrorMessage | ConvertRequestMessage | PongMessage;

// --- Bridge convert API ---

export interface BridgeConvertOptions {
  url: string;
  includeImages: boolean;
  includeFrontmatter: boolean;
  timeoutMs: number;
}

export interface BridgeConvertResult {
  markdown: string;
  title: string;
  url: string;
  charCount: number;
}
