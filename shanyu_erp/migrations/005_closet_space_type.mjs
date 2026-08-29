export async function up(pgm) {
  pgm.noTransaction();
  pgm.addTypeValue("space_type", "CLOSET", {
    after: "BEDROOM",
    ifNotExists: true,
  });
}

export async function down() {
  // PostgreSQL cannot safely remove one enum value without rebuilding the type.
}
