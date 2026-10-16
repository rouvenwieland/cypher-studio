/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOCK_IPC?: string;
}

/** Kanonische Tokens (docs/tokens.css) über den Alias @tokens */
declare module "@tokens";
