import type { ConnectionResponse } from '../types.js';
export declare function useAPI(): <T>(path: string, init?: RequestInit) => Promise<T>;
/** The VocalStack connection, and the one-click flow that opens the dashboard in a new tab. */
export declare function useConnection(): {
    call: <T>(path: string, init?: RequestInit) => Promise<T>;
    connect: () => Promise<void>;
    connecting: boolean;
    connection: ConnectionResponse | undefined;
    refresh: () => Promise<void>;
    setConnection: import("react").Dispatch<import("react").SetStateAction<ConnectionResponse | undefined>>;
};
