declare module "better-sqlite3" {
  class Database {
    constructor(filename: string);
    pragma(value: string): unknown;
    exec(sql: string): unknown;
    transaction<T extends (...args: never[]) => unknown>(fn: T): T;
    prepare(sql: string): {
      run(params?: unknown, ...rest: unknown[]): { changes: number };
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    };
  }

  export default Database;
}
