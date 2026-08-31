import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const scrypt = promisify(scryptCallback);
const demoPassword = process.env.DEMO_USER_PASSWORD ?? "Shanyu123!";
const demoUsers = [
  {
    account: "owner",
    displayName: "何总",
    id: "11111111-1111-4111-8111-111111111111",
    role: "OWNER",
  },
  {
    account: "alex",
    displayName: "Alex",
    id: "22222222-2222-4222-8222-222222222222",
    role: "LEAD_DESIGNER",
  },
  {
    account: "mori",
    displayName: "木作设计师",
    id: "33333333-3333-4333-8333-333333333333",
    role: "WOODWORK_DESIGNER",
  },
  {
    account: "pm",
    displayName: "项目经理（预留）",
    id: "88888888-8888-4888-8888-888888888888",
    role: "PROJECT_MANAGER",
  },
  {
    account: "finance",
    displayName: "财务（预留）",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
    role: "FINANCE",
  },
];

const pool = new pg.Pool({
  database: requiredEnvironmentVariable("POSTGRES_DB"),
  host: process.env.POSTGRES_HOST ?? "127.0.0.1",
  password: requiredEnvironmentVariable("POSTGRES_PASSWORD"),
  port: Number.parseInt(process.env.POSTGRES_PORT ?? "5432", 10),
  user: requiredEnvironmentVariable("POSTGRES_USER"),
});

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const seededUserIds = new Map();
  for (const user of demoUsers) {
    const passwordHash = await hashPassword(demoPassword);
    const result = await client.query(
      `INSERT INTO users
         (id, account, display_name, phone, role, status)
       VALUES ($1, $2, $3, NULL, $4, 'ACTIVE')
       ON CONFLICT (account) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             role = EXCLUDED.role,
             status = 'ACTIVE',
             updated_at = current_timestamp
       RETURNING id`,
      [user.id, user.account, user.displayName, user.role],
    );
    const userId = result.rows[0]?.id;
    if (!userId) {
      throw new Error(`无法初始化演示账号 ${user.account}`);
    }
    seededUserIds.set(user.account, userId);
    await client.query(
      `INSERT INTO user_credentials (user_id, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             changed_at = current_timestamp`,
      [userId, passwordHash],
    );
  }
  const ownerId = seededUserIds.get("owner");
  const leadId = seededUserIds.get("alex");
  if (!ownerId || !leadId) {
    throw new Error("无法初始化演示项目的负责人");
  }
  const demoProjectId = "44444444-4444-4444-8444-444444444444";
  await client.query(
    `INSERT INTO projects
       (id, name, customer_name, address, building_area,
        lead_designer_id, created_by_user_id)
     VALUES ($1, '静悦府（演示）', '林先生', '上海市静安区测试路 1 号',
             130.0000, $2, $3)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           customer_name = EXCLUDED.customer_name,
           address = EXCLUDED.address,
           building_area = EXCLUDED.building_area,
           lead_designer_id = EXCLUDED.lead_designer_id,
           updated_at = current_timestamp`,
    [demoProjectId, leadId, ownerId],
  );
  const demoSpaces = [
    {
      area: "42.0000",
      displayName: "客餐厅",
      height: "2.8000",
      id: "55555555-5555-4555-8555-555555555555",
      includesBalcony: true,
      perimeter: "28.0000",
      sortOrder: 0,
      type: "LIVING_DINING",
    },
    {
      area: "18.0000",
      displayName: "主卧",
      height: "2.8000",
      id: "66666666-6666-4666-8666-666666666666",
      includesBalcony: false,
      perimeter: "17.0000",
      sortOrder: 1,
      type: "BEDROOM",
    },
  ];
  for (const space of demoSpaces) {
    await client.query(
      `INSERT INTO project_spaces
         (id, project_id, type, display_name, area, perimeter, height,
          includes_balcony, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE
         SET type = EXCLUDED.type,
             display_name = EXCLUDED.display_name,
             area = EXCLUDED.area,
             perimeter = EXCLUDED.perimeter,
             height = EXCLUDED.height,
             includes_balcony = EXCLUDED.includes_balcony,
             sort_order = EXCLUDED.sort_order,
             updated_at = current_timestamp`,
      [
        space.id,
        demoProjectId,
        space.type,
        space.displayName,
        space.area,
        space.perimeter,
        space.height,
        space.includesBalcony,
        space.sortOrder,
      ],
    );
  }
  const acceptanceProjectId = "99999999-9999-4999-8999-999999999999";
  await client.query(
    `INSERT INTO projects
       (id, name, customer_name, address, building_area,
        lead_designer_id, created_by_user_id)
     VALUES ($1, '云栖名苑（V1验收）', '陈先生', '杭州市滨江区云栖名苑 8-2-602',
             130.0000, $2, $3)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           customer_name = EXCLUDED.customer_name,
           address = EXCLUDED.address,
           building_area = EXCLUDED.building_area,
           lead_designer_id = EXCLUDED.lead_designer_id,
           updated_at = current_timestamp`,
    [acceptanceProjectId, leadId, ownerId],
  );
  const acceptanceSpaces = [
    ["90000000-0000-4000-8000-000000000001", "LIVING_DINING", "客餐厅", "50.0000", "40.0000", "2.8000", false],
    ["90000000-0000-4000-8000-000000000002", "BEDROOM", "主卧", "20.0000", "20.0000", "2.9100", false],
    ["90000000-0000-4000-8000-000000000003", "BEDROOM", "次卧", "16.0000", "18.0000", "2.9100", false],
    ["90000000-0000-4000-8000-000000000004", "CLOSET", "衣帽间", "8.0000", "12.0000", "2.9100", false],
    ["90000000-0000-4000-8000-000000000005", "KITCHEN", "厨房", "8.0000", "12.0000", "2.4500", false],
    ["90000000-0000-4000-8000-000000000006", "BATHROOM", "主卫", "5.8000", "12.0000", "2.4500", false],
    ["90000000-0000-4000-8000-000000000007", "BATHROOM", "公卫", "4.6000", "10.0000", "2.4500", false],
    ["90000000-0000-4000-8000-000000000008", "BALCONY", "生活阳台", "6.0000", "10.0000", "2.7000", false],
  ];
  for (const [id, type, displayName, area, perimeter, height, includesBalcony] of acceptanceSpaces) {
    await client.query(
      `INSERT INTO project_spaces
         (id, project_id, type, display_name, area, perimeter, height,
          includes_balcony, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE
         SET type = EXCLUDED.type,
             display_name = EXCLUDED.display_name,
             area = EXCLUDED.area,
             perimeter = EXCLUDED.perimeter,
             height = EXCLUDED.height,
             includes_balcony = EXCLUDED.includes_balcony,
             sort_order = EXCLUDED.sort_order,
             updated_at = current_timestamp`,
      [id, acceptanceProjectId, type, displayName, area, perimeter, height, includesBalcony, acceptanceSpaces.findIndex((item) => item[0] === id)],
    );
  }
  await client.query("COMMIT");
  console.log(
    `已初始化演示账号：${demoUsers.map((user) => user.account).join(", ")}；演示项目：静悦府（演示）、云栖名苑（V1验收）`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

function requiredEnvironmentVariable(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
}
