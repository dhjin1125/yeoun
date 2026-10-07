import { Check, ChevronRight } from "lucide-react";
import styles from "./reading-steps.module.css";

export function ReadingSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className={styles.steps} aria-label="꿈 해석 진행 단계">
      {["꿈 기록", "무료 해석", "상세 해몽"].map((label, index) => (
        <li key={label} aria-current={current === index + 1 ? "step" : undefined}>
          <span className={styles.number} aria-hidden="true">
            {current > index + 1 ? <Check size={12} /> : index + 1}
          </span>
          <span>{label}{index === 2 && current !== 3 ? <small>선택</small> : null}</span>
          {index < 2 ? <ChevronRight className={styles.separator} size={12} aria-hidden="true" /> : null}
        </li>
      ))}
    </ol>
  );
}
