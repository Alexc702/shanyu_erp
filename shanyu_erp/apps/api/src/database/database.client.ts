import { Injectable, OnModuleDestroy } from "@nestjs/common";
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
    return this.pool.query<Row>(text, [...values]);
  }

  async transaction<Result>(
    work: (database: DatabaseExecutor) => Promise<Result>,
  ): Promise<Result> {
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
