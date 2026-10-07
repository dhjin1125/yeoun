import { expect, test } from "playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("yeoun:intro:v2", "seen"));
});

test("server revalidation can remove a stale cached purchase offer",async({page})=>{
  await page.route(/\/api\/readings\/[^/?]+(?:\?.*)?$/,async route=>{
    if(route.request().method()!=="GET") return route.continue();
    const response=await route.fetch({headers:{...route.request().headers(),accept:"application/json"}});
    const body=await response.json();
    body.reading.paidOffer=null;
    body.reading.canPurchaseFullReading=false;
    body.reading.freeDetailGuidance={ready:false,kind:"scene",question:"서버에서 확인한 새 질문",questionId:"confirm-server",placeholder:"기억나는 사실"};
    await route.fulfill({response,json:body});
  });
  await page.goto("/");
  await page.getByLabel("꿈 이야기").fill("검은 뱀이 집에 들어왔어요. 무서웠지만 문을 열어 내보냈고 마지막에는 편안해졌어요.");
  await page.getByRole("button",{name:"무료로 꿈 해석 보기"}).click();
  await expect(page.getByRole("heading",{name:"서버에서 확인한 새 질문"})).toBeVisible();
  await expect(page.locator(".deep-reading-offer")).toHaveCount(0);
});

test("core fact confirmation precedes the offer, payment and integrated report", async ({ page }, testInfo) => {
  test.skip(process.env.APP_PROFILE === "review", "Anonymous checkout flow.");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let orders = 0;
  page.on("request", request => { if (request.url().endsWith("/api/orders")) orders += 1; });
  await page.goto("/");
  await page.getByLabel("꿈 이야기").fill("누가 쫒아오고 막 때리고 피나오고 그런꿈");
  await page.getByRole("button", { name: "무료로 꿈 해석 보기" }).click();
  await expect(page.getByRole("heading", { name: "때리는 장면에서 어떤 상황이었나요?" })).toBeVisible();
  await expect(page.locator(".deep-reading-offer")).toHaveCount(0);
  await expect(page.locator(".direct-answer")).toContainText("쫓아오는 장면");
  await expect(page.locator(".direct-answer")).toContainText("피가 나는 장면");
  const originalUrl = page.url();
  if (process.env.CAPTURE_VISUALS === "1") await page.screenshot({path:testInfo.outputPath("fact-confirmation.png"),fullPage:true});
  await page.getByRole("button", { name: "확인 질문에 답하기" }).click();
  const detail = page.getByLabel("확인 질문 답변 또는 추가 내용");
  await expect(page.getByRole("button", { name: "기억나지 않아요", exact:true })).toBeVisible();
  await detail.fill("처음에는 무서워서 도망쳤고, 나중에는 내가 쫓아오던 사람을 때렸어. 피는 그 사람에게 났고, 끝에는 후련했어.");
  await page.route("**/api/readings/*/details", route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:{message:"잠시 후 다시 시도해 주세요."}})}));
  await page.getByRole("button", { name:"답변 반영하기",exact:true }).click();
  await expect(page.locator(".free-detail [role=alert]")).toContainText("잠시 후");
  await expect(detail).toHaveValue(/후련했어/);
  expect(orders).toBe(0);
  await page.unroute("**/api/readings/*/details");
  await page.getByRole("button", { name:"답변 반영하기",exact:true }).click();
  await expect(page).not.toHaveURL(originalUrl);
  const purchase=page.getByRole("button",{name:"상세 해몽 테스트하기",exact:true});
  await expect(purchase).toBeVisible();
  await expect(page.locator(".timeline-entry--safety")).toHaveCount(0);
  await page.reload();
  await expect(purchase).toBeVisible();
  await purchase.click();
  const dialog=page.getByRole("dialog",{name:"상세 해몽 + 질문 2회"});
  await expect(dialog.getByText("₩990")).toBeVisible();
  const pay=dialog.getByRole("button",{name:"테스트 결제로 상세 풀이 보기"});
  await expect(pay).toBeDisabled();
  await expect(dialog.getByText(/중복결제·미제공·기술 오류 전액 환불/)).toBeVisible();
  if (process.env.CAPTURE_VISUALS === "1") await page.screenshot({path:testInfo.outputPath("confirmed-checkout.png"),fullPage:true});
  await dialog.getByRole("checkbox").check();
  await pay.click();
  await expect(page.getByRole("heading",{name:"상세 해몽",exact:true})).toBeVisible();
  await expect(page.getByRole("region",{name:"새 정보로 달라진 해석"})).toContainText("후련했어");
  const comparison=page.locator("details").filter({has:page.locator("summary",{hasText:"첫 읽기와 비교하기"})});
  await expect(comparison).not.toHaveAttribute("open","");
  await expect(page.locator(".timeline-entry--free")).not.toBeVisible();
  await expect(page.locator(".consultation-timeline > article").first()).toHaveClass(/timeline-entry--detailed/);
  await expect(page.getByText("이 답변이 도움이 됐나요?")).toHaveCount(0);
  await expect(page.getByText("궁금했던 점이 풀렸나요?")).toHaveCount(0);
  const composer=page.getByLabel("꿈에 대해 이어서 질문하기");
  await composer.fill("그렇궂나");
  await page.getByRole("button",{name:"질문 보내기"}).click();
  await expect(page.getByRole("heading",{name:"추가 대화",exact:true})).toBeVisible();
  await expect(page.getByText("남은 질문 2회",{exact:true})).toBeVisible();
  for (const [index, message] of ["다른 관점으로 풀어줘","같은 꿈을 반복해서 꾸는 이유를 알려줘"].entries()) {
    await composer.fill(message);
    await page.getByRole("button",{name:"질문 보내기"}).click();
    if (index === 0) await expect(composer).toBeEnabled();
    else await expect(composer).toHaveCount(0);
  }
  await expect(page.getByRole("button",{name:"질문 2회 더 이어가기 · 990원"})).toBeVisible();
  await page.getByRole("button",{name:"사실 정정·오류 수정"}).click();
  await page.getByLabel("정정하거나 수정할 내용").fill("장소는 학교였어");
  await page.getByRole("button",{name:"추가 비용 없이 반영하기"}).click();
  await expect(page.getByRole("region",{name:"새 정보로 달라진 해석"})).toContainText("학교였어");
  await expect(page.getByRole("button",{name:"질문 2회 더 이어가기 · 990원"})).toBeVisible();
  await expect(page.locator(".consultation-timeline > article").first()).toHaveClass(/timeline-entry--detailed/);
  if (process.env.CAPTURE_VISUALS === "1") await page.screenshot({path:testInfo.outputPath("paid-correction.png"),fullPage:true});
  expect(orders).toBe(1);
  expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("forgotten facts stop questions and checkout without fabricating an ending", async ({ page },testInfo) => {
  await page.goto("/");
  await page.getByLabel("꿈 이야기").fill("누가 쫒아오고 막 때리고 피나오고 그런꿈");
  await page.getByRole("button",{name:"무료로 꿈 해석 보기"}).click();
  await page.getByRole("button",{name:"확인 질문에 답하기"}).click();
  await page.getByRole("button",{name:"기억나지 않아요",exact:true}).click();
  await page.getByRole("button",{name:"답변 반영하기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"지금 기억으로는 짧은 첫 읽기까지 제공할 수 있어요."})).toBeVisible();
  await expect(page.locator(".deep-reading-offer")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"확인 질문에 답하기"})).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".deep-reading-offer")).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"지금 기억으로는 짧은 첫 읽기까지 제공할 수 있어요."})).toBeVisible();
  if (process.env.CAPTURE_VISUALS === "1") await page.screenshot({path:testInfo.outputPath("limited-reading.png"),fullPage:true});
});

test("fact confirmation routes current safety concerns without an order", async ({ page }) => {
  let orders=0;
  page.on("request",request=>{if(request.url().endsWith("/api/orders"))orders+=1;});
  await page.goto("/");
  await page.getByLabel("꿈 이야기").fill("누가 쫓아오고 때리고 피가 났어요");
  await page.getByRole("button",{name:"무료로 꿈 해석 보기"}).click();
  await page.getByRole("button",{name:"확인 질문에 답하기"}).click();
  await page.getByLabel("확인 질문 답변 또는 추가 내용").fill("지금 자해하고 싶고 죽고 싶어요.");
  await page.getByRole("button",{name:"답변 반영하기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"지금 필요한 이야기부터 할게요."})).toBeVisible();
  await expect(page.locator(".deep-reading-offer")).toHaveCount(0);
  expect(orders).toBe(0);
});
