export async function up(pgm) {
  pgm.sql(`UPDATE half_package_main_material_demand_tags tag
    SET target_spec = correction.new_spec
    FROM (VALUES
      ('70*200mm小砖（胶泥粘帖）', '70*200', '50*200'),
      ('70*300mm小砖（胶泥粘帖）', '70*300', '60*200')
    ) AS correction(old_name, old_spec, new_spec)
    WHERE tag.target_spec = correction.old_spec
      AND EXISTS (
        SELECT 1 FROM half_package_version_items item
        WHERE item.standard_item_id = tag.standard_item_id
          AND item.item_name = correction.old_name
      )`);
}

export async function down() {
  // The old and new specs cannot be distinguished after newer template imports.
}
