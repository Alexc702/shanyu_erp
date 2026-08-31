export async function up(pgm) {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION require_half_package_draft_mutation()
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
  `);
}

export async function down(pgm) {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION require_half_package_draft_mutation()
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
  `);
}
