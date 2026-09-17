export async function up(pgm) {
  pgm.sql(`INSERT INTO half_package_main_material_demand_tags
      (standard_item_id, demand_type, target_spec, surface_type)
    SELECT candidate.standard_item_id, 'TILE', candidate.target_spec,
           candidate.surface_type
      FROM (
        SELECT DISTINCT ON (item.standard_item_id)
          item.standard_item_id,
          CASE WHEN item.item_name LIKE '%多规格%' THEN '多规格'
               ELSE regexp_replace(
                 substring(item.item_name from '([0-9]+\\s*[*×xX]\\s*[0-9]+)'),
                 '\\s*[*×xX]\\s*', '*', 'g'
               ) END AS target_spec,
          CASE WHEN item.item_name LIKE '%墙砖%'
                     OR item.item_name LIKE '%小砖%'
               THEN 'WALL' ELSE 'FLOOR' END AS surface_type
          FROM half_package_version_items item
          JOIN half_package_template_versions template
            ON template.id = item.template_version_id
         WHERE item.item_name ~ '(地砖|墙砖|小砖|木纹砖|古堡砖)'
           AND (item.item_name LIKE '%粘贴%' OR item.item_name LIKE '%粘帖%')
         ORDER BY item.standard_item_id, template.version_number DESC,
                  item.sort_order
      ) candidate
     WHERE candidate.target_spec IS NOT NULL
    ON CONFLICT (standard_item_id)
    DO UPDATE SET demand_type = EXCLUDED.demand_type,
                  target_spec = EXCLUDED.target_spec,
                  surface_type = EXCLUDED.surface_type`);
}

export async function down() {
  // 数据修复不可安全区分旧映射与本次补齐映射，回滚时保留有效关联。
}
