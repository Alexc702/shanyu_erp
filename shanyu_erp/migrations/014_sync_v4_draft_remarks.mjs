const v4FileHash =
  "4f9134b7b3637ad8a01605be323369614f216a01958b111aa5079191ed7b8379";

export async function up(pgm) {
  pgm.sql(`
    WITH v4_remarks AS (
      SELECT version_item.standard_item_id, version_item.remarks
        FROM catalog_import_batches batch
        JOIN half_package_template_versions template
          ON template.source_batch_id = batch.id
        JOIN half_package_version_items version_item
          ON version_item.template_version_id = template.id
       WHERE batch.file_hash = '${v4FileHash}'
    )
    UPDATE half_package_quotation_lines line
       SET remarks = v4_remarks.remarks
      FROM half_package_quotation_spaces scope,
           half_package_quotations quotation,
           half_package_version_items original_item,
           v4_remarks
     WHERE scope.id = line.quotation_space_id
       AND quotation.id = scope.quotation_id
       AND quotation.status = 'DRAFT'
       AND quotation.is_current
       AND original_item.id = line.version_item_id
       AND v4_remarks.standard_item_id = original_item.standard_item_id
       AND line.remarks IS DISTINCT FROM v4_remarks.remarks;
  `);
}

export async function down(pgm) {
  pgm.sql(`
    UPDATE half_package_quotation_lines line
       SET remarks = original_item.remarks
      FROM half_package_quotation_spaces scope,
           half_package_quotations quotation,
           half_package_version_items original_item
     WHERE scope.id = line.quotation_space_id
       AND quotation.id = scope.quotation_id
       AND quotation.status = 'DRAFT'
       AND quotation.is_current
       AND original_item.id = line.version_item_id
       AND line.remarks IS DISTINCT FROM original_item.remarks;
  `);
}
