export async function up(pgm) {
  pgm.addColumn("half_package_quotations", {
    margin_benchmark_rate: {
      type: "numeric(7,4)",
      notNull: true,
      default: 0.3,
    },
  });
  pgm.addConstraint(
    "half_package_quotations",
    "half_package_quotations_margin_benchmark_rate",
    { check: "margin_benchmark_rate >= 0 AND margin_benchmark_rate <= 1" },
  );
}

export async function down(pgm) {
  pgm.dropConstraint(
    "half_package_quotations",
    "half_package_quotations_margin_benchmark_rate",
  );
  pgm.dropColumn("half_package_quotations", "margin_benchmark_rate");
}
