export async function up(pgm) {
  pgm.createType("user_role", [
    "OWNER",
    "LEAD_DESIGNER",
    "WOODWORK_DESIGNER",
    "PROJECT_MANAGER",
    "FINANCE",
  ]);
  pgm.createType("user_status", ["ACTIVE", "DISABLED"]);
  pgm.createType("audit_result", ["SUCCESS", "FAILURE"]);

  pgm.createTable("users", {
    id: { type: "uuid", primaryKey: true },
    account: { type: "varchar(64)", notNull: true, unique: true },
    display_name: { type: "varchar(100)", notNull: true },
    phone: { type: "varchar(32)", unique: true },
    role: { type: "user_role", notNull: true },
    status: { type: "user_status", notNull: true, default: "ACTIVE" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });
  pgm.sql(
    "CREATE UNIQUE INDEX users_account_case_insensitive_idx ON users (lower(account))",
  );

  pgm.createTable("user_credentials", {
    user_id: {
      type: "uuid",
      primaryKey: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    password_hash: { type: "text", notNull: true },
    changed_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.createTable("auth_sessions", {
    id: { type: "uuid", primaryKey: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    token_hash: { type: "char(64)", notNull: true, unique: true },
    created_at: { type: "timestamptz", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
    revoked_at: { type: "timestamptz" },
  });
  pgm.createIndex("auth_sessions", ["user_id", "expires_at"]);

  pgm.createTable("audit_events", {
    id: { type: "uuid", primaryKey: true },
    action: { type: "varchar(80)", notNull: true },
    actor_user_id: {
      type: "uuid",
      references: "users(id)",
      onDelete: "SET NULL",
    },
    occurred_at: { type: "timestamptz", notNull: true },
    result: { type: "audit_result", notNull: true },
    target_type: { type: "varchar(80)", notNull: true },
    target_id: { type: "varchar(120)" },
    before_value: { type: "jsonb" },
    after_value: { type: "jsonb" },
    reason: { type: "text" },
    metadata: { type: "jsonb", notNull: true, default: "{}" },
  });
  pgm.createIndex("audit_events", ["occurred_at"]);
  pgm.createIndex("audit_events", ["actor_user_id", "occurred_at"]);
}

export async function down(pgm) {
  pgm.dropTable("audit_events");
  pgm.dropTable("auth_sessions");
  pgm.dropTable("user_credentials");
  pgm.dropTable("users");
  pgm.dropType("audit_result");
  pgm.dropType("user_status");
  pgm.dropType("user_role");
}
