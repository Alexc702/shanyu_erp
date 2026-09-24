import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";

export interface DatabaseExecutor {
  query<Row extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

@Injectable()
export class DatabaseClient implements OnModuleDestroy {
  private readonly projectRequest = new AsyncLocalStorage<DatabaseExecutor>();
  private readonly pool = new Pool({
    database: requiredEnvironmentVariable("POSTGRES_DB"),
    host: process.env.POSTGRES_HOST ?? "127.0.0.1",
    password: requiredEnvironmentVariable("POSTGRES_PASSWORD"),
    port: Number.parseInt(process.env.POSTGRES_PORT ?? "5432", 10),
    user: requiredEnvironmentVariable("POSTGRES_USER"),
  });

  query<Row extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return this.projectRequest.getStore()?.query<Row>(text, values)
      ?? this.pool.query<Row>(text, [...values]);
  }

  async transaction<Result>(
    work: (database: DatabaseExecutor) => Promise<Result>,
  ): Promise<Result> {
    const request = this.projectRequest.getStore();
    if (request) return work(request);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(asExecutor(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // Project HTTP requests serialize authorization and business writes with transfer.
  // Existing repository transactions join this boundary; no second connection/lock.
  async projectTransaction<Result>(projectId: string, work: () => Promise<Result>): Promise<Result> {
    return this.transaction(async (database) => {
      await database.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 924))", [projectId]);
      return this.projectRequest.run(database, work);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

function asExecutor(client: PoolClient): DatabaseExecutor {
  return {
    query<Row extends QueryResultRow>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<QueryResult<Row>> {
      return client.query<Row>(text, [...values]);
    },
  };
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }

  return value;
}
