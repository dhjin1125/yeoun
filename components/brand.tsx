import Link from "next/link";

export function DreamMark({ size = 38 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="dream-mark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
    >
      <path
        d="M30.8 10.7c-5.1 1.8-8.7 6.7-8.7 12.4 0 7.2 5.8 13 13 13 1 0 2-.1 3-.4A15.4 15.4 0 1 1 30.8 10.7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="36.5" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function BrandLink() {
  return (
    <Link className="brand-link" href="/" aria-label="여운 홈">
      <DreamMark size={32} />
      <span>
        <strong>여운</strong>
        <small>꿈이 남긴 마음을 읽다</small>
      </span>
    </Link>
  );
}
