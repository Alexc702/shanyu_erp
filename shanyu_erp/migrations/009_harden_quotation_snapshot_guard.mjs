export async function up(pgm) {
  pgm.sql(snapshotGuard("IS DISTINCT FROM", true));
}

export async function down(pgm) {
  pgm.sql(snapshotGuard("<>", false));
}

function snapshotGuard(comparator, includeNullableRate) {
  return `
    CREATE OR REPLACE FUNCTION guard_half_package_quotation_snapshot()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND OLD.status <> 'DRAFT' THEN
        RAISE EXCEPTION '已提交报价版本不可删除';
      END IF;
      IF TG_OP = 'UPDATE' AND OLD.status <> 'DRAFT' AND (
        NEW.project_id ${comparator} OLD.project_id OR
        NEW.version_number ${comparator} OLD.version_number OR
        NEW.template_version_id ${comparator} OLD.template_version_id OR
        NEW.cost_template_version_id ${comparator} OLD.cost_template_version_id OR
        NEW.quantity_rule_version_id ${comparator} OLD.quantity_rule_version_id OR
        NEW.building_area ${comparator} OLD.building_area OR
        NEW.management_rate ${comparator} OLD.management_rate OR
        NEW.direct_cost ${comparator} OLD.direct_cost OR
        NEW.expected_cost ${comparator} OLD.expected_cost OR
        NEW.gross_profit ${comparator} OLD.gross_profit OR
        ${includeNullableRate ? `NEW.gross_margin_rate ${comparator} OLD.gross_margin_rate OR` : ""}
        NEW.management_fee ${comparator} OLD.management_fee OR
        NEW.total ${comparator} OLD.total OR
        NEW.revision ${comparator} OLD.revision
      ) THEN
        RAISE EXCEPTION '已提交报价快照不可修改';
      END IF;
      RETURN COALESCE(NEW, OLD);
    END;
    $$;
  `;
}
