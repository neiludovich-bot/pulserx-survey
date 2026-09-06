import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), unique: vi.fn(), crawl: vi.fn(), apply: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { sourceDocument: { findMany: mocks.list, updateMany: mocks.update, findUnique: mocks.unique } } }));
vi.mock("./website-crawler", () => ({ indexMedicalWebsite: mocks.crawl }));
vi.mock("./website-index-service", () => ({ applyWebsiteIndex: mocks.apply }));
import { initialRefreshState, refreshDue, runWebsiteRefreshTick } from "./website-refresh-service";
import { publicWebsiteAddress } from "./website-download";
const input = { surveySlug: "future-bot", profile: { rootUrl: "https://example.com/", hosts: ["example.com"], documentHosts: [] } };
beforeEach(() => vi.resetAllMocks());
describe("automatic website indexing", () => {
  it("queues new surveys with weekly refresh and recovers expired durable leases", () => {
    const state = initialRefreshState(input, new Date(0));
    expect(state).toMatchObject({ enabled: true, intervalHours: 168, status: "queued" });
    expect(refreshDue(state, 1)).toBe(true);
    expect(refreshDue({ ...state, status: "running", lastStartedAt: new Date(0).toISOString(), leaseUntil: new Date(7200000).toISOString() }, 180001)).toBe(true);
    expect(refreshDue({ ...state, status: "completed", enabled: false }, 1)).toBe(false);
    expect(refreshDue({ ...state, status: "running", leaseUntil: new Date(100).toISOString() }, 99)).toBe(false);
    expect(refreshDue({ ...state, status: "running", leaseUntil: new Date(100).toISOString() }, 101)).toBe(true);
  });
  it("does not crawl when another worker won the claim", async () => {
    mocks.list.mockResolvedValue([{id:"config",content:JSON.stringify(initialRefreshState(input, new Date(0)))}]);
    mocks.update.mockResolvedValue({count:0});
    await runWebsiteRefreshTick(); expect(mocks.crawl).not.toHaveBeenCalled();
  });
  it("retains existing evidence on failure and persists a retry", async () => {
    mocks.list.mockResolvedValue([{id:"config",content:JSON.stringify(initialRefreshState(input, new Date(0)))}]);
    mocks.update.mockResolvedValue({count:1}); mocks.crawl.mockRejectedValue(new Error("Website unavailable"));
    await runWebsiteRefreshTick(); expect(mocks.apply).not.toHaveBeenCalled();
    const saved = JSON.parse(mocks.update.mock.calls.at(-1)![0].data.content);
    expect(saved).toMatchObject({status:"failed",lastError:"Website unavailable",leaseUntil:null});
    expect(Date.parse(saved.nextRunAt)).toBeGreaterThan(Date.now());
  });
  it("passes the entire snapshot including tables through the shared import on each run", async () => {
    mocks.list.mockResolvedValue([{id:"config",content:JSON.stringify(initialRefreshState(input, new Date(0)))}]);
    mocks.update.mockResolvedValue({count:1});
    mocks.unique.mockImplementation(() => ({content:mocks.update.mock.calls[0][0].data.content}));
    const snapshot={pages:[{sourceType:"URL",url:"https://example.com/",tables:[{title:"Safety"}],assets:[]}],truncated:false};
    mocks.crawl.mockResolvedValue(snapshot); mocks.apply.mockResolvedValue({reportId:"report",issues:[]});
    await runWebsiteRefreshTick(); expect(mocks.apply).toHaveBeenCalledWith(snapshot,input.profile);
    expect(JSON.parse(mocks.update.mock.calls.at(-1)![0].data.content)).toMatchObject({status:"completed",lastReportId:"report"});
  });
  it("rejects internal and metadata addresses for configurable websites", () => {
    for (const ip of ["127.0.0.1","10.1.2.3","169.254.169.254","172.16.0.2","192.168.0.1","100.64.1.2","::1"]) expect(publicWebsiteAddress(ip)).toBe(false);
    expect(publicWebsiteAddress("93.184.216.34")).toBe(true);
  });
});
