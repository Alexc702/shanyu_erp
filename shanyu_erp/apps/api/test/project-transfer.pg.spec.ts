import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { SessionUser } from "@shanyu/contracts";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/access/auth.service";
import { DatabaseClient } from "../src/database/database.client";
import { ProjectTransferService } from "../src/project/project-transfer.service";

describe.skipIf(process.env.SHANYU_SAFE_UPDATE_DB_TEST !== "1")("project transfer / isolated PostgreSQL HTTP", () => {
  let app: INestApplication, db: DatabaseClient;
  let projectId: string, quotationId: string;
  const users = {} as Record<string, SessionUser> & Record<"lead" | "next" | "admin", SessionUser>;
  beforeAll(async () => {
    if (process.env.POSTGRES_HOST !== "127.0.0.1" || process.env.POSTGRES_DB !== "shanyu_catalog_safe_test") throw new Error("Only isolated local database allowed");
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AuthService).useValue({
      getSessionUser: async (token: string) => { if (!users[token]) throw new Error("Unknown test session"); return users[token]; },
    }).compile();
    app = module.createNestApplication(); await app.init(); db = app.get(DatabaseClient);
    for (const [name, role] of Object.entries({ admin: "ADMIN", owner: "OWNER", lead: "LEAD_DESIGNER", next: "LEAD_DESIGNER", third: "LEAD_DESIGNER", disabled: "LEAD_DESIGNER", wood: "WOODWORK_DESIGNER" } as const)) {
      users[name] = { id: randomUUID(), role, account: `transfer-${randomUUID()}`, displayName: name, phone: null };
      await db.query("INSERT INTO users(id,account,display_name,role,status) VALUES($1,$2,$3,$4,$5)", [users[name].id,users[name].account,name,role,name === "disabled" ? "DISABLED" : "ACTIVE"]);
    }
    if (!(await db.query("SELECT id FROM half_package_template_versions LIMIT 1")).rowCount) {
      const batch = await request(app.getHttpServer()).post("/catalog/half-package/imports").set("Cookie","shanyu_session=admin")
        .attach("file",resolve(process.cwd(),"../../../半包报价单_v5.xlsx")).expect(201);
      await request(app.getHttpServer()).post(`/catalog/half-package/imports/${batch.body.batch.id}/publish`).set("Cookie","shanyu_session=admin").expect(201);
    }
  });
  afterAll(async () => { await app?.close(); });
  afterEach(async () => {
    if (!projectId) return;
    // Only this test's project, in the explicitly guarded disposable database.
    await db.transaction(async transaction => {
      await transaction.query("SET LOCAL session_replication_role = replica");
      await transaction.query("DELETE FROM half_package_quotation_lines WHERE quotation_space_id IN (SELECT s.id FROM half_package_quotation_spaces s JOIN half_package_quotations q ON q.id=s.quotation_id WHERE q.project_id=$1)",[projectId]);
      for (const table of ["half_package_quotation_spaces","main_material_quote_lines","half_package_approval_decisions","quotation_export_jobs","half_package_exports"]) {
        await transaction.query(`DELETE FROM ${table} WHERE quotation_id IN (SELECT id FROM half_package_quotations WHERE project_id=$1)`,[projectId]);
      }
      await transaction.query("DELETE FROM half_package_quotations WHERE project_id=$1",[projectId]);
      await transaction.query("DELETE FROM project_spaces WHERE project_id=$1",[projectId]);
      await transaction.query("DELETE FROM audit_events WHERE target_id=$1",[projectId]);
      await transaction.query("DELETE FROM projects WHERE id=$1",[projectId]);
    });
  });
  const cookie = (user: string) => `shanyu_session=${user}`;
  const api = () => request(app.getHttpServer());
  beforeEach(async () => {
    const result = await api().post("/projects").set("Cookie",cookie("lead")).send({ projectAddress: "隔离转交验收", customerName: "测试", outerFrameArea: "100", leadDesignerId: users.lead.id,
      spaces: [{ type: "BEDROOM", displayName: "主卧", area: "20", perimeter: "18", height: "2.8", includesBalcony: false }] }).expect(201);
    projectId = result.body.project.id;
    const quotation = await api().get(`/projects/${projectId}/half-package-quotation`).set("Cookie",cookie("lead")).expect(200);
    quotationId = quotation.body.quotation.id;
    await api().get(`/projects/${projectId}/main-material-quotation`).set("Cookie",cookie("lead")).expect(200);
  });
  const transfer = (actor = "admin", retainReadonly = false, target = "next", revision = 0, reason?: string) => api().post(`/projects/${projectId}/lead-transfer`).set("Cookie",cookie(actor))
    .send({ expectedAccessRevision: revision, leadDesignerId: users[target]!.id, retainReadonly, ...(reason === undefined ? {} : { reason }) });
  async function snapshot() {
    return (await db.query(`SELECT to_jsonb(q) AS quote,
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM half_package_quotation_lines l JOIN half_package_quotation_spaces s ON s.id=l.quotation_space_id WHERE s.quotation_id=q.id) AS lines,
      (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM main_material_quote_lines m WHERE m.quotation_id=q.id) AS materials
      FROM half_package_quotations q WHERE q.project_id=$1 ORDER BY q.id`, [projectId])).rows;
  }
  it("admin transfers with empty reason atomically, preserves business snapshots and removes old access", async () => {
    const before = await snapshot();
    await transfer().expect(201);
    expect(await snapshot()).toEqual(before);
    await api().get(`/projects/${projectId}`).set("Cookie",cookie("lead")).expect(404);
    await api().get(`/projects/${projectId}`).set("Cookie",cookie("next")).expect(200);
    const list = await api().get("/projects").set("Cookie",cookie("lead")).expect(200);
    expect(list.body.projects.some((p: { id: string }) => p.id === projectId)).toBe(false);
    const audit = await db.query("SELECT reason,before_value,after_value FROM audit_events WHERE target_id=$1 AND action='PROJECT_LEAD_TRANSFERRED'", [projectId]);
    expect(audit.rows).toHaveLength(1); expect(audit.rows[0]!.reason).toBeNull();
    expect(audit.rows[0]!.after_value.leadDesignerId).toBe(users.next.id);
  });
  it("owner retains one viewer, viewer sees current data but cannot write or access files/costs", async () => {
    await transfer("owner",true,"next",0,"交接").expect(201);
    const before = await snapshot();
    for (const path of [`/projects/${projectId}`, `/projects/${projectId}/half-package-quotation`, `/projects/${projectId}/main-material-quotation`, `/projects/${projectId}/main-material-quotation/catalog`, `/projects/${projectId}/half-package-quotation/versions`]) {
      await api().get(path).set("Cookie",cookie("lead")).expect(200);
    }
    expect(await snapshot()).toEqual(before);
    for (const path of [`/projects/${projectId}/spaces`, `/projects/${projectId}/half-package-quotation/submit`, `/projects/${projectId}/main-material-quotation/lines`, `/approvals/half-package/${quotationId}/exports`, `/approvals/half-package/${quotationId}/selection-sheet`, `/projects/${projectId}/half-package-quotation/versions/${quotationId}/continue-editing`]) {
      await api().post(path).set("Cookie",cookie("lead")).send({}).expect(403);
    }
    await api().patch(`/projects/${projectId}/half-package-quotation/design-fee`).set("Cookie",cookie("lead")).send({}).expect(403);
    await api().get(`/approvals/half-package/${quotationId}/selection-sheet`).set("Cookie",cookie("lead")).expect(403);
    await api().get(`/projects/${projectId}/half-package-quotation/project-cost-analysis`).set("Cookie",cookie("lead")).expect(403);
    const latest = await api().get(`/projects/${projectId}/half-package-quotation`).set("Cookie",cookie("next")).expect(200);
    await api().patch(`/projects/${projectId}/half-package-quotation/design-fee`).set("Cookie",cookie("next"))
      .send({ unitPrice: "0", expectedRevision: latest.body.quotation.revision, quotationId }).expect(200);
    const view = await api().get(`/projects/${projectId}/half-package-quotation`).set("Cookie",cookie("lead")).expect(200);
    expect(view.body.quotation.designFeeConfirmed).toBe(true);
  });
  it.each(["lead","wood"])("rejects transfer by %s", async actor => { await transfer(actor).expect(actor === "wood" ? 404 : 403); });
  it.each(["lead","disabled","wood"])("rejects invalid target %s without partial permissions", async target => {
    await transfer("admin",true,target).expect(400);
    const result = await api().get(`/projects/${projectId}`).set("Cookie",cookie("lead")).expect(200);
    expect(result.body.project).toMatchObject({ accessRevision: 0, readonlyDesigner: null, leadDesigner: { id: users.lead.id } });
  });
  it("retransfer replaces earlier viewer; revoke immediately removes access", async () => {
    await transfer("owner",true).expect(201);
    await transfer("admin",true,"third",1).expect(201);
    await api().get(`/projects/${projectId}`).set("Cookie",cookie("lead")).expect(404);
    await api().get(`/projects/${projectId}`).set("Cookie",cookie("next")).expect(200);
    await api().post(`/projects/${projectId}/revoke-readonly`).set("Cookie",cookie("admin")).send({ expectedAccessRevision: 2 }).expect(201);
    await api().get(`/projects/${projectId}`).set("Cookie",cookie("next")).expect(404);
    await api().get(`/projects/${projectId}`).set("Cookie",cookie("third")).expect(200);
  });
  it("keeps pending approval, original submitter, snapshots and existing export bytes unchanged", async () => {
    await db.query("UPDATE half_package_quotations SET status='QUOTED',submitted_at=now(),submitted_by_user_id=$2,adjustment_status='PENDING_APPROVAL' WHERE id=$1", [quotationId, users.lead.id]);
    const exportId = randomUUID(), jobId = randomUUID();
    await db.query(`INSERT INTO half_package_exports(id,quotation_id,format,file_name,content_type,content_sha256,payload,size_bytes,created_by_user_id)
      VALUES($1,$2,'PDF','test.pdf','application/pdf',repeat('a',64),decode('25504446','hex'),4,$3)`, [exportId,quotationId,users.lead.id]);
    await db.query("INSERT INTO quotation_export_jobs(id,quotation_id,format,audience,requested_by_user_id) VALUES($1,$2,'PDF','CLIENT',$3)", [jobId,quotationId,users.lead.id]);
    const before = await snapshot();
    await transfer("admin",true).expect(201);
    expect(await snapshot()).toEqual(before);
    for (const path of [`/quotation-exports/${exportId}`,`/quotation-export-jobs/${jobId}`]) {
      await api().get(path).set("Cookie",cookie("lead")).expect(403);
      await api().get(path).set("Cookie",cookie("next")).expect(200);
    }
    expect((await db.query("SELECT encode(payload,'hex') AS bytes FROM half_package_exports WHERE id=$1",[exportId])).rows[0]!.bytes).toBe("25504446");
    await api().post(`/projects/${projectId}/revoke-readonly`).set("Cookie",cookie("owner")).send({expectedAccessRevision:1}).expect(201);
    await api().get(`/quotation-exports/${exportId}`).set("Cookie",cookie("lead")).expect(404);
  });
  it("a failure after changing ownership rolls back ownership, viewer and success audit together", async () => {
    await expect(db.projectTransaction(projectId, async () => {
      await app.get(ProjectTransferService).change(users.admin,projectId,{expectedAccessRevision:0,leadDesignerId:users.next.id,retainReadonly:true});
      throw new Error("simulated commit failure");
    })).rejects.toThrow("simulated commit failure");
    const result = await api().get(`/projects/${projectId}`).set("Cookie",cookie("lead")).expect(200);
    expect(result.body.project).toMatchObject({accessRevision:0,readonlyDesigner:null,leadDesigner:{id:users.lead.id}});
    expect((await db.query("SELECT id FROM audit_events WHERE target_id=$1 AND action='PROJECT_LEAD_TRANSFERRED'",[projectId])).rowCount).toBe(0);
  });
  it("simultaneous transfers commit exactly once, stale retry cannot overwrite", async () => {
    const results = await Promise.all([transfer("owner",true,"next"),transfer("admin",false,"third")]);
    expect(results.map(r=>r.status).sort()).toEqual([201,409]);
    expect((await db.query("SELECT count(*)::int AS count FROM audit_events WHERE target_id=$1 AND result='SUCCESS' AND action='PROJECT_LEAD_TRANSFERRED'",[projectId])).rows[0]!.count).toBe(1);
  });
  it("in-flight stale writes wait for transfer commit and cannot save afterwards", async () => {
    let release!: () => void, locked!: () => void;
    const entered = new Promise<void>(resolve => { locked=resolve; });
    const gate = new Promise<void>(resolve => { release=resolve; });
    const handingOver = db.projectTransaction(projectId, async () => {
      await app.get(ProjectTransferService).change(users.admin,projectId,{ expectedAccessRevision:0,leadDesignerId:users.next.id,retainReadonly:true });
      locked(); await gate;
    });
    await entered;
    const write = api().patch(`/projects/${projectId}/half-package-quotation/design-fee`).set("Cookie",cookie("lead"))
      .send({unitPrice:"10",expectedRevision:0,quotationId}).then(r=>r);
    release(); await handingOver;
    expect((await write).status).toBe(403);
    expect((await db.query("SELECT design_fee_unit_price FROM half_package_quotations WHERE id=$1",[quotationId])).rows[0]!.design_fee_unit_price).toBeNull();
  });
});
