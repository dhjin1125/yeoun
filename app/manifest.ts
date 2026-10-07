import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "여운 — 꿈이 남긴 마음을 읽는 해몽",
    short_name: "여운",
    description: "확인한 꿈의 장면과 답변을 바탕으로 의미를 함께 읽는 개인화 꿈 해몽",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f0e5",
    theme_color: "#173c37",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }]
  };
}
