export async function up(pgm) {
  pgm.addColumns("half_package_quotations", {
    cost_template_version_id: {
      type: "uuid",
      references: "half_package_template_versions(id)",
      onDelete: "RESTRICT",
    },
    expected_cost: { type: "numeric(16,4)", notNull: true, default: 0 },
    gross_profit: { type: "numeric(16,4)", notNull: true, default: 0 },
    gross_margin_rate: { type: "numeric(9,4)" },
  });
  pgm.addColumns("half_package_quotation_spaces", {
    expected_cost: { type: "numeric(16,4)", notNull: true, default: 0 },
    gross_profit: { type: "numeric(16,4)", notNull: true, default: 0 },
    gross_margin_rate: { type: "numeric(9,4)" },
  });
  pgm.addColumns("half_package_quotation_lines", {
    cost_unit_price: { type: "numeric(14,4)" },
    cost_amount: { type: "numeric(16,4)" },
    gross_profit: { type: "numeric(16,4)" },
    gross_margin_rate: { type: "numeric(9,4)" },
  });

  pgm.sql(`
    UPDATE half_package_quotations
       SET cost_template_version_id = template_version_id
  `);
  pgm.sql(`
    UPDATE half_package_quotation_lines l
       SET cost_unit_price = pv.cost_unit_price
      FROM half_package_item_price_versions pv
     WHERE pv.version_item_id = l.version_item_id
  `);
  pgm.sql(`
    UPDATE half_package_quotation_lines
       SET cost_amount = round(calculated_quantity * cost_unit_price, 4),
           gross_profit = round(sale_amount - calculated_quantity * cost_unit_price, 4),
           gross_margin_rate = round(
             (sale_amount - calculated_quantity * cost_unit_price) / sale_amount,
             4
           )
     WHERE calculated_quantity IS NOT NULL
       AND sale_amount IS NOT NULL
  `);
  pgm.sql(`
    UPDATE half_package_quotation_spaces s
       SET expected_cost = totals.expected_cost,
           gross_profit = round(s.subtotal - totals.expected_cost, 4),
           gross_margin_rate = CASE
             WHEN s.subtotal = 0 THEN NULL
             ELSE round((s.subtotal - totals.expected_cost) / s.subtotal, 4)
           END
      FROM (
        SELECT s2.id,
               coalesce(sum(l.cost_amount), 0)::numeric(16,4) AS expected_cost
          FROM half_package_quotation_spaces s2
          LEFT JOIN half_package_quotation_lines l
            ON l.quotation_space_id = s2.id
         GROUP BY s2.id
      ) totals
     WHERE totals.id = s.id
  `);
  pgm.sql(`
    UPDATE half_package_quotations q
       SET expected_cost = totals.expected_cost,
           gross_profit = round(q.direct_cost - totals.expected_cost, 4),
           gross_margin_rate = CASE
             WHEN q.direct_cost = 0 THEN NULL
             ELSE round((q.direct_cost - totals.expected_cost) / q.direct_cost, 4)
           END
      FROM (
        SELECT q2.id,
               coalesce(sum(s.expected_cost), 0)::numeric(16,4) AS expected_cost
          FROM half_package_quotations q2
          LEFT JOIN half_package_quotation_spaces s
            ON s.quotation_id = q2.id
         GROUP BY q2.id
      ) totals
     WHERE totals.id = q.id
  `);

  pgm.alterColumn("half_package_quotations", "cost_template_version_id", {
    notNull: true,
  });
  pgm.alterColumn("half_package_quotation_lines", "cost_unit_price", {
    notNull: true,
  });
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
  pgm.addConstraint(
    "half_package_quotation_spaces",
    "half_package_quotation_spaces_expected_margin",
    {
      check:
        "expected_cost >= 0 AND " +
        "((subtotal = 0 AND gross_margin_rate IS NULL) OR " +
        "(subtotal > 0 AND gross_margin_rate IS NOT NULL))",
    },
  );
  pgm.addConstraint(
    "half_package_quotation_lines",
    "half_package_quotation_lines_expected_margin",
    {
      check:
        "cost_unit_price > 0 AND " +
        "((sale_amount IS NULL AND cost_amount IS NULL AND gross_profit IS NULL " +
        "AND gross_margin_rate IS NULL) OR " +
        "(sale_amount IS NOT NULL AND cost_amount > 0 AND gross_profit IS NOT NULL " +
        "AND gross_margin_rate IS NOT NULL))",
    },
  );
  pgm.createIndex("half_package_quotations", "cost_template_version_id");
}

export async function down(pgm) {
  pgm.dropIndex("half_package_quotations", "cost_template_version_id");
  pgm.dropConstraint(
    "half_package_quotation_lines",
    "half_package_quotation_lines_expected_margin",
  );
  pgm.dropConstraint(
    "half_package_quotation_spaces",
    "half_package_quotation_spaces_expected_margin",
  );
  pgm.dropConstraint(
    "half_package_quotations",
    "half_package_quotations_expected_margin",
  );
  pgm.dropColumns("half_package_quotation_lines", [
    "cost_unit_price",
    "cost_amount",
    "gross_profit",
    "gross_margin_rate",
  ]);
  pgm.dropColumns("half_package_quotation_spaces", [
    "expected_cost",
    "gross_profit",
    "gross_margin_rate",
  ]);
  pgm.dropColumns("half_package_quotations", [
    "cost_template_version_id",
    "expected_cost",
    "gross_profit",
    "gross_margin_rate",
  ]);
}
