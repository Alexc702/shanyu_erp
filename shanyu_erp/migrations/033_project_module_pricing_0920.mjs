export async function up(pgm) {
  // NULL preserves the meaning of existing quotation snapshots; no backfill.
  pgm.sql(`ALTER TABLE half_package_quotations
    ADD COLUMN main_material_adjustment jsonb,
    ADD COLUMN design_fee_unit_price numeric(16,4) CHECK (design_fee_unit_price >= 0),
    ADD CONSTRAINT valid_main_material_adjustment CHECK (
      main_material_adjustment IS NULL OR (
        jsonb_typeof(main_material_adjustment) = 'object'
        AND main_material_adjustment ?& ARRAY['discountRate', 'writeOff']
        AND (main_material_adjustment->>'discountRate')::numeric BETWEEN 0 AND 1
        AND (main_material_adjustment->>'writeOff')::numeric >= 0
      )
    );
    ALTER TABLE half_package_quotations DROP CONSTRAINT half_package_quotations_adjustment_values;
    ALTER TABLE half_package_quotations ADD CONSTRAINT half_package_quotations_adjustment_values CHECK (
      discount_rate BETWEEN 0 AND 1 AND write_off >= 0 AND adjusted_total >= 0
      AND adjusted_total = (
        CASE WHEN main_material_adjustment IS NULL
          THEN greatest(round((total + main_material_total) * discount_rate - write_off, 4), 0)
          ELSE greatest(round(total * discount_rate - write_off, 4), 0)
            + greatest(round(main_material_total * (main_material_adjustment->>'discountRate')::numeric
                - (main_material_adjustment->>'writeOff')::numeric, 4), 0)
        END + coalesce(round(design_fee_unit_price * outer_frame_area, 2), 0)
      )
    );
    CREATE FUNCTION guard_project_module_pricing_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.status <> 'DRAFT' AND NEW.design_fee_unit_price IS DISTINCT FROM OLD.design_fee_unit_price THEN
        RAISE EXCEPTION '历史设计费快照不可修改';
      END IF;
      IF NEW.main_material_adjustment IS DISTINCT FROM OLD.main_material_adjustment
        AND NOT (OLD.status = 'QUOTED' AND OLD.is_current AND OLD.adjustment_status = 'AWAITING_SUBMISSION') THEN
        RAISE EXCEPTION '仅当前已报价版本可提交模块优惠';
      END IF;
      RETURN NEW;
    END $$;
    CREATE FUNCTION reconcile_draft_module_pricing() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      -- Reconcile space edits only for new-format current drafts, never history.
      IF NEW.status = 'DRAFT' AND NEW.is_current
        AND (NEW.main_material_adjustment IS NOT NULL OR NEW.design_fee_unit_price IS NOT NULL) THEN
        NEW.adjusted_total := CASE WHEN NEW.main_material_adjustment IS NULL
          THEN greatest(round((NEW.total + NEW.main_material_total) * NEW.discount_rate - NEW.write_off, 4), 0)
          ELSE greatest(round(NEW.total * NEW.discount_rate - NEW.write_off, 4), 0)
            + greatest(round(NEW.main_material_total * (NEW.main_material_adjustment->>'discountRate')::numeric
                - (NEW.main_material_adjustment->>'writeOff')::numeric, 4), 0)
          END + coalesce(round(NEW.design_fee_unit_price * NEW.outer_frame_area, 2), 0);
        NEW.gross_profit := NEW.adjusted_total - NEW.expected_cost - NEW.main_material_expected_cost;
        NEW.gross_margin_rate := CASE WHEN NEW.adjusted_total = 0 THEN NULL
          ELSE round(NEW.gross_profit / NEW.adjusted_total, 4) END;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER project_module_pricing_snapshot_guard BEFORE UPDATE ON half_package_quotations
      FOR EACH ROW EXECUTE FUNCTION guard_project_module_pricing_snapshot();
    CREATE TRIGGER draft_module_pricing_reconcile BEFORE UPDATE ON half_package_quotations
      FOR EACH ROW EXECUTE FUNCTION reconcile_draft_module_pricing();`);
}

export async function down() {
  throw new Error("模块计价快照不可破坏性回滚");
}
