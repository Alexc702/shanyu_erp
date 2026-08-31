import { Injectable } from "@nestjs/common";
import type { AuditEventView } from "@shanyu/contracts";

import { DatabaseClient } from "../database/database.client";
import type { AuditQuery, AuditQueryRepository } from "./audit-query.repository";

interface AuditRow {
  action: string;
  actor_display_name: string | null;
  actor_user_id: string | null;
  after_value: Record<string, unknown> | null;
  before_value: Record<string, unknown> | null;
  id: string;
  metadata: Record<string, unknown>;
  occurred_at: Date;
  reason: string | null;
  result: "SUCCESS" | "FAILURE";
  target_id: string | null;
  target_type: string;
}

@Injectable()
export class PgAuditQueryRepository implements AuditQueryRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(query: AuditQuery): Promise<readonly AuditEventView[]> {
    const result = await this.database.query<AuditRow>(
      `SELECT e.id, e.action, e.actor_user_id, u.display_name AS actor_display_name,
              e.occurred_at, e.result, e.target_type, e.target_id,
              e.before_value, e.after_value, e.reason, e.metadata
         FROM audit_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE ($1::varchar IS NULL OR e.action = $1)
          AND ($2::audit_result IS NULL OR e.result = $2)
        ORDER BY e.occurred_at DESC, e.id DESC
        LIMIT 300`,
      [query.action ?? null, query.result ?? null],
    );
    return result.rows.map((row) => ({
      action: row.action,
      actorDisplayName: row.actor_display_name,
      actorUserId: row.actor_user_id,
      afterValue: row.after_value,
      beforeValue: row.before_value,
      id: row.id,
      metadata: row.metadata,
      occurredAt: row.occurred_at.toISOString(),
      reason: row.reason,
      result: row.result,
      targetId: row.target_id,
      targetType: row.target_type,
    }));
  }
}
