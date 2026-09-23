export async function up(pgm) {
  pgm.sql(`ALTER TABLE half_package_quotations
    ADD COLUMN design_fee_confirmed_area numeric(14,4),
    ADD COLUMN design_fee_revision integer NOT NULL DEFAULT 0 CHECK (design_fee_revision >= 0),
    DROP CONSTRAINT half_package_quotations_version,
    ADD CONSTRAINT half_package_quotations_version UNIQUE (project_id, version_number, design_fee_revision);
    CREATE FUNCTION guard_design_fee_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.status <> 'DRAFT' AND (
        NEW.design_fee_confirmed_area IS DISTINCT FROM OLD.design_fee_confirmed_area OR
        NEW.design_fee_revision IS DISTINCT FROM OLD.design_fee_revision
      ) THEN RAISE EXCEPTION '历史设计费确认快照不可修改'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER design_fee_confirmation_guard BEFORE UPDATE ON half_package_quotations
      FOR EACH ROW EXECUTE FUNCTION guard_design_fee_confirmation();`);
}

export async function down() {
  throw new Error("设计费修订快照不可破坏性回滚");
}
