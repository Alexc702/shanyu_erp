export async function up(pgm) {
  pgm.dropConstraint(
    "half_package_quotation_lines",
    "half_package_quotation_lines_item",
  );
  pgm.createIndex(
    "half_package_quotation_lines",
    ["quotation_space_id", "version_item_id", "item_name"],
    {
      name: "half_package_quotation_lines_unique_item_method",
      unique: true,
    },
  );
}

export async function down(pgm) {
  pgm.sql(`DELETE FROM main_material_quote_lines
    WHERE source_half_package_line_id IN (
      SELECT line.id
        FROM half_package_quotation_lines line
       WHERE line.item_name IN (
         '100*100mm小砖（水泥砂浆粘贴）',
         '200*200mm小砖（水泥砂浆粘贴）'
       )
    );
    DELETE FROM half_package_quotation_lines
     WHERE item_name IN (
       '100*100mm小砖（水泥砂浆粘贴）',
       '200*200mm小砖（水泥砂浆粘贴）'
     );`);
  pgm.dropIndex(
    "half_package_quotation_lines",
    ["quotation_space_id", "version_item_id", "item_name"],
    { name: "half_package_quotation_lines_unique_item_method" },
  );
  pgm.addConstraint(
    "half_package_quotation_lines",
    "half_package_quotation_lines_item",
    { unique: ["quotation_space_id", "version_item_id"] },
  );
}
