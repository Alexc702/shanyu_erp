import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { DatabaseClient } from "../database/database.client";
import type { AuditRecord, AuditRepository } from "./audit.repository";

@Injectable()
export class PgAuditRepository implements AuditRepository {
  constructor(private readonly database: DatabaseClient) {}

  async append(record: AuditRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_events
         (id, action, actor_user_id, occurred_at, result, target_type, target_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        record.action,
        record.actorUserId,
        record.occurredAt,
        record.result,
        record.targetType,
        record.targetId,
      ],
    );
  }
}
