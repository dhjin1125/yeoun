import { expect, test } from "playwright/test";

const routeFixtureDream =
  "검은 뱀이 집 창문으로 천천히 들어왔어요. 처음에는 무서웠지만 가만히 바라보다가 문을 열어 밖으로 내보냈고 마지막에는 마음이 편안해졌어요.";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("yeoun:intro:v2", "seen");
  });
});

test("post-intro home and reading route share the journal golden master", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");

  const restorePath = await page.evaluate(async (dream) => {
    const createResponse = await fetch("/api/readings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ dream, emotion: "무서웠어요" })
    });
    let body = (await createResponse.json()) as {
      reading?: {
        id: string;
        restoreUrl: string;
        currentQuestion: { id: string } | null;
      };
    };
    if (!createResponse.ok || !body.reading) throw new Error("Reading fixture creation failed");

    const token = new URL(body.reading.restoreUrl).searchParams.get("token");
    if (!token) throw new Error("Reading fixture token is missing");

    for (let index = 0; index < 2 && body.reading.currentQuestion; index += 1) {
      const clarificationResponse = await fetch(
        `/api/readings/${encodeURIComponent(body.reading.id)}/clarifications`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            questionId: body.reading.currentQuestion.id,
            answer: null,
            skipped: true,
            restoreToken: token
          })
        }
      );
      body = (await clarificationResponse.json()) as typeof body;
      if (!clarificationResponse.ok || !body.reading) {
        throw new Error("Reading fixture clarification failed");
      }
    }

    const restoreUrl = new URL(body.reading.restoreUrl);
    return `${restoreUrl.pathname}${restoreUrl.search}`;
  }, routeFixtureDream);

  await page.goto(restorePath);
  await expect(page.getByRole("heading", { name: "무료 첫 해석" })).toBeVisible({ timeout: 20_000 });

  const root = page.locator('[data-design-source="design-preview-golden-master"]');
  await expect(root).toBeVisible();
  await expect(root.locator(".app-header")).toHaveCount(0);
  await expect(root.getByRole("link", { name: "여운 홈" })).toBeVisible();
  const tagline = root.getByText("꿈을 기록하고 해석해요", { exact: true });
  if ((page.viewportSize()?.width ?? 0) > 720) await expect(tagline).toBeVisible();
  else await expect(tagline).toBeHidden();

  const metrics = await root.evaluate((element) => {
    const inspect = (target: HTMLElement) => {
      const style = getComputedStyle(target);
      return {
        width: target.getBoundingClientRect().width,
        background: style.backgroundColor,
        color: style.color,
        fontFamily: style.fontFamily,
        boxShadow: style.boxShadow
      };
    };
    const read = (selector: string) => {
      const target = element.querySelector<HTMLElement>(selector);
      if (!target) throw new Error(`Missing ${selector}`);
      return inspect(target);
    };
    return {
      page: inspect(element as HTMLElement),
      header: read(":scope > header"),
      shell: read(".consultation-shell"),
      heading: read(".consultation-intro h1"),
      timeline: read(".consultation-timeline"),
      answer: read(".direct-answer p"),
      action: read(".deep-reading-offer .primary-button"),
      footer: read("footer"),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    };
  });

  expect(metrics.page.background).toBe("rgb(245, 246, 244)");
  expect(metrics.heading.color).toBe("rgb(32, 35, 31)");
  expect(metrics.timeline.background).toBe("rgba(0, 0, 0, 0)");
  expect(metrics.timeline.boxShadow).toBe("none");
  expect(metrics.answer.fontFamily).toContain("Pretendard");
  expect(metrics.answer.fontFamily).not.toContain("Noto Serif");
  expect(metrics.action.background).toBe("rgb(49, 92, 77)");
  expect(metrics.footer.background).toBe("rgb(236, 239, 235)");
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);

  const viewportWidth = page.viewportSize()?.width ?? 0;
  expect(metrics.header.width).toBeCloseTo(viewportWidth > 720 ? 960 : viewportWidth - 32, 0);
  expect(metrics.shell.width).toBeCloseTo(viewportWidth > 720 ? 700 : viewportWidth - 32, 0);
  await expect(root.getByRole("heading", { name: "사업자 정보" })).toBeVisible();
  await expect(root.locator("footer dd").first()).not.toBeEmpty();

  await page.goto("/");
  const homeRoot = page.locator('[data-design-source="design-preview-golden-master"]');
  await expect(homeRoot).toBeVisible();
  await expect(homeRoot.getByRole("heading", { name: "무슨 꿈을 꾸셨나요?" })).toBeVisible();
  await expect(homeRoot.getByLabel("꿈 이야기")).toBeVisible();
  await expect(homeRoot.locator(".app-header, .site-footer")).toHaveCount(0);
});
