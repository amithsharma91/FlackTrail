declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(filename: string, options?: { readonly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }

  export interface StatementSync {
    run(...params: any[]): this;
    get(...params: any[]): any;
    all(...params: any[]): any[];
    each(...params: any[]): void;
    finalize(): void;
  }

  // Backward-compatible alias for existing code importing `Database`
  export type Database = DatabaseSync;
  export type Statement = StatementSync;
}