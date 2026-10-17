/** Test-Zugriff auf das Mock-IPC der App (siehe src/ipc/mock/index.ts). */
export {};

declare global {
  interface Window {
    __CYPHER_SCENARIO__?: string;
    __CYPHER_MOCK_SPEED__?: number;
    __CYPHER_PICK__?: string;
    __CYPHER_MOCK_LATENCY__?: number;
    __CYPHER_MOCK_DELAY__?: Record<string, number>;
    __CYPHER_MOCK__?: {
      emit: (name: string, payload: unknown) => Promise<void>;
      calls: () => { cmd: string; args: unknown }[];
      scenario: () => string;
      reset: (scenario?: string) => void;
      exports: {
        meta: {
          fileName: string;
          format: string;
          destination: { kind: string; folder?: string; projectId?: string; subfolder?: string };
          dpi?: number;
        };
        bytes: number;
        url: string;
      }[];
    };
  }
}
