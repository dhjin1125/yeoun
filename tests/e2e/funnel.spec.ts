import { expect, test } from "playwright/test";

const detailedDream =
  "검은 뱀이 우리 집 창문으로 천천히 들어왔어요. 처음에는 무서웠지만 도망치지 않고 가만히 바라보다가 문을 열어 밖으로 내보냈고, 마지막에는 이상하게 마음이 편안해졌어요.";

const relationshipDream =
  "여자친구가 꿈을 꿨는데 1번 오빠는 저였고 좋은 시간을 보냈대요. 2번 오빠도 저인 줄 알았는데 얼굴이 안 보이다가 다른 사람이란 걸 알았대요. 그 사람은 새벽 1시에 들어오고 화를 내며 여자친구 말도 듣지 않았대요. 가족이 모인 아파트의 어떤 곳에 들어가면 좀비에게 공격당했대요. 최근에 여자친구 친구가 남편에게 맞고 폭언을 들어 손목 자해까지 했다는 이야기를 들었대요. 이 꿈이 다른 남자를 만나고 싶다는 뜻일까요? 여자친구에게 전할 말도 알고 싶어요.";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("yeoun:intro:v2", "seen");
  });
});

test("dream observatory assembles six scenes in WebGL and enters the dream record", async ({ page }) => {
  await page.goto("/?intro=1");

  const intro = page.getByRole("dialog", { name: /마음에 남은 꿈/ });
  const enter = intro.getByRole("button", { name: "내 꿈 해석해보기" });
  const stage = page.locator(".dream-archive-stage");
  const canvas = stage.locator(".dream-observatory-canvas");
  const poster = stage.locator(".dream-observatory-poster");
  await expect(intro).toBeVisible();
  await expect(stage).toHaveAttribute("data-rendered", "true");
  await expect(stage).toHaveAttribute("data-scene", "dream-observatory");
  await expect(stage).toHaveAttribute("data-motion-profile", "assembled-spatial-v1");
  await expect(stage).toHaveAttribute("data-featured-scene", "sky-whale");
  await expect(stage).toHaveAttribute("data-motion", "active");
  await expect(stage).toHaveAttribute("data-renderer", "webgl", { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-textures", "ready", { timeout: 10_000 });
  await expect(page.getByText("꿈 장면 아카이브", { exact: true })).toHaveCount(0);
  await expect(page.getByText("기억과 기록 사이", { exact: true })).toHaveCount(0);
  expect(Number(await stage.getAttribute("data-dreams"))).toBe(6);
  await expect(canvas).toHaveCount(1);
  await expect(poster).toHaveCount(1);
  await expect(stage.locator('img[src*="sky-whale"]')).toHaveCount(1);
  await expect(stage.locator(".dream-archive-grid, .dream-archive-tile, .dream-archive-meta")).toHaveCount(0);
  expect(await poster.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThanOrEqual(900);
  await expect(enter).toBeFocused();

  await expect(stage).toHaveAttribute("data-build", "settled", { timeout: 9_000 });
  const rendering = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const bounds = canvasElement.getBoundingClientRect();
    return {
      cssOpacity: Number.parseFloat(getComputedStyle(canvasElement).opacity),
      pixelWidth: canvasElement.width,
      pixelHeight: canvasElement.height,
      width: bounds.width,
      height: bounds.height
    };
  });
  expect(rendering.cssOpacity).toBeGreaterThanOrEqual(0.99);
  expect(rendering.pixelWidth).toBeGreaterThanOrEqual(rendering.width);
  expect(rendering.pixelHeight).toBeGreaterThanOrEqual(rendering.height);
  expect(Number.parseFloat(await poster.evaluate((element) => getComputedStyle(element).opacity))).toBeLessThanOrEqual(0.05);

  const metrics = await intro.evaluate((element) => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    height: element.getBoundingClientRect().height,
    viewportHeight: window.innerHeight
  }));
  expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.height).toBeGreaterThanOrEqual(metrics.viewportHeight - 1);
  expect(await enter.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

  const introCopy = [
    intro.getByText("가입 없이 첫 해석 무료", { exact: true }),
    intro.getByRole("heading", { name: /마음에 남은 꿈/ }),
    intro.getByText(/기억나는 장면과 기분만 적어도 괜찮아요/),
    enter
  ];
  for (const item of introCopy) {
    await expect(item).toBeVisible();
    const box = await item.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(metrics.viewportHeight + 1);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    }
  }

  await enter.click();
  await expect(intro).toHaveCount(0, { timeout: 3_000 });
  await expect(page.getByRole("heading", { name: "무슨 꿈을 꾸셨나요?" })).toBeInViewport();
  await expect(page.getByLabel("꿈 이야기")).toBeVisible();
});

test("intro copy stays inside a short landscape viewport", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/?intro=1&viewport=short-landscape");

  const intro = page.getByRole("dialog", { name: /마음에 남은 꿈/ });
  const items = [
    intro.getByText("가입 없이 첫 해석 무료", { exact: true }),
    intro.getByRole("heading", { name: /마음에 남은 꿈/ }),
    intro.getByText(/기억나는 장면과 기분만 적어도 괜찮아요/),
    intro.getByRole("button", { name: "내 꿈 해석해보기" })
  ];
  for (const item of items) {
    await expect(item).toBeVisible();
    const box = await item.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(845);
      expect(box.y + box.height).toBeLessThanOrEqual(391);
    }
  }
});

test("dream archive keeps a complete static composition for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?intro=1");

  const stage = page.locator(".dream-archive-stage");
  const canvas = stage.locator(".dream-observatory-canvas");
  const poster = stage.locator(".dream-observatory-poster");
  await expect(stage).toHaveAttribute("data-rendered", "true");
  await expect(stage).toHaveAttribute("data-scene", "dream-observatory");
  await expect(stage).toHaveAttribute("data-motion-profile", "assembled-spatial-v1");
  await expect(stage).toHaveAttribute("data-motion", "reduced");
  await expect(stage).toHaveAttribute("data-renderer", "fallback");
  expect(await canvas.evaluate((element) => getComputedStyle(element).display)).toBe("none");
  expect(await canvas.evaluate((element) => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height }))).toEqual({ width: 300, height: 150 });
  expect(Number.parseFloat(await poster.evaluate((element) => getComputedStyle(element).opacity))).toBe(1);
  expect(await poster.locator("img").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
});

test("landing input is mobile-safe, optional-context friendly, and keyboard accessible", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("여운 — 꿈이 남긴 마음을 읽는 해몽");
  const root = page.locator('[data-design-source="design-preview-golden-master"]');
  await expect(root).toBeVisible();
  await expect(root.getByRole("link", { name: "여운 홈" })).toBeVisible();
  await expect(root.getByRole("heading", { name: "무슨 꿈을 꾸셨나요?" })).toBeVisible();
  await expect(root.getByText(/마음에 남은 장면을 들려주세요/)).toBeVisible();
  await expect(root.locator(".app-header, .site-footer")).toHaveCount(0);
  const textarea = page.getByLabel("꿈 이야기");
  const submit = page.locator("#dream-input button[type='submit']");
  const helpers = page.locator("#dream-input details");
  await expect(helpers).not.toHaveAttribute("open", "");
  await helpers.locator("summary").click();
  const focus = page.getByRole("button", { name: "최근 사건의 영향", exact: true });
  await expect(focus).toHaveAttribute("aria-pressed", "false");
  await focus.click();
  await expect(focus).toHaveAttribute("aria-pressed", "true");
  await expect(submit).toHaveAccessibleName("무료로 꿈 해석 보기");
  await focus.click();
  await expect(submit).toHaveAccessibleName("무료로 꿈 해석 보기");
  await expect(textarea).toBeVisible();
  await expect(submit).toBeDisabled();

  const metrics = await textarea.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    };
  });
  expect(metrics.fontSize).toBeGreaterThanOrEqual(16);
  expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);

  await textarea.fill("뱀이 나오는 꿈");
  await expect(submit).toBeEnabled();
  await textarea.fill("뱀이 나왔는데 무섭지만 잠시 바라보다가 문을 닫았어요.");
  await expect(submit).toBeEnabled();
  expect(await submit.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

  const footer = root.locator("footer");
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole("heading", { name: "사업자 정보" })).toBeVisible();
  await expect(footer.locator("dd").first()).not.toBeEmpty();
  await expect(footer.getByText("통신판매업 신고번호", { exact: true })).toBeVisible();
  await expect(footer.getByText("고객센터 전화", { exact: true })).toBeVisible();
  await expect(footer.getByRole("link", { name: "이용약관" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "개인정보처리방침" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "환불정책" })).toBeVisible();
});

test("selected focus reaches the API and becomes the first free answer", async ({ page }) => {
  await page.goto("/");
  await page.locator("#dream-input summary").click();
  await page.getByRole("button", { name: "좋은 꿈·나쁜 꿈?" }).click();
  await page.getByLabel("꿈 이야기").fill(detailedDream);

  const requestPromise = page.waitForRequest(
    (request) => request.url().endsWith("/api/readings") && request.method() === "POST"
  );
  await page.getByRole("button", { name: "무료로 꿈 해석 보기" }).click();
  const request = await requestPromise;

  expect(request.postDataJSON()).toMatchObject({ focus: "good_or_bad" });
  await expect(page.getByRole("heading", { name: "뱀의 상징" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /상징 풀이보다/ })).toHaveCount(0);
});

test("a created reading gets its own route and browser back returns to dream input", async ({ page }) => {
  let recoveryRequests = 0;
  await page.route("**/api/readings/**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    recoveryRequests += 1;
    await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("꿈 이야기").fill(detailedDream);
  await page.getByRole("button", { name: "무료로 꿈 해석 보기" }).click();

  await expect(page).toHaveURL(/\/reading\/[^?]+\?token=/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "무료 첫 해석" })).toBeVisible({ timeout: 15_000 });
  expect(recoveryRequests).toBeGreaterThan(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("꿈 이야기")).toBeVisible();
  await expect(page.getByLabel("꿈 이야기")).toHaveValue(detailedDream);
});

test("review account opens the protected product selection and a separate checkout popup", async ({ page }) => {
  test.skip(process.env.APP_PROFILE !== "review", "Product authentication is enabled only in the review profile.");
  await page.goto("/products");
  await expect(page).toHaveURL(/\/login\?next=%2Fproducts|\/login\?next=\/products/);
  await page.getByLabel("아이디").fill("test");
  await page.getByLabel("비밀번호").fill("test");
  await page.getByRole("button", { name: /로그인하고 상품 보기/ }).click();

  await expect(page).toHaveURL(/\/products$/);
  await expect(page.getByRole("heading", { name: /필요한 만큼만/ })).toBeVisible();
  await expect(page.getByText("로그인 계정", { exact: true })).toBeVisible();
  const firstProduct = page.locator(".review-product-grid article").first();
  await expect(firstProduct.getByRole("heading", { name: "상세 해몽 + 질문 2회" })).toBeVisible();
  await firstProduct.getByRole("button", { name: "이 상품 선택" }).click();

  const dialog = page.getByRole("dialog", { name: "상세 해몽 + 질문 2회" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("최종 결제금액")).toBeVisible();
  await expect(dialog.getByText("990원", { exact: true }).last()).toBeVisible();
  const checkoutButton = dialog.getByRole("button", { name: /결제창 팝업 열기/ });
  await expect(checkoutButton).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /이용약관.*환불정책/ }).check();
  await expect(checkoutButton).toBeEnabled();

  const popupPromise = page.waitForEvent("popup");
  await checkoutButton.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup.getByText("결제 정보 확인")).toBeVisible();
  await expect(popup.getByRole("heading", { name: "상세 해몽 + 질문 2회" })).toBeVisible();
  await expect(popup.getByRole("button", { name: "990원 결제 준비 중" })).toBeDisabled();
  await expect(popup.getByRole("link", { name: "이용약관" })).toBeVisible();
  await expect(popup.getByRole("link", { name: "개인정보처리방침" })).toBeVisible();
  await expect(popup.getByRole("link", { name: "환불정책" })).toBeVisible();
  await popup.close();
});

test("review checkout in the real dream flow requires login and returns to the same result", async ({ page }) => {
  test.skip(process.env.APP_PROFILE !== "review", "This flow is active only in the Vercel review profile.");

  await page.goto("/");
  await expect(page.getByRole("link", { name: "로그인" })).toBeVisible();
  await page.getByLabel("꿈 이야기").fill(detailedDream);
  await page.getByRole("button", { name: "무료로 꿈 해석 보기" }).click();

  await expect(page.getByRole("heading", { name: "무료 첫 해석" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "로그인 후 상세 해몽 · 990원" })).toBeVisible();

  const readingUrl = page.url();
  const readingId = new URL(readingUrl).pathname.split("/").at(-1);
  const restoreToken = new URL(readingUrl).searchParams.get("token");
  if (!readingId || !restoreToken) throw new Error("Missing reading route credentials");

  const rejectedOrder = await page.evaluate(async ({ readingId, restoreToken }) => {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readingId, restoreToken, product: "full_reading", contentConsent: true })
    });
    return { status: response.status, body: await response.json() };
  }, { readingId, restoreToken });
  expect(rejectedOrder.status).toBe(401);
  expect(rejectedOrder.body).toMatchObject({ error: { code: "AUTH_REQUIRED" } });

  // A cached first paint is followed by server revalidation, so stale offers
  // cannot bypass the current fact-confirmation and payment eligibility.

  await page.getByRole("button", { name: "로그인 후 상세 해몽 · 990원" }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("아이디").fill("test");
  await page.getByLabel("비밀번호").fill("test");
  await page.getByRole("button", { name: /로그인하고 상품 보기/ }).click();

  await expect(page).toHaveURL(new RegExp(`/reading/${readingId}\\?.*checkout=full_reading`));
  await expect(page.getByRole("heading", { name: "무료 첫 해석" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();

  await expect(page.getByRole("dialog", { name: "상세 해몽 + 질문 2회" })).toBeVisible();
});

test("free answer, full reading, 2+2 questions, and deletion stay in one consultation timeline", async ({ page, request }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("꿈 이야기").fill(detailedDream);
  await page.getByRole("button", { name: "무료로 꿈 해석 보기" }).click();

  await expect(page.getByRole("heading", { name: "무료 첫 해석" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "뱀의 상징" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "집·방의 상징" })).toBeVisible();
  await expect(page.locator(".timeline-entry--free")).not.toContainText("꿈만으로 확실히 말할 수 없는 부분");
  const directAnswerPosition = await page.locator(".timeline-entry--free .direct-answer").boundingBox();
  expect(directAnswerPosition!.y).toBeLessThan((page.viewportSize()?.height ?? 844) / 2);
  await expect(page.locator(".reading-source")).not.toHaveAttribute("open", "");
  await page.locator(".reading-source summary").click();
  const dreamRecord = page.locator(".timeline-entry--user .user-record").first();
  const dreamToggle = page.getByRole("button", { name: "기억한 꿈 전체 내용 보기" });
  await expect(dreamToggle).toHaveAttribute("aria-expanded", "false");
  expect(await dreamRecord.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(150);
  expect(await dreamRecord.locator(".user-record-text").evaluate((element) => getComputedStyle(element).webkitLineClamp)).toBe("2");
  await dreamToggle.click();
  await expect(page.getByRole("button", { name: "기억한 꿈 접기" })).toHaveAttribute("aria-expanded", "true");
  await expect(dreamRecord.locator(".user-record-text")).toHaveClass(/is-expanded/);
  await page.getByRole("button", { name: "기억한 꿈 접기" }).click();
  await page.locator(".reading-source summary").click();
  const answerMetrics = await page.locator(".timeline-entry--free").evaluate((element) => {
    const directAnswer = element.querySelector(".direct-answer p");
    if (!directAnswer) throw new Error("Missing direct answer");
    const style = getComputedStyle(directAnswer);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    };
  });
  expect(answerMetrics.fontSize).toBeGreaterThanOrEqual(16);
  expect(answerMetrics.lineHeight / answerMetrics.fontSize).toBeGreaterThanOrEqual(1.7);
  expect(answerMetrics.pageWidth).toBeLessThanOrEqual(answerMetrics.viewportWidth + 1);
  const deepReadingOffer = page.getByRole("region", { name: "확인한 내용으로 이 꿈을 함께 읽어볼까요?" });
  await expect(deepReadingOffer).toBeVisible();
  await expect(deepReadingOffer.getByText("테스트 결제 · 실제 청구 없음", { exact: true })).toBeVisible();
  await expect(deepReadingOffer.getByRole("button", { name: "확인한 장면을 하나의 이야기로 읽기" })).toBeVisible();
  const jsonContractResponse = await request.post("/api/readings", {
    data: { dream: detailedDream, emotion: null }
  });
  expect(jsonContractResponse.status()).toBe(201);
  const jsonContractPayload = await jsonContractResponse.json();
  expect(JSON.stringify(jsonContractPayload)).not.toContain("detailed");
  expect(JSON.stringify(jsonContractPayload)).not.toContain("꿈이 움직인 방향");
  if (process.env.CAPTURE_VISUALS === "1") {
    await page.screenshot({ path: testInfo.outputPath("free-timeline.png"), fullPage: true });
  }

  await page.getByRole("button", { name: /상세 해몽 테스트하기/ }).click();
  const fullDialog = page.getByRole("dialog", { name: "상세 해몽 + 질문 2회" });
  await expect(fullDialog).toBeVisible();
  await expect(fullDialog.getByText("₩990")).toBeVisible();
  await expect(fullDialog.getByText(/중복결제·미제공·기술 오류 전액 환불/)).toBeVisible();
  await expect(fullDialog.getByText(/자동결제 없음/)).toHaveCount(0);
  await expect(fullDialog.getByText(/카드 정보 입력이나 실제 청구 없이 진행돼요/)).toBeVisible();
  await expect(fullDialog.getByRole("button", { name: /테스트 결제로 상세 풀이 보기/ })).toBeDisabled();
  await fullDialog.getByRole("checkbox").check();
  await fullDialog.getByRole("button", { name: /테스트 결제로 상세 풀이 보기/ }).click();

  await expect(page.getByRole("heading", { name: "상세 해몽" })).toBeVisible({ timeout: 15_000 });
  const composer = page.getByLabel("꿈에 대해 이어서 질문하기");
  await expect(composer).toBeVisible();
  await expect(page.getByText("남은 질문 2회", { exact: true })).toBeVisible();
  const composerMetrics = await composer.evaluate((element) => {
    const style = getComputedStyle(element);
    const send = element.parentElement?.querySelector("button");
    return {
      fontSize: Number.parseFloat(style.fontSize),
      sendHeight: send?.getBoundingClientRect().height ?? 0,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    };
  });
  expect(composerMetrics.fontSize).toBeGreaterThanOrEqual(16);
  expect(composerMetrics.sendHeight).toBeGreaterThanOrEqual(44);
  expect(composerMetrics.pageWidth).toBeLessThanOrEqual(composerMetrics.viewportWidth + 1);
  if (process.env.CAPTURE_VISUALS === "1") {
    await page.screenshot({ path: testInfo.outputPath("paid-composer.png"), fullPage: true });
  }

  await composer.fill("한글 조합 중");
  await composer.dispatchEvent("compositionstart");
  await composer.press("Enter");
  expect(await composer.inputValue()).toContain("한글 조합 중");
  await expect(page.getByText("남은 질문 2회", { exact: true })).toBeVisible();
  await composer.dispatchEvent("compositionend");

  await composer.fill("현실의 일과 연결해줘");
  await page.getByRole("button", { name: "질문 보내기" }).click();
  await expect(page.getByRole("heading", { name: "이어진 답변" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("남은 질문 1회", { exact: true })).toBeVisible();

  await composer.fill("관계에 대한 꿈인지 봐줘");
  await page.getByRole("button", { name: "질문 보내기" }).click();
  await expect(page.getByRole("button", { name: "질문 2회 더 이어가기 · 990원" })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "질문 2회 더 이어가기 · 990원" }).click();
  const packDialog = page.getByRole("dialog", { name: "질문 2회 더 이어가기" });
  await packDialog.getByRole("checkbox").check();
  await page.route("**/api/orders", (route) => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { message: "결제 연결을 다시 확인해 주세요." } })
  }));
  await packDialog.getByRole("button", { name: /테스트 결제로 질문 2회 열기/ }).click();
  await expect(packDialog.getByRole("alert")).toContainText("결제 연결을 다시 확인해 주세요.");
  await expect(packDialog).toBeVisible();
  await page.unroute("**/api/orders");
  await packDialog.getByRole("button", { name: /테스트 결제로 질문 2회 열기/ }).click();
  await expect(page.getByText("남은 질문 2회", { exact: true })).toBeVisible({ timeout: 15_000 });

  await composer.fill("처음 해석과 달라진 점을 말해줘");
  await page.getByRole("button", { name: "질문 보내기" }).click();
  await expect(page.getByText("남은 질문 1회", { exact: true })).toBeVisible();

  await composer.fill("마지막으로 기억할 한마디를 써줘");
  await page.getByRole("button", { name: "질문 보내기" }).click();
  await expect(page.getByRole("link", { name: /새 꿈으로 시작하기/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("그대로 전해도 되는 문장")).toBeVisible();

  await page.getByRole("button", { name: "기록 삭제" }).click();
  await expect(page.getByText(/모두 삭제하며 복구할 수 없어요/)).toBeVisible();
  await page.getByRole("button", { name: "영구 삭제" }).click();
  await expect(page).toHaveURL(/\/?deleted=1$/);
  await expect(page.getByLabel("꿈 이야기")).toBeVisible();
});

test("preview browsing precedes checkout, consent gates payment, and closing returns focus", async ({ page }) => {
  let orders = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/orders")) orders += 1; });
  await page.goto("/");
  await page.getByLabel("꿈 이야기").fill(detailedDream);
  await page.getByRole("button", { name: "무료로 꿈 해석 보기" }).click();
  await expect(page.getByRole("heading", { name: "무료 첫 해석", exact: true })).toBeVisible();
  const previews = page.locator(".preview-ledger article > button");
  await expect(previews.first()).toHaveAttribute("aria-expanded", "true");
  await previews.nth(1).click();
  await expect(previews.first()).toHaveAttribute("aria-expanded", "false");
  await expect(previews.nth(1)).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(orders).toBe(0);

  const checkoutButton = page.getByRole("button", { name: "상세 해몽 테스트하기", exact: true });
  await checkoutButton.click();
  const dialog = page.getByRole("dialog", { name: "상세 해몽 + 질문 2회" });
  await expect(dialog.getByRole("button", { name: "테스트 결제로 상세 풀이 보기" })).toBeDisabled();
  const close = dialog.getByRole("button", { name: "결제 요약 닫기" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("link", { name: "환불 기준 보기" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(checkoutButton).toBeFocused();
  expect(orders).toBe(0);
  await page.getByRole("link", { name: "새 꿈 시작" }).click();
  await expect(page.getByLabel("꿈 이야기")).toHaveValue("");
});

test("relationship fear becomes specific remaining questions without hiding the free verdict", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("꿈 이야기").fill(relationshipDream);
  await page.getByRole("button", { name: "무료로 꿈 해석 보기" }).click();

  await expect(page.getByRole("heading", { name: "무료 첫 해석" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "뒤바뀐 사람·보이지 않는 얼굴의 상징" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "그 사람의 현재 안전도 함께 확인해 주세요" })).toBeVisible();

  const offer = page.getByRole("region", { name: "확인한 내용으로 이 꿈을 함께 읽어볼까요?" });
  await expect(offer).toBeVisible();
  await expect(offer.getByRole("button", { name: "확인한 장면을 하나의 이야기로 읽기" })).toBeVisible();
  const realityPreview = offer.getByRole("button",{name:"알려준 현실 상황과의 연결"});
  const realityPreviewTitle = await realityPreview.innerText();
  await expect(offer.getByRole("button", { name: "비슷한 해석과 무엇이 다른지" })).toBeVisible();
  await expect(offer.getByRole("list", { name: "결제 안내" })).toHaveCount(0);
  await expect(offer.getByText("안전 안내는 항상 무료", { exact: true })).toHaveCount(0);

  if (process.env.CAPTURE_VISUALS === "1") {
    await page.screenshot({ path: testInfo.outputPath("relationship-offer.png"), fullPage: true });
  }

  await realityPreview.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(realityPreview).toHaveAttribute("aria-expanded", "true");
  await offer.getByRole("button", { name: "상세 해몽 테스트하기", exact: true }).click();
  const checkout = page.getByRole("dialog", { name: "상세 해몽 + 질문 2회" });
  await expect(checkout).toBeVisible();
  await expect(checkout.getByText("관심 있게 본 내용 · 전체 풀이에 포함돼요", { exact: true })).toBeVisible();
  await expect(checkout.getByText(realityPreviewTitle, { exact: true })).toBeVisible();

  if (process.env.CAPTURE_VISUALS === "1") {
    await page.screenshot({ path: testInfo.outputPath("relationship-checkout.png"), fullPage: true });
  }
});

test("missing symbols ask for a detail without presenting the question as an interpretation", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("꿈 이야기").fill("기억이 안 나요");
  await page.getByRole("button", { name: "무료로 꿈 해석 보기" }).click();
  await expect(page.getByRole("heading", { name: "꿈에 무엇이 나왔나요?" })).toBeVisible();
  await expect(page.locator(".timeline-entry--free")).toHaveCount(0);
  await expect(page.locator(".deep-reading-offer")).toHaveCount(0);
  await page.getByRole("button", { name: "확인 질문에 답하기" }).click();
  await page.getByLabel("확인 질문 답변 또는 추가 내용").fill("뱀이 나왔어");
  await page.getByRole("button", { name: "답변 반영하기",exact:true }).click();
  await expect(page.getByRole("heading", { name: "뱀의 상징" })).toBeVisible();
  await expect(page.locator(".direct-answer")).toContainText("경계");
});

test("short dream shows a free preview, accepts more detail, and then offers checkout", async ({ page, request }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("꿈 이야기").fill("뱀이 나왔어");
  await page.getByRole("button", { name: "무료로 꿈 해석 보기" }).click();
  await expect(page.getByRole("heading", { name: "무료 첫 해석", exact: true })).toBeVisible();
  await expect(page.locator(".timeline-entry--free")).toContainText("뱀");
  await expect(page.locator(".deep-reading-offer")).toHaveCount(0);
  await expect(page.locator("#clarification-title")).toHaveCount(0);
  const originalUrl = page.url();
  const readingId = new URL(originalUrl).pathname.split("/").at(-1)!;
  const token = new URL(originalUrl).searchParams.get("token")!;
  const denied = await request.post(`/api/readings/${readingId}/details`, { data: { detail: "무서웠어요" } });
  expect(denied.status()).toBe(403);
  const deniedOrder = await page.evaluate(async ({ readingId, token }) => {
    const response = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ readingId, restoreToken: token, product: "full_reading", contentConsent: true }) });
    return { status: response.status, body: await response.json() };
  }, { readingId, token });
  expect(deniedOrder).toMatchObject({ status: 409, body: { error: { code: "MORE_DREAM_DETAIL_REQUIRED" } } });
  if (process.env.CAPTURE_VISUALS === "1") await page.screenshot({ path: testInfo.outputPath("brief-free.png"), fullPage: true });
  await page.getByRole("button", { name: "확인 질문에 답하기" }).click();
  const detail = page.getByLabel("확인 질문 답변 또는 추가 내용");
  await expect(detail).toBeFocused();
  await expect(page.getByRole("button", { name: "답변 반영하기",exact:true })).toBeDisabled();
  await detail.fill("처음에는 무서워서 바라봤어요. 문을 열어 밖으로 내보냈고 마지막에는 편안해졌어요.");
  await page.route("**/api/readings/*/details", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "잠시 후 다시 시도해 주세요." } }) }));
  await page.getByRole("button", { name: "답변 반영하기",exact:true }).click();
  await expect(page.locator(".free-detail [role=alert]")).toBeVisible();
  await expect(detail).toHaveValue(/편안해졌어요/);
  await expect(page.locator(".direct-answer")).toContainText("뱀");
  await page.unroute("**/api/readings/*/details");
  if (process.env.CAPTURE_VISUALS === "1") await page.screenshot({ path: testInfo.outputPath("free-detail-form.png"), fullPage: true });
  await page.getByRole("button", { name: "답변 반영하기",exact:true }).click();
  await expect(page).not.toHaveURL(originalUrl);
  await expect(page.locator(".timeline-entry--free")).toHaveCount(1);
  await expect(page.locator(".direct-answer")).toContainText("뱀");
  await expect(page.getByRole("button", { name: "상세 해몽 테스트하기", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".direct-answer")).toContainText("뱀");
  await page.locator(".reading-source > summary").click();
  await expect(page.locator(".reading-source")).toContainText("밖으로 내보냈고");
  if (process.env.CAPTURE_VISUALS === "1") await page.screenshot({ path: testInfo.outputPath("enriched-free.png"), fullPage: true });
  await page.getByRole("button", { name: "상세 해몽 테스트하기", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "테스트 결제로 상세 풀이 보기" }).click();
  await expect(page.getByRole("heading", { name: "상세 해몽", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "사실 정정·오류 수정" })).toBeVisible();
});

test("a recovery token grants only the matching reading and pre-payment DTO stays filtered", async ({ page, request }) => {
  await page.goto("/");
  const created = await page.evaluate(async (dream) => {
    const response = await fetch("/api/readings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ dream, emotion: null })
    });
    return response.json() as Promise<{ reading?: { id: string; restoreUrl: string } }>;
  }, detailedDream);
  if (!created?.reading) throw new Error("Missing reading creation response");

  const token = new URL(created.reading.restoreUrl).searchParams.get("token");
  if (!token) throw new Error("Missing restore token");
  const path = `/api/readings/${encodeURIComponent(created.reading.id)}`;
  const denied = await request.get(path);
  expect(denied.status()).toBe(403);

  const restored = await request.get(`${path}?token=${encodeURIComponent(token)}`);
  expect(restored.status()).toBe(200);
  const body = await restored.json();
  expect(JSON.stringify(body)).not.toContain('"kind":"detailed"');
  expect(JSON.stringify(body)).not.toContain('"kind":"followup"');

  const wrongToken = await request.get(`${path}?token=${encodeURIComponent(`${token}x`)}`);
  expect(wrongToken.status()).toBe(403);
});

test("immediate-risk language shows free support before interpretation or payment", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("꿈 이야기").fill("악몽에서 깬 뒤에도 지금 죽고 싶다는 생각이 계속 들고 혼자 있어요.");
  await page.getByRole("button", { name: "무료로 꿈 해석 보기" }).click();

  await expect(page.getByRole("heading", { name: "해몽보다 지금의 안전을 먼저 살필게요" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: /24시간 자살예방 상담전화.*109/ })).toHaveAttribute("href", "tel:109");
  await expect(page.getByRole("button", { name: /상세 해몽 테스트하기/ })).toHaveCount(0);
  await expect(page.getByText(/결제 여부와 관계없이/)).toBeVisible();
});

test("third-party danger is distinguished from the dreamer and does not assert direct causation", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("꿈 이야기").fill(
    "이건 제 꿈이 아니라 친구가 꾼 꿈이에요. 친구가 최근 지인의 가정폭력 이야기를 들은 뒤 어두운 집에서 문을 잠그는 꿈을 꾸었고 무서웠대요."
  );
  await page.getByRole("button", { name: "무료로 꿈 해석 보기" }).click();

  const skip = page.getByRole("button", { name: "이 내용만으로 무료 해석 보기" });
  while (await skip.count()) {
    if (!(await skip.isVisible())) break;
    await skip.click();
    await page.waitForTimeout(50);
  }

  await expect(page.getByRole("heading", { name: "그 사람의 현재 안전도 함께 확인해 주세요" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: /여성긴급전화.*1366/ })).toHaveAttribute("href", "tel:1366");
  await expect(page.getByText(/직접적인 인과를 확정할 수는 없어요/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "무료 첫 해석" })).toBeVisible();
});
