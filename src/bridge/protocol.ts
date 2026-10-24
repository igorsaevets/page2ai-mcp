// Agent Bridge WebSocket protocol types.
// Transport: JSON text frames over ws://127.0.0.1:PORT.
//
// page2ai-bridge/2 (0.6.0): both ends prove they know a key the extension made and
// the user pasted into this server's PAGE2AI_BRIDGE_KEY, before anything else runs.
//   ext → srv  hello      {keyId, nonceE}
//   srv → ext  challenge  {nonceS, proof: HMAC(key, "page2ai-bridge/2|server|<port>|<nonceE>|<nonceS>")}
//   ext → srv  auth       {proof: HMAC(key, "page2ai-bridge/2|client|<port>|<nonceS>|<nonceE>")}
//   srv → ext  welcome
// The extension checks the server's proof before it sends its own and before it
// accepts any convert: a program that took the port without the key gets nothing.
// The port is inside both proofs, so a relay through another port fails.

export const BRIDGE_PROTOCOL = 'page2ai-bridge/2';
export const DEFAULT_BRIDGE_PORT = 3025;

/** A bridge failure with the protocol's code (TIMEOUT, PERMISSION_REQUIRED, ...).
 *  Callers decide by `code`; the message is for people and may change. */
export class BridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'BridgeError';
    this.code = code;
  }
}

// --- Extension → Server ---

export interface HelloMessage {
  type: 'hello';
  protocol: string;
  extensionId: string;
  extensionVersion: string;
  /** First 16 hex digits of SHA-256(key): which of the server's keys to use. */
  keyId: string;
  /** 32 random bytes, hex. */
  nonceE: string;
}

export interface AuthMessage {
  type: 'auth';
  proof: string;
}

export interface PingMessage {
  type: 'ping';
}

export interface ConvertResultMessage {
  type: 'result';
  id: string;
  markdown: string;
  title: string;
  url: string;
  charCount: number;
  source: 'extension';
}

export interface ConvertErrorMessage {
  type: 'error';
  id: string;
  // TIMEOUT means the caller's time is spent: the server answers it without a fetch.
  // Every other code is a refusal, after which the server fetches the URL itself.
  code: 'TAB_LOAD_FAILED' | 'EXTRACTION_FAILED' | 'TIMEOUT' | 'RESTRICTED_URL' | 'PERMISSION_REQUIRED';
  message: string;
}

export type ExtensionMessage = HelloMessage | AuthMessage | PingMessage | ConvertResultMessage | ConvertErrorMessage;

// --- Server → Extension ---

export interface ChallengeMessage {
  type: 'challenge';
  protocol: typeof BRIDGE_PROTOCOL;
  serverVersion: string;
  /** 32 random bytes, hex. */
  nonceS: string;
  proof: string;
}

export interface WelcomeMessage {
  type: 'welcome';
  protocol: typeof BRIDGE_PROTOCOL;
  serverVersion: string;
}

/** Before the handshake ends: NO_KEY, UNKNOWN_KEY, PROTOCOL_MISMATCH (with the
 *  server's `protocol`), AUTH_FAILED, ALREADY_CONNECTED. */
export interface ServerErrorMessage {
  type: 'error';
  code: string;
  message: string;
  protocol?: string;
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

export type ServerMessage = ChallengeMessage | WelcomeMessage | ServerErrorMessage | ConvertRequestMessage | PongMessage;

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
