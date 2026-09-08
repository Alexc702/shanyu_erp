export async function up(pgm) {
  pgm.sql(`DROP TRIGGER IF EXISTS half_package_quotation_snapshot_guard ON half_package_quotations`);

  pgm.addColumns("half_package_quotations", {
    adjusted_total: { type: "numeric(16,4)", notNull: true, default: 0 },
    discount_rate: { type: "numeric(7,4)", notNull: true, default: 1 },
    is_current: { type: "boolean", notNull: true, default: false },
    project_address: { type: "varchar(500)" },
    write_off: { type: "numeric(16,4)", notNull: true, default: 0 },
  });
  pgm.sql(`
    UPDATE half_package_quotations q
       SET adjusted_total = q.total,
           project_address = p.address
      FROM projects p
     WHERE p.id = q.project_id;
    ALTER TABLE half_package_quotations
      ALTER COLUMN project_address SET NOT NULL;
    ALTER TABLE half_package_quotations
      RENAME COLUMN building_area TO outer_frame_area;

    UPDATE projects SET name = address;
    ALTER TABLE projects DROP COLUMN address;
    ALTER TABLE projects RENAME COLUMN name TO project_address;
    ALTER TABLE projects RENAME COLUMN building_area TO outer_frame_area;

    ALTER TYPE half_package_quantity_rule_kind
      RENAME VALUE 'PROJECT_BUILDING_AREA' TO 'PROJECT_OUTER_FRAME_AREA';
  `);

  pgm.dropConstraint("half_package_quotations", "half_package_quotations_state");
  pgm.dropConstraint(
    "half_package_quotations",
    "half_package_quotations_submission_shape",
  );
  pgm.dropConstraint(
    "half_package_quotations",
    "half_package_quotations_expected_margin",
  );
  pgm.sql(`
    UPDATE half_package_quotations
       SET status = CASE
         WHEN status IN ('PENDING_PRICING', 'PENDING_SUPPLEMENT', 'PENDING_APPROVAL')
           THEN 'QUOTED'
         WHEN status = 'SUPERSEDED' THEN 'APPROVED'
         WHEN status = 'VOID' THEN 'RETURNED'
         ELSE status
       END;

    WITH ranked AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY project_id
               ORDER BY version_number DESC, updated_at DESC, id DESC
             ) AS position
        FROM half_package_quotations
    )
    UPDATE half_package_quotations q
       SET is_current = ranked.position = 1
      FROM ranked
     WHERE ranked.id = q.id;

    UPDATE half_package_quotations
       SET gross_profit = round(adjusted_total - expected_cost, 4),
           gross_margin_rate = CASE
             WHEN adjusted_total = 0 THEN NULL
             ELSE round((adjusted_total - expected_cost) / adjusted_total, 4)
           END;

  `);
  pgm.addConstraint("half_package_quotations", "half_package_quotations_state", {
    check: "status IN ('DRAFT', 'QUOTED', 'RETURNED', 'APPROVED')",
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
  pgm.addConstraint(
    "half_package_quotations",
    "half_package_quotations_expected_margin",
    {
      check:
        "expected_cost >= 0 AND " +
        "((adjusted_total = 0 AND gross_margin_rate IS NULL) OR " +
        "(adjusted_total > 0 AND gross_margin_rate IS NOT NULL))",
    },
  );
  pgm.addConstraint(
    "half_package_quotations",
    "half_package_quotations_adjustment_values",
    {
      check:
        "discount_rate >= 0 AND discount_rate <= 1 AND write_off >= 0 AND " +
        "adjusted_total >= 0 AND adjusted_total = greatest(round(total * discount_rate - write_off, 4), 0)",
    },
  );
  pgm.createIndex("half_package_quotations", ["project_id"], {
    name: "half_package_quotations_current_project",
    unique: true,
    where: "is_current",
  });
  pgm.createIndex("half_package_quotations", ["status", "is_current"], {
    name: "half_package_quotations_current_status",
  });

  pgm.dropConstraint(
    "half_package_approval_decisions",
    "half_package_approval_decisions_action",
  );
  pgm.sql(`
    UPDATE half_package_approval_decisions
       SET action = CASE
         WHEN action = 'SUBMITTED' THEN 'QUOTED'
         WHEN action = 'SPECIAL_APPROVED' THEN 'APPROVED'
         ELSE action
       END;
  `);
  pgm.addConstraint(
    "half_package_approval_decisions",
    "half_package_approval_decisions_action",
    { check: "action IN ('QUOTED', 'APPROVED', 'RETURNED', 'VOIDED')" },
  );

  pgm.sql(`
    CREATE OR REPLACE FUNCTION guard_half_package_quotation_snapshot()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND OLD.status <> 'DRAFT' THEN
        RAISE EXCEPTION '已生成报价版本不可删除';
      END IF;
      IF TG_OP = 'UPDATE' AND OLD.status <> 'DRAFT' AND (
        NEW.project_id IS DISTINCT FROM OLD.project_id OR
        NEW.version_number IS DISTINCT FROM OLD.version_number OR
        NEW.template_version_id IS DISTINCT FROM OLD.template_version_id OR
        NEW.cost_template_version_id IS DISTINCT FROM OLD.cost_template_version_id OR
        NEW.quantity_rule_version_id IS DISTINCT FROM OLD.quantity_rule_version_id OR
        NEW.project_address IS DISTINCT FROM OLD.project_address OR
        NEW.outer_frame_area IS DISTINCT FROM OLD.outer_frame_area OR
        NEW.management_rate IS DISTINCT FROM OLD.management_rate OR
        NEW.direct_cost IS DISTINCT FROM OLD.direct_cost OR
        NEW.expected_cost IS DISTINCT FROM OLD.expected_cost OR
        NEW.management_fee IS DISTINCT FROM OLD.management_fee OR
        NEW.total IS DISTINCT FROM OLD.total
      ) THEN
        RAISE EXCEPTION '已生成报价快照不可修改';
      END IF;
      RETURN COALESCE(NEW, OLD);
    END;
    $$;
    CREATE TRIGGER half_package_quotation_snapshot_guard
      BEFORE UPDATE OR DELETE ON half_package_quotations
      FOR EACH ROW EXECUTE FUNCTION guard_half_package_quotation_snapshot();
  `);
}

export async function down(pgm) {
  pgm.sql(`DROP TRIGGER IF EXISTS half_package_quotation_snapshot_guard ON half_package_quotations`);
  pgm.dropIndex("half_package_quotations", ["status", "is_current"], {
    name: "half_package_quotations_current_status",
  });
  pgm.dropIndex("half_package_quotations", ["project_id"], {
    name: "half_package_quotations_current_project",
  });
  pgm.dropConstraint(
    "half_package_quotations",
    "half_package_quotations_adjustment_values",
  );
  pgm.dropConstraint(
    "half_package_quotations",
    "half_package_quotations_expected_margin",
  );
  pgm.dropConstraint(
    "half_package_quotations",
    "half_package_quotations_submission_shape",
  );
  pgm.dropConstraint("half_package_quotations", "half_package_quotations_state");
  pgm.sql(`
    UPDATE half_package_quotations
       SET status = CASE WHEN status = 'QUOTED' THEN 'PENDING_APPROVAL' ELSE status END,
           gross_profit = round(direct_cost - expected_cost, 4),
           gross_margin_rate = CASE
             WHEN direct_cost = 0 THEN NULL
             ELSE round((direct_cost - expected_cost) / direct_cost, 4)
           END;
  `);
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
  pgm.addConstraint(
    "half_package_quotations",
    "half_package_quotations_expected_margin",
    {
      check:
        "expected_cost >= 0 AND " +
        "((direct_cost = 0 AND gross_margin_rate IS NULL) OR " +
        "(direct_cost > 0 AND gross_margin_rate IS NOT NULL))",
    },
  );

  pgm.dropConstraint(
    "half_package_approval_decisions",
    "half_package_approval_decisions_action",
  );
  pgm.sql(`UPDATE half_package_approval_decisions SET action = 'SUBMITTED' WHERE action = 'QUOTED'`);
  pgm.addConstraint(
    "half_package_approval_decisions",
    "half_package_approval_decisions_action",
    {
      check:
        "action IN ('SUBMITTED', 'APPROVED', 'SPECIAL_APPROVED', 'RETURNED', 'VOIDED')",
    },
  );

  pgm.sql(`
    ALTER TYPE half_package_quantity_rule_kind
      RENAME VALUE 'PROJECT_OUTER_FRAME_AREA' TO 'PROJECT_BUILDING_AREA';

    ALTER TABLE projects RENAME COLUMN outer_frame_area TO building_area;
    ALTER TABLE projects RENAME COLUMN project_address TO name;
    ALTER TABLE projects ADD COLUMN address varchar(500);
    UPDATE projects SET address = name;
    ALTER TABLE projects ALTER COLUMN address SET NOT NULL;

    ALTER TABLE half_package_quotations
      RENAME COLUMN outer_frame_area TO building_area;
  `);
  pgm.dropColumns("half_package_quotations", [
    "adjusted_total",
    "discount_rate",
    "is_current",
    "project_address",
    "write_off",
  ]);
  pgm.sql(`
    CREATE OR REPLACE FUNCTION guard_half_package_quotation_snapshot()
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
}
