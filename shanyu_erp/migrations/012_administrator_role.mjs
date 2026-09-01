export async function up(pgm) {
  pgm.sql("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'ADMIN' BEFORE 'OWNER'");
}

export async function down(pgm) {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM users WHERE role::text = 'ADMIN') THEN
        RAISE EXCEPTION '存在管理员账号，无法回滚管理员角色迁移';
      END IF;
    END
    $$;
    CREATE TYPE user_role_without_admin AS ENUM (
      'OWNER',
      'LEAD_DESIGNER',
      'WOODWORK_DESIGNER',
      'PROJECT_MANAGER',
      'FINANCE'
    );
    ALTER TABLE users
      ALTER COLUMN role TYPE user_role_without_admin
      USING role::text::user_role_without_admin;
    DROP TYPE user_role;
    ALTER TYPE user_role_without_admin RENAME TO user_role;
  `);
}
