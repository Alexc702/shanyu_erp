import { expect, test, type BrowserContext } from "@playwright/test";

const api = process.env.TRANSFER_API_URL;
test.skip(!api, "使用 playwright.transfer.config.ts 显式启用隔离验收");
test("transfer UI, optional reason, live readonly access, takeover and revoke", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  if (api !== "http://localhost:3115" || process.env.TRANSFER_WEB_URL !== "http://localhost:3215") throw new Error("Isolated endpoints required");
  const contexts: BrowserContext[] = [];
  async function login(account: string, password = "Shanyu123!") {
    const context = await browser.newContext({ baseURL: process.env.TRANSFER_WEB_URL, viewport: {width:1440,height:1000} }); contexts.push(context);
    expect((await context.request.post(`${api}/auth/login`, {data:{identifier:account,password,rememberMe:false}})).status()).toBe(200);
    return context;
  }
  try {
    const owner = await login("owner"), old = await login("alex");
    const account = `transfer-${Date.now()}`, password = "TransferQa0924!";
    const created = await owner.request.post(`${api}/users`, {data:{account,password,displayName:"转交验收新主案",phone:null,role:"LEAD_DESIGNER"}});
    expect(created.status()).toBe(201); const targetId = (await created.json()).user.id;
    const next = await login(account,password);
    const response = await old.request.post(`${api}/projects`, {data:{projectAddress:"转交浏览器隔离验收",customerName:"测试",outerFrameArea:"100",leadDesignerId:"22222222-2222-4222-8222-222222222222",spaces:[{displayName:"主卧",type:"BEDROOM",area:"20",perimeter:"18",height:"2.8",includesBalcony:false}]}});
    expect(response.status()).toBe(201); const id = (await response.json()).project.id;
    const page = await owner.newPage(); await page.goto(`/projects/${id}`);
    const oldPage = await old.newPage(); await oldPage.goto(`/projects/${id}`);
    await expect(oldPage.getByRole("button",{name:"转交主案",exact:true})).toHaveCount(0);
    await expect(oldPage.getByRole("button",{name:"确认设计费",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"转交主案",exact:true}).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("checkbox")).not.toBeChecked();
    await expect(dialog.getByRole("button",{name:"确认转交",exact:true})).toBeDisabled();
    await dialog.getByLabel("新主案").selectOption(targetId);
    await dialog.getByRole("checkbox").check();
    await expect(dialog.getByLabel("转交原因",{exact:false})).toHaveValue("");
    await page.screenshot({path:testInfo.outputPath("transfer-dialog.png"),fullPage:true});
    await dialog.getByRole("button",{name:"确认转交",exact:true}).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText(/主案 转交验收新主案/)).toBeVisible();
    await oldPage.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await expect(oldPage.getByText("只读查看",{exact:true})).toBeVisible();
    await expect(oldPage.getByRole("button",{name:"确认设计费",exact:true})).toHaveCount(0);
    await expect(oldPage.getByRole("button",{name:"打印/导出",exact:true})).toHaveCount(0);
    await oldPage.screenshot({path:testInfo.outputPath("readonly-project.png"),fullPage:true});
    const nextPage = await next.newPage(); await nextPage.goto(`/projects/${id}`);
    await nextPage.getByLabel("设计费单价（元/㎡）").fill("0");
    await nextPage.getByRole("button",{name:"确认设计费",exact:true}).click();
    await expect(nextPage.getByText("设计费已确认，已纳入项目报价")).toBeVisible();
    await oldPage.reload(); await expect(oldPage.getByLabel("设计费单价（元/㎡）")).toHaveValue("0.0000");
    await oldPage.goto(`/projects/${id}/quotation`);
    await expect(oldPage.getByText("只读查看", {exact:true}).first()).toBeVisible();
    await expect(oldPage.getByRole("button",{name:"保存草稿",exact:true})).toHaveCount(0);
    await oldPage.goto(`/projects/${id}/quotation/main-materials`);
    await expect(oldPage.getByRole("button",{name:"添加主材",exact:true})).toHaveCount(0);
    await page.getByRole("button",{name:"取消只读权限",exact:true}).click();
    await page.screenshot({path:testInfo.outputPath("revoke-dialog.png"),fullPage:true});
    await page.getByRole("button",{name:"确认取消只读",exact:true}).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await oldPage.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await expect(oldPage).toHaveURL(/\/projects$/);
    expect((await old.request.get(`${api}/projects/${id}`)).status()).toBe(404);
    expect((await next.request.get(`${api}/projects/${id}`)).status()).toBe(200);
  } finally { await Promise.all(contexts.map(context=>context.close())); }
});
