import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { FileModelStore } from "@/lib/model";
import { companyModel, saveCompanyMetrics } from "@/lib/vc/server/company-model";
import { createStudyInput } from "@/lib/vc/validation";
import { createForecastingGateway } from "@/lib/vc/server/forecasting-adapter";
import { getVcDeps, getVcServices } from "@/lib/vc/server/container";
import type { VcContext } from "@/lib/vc/types";
import { makeAdmin, makeMarket, makeOrg, makeStartup, makeUser, resetDatabase } from "../helpers";

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());
afterAll(() => db.$disconnect());
const day = (offset: number) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
/** A draft linked to nothing yet; tests add `modelLink`. Forecasting closes two weeks out. */
const studyInput = (startupId: string) => ({
  startupId,
  question: "Will PostHog's JS SDK pass 1,100 downloads in a week?",
  yesCriteria: "YES if the public npm downloads API reports at least the threshold.",
  noCriteria: "NO if the public npm downloads API reports fewer than the threshold.",
  deadline: new Date(Date.now()+14*86400000),
  visibility: "ORGANIZATION" as const,
});
async function world() {
  const a = await makeUser(); const b = await makeUser();
  const orgA = await makeOrg([[a,"OWNER"]]); const orgB = await makeOrg([[b,"OWNER"]]);
  const company = await makeStartup();
  const startup = await db.startup.update({where:{id:company.id},data:{slug:"posthog",name:"PostHog"}});
  const ctx = async (user: typeof a): Promise<VcContext> => {
    const memberships = await getVcDeps().platform.getMemberships(user.id);
    return {user:{id:user.id,name:user.displayName,email:user.email,isPlatformAdmin:false},memberships,activeOrg:memberships[0]};
  };
  return {a,b,orgA,orgB,startup,ca:await ctx(a),cb:await ctx(b)};
}
describe("private company metrics and model questions",()=>{
  it("isolates inputs by organization, records provenance and permits corrections only in that organization",async()=>{
    const w=await world();
    const observation={metricId:"sponsor_arr",value:120000,periodStart:day(-3),periodEnd:day(-3),note:"Investor report",simulated:true};
    await saveCompanyMetrics(w.ca,w.startup.id,{observations:[observation]});
    expect((await companyModel(w.cb,w.startup.id)).sponsor).toEqual([]);
    const own=await companyModel(w.ca,w.startup.id);
    expect(own.sponsor[0]).toMatchObject({value:120000,simulated:true,provenance:"sponsor_provided",note:"Investor report"});
    await saveCompanyMetrics(w.cb,w.startup.id,{observations:[{...observation,value:999}]});
    await saveCompanyMetrics(w.ca,w.startup.id,{observations:[{...observation,value:150000}]});
    expect((await companyModel(w.cb,w.startup.id)).sponsor[0].value).toBe(999);
    const row=await db.modelDataPoint.findFirstOrThrow({where:{organizationId:w.orgA.id}});
    expect(row).toMatchObject({enteredById:w.a.id,value:150000,source:"SPONSOR",provenance:"SPONSOR_PROVIDED"});
    expect(await db.modelDataPoint.count()).toBe(2);
  });
  it("rejects missing membership, read-only writes, invalid periods, unsupported metrics and manual prices",async()=>{
    const w=await world();
    const input={observations:[{metricId:"sponsor_arr",value:1,periodStart:day(-2),periodEnd:day(-1)}]};
    await expect(companyModel({...w.ca,memberships:[]},w.startup.id)).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(saveCompanyMetrics({...w.ca,activeOrg:{...w.ca.activeOrg!,role:"VIEWER"}},w.startup.id,input)).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(saveCompanyMetrics(w.ca,w.startup.id,input)).rejects.toMatchObject({code:"VALIDATION_ERROR"});
    await expect(saveCompanyMetrics(w.ca,w.startup.id,{observations:[{...input.observations[0],periodStart:day(1),periodEnd:day(1)}]})).rejects.toMatchObject({code:"VALIDATION_ERROR"});
    // No manual prices: a typed baseline is dropped, and only the model sets it.
    expect(createStudyInput.parse({...studyInput(w.startup.id),baselineValue:.99})).not.toHaveProperty("baselineValue");
    // A firm-only KPI has no independent resolution source, so it can't be a question.
    await expect(getVcServices().studies.create(w.ca,{...studyInput(w.startup.id),modelLink:{metricId:"sponsor_arr",threshold:1,targetDate:day(28)}})).rejects.toMatchObject({code:"VALIDATION_ERROR"});
  });
  it("prices only from the target metric and this firm's inputs, and opens at the model's price",async()=>{
    const w=await world();
    vi.spyOn(FileModelStore.prototype,"readPoints").mockReturnValue([]);
    const services=getVcServices();
    const link={metricId:"npm_downloads:posthog-js",threshold:1100,targetDate:day(28)};
    const input={...studyInput(w.startup.id),modelLink:link};
    expect((await services.studies.create(w.ca,input)).baselineValue).toBeNull();

    const observations=Array.from({length:10},(_,i)=>({metricId:link.metricId,value:800+i*20,periodStart:day(-76+i*7),periodEnd:day(-70+i*7),simulated:true}));
    await saveCompanyMetrics(w.ca,w.startup.id,{observations});
    const study=await services.studies.create(w.ca,input);
    expect(study.baselineValue).not.toBeNull();
    const estimate=(await getVcDeps().repo.findModelEstimate(study.id))!;
    expect(estimate.status).toBe("OK");
    expect(estimate.inputsUsed.some((i)=>i.provenance==="sponsor_provided")).toBe(true);
    // Firm B can't see or use firm A's figures.
    expect((await services.studies.create(w.cb,input)).baselineValue).toBeNull();
    // A different metric's figures never move this question's price.
    await saveCompanyMetrics(w.ca,w.startup.id,{observations:[{metricId:"sponsor_arr",value:9e10,periodStart:day(-1),periodEnd:day(-1)}]});
    expect((await services.studies.create(w.ca,input)).baselineValue).toBe(study.baselineValue);

    const admin=await makeAdmin();
    const adminCtx:VcContext={user:{id:admin.id,name:admin.displayName,email:admin.email,isPlatformAdmin:true},memberships:[],activeOrg:null};
    await services.studies.transition(w.ca,study.id,{action:"submit",expectedVersion:1});
    await services.studies.transition(adminCtx,study.id,{action:"approve",expectedVersion:2});
    const open=await services.studies.transition(adminCtx,study.id,{action:"open",expectedVersion:3});
    const market=await db.market.findUniqueOrThrow({where:{id:open.marketId!},include:{sources:{orderBy:{position:"asc"}}}});
    expect(market.openingBaseline).toBe(open.baselineValue);
    expect(market.modelValue).toBe(open.baselineValue);
    expect(market.sources[0].url).toContain("api.npmjs.org/downloads/range/");
    await expect(services.studies.update(w.ca,study.id,{expectedVersion:4,sources:[]})).rejects.toMatchObject({code:"CONFLICT"});
    // New figures don't touch the market until the model refresh publishes them.
    await saveCompanyMetrics(w.ca,w.startup.id,{observations:[{...observations[0],value:9000}]});
    expect((await db.market.findUniqueOrThrow({where:{id:market.id}})).openingBaseline).toBe(market.openingBaseline);
  });
  it("uses recorded LMSR prices, leaves the unpopulated verified line empty and keeps the model separate",async()=>{
    const admin=await makeAdmin(); const market=await makeMarket(admin);
    await db.market.update({where:{id:market.id},data:{modelValue:.42,yesCredits:90,noCredits:10,forecastCount:2}});
    await db.marketSnapshot.create({data:{marketId:market.id,sequence:2,trigger:"FORECAST",openingBaseline:.4,modelValue:.42,yesCredits:90,noCredits:10,allocationShare:.9,forecastCount:2,forecasterCount:2,generalEstimate:.61,specializedEstimate:.4,specializedForecasters:0,estimateKind:"MARKET_PRICE"}});
    const gateway=createForecastingGateway(db);
    const estimate=(await gateway.getEstimates([market.id])).get(market.id)!;
    expect(estimate).toMatchObject({modelValue:.42,generalPrice:.61,specializedPrice:null,allocation:{yesShare:.9}});
    expect((await gateway.getHistory(market.id)).at(-1)).toMatchObject({modelValue:.42,yesShare:.61,specializedPrice:null});
  });
});
