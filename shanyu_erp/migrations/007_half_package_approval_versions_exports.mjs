export async function up(pgm) {
  pgm.dropConstraint(
    "half_package_quotations",
    "half_package_quotations_state",
  );
  pgm.addColumns("half_package_quotations", {
    parent_version_id: {
      type: "uuid",
      references: "half_package_quotations(id)",
      onDelete: "RESTRICT",
    },
    submitted_by_user_id: {
      type: "uuid",
      references: "users(id)",
      onDelete: "RESTRICT",
    },
    submitted_at: { type: "timestamptz" },
    decided_by_user_id: {
      type: "uuid",
      references: "users(id)",
      onDelete: "RESTRICT",
    },
    decided_at: { type: "timestamptz" },
    decision_action: { type: "varchar(32)" },
    decision_reason: { type: "text" },
  });
  pgm.addConstraint("half_package_quotations", "half_package_quotations_state", {
    check:
      "status IN ('DRAFT', 'PENDING_PRICING', 'PENDING_SUPPLEMENT', " +
      "'PENDING_APPROVAL', 'RETURNED', 'APPROVED', 'SUPERSEDED', 'VOID')",
  });
  pgm.addConstraint(
    "half_package_quotations",
    "half_package_quotations_submission_shape",
    {
      check:
        "(status = 'DRAFT' AND submitted_at IS NULL AND submitted_by_user_id IS NULL) OR " +
        "(status <> 'DRAFT' AND submitted_at IS NOT NULL AND submitted_by_user_id IS NOT NULL)",
    },
  );
  pgm.createIndex("half_package_quotations", "parent_version_id");
  pgm.createIndex("half_package_quotations", ["status", "submitted_at"]);

  pgm.createTable("half_package_approval_decisions", {
    id: { type: "uuid", primaryKey: true },
    quotation_id: {
      type: "uuid",
      notNull: true,
      references: "half_package_quotations(id)",
      onDelete: "RESTRICT",
    },
    action: { type: "varchar(32)", notNull: true },
    actor_user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "RESTRICT",
    },
    reason: { type: "text" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });
  pgm.addConstraint(
    "half_package_approval_decisions",
    "half_package_approval_decisions_action",
    {
      check:
        "action IN ('SUBMITTED', 'APPROVED', 'SPECIAL_APPROVED', 'RETURNED', 'VOIDED')",
    },
  );
  pgm.createIndex("half_package_approval_decisions", [
    "quotation_id",
    "created_at",
  ]);

  pgm.createTable("half_package_exports", {
    id: { type: "uuid", primaryKey: true },
    quotation_id: {
      type: "uuid",
      notNull: true,
      references: "half_package_quotations(id)",
      onDelete: "RESTRICT",
    },
    format: { type: "varchar(8)", notNull: true },
    file_name: { type: "varchar(255)", notNull: true },
    content_type: { type: "varchar(120)", notNull: true },
    content_sha256: { type: "varchar(64)", notNull: true },
    payload: { type: "bytea", notNull: true },
    created_by_user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "RESTRICT",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });
  pgm.addConstraint("half_package_exports", "half_package_exports_format", {
    check: "format IN ('PDF', 'XLSX')",
  });
  pgm.createIndex("half_package_exports", ["quotation_id", "created_at"]);

  pgm.sql(`
    CREATE FUNCTION guard_half_package_quotation_snapshot()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND OLD.status <> 'DRAFT' THEN
        RAISE EXCEPTION '已提交报价版本不可删除';
      END IF;
      IF TG_OP = 'UPDATE' AND OLD.status <> 'DRAFT' AND (
        NEW.project_id IS DISTINCT FROM OLD.project_id OR
        NEW.version_number IS DISTINCT FROM OLD.version_number OR
        NEW.template_version_id IS DISTINCT FROM OLD.template_version_id OR
        NEW.cost_template_version_id IS DISTINCT FROM OLD.cost_template_version_id OR
        NEW.quantity_rule_version_id IS DISTINCT FROM OLD.quantity_rule_version_id OR
        NEW.building_area IS DISTINCT FROM OLD.building_area OR
        NEW.management_rate IS DISTINCT FROM OLD.management_rate OR
        NEW.direct_cost IS DISTINCT FROM OLD.direct_cost OR
        NEW.expected_cost IS DISTINCT FROM OLD.expected_cost OR
        NEW.gross_profit IS DISTINCT FROM OLD.gross_profit OR
        NEW.gross_margin_rate IS DISTINCT FROM OLD.gross_margin_rate OR
        NEW.management_fee IS DISTINCT FROM OLD.management_fee OR
        NEW.total IS DISTINCT FROM OLD.total OR
        NEW.revision IS DISTINCT FROM OLD.revision
      ) THEN
        RAISE EXCEPTION '已提交报价快照不可修改';
      END IF;
      RETURN COALESCE(NEW, OLD);
    END;
    $$;
    CREATE TRIGGER half_package_quotation_snapshot_guard
      BEFORE UPDATE OR DELETE ON half_package_quotations
      FOR EACH ROW EXECUTE FUNCTION guard_half_package_quotation_snapshot();
  `);
  pgm.sql(`
    CREATE FUNCTION require_half_package_draft_mutation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE quotation_status varchar(32);
    DECLARE target_quotation_id uuid;
    BEGIN
      IF TG_TABLE_NAME = 'half_package_quotation_spaces' THEN
        target_quotation_id := COALESCE(NEW.quotation_id, OLD.quotation_id);
      ELSE
        SELECT s.quotation_id INTO target_quotation_id
          FROM half_package_quotation_spaces s
         WHERE s.id = COALESCE(NEW.quotation_space_id, OLD.quotation_space_id);
      END IF;
      SELECT q.status INTO quotation_status
        FROM half_package_quotations q
       WHERE q.id = target_quotation_id;
      IF quotation_status <> 'DRAFT' THEN
        RAISE EXCEPTION '已提交报价快照明细不可修改';
      END IF;
      RETURN COALESCE(NEW, OLD);
    END;
    $$;
    CREATE TRIGGER half_package_quotation_spaces_draft_only
      BEFORE INSERT OR UPDATE OR DELETE ON half_package_quotation_spaces
      FOR EACH ROW EXECUTE FUNCTION require_half_package_draft_mutation();
    CREATE TRIGGER half_package_quotation_lines_draft_only
      BEFORE INSERT OR UPDATE OR DELETE ON half_package_quotation_lines
      FOR EACH ROW EXECUTE FUNCTION require_half_package_draft_mutation();
  `);
}

export async function down(pgm) {
  pgm.sql("DROP TRIGGER half_package_quotation_lines_draft_only ON half_package_quotation_lines");
  pgm.sql("DROP TRIGGER half_package_quotation_spaces_draft_only ON half_package_quotation_spaces");
  pgm.sql("DROP FUNCTION require_half_package_draft_mutation()");
  pgm.sql("DROP TRIGGER half_package_quotation_snapshot_guard ON half_package_quotations");
  pgm.sql("DROP FUNCTION guard_half_package_quotation_snapshot()");
  pgm.dropTable("half_package_exports");
  pgm.dropTable("half_package_approval_decisions");
  pgm.dropIndex("half_package_quotations", ["status", "submitted_at"]);
  pgm.dropIndex("half_package_quotations", "parent_version_id");
  pgm.dropConstraint(
    "half_package_quotations",
    "half_package_quotations_submission_shape",
  );
  pgm.dropConstraint("half_package_quotations", "half_package_quotations_state");
  pgm.dropColumns("half_package_quotations", [
    "parent_version_id",
    "submitted_by_user_id",
    "submitted_at",
    "decided_by_user_id",
    "decided_at",
    "decision_action",
    "decision_reason",
  ]);
  pgm.addConstraint("half_package_quotations", "half_package_quotations_state", {
    check: "status = 'DRAFT'",
  });
}
