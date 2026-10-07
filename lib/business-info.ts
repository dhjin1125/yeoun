import "server-only";

/** Confirmed public operator details, shared by all deployment variants. */
const NODEOFF_BUSINESS_INFO = {
  name: "노드오프",
  representative: "진동현",
  registrationNumber: "502-60-03676",
  address: "인천광역시",
  phone: "",
  email: "jin@nodeoff.kr",
  mailOrderRegistrationNumber: ""
};

export type BusinessInfo = ReturnType<typeof businessInfo>;
export function businessInfo() {
  return { ...NODEOFF_BUSINESS_INFO, complete: false };
}
