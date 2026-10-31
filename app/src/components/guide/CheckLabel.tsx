import type { InputHTMLAttributes, ReactNode } from "react";

type CheckLabelProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  children: ReactNode;
};

/** Checkbox with the preview's square style (`.chk`). */
export function CheckLabel({ children, className = "", ...input }: CheckLabelProps) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-2 font-mono text-[11px] tracking-[0.06em] whitespace-nowrap text-text-3 uppercase ${className}`}
    >
      <input
        type="checkbox"
        className="m-0 grid size-[18px] cursor-pointer appearance-none place-items-center rounded-[2px] border border-line-2 checked:border-acc checked:bg-acc checked:after:block checked:after:h-[9px] checked:after:w-[5px] checked:after:translate-x-[-1px] checked:after:translate-y-[-1px] checked:after:rotate-45 checked:after:border-r-2 checked:after:border-b-2 checked:after:border-bg checked:after:content-['']"
        {...input}
      />
      {children}
    </label>
  );
}
