import { afterEach, expect, it, vi } from "vitest";
import { createDirectUploadRequestId, uploadDirectMaterials } from "./main-material-direct-client";

afterEach(()=>vi.unstubAllGlobals());
it("generates distinct upload IDs without requiring an HTTPS-only randomUUID API",()=>{
  const getRandomValues=crypto.getRandomValues.bind(crypto);vi.stubGlobal("crypto",{getRandomValues});
  const id=createDirectUploadRequestId();expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);expect(createDirectUploadRequestId()).not.toBe(id);
});
it("receives actual streamed processing stages and a final batch, preserving the upload operation ID",async()=>{
  const payload=new TextEncoder().encode([JSON.stringify({stage:"READING"}),JSON.stringify({stage:"IMAGES"}),JSON.stringify({stage:"VALIDATING"}),JSON.stringify({batch:{id:"batch",rows:[],published:null}})].join("\n"));
  const fetch=vi.fn().mockResolvedValue(new Response(new ReadableStream({start(controller){controller.enqueue(payload.slice(0,21));controller.enqueue(payload.slice(21));controller.close();}}),{status:201}));vi.stubGlobal("fetch",fetch);
  const stages:string[]=[], batch=await uploadDirectMaterials(new File(["x"],"资料.xlsx"),[],new AbortController().signal,"operation",stage=>stages.push(stage));
  expect(stages).toEqual(["READING","IMAGES","VALIDATING"]);expect(batch.id).toBe("batch");expect(batch.published).toBeNull();
  expect(fetch.mock.calls[0]![1].headers["X-Import-Request-Id"]).toBe("operation");
});
it("does not turn a processing failure or truncated stream into success",async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response('{"stage":"READING"}\n{"error":{"message":"文件损坏","kind":"CORRUPT"}}\n',{status:201})).mockResolvedValueOnce(new Response('{"stage":"READING"}\n',{status:201}));vi.stubGlobal("fetch",fetch);
  const upload=()=>uploadDirectMaterials(new File(["x"],"资料.xlsx"),[],new AbortController().signal,"operation",()=>{});
  await expect(upload()).rejects.toMatchObject({message:"文件损坏",kind:"CORRUPT"});await expect(upload()).rejects.toThrow("未完成");
});
