import { afterEach, describe, expect, it, vi } from "vitest";
import { businessInfo } from "@/lib/business-info";
afterEach(() => vi.unstubAllEnvs());
describe("public operator identity", () => {
  it.each(["production", "development"])("uses Nodeoff identity in %s despite obsolete environment overrides", (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("BUSINESS_NAME", "obsolete operator");
    vi.stubEnv("BUSINESS_EMAIL", "obsolete@example.test");
    for (const variant of ["true", "false"]) {
      vi.stubEnv("NODEOFF_REVIEW_SITE", variant);
      expect(businessInfo()).toEqual({name:"노드오프",representative:"진동현",registrationNumber:"502-60-03676",address:"인천광역시",phone:"",email:"jin@nodeoff.kr",mailOrderRegistrationNumber:"",complete:false});
    }
  });
});
