export async function up(pgm) {
  pgm.sql(repairDraftBalcony("LIVING_DINING"));
}

export async function down(pgm) {
  pgm.sql(repairDraftBalcony("BALCONY"));
}

function repairDraftBalcony(sourceSectionCode) {
  return `
    CREATE TEMP TABLE draft_balcony_repair_scopes ON COMMIT DROP AS
    SELECT s.id AS scope_id, s.area, s.perimeter, s.height,
           q.id AS quotation_id, q.template_version_id
      FROM half_package_quotation_spaces s
      JOIN half_package_quotations q ON q.id = s.quotation_id
     WHERE q.status = 'DRAFT'
       AND s.space_type = 'BALCONY';

    CREATE TEMP TABLE draft_balcony_repair_lines ON COMMIT DROP AS
    SELECT gen_random_uuid() AS line_id, target.scope_id,
           target.area, target.perimeter, target.height,
           vi.id AS version_item_id, hs.code AS section_code,
           hs.name AS section_name, vi.item_name, vi.unit, vi.remarks,
           vi.sort_order, prices.sale_unit_price, prices.cost_unit_price
      FROM draft_balcony_repair_scopes target
      JOIN half_package_sections hs
        ON hs.template_version_id = target.template_version_id
       AND hs.code = '${sourceSectionCode}'
      JOIN half_package_version_items vi ON vi.section_id = hs.id
      JOIN half_package_item_price_versions prices
        ON prices.version_item_id = vi.id;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM draft_balcony_repair_scopes target
         WHERE NOT EXISTS (
           SELECT 1
             FROM draft_balcony_repair_lines staged
            WHERE staged.scope_id = target.scope_id
         )
      ) THEN
        RAISE EXCEPTION '草稿阳台缺少可用的 ${sourceSectionCode} 模板';
      END IF;
    END;
    $$;

    DELETE FROM half_package_quotation_lines line
     USING draft_balcony_repair_scopes target
     WHERE line.quotation_space_id = target.scope_id
       AND line.referenced_line_id IS NOT NULL;

    DELETE FROM half_package_quotation_lines line
     USING draft_balcony_repair_scopes target
     WHERE line.quotation_space_id = target.scope_id;

    INSERT INTO half_package_quotation_lines
      (id, quotation_space_id, version_item_id, section_code, section_name,
       item_name, unit, remarks, sort_order, selected, quantity_rule_kind,
       referenced_line_id, manual_quantity, calculated_quantity,
       sale_unit_price, sale_amount, cost_unit_price, cost_amount,
       gross_profit, gross_margin_rate)
    SELECT staged.line_id, staged.scope_id, staged.version_item_id,
           staged.section_code, staged.section_name, staged.item_name,
           staged.unit, staged.remarks, staged.sort_order,
           CASE
             WHEN staged.section_code = 'LIVING_DINING'
              AND staged.item_name IN ('顶面基层处理', '顶面乳胶漆', '墙面基层处理', '墙面乳胶漆')
             THEN true ELSE false
           END,
           (CASE
             WHEN staged.section_code = 'LIVING_DINING' AND staged.item_name = '顶面基层处理'
             THEN 'SPACE_AREA'
             WHEN staged.section_code = 'LIVING_DINING' AND staged.item_name = '墙面基层处理'
             THEN 'SPACE_PERIMETER_HEIGHT'
             WHEN staged.section_code = 'LIVING_DINING' AND staged.item_name IN ('顶面乳胶漆', '墙面乳胶漆')
             THEN 'LINE_REFERENCE'
             ELSE 'MANUAL'
           END)::half_package_quantity_rule_kind,
           CASE
             WHEN staged.section_code = 'LIVING_DINING' AND staged.item_name = '顶面乳胶漆'
             THEN top_base.line_id
             WHEN staged.section_code = 'LIVING_DINING' AND staged.item_name = '墙面乳胶漆'
             THEN wall_base.line_id
             ELSE NULL
           END,
           NULL,
           CASE
             WHEN staged.section_code = 'LIVING_DINING' AND staged.item_name IN ('顶面基层处理', '顶面乳胶漆')
             THEN staged.area
             WHEN staged.section_code = 'LIVING_DINING' AND staged.item_name IN ('墙面基层处理', '墙面乳胶漆')
             THEN round(staged.perimeter * staged.height, 4)
             ELSE NULL
           END,
           staged.sale_unit_price,
           CASE
             WHEN staged.section_code = 'LIVING_DINING' AND staged.item_name IN ('顶面基层处理', '顶面乳胶漆')
             THEN round(staged.area * staged.sale_unit_price, 4)
             WHEN staged.section_code = 'LIVING_DINING' AND staged.item_name IN ('墙面基层处理', '墙面乳胶漆')
             THEN round(staged.perimeter * staged.height * staged.sale_unit_price, 4)
             ELSE NULL
           END,
           staged.cost_unit_price,
           CASE
             WHEN staged.section_code = 'LIVING_DINING' AND staged.item_name IN ('顶面基层处理', '顶面乳胶漆')
             THEN round(staged.area * staged.cost_unit_price, 4)
             WHEN staged.section_code = 'LIVING_DINING' AND staged.item_name IN ('墙面基层处理', '墙面乳胶漆')
             THEN round(staged.perimeter * staged.height * staged.cost_unit_price, 4)
             ELSE NULL
           END,
           CASE
             WHEN staged.section_code = 'LIVING_DINING' AND staged.item_name IN ('顶面基层处理', '顶面乳胶漆')
             THEN round(staged.area * (staged.sale_unit_price - staged.cost_unit_price), 4)
             WHEN staged.section_code = 'LIVING_DINING' AND staged.item_name IN ('墙面基层处理', '墙面乳胶漆')
             THEN round(staged.perimeter * staged.height * (staged.sale_unit_price - staged.cost_unit_price), 4)
             ELSE NULL
           END,
           CASE
             WHEN staged.section_code = 'LIVING_DINING' AND staged.item_name IN ('顶面基层处理', '顶面乳胶漆', '墙面基层处理', '墙面乳胶漆')
             THEN round((staged.sale_unit_price - staged.cost_unit_price) / staged.sale_unit_price, 4)
             ELSE NULL
           END
      FROM draft_balcony_repair_lines staged
      LEFT JOIN draft_balcony_repair_lines top_base
        ON top_base.scope_id = staged.scope_id
       AND top_base.item_name = '顶面基层处理'
      LEFT JOIN draft_balcony_repair_lines wall_base
        ON wall_base.scope_id = staged.scope_id
       AND wall_base.item_name = '墙面基层处理';

    UPDATE half_package_quotation_spaces scope
       SET subtotal = totals.subtotal,
           expected_cost = totals.expected_cost,
           gross_profit = round(totals.subtotal - totals.expected_cost, 4),
           gross_margin_rate = CASE
             WHEN totals.subtotal = 0 THEN NULL
             ELSE round((totals.subtotal - totals.expected_cost) / totals.subtotal, 4)
           END
      FROM (
        SELECT target.scope_id,
               coalesce(sum(line.sale_amount), 0)::numeric(16,4) AS subtotal,
               coalesce(sum(line.cost_amount), 0)::numeric(16,4) AS expected_cost
          FROM draft_balcony_repair_scopes target
          LEFT JOIN half_package_quotation_lines line
            ON line.quotation_space_id = target.scope_id
         GROUP BY target.scope_id
      ) totals
     WHERE scope.id = totals.scope_id;

    UPDATE half_package_quotations quotation
       SET direct_cost = totals.direct_cost,
           expected_cost = totals.expected_cost,
           gross_profit = round(totals.direct_cost - totals.expected_cost, 4),
           gross_margin_rate = CASE
             WHEN totals.direct_cost = 0 THEN NULL
             ELSE round((totals.direct_cost - totals.expected_cost) / totals.direct_cost, 4)
           END,
           management_fee = round(totals.direct_cost * quotation.management_rate, 4),
           total = round(totals.direct_cost * (1 + quotation.management_rate), 4),
           revision = quotation.revision + 1,
           updated_at = current_timestamp
      FROM (
        SELECT target.quotation_id,
               sum(scope.subtotal)::numeric(16,4) AS direct_cost,
               sum(scope.expected_cost)::numeric(16,4) AS expected_cost
          FROM (SELECT DISTINCT quotation_id FROM draft_balcony_repair_scopes) target
          JOIN half_package_quotation_spaces scope
            ON scope.quotation_id = target.quotation_id
         GROUP BY target.quotation_id
      ) totals
     WHERE quotation.id = totals.quotation_id;
  `;
}
