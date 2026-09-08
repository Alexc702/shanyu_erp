export async function up(pgm) {
  pgm.addColumns("half_package_quotations", {
    adjustment_reason: { type: "text" },
    adjustment_status: {
      type: "varchar(32)",
      notNull: true,
      default: "AWAITING_SUBMISSION",
    },
    adjustment_submitted_at: { type: "timestamptz" },
    adjustment_submitted_by_user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },
  });
  pgm.sql(`
    UPDATE half_package_quotations
       SET adjustment_status = CASE
         WHEN status = 'APPROVED' THEN 'CONFIRMED'
         ELSE 'AWAITING_SUBMISSION'
       END;
  `);
  pgm.addConstraint(
    "half_package_quotations",
    "half_package_quotations_adjustment_status",
    {
      check:
        "adjustment_status IN ('AWAITING_SUBMISSION', 'PENDING_APPROVAL', 'CONFIRMED')",
    },
  );
  pgm.createIndex(
    "half_package_quotations",
    ["status", "adjustment_status", "is_current"],
    { name: "half_package_quotations_adjustment_queue" },
  );
}

export async function down(pgm) {
  pgm.dropIndex(
    "half_package_quotations",
    ["status", "adjustment_status", "is_current"],
    { name: "half_package_quotations_adjustment_queue" },
  );
  pgm.dropConstraint(
    "half_package_quotations",
    "half_package_quotations_adjustment_status",
  );
  pgm.dropColumns("half_package_quotations", [
    "adjustment_submitted_by_user_id",
    "adjustment_submitted_at",
    "adjustment_status",
    "adjustment_reason",
  ]);
}
