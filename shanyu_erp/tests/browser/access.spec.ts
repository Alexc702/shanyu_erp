import { expect, test, type Page } from "@playwright/test";

const demoPassword = process.env.DEMO_USER_PASSWORD ?? "Shanyu123!";

test("owner can open user management", async ({ page }) => {
  await login(page, "owner");

  await expect(page.getByRole("heading", { name: "你好，何总" })).toBeVisible();
  await page.getByRole("link", { name: "用户与权限", exact: true }).click();
  await expect(page).toHaveURL("/users");
  await expect(page.getByRole("heading", { name: "用户与权限" })).toBeVisible();
  await expect(page.getByText("共 3 个内部账号")).toBeVisible();
});

test("owner can inspect and maintain confirmed project spaces", async ({ page }) => {
  await login(page, "owner");
  await page.getByRole("link", { name: "项目管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "住宅项目" })).toBeVisible();
  await page.getByRole("link", { name: "新建项目" }).click();
  await expect(page.getByRole("heading", { name: "新建住宅项目" })).toBeVisible();
  await expect(page.getByLabel("主案设计师")).toBeVisible();
  await page.getByRole("link", { name: "返回项目列表" }).click();
  await page.getByRole("link", { name: /静悦府（演示）/ }).click();
  await expect(page.getByRole("heading", { name: "静悦府（演示）" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "客餐厅" })).toBeVisible();
  await expect(page.getByText("已包含阳台工程项")).toBeVisible();

  const livingCard = page.locator("article.space-card").filter({
    has: page.getByRole("heading", { name: "客餐厅", exact: true }),
  });
  await livingCard.getByText("编辑空间", { exact: true }).click();
  const nameInput = livingCard.getByLabel("空间名称");
  await expect(nameInput).toHaveAttribute("maxlength", "6");
  await nameInput.fill("厅");
  await livingCard.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("heading", { name: "厅", exact: true })).toBeVisible();

  const oneCharacterCard = page.locator("article.space-card").filter({
    has: page.getByRole("heading", { name: "厅", exact: true }),
  });
  await oneCharacterCard.getByLabel("空间名称").fill("客餐厅一号厅");
  await oneCharacterCard.getByRole("button", { name: "保存" }).click();
  await expect(
    page.getByRole("heading", { name: "客餐厅一号厅", exact: true }),
  ).toBeVisible();

  const sixCharacterCard = page
    .locator("article.space-card")
    .filter({
      has: page.getByRole("heading", { name: "客餐厅一号厅", exact: true }),
    });
  await sixCharacterCard.getByLabel("空间名称").fill("客餐厅");
  await sixCharacterCard.getByRole("button", { name: "保存" }).click();
  await expect(
    page.getByRole("heading", { name: "客餐厅", exact: true }),
  ).toBeVisible();
});

test("standalone balcony requires confirmation when living room wraps a balcony", async ({ page }) => {
  await login(page, "owner");
  await page.getByRole("link", { name: "项目管理", exact: true }).click();
  await page.getByRole("link", { name: /静悦府（演示）/ }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  const projectId = new URL(page.url()).pathname.split("/").at(-1);
  if (!projectId) {
    throw new Error("项目地址缺少项目 ID");
  }
  const existingResponse = await page.request.get(
    `http://localhost:3001/projects/${projectId}`,
  );
  const existingPayload = (await existingResponse.json()) as {
    project: { spaces: Array<{ displayName: string; id: string }> };
  };
  for (const space of existingPayload.project.spaces.filter(
    (item) => item.displayName === "验收阳台",
  )) {
    await page.request.delete(
      `http://localhost:3001/projects/${projectId}/spaces/${space.id}`,
    );
  }
  await page.reload();

  const addPanel = page.locator("section.add-space-panel");
  await addPanel.getByLabel("空间类型").selectOption("BALCONY");
  await addPanel.getByLabel("空间名称").fill("验收阳台");
  await addPanel.getByLabel("面积（㎡）").fill("6.0000");
  await addPanel.getByLabel("周长（m）").fill("10.0000");
  await addPanel.getByLabel("层高（m）").fill("2.8000");
  await addPanel.getByRole("button", { name: "新增空间" }).click();
  await expect(
    addPanel.getByText("本项目客餐厅已包阳台，请确认是否仍需新增独立阳台"),
  ).toBeVisible();

  await addPanel.getByLabel("我确认仍需新增独立阳台").check();
  await addPanel.getByRole("button", { name: "新增空间" }).click();
  await expect(
    page.getByRole("heading", { name: "验收阳台", exact: true }),
  ).toBeVisible();

  const balconyCard = page.locator("article.space-card").filter({
    has: page.getByRole("heading", { name: "验收阳台", exact: true }),
  });
  await balconyCard.getByText("编辑空间", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await balconyCard.getByRole("button", { name: "删除" }).click();
  await expect(
    page.getByRole("heading", { name: "验收阳台", exact: true }),
  ).toHaveCount(0);
});

test("lead designer cannot open user management", async ({ page }) => {
  await login(page, "alex");

  await expect(page.getByRole("heading", { name: "你好，Alex" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "用户与权限", exact: true }),
  ).toHaveCount(0);
  await page.goto("/users");
  await expect(page).toHaveURL("/");
  await page.getByRole("link", { name: "项目管理", exact: true }).click();
  await expect(page.getByText("静悦府（演示）")).toBeVisible();
});

test("woodwork designer gets the reserved V2 workbench", async ({ page }) => {
  await login(page, "mori");

  await expect(
    page.getByRole("heading", { name: "你好，木作设计师" }),
  ).toBeVisible();
  await expect(
    page.getByText("木作项目指派与铂屿木作定制将在 V2 接入。"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "用户与权限", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "项目管理", exact: true }),
  ).toHaveCount(0);
  await page.goto("/projects");
  await expect(page).toHaveURL("/");
  await page.goto("/projects/new");
  await expect(page).toHaveURL("/");
});

async function login(page: Page, account: string) {
  await page.goto("/login");
  await page.getByLabel("账号或手机号").fill(account);
  await page.getByLabel("密码").fill(demoPassword);
  await page.getByRole("button", { name: "登录系统" }).click();
  await expect(page).toHaveURL("/");
}
