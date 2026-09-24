export async function up(pgm) {
  pgm.sql(`ALTER TABLE projects
    ADD COLUMN readonly_designer_id uuid REFERENCES users(id),
    ADD COLUMN access_revision integer NOT NULL DEFAULT 0 CHECK (access_revision >= 0),
    ADD CONSTRAINT project_distinct_readonly_designer CHECK (readonly_designer_id <> lead_designer_id);
    CREATE INDEX projects_readonly_designer_idx ON projects(readonly_designer_id)
      WHERE readonly_designer_id IS NOT NULL;`);
}

export async function down() {
  throw new Error("项目转交权限不可破坏性回滚");
}
