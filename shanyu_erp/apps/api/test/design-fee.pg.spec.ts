import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../src/database/database.client";
import type { ProjectsRepository } from "../src/project/projects.repository";
import type { CatalogRepository } from "../src/catalog/catalog.repository";
import { PgQuotationRepository } from "../src/quotation/pg-quotation.repository";
import { calculateProjectPricing } from "../src/quotation/project-pricing";
import { QuotationRevisionConflictError } from "../src/quotation/quotation.repository";

describe.skipIf(process.env.SHANYU_SAFE_UPDATE_DB_TEST !== "1")("design fee / isolated PostgreSQL", () => {
  let pool: Pool, client: PoolClient, repository: PgQuotationRepository;
  let actor: string, quotation: string;
  beforeAll(() => {
    if (process.env.POSTGRES_HOST !== "127.0.0.1" || process.env.POSTGRES_DB !== "shanyu_catalog_safe_test") {
      throw new Error("Only the isolated local test database is allowed");
    }
    pool = new Pool({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT),
      database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    client = await pool.connect(); await client.query("BEGIN");
    repository = new PgQuotationRepository({ query: client.query.bind(client),
      transaction: async (run: (db: unknown) => Promise<unknown>) => run(client),
    } as unknown as DatabaseClient, {} as ProjectsRepository, {} as CatalogRepository);
    actor = randomUUID(); quotation = randomUUID(); const project = randomUUID();
    await client.query("INSERT INTO users (id,account,display_name,role,status) VALUES ($1,$2,'设计费验收','ADMIN','ACTIVE')", [actor, actor]);
    await client.query(`INSERT INTO projects (id,project_address,customer_name,outer_frame_area,lead_designer_id,created_by_user_id)
      VALUES ($1,'隔离设计费验收','测试',100,$2,$2)`, [project, actor]);
    await client.query(`INSERT INTO half_package_quotations
      (id,project_id,project_address,template_version_id,cost_template_version_id,quantity_rule_version_id,
       outer_frame_area,management_rate,created_by_user_id,total,expected_cost,adjusted_total,gross_profit,gross_margin_rate,is_current)
      SELECT $1,$2,'隔离设计费验收',t.id,t.id,(SELECT id FROM half_package_quantity_rule_versions LIMIT 1),
      100,0.1,$3,1000,600,1000,400,0.4,true FROM half_package_template_versions t LIMIT 1`, [quotation, project, actor]);
  });
  afterEach(async () => { await client.query("ROLLBACK"); client.release(); });

  async function confirm(price: string) {
    const source = (await repository.findById(quotation))!;
    return repository.confirmDesignFee({ ...source, designFeeUnitPrice: price,
      adjustedTotal: calculateProjectPricing({ ...source, designFeeUnitPrice: price }).adjustedTotal }, source.revision, actor);
  }
  it("confirms zero in-place on a draft and rejects a stale revision", async () => {
    const before = (await repository.findById(quotation))!;
    const saved = await confirm("0");
    expect(saved).toMatchObject({ id: quotation, status: "DRAFT", designFeeUnitPrice: "0.0000", designFeeConfirmedArea: "100.0000", revision: 1 });
    await expect(repository.confirmDesignFee(before, 0, actor)).rejects.toBeInstanceOf(QuotationRevisionConflictError);
  });
  it.each(["QUOTED", "APPROVED", "RETURNED"])("preserves the %s snapshot and creates a same-V internal revision", async (status) => {
    await client.query(`UPDATE half_package_quotations SET status=$2,submitted_at=now(),submitted_by_user_id=$3,
      adjustment_status=CASE WHEN $2::varchar='APPROVED' THEN 'CONFIRMED' ELSE 'AWAITING_SUBMISSION' END WHERE id=$1`, [quotation, status, actor]);
    const before = (await repository.findById(quotation))!;
    const saved = await confirm("20");
    expect(saved.id).not.toBe(quotation);
    expect(saved).toMatchObject({ versionNumber: before.versionNumber, designFeeRevision: 1, parentVersionId: quotation,
      status: status === "APPROVED" ? "APPROVED" : "QUOTED", designFeeUnitPrice: "20.0000", adjustedTotal: "3000.0000",
      total: before.total, discountRate: before.discountRate, writeOff: before.writeOff, expectedCost: before.expectedCost });
    expect(await repository.findById(quotation)).toEqual({ ...before, isCurrent: false });
    quotation = saved.id;
    expect(await confirm("30")).toMatchObject({ versionNumber: before.versionNumber, designFeeRevision: 2, adjustedTotal: "4000.0000" });
  });
  it("does not make a pending discount effective or move its approval history", async () => {
    await client.query(`UPDATE half_package_quotations SET status='QUOTED',submitted_at=now(),submitted_by_user_id=$2,
      discount_rate=0.9,write_off=10,adjusted_total=890,adjustment_status='PENDING_APPROVAL',adjustment_reason='原待审批'
      WHERE id=$1`, [quotation, actor]);
    const saved = await confirm("20");
    expect(saved).toMatchObject({ status: "QUOTED", adjustmentStatus: "PENDING_APPROVAL", discountRate: "0.9000",
      writeOff: "10.0000", adjustmentReason: "原待审批", adjustedTotal: "2890.0000" });
    expect((await repository.findById(quotation))?.adjustedTotal).toBe("890.0000");
  });
  it("retains already effective discounts when confirming a new design fee", async () => {
    await client.query(`UPDATE half_package_quotations SET status='APPROVED',submitted_at=now(),submitted_by_user_id=$2,
      discount_rate=0.9,write_off=10,adjusted_total=890,adjustment_status='CONFIRMED',adjustment_reason='已批准优惠'
      WHERE id=$1`, [quotation, actor]);
    expect(await confirm("20")).toMatchObject({ status: "APPROVED", adjustmentStatus: "CONFIRMED",
      discountRate: "0.9000", writeOff: "10.0000", adjustedTotal: "2890.0000" });
  });
});
