import { cva, type VariantProps } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

/**
 * Buttons.
 *
 * Three intents and nothing else. `primary` carries verdigris, the system
 * accent — so the page can have exactly one obvious next action. `destructive`
 * carries stamp red and is reserved for things a board cannot casually undo.
 * Everything else is quiet: ironwork text on a limestone hairline.
 *
 * A label says what happens: "Add to the calendar", not "Submit". The action
 * keeps its name through the whole flow.
 */
const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-sheet border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55",
  {
    variants: {
      intent: {
        primary: "border-verdigris bg-verdigris text-white hover:bg-verdigris/90",
        secondary: "border-limestone-deep bg-paper text-ironwork hover:bg-paper-sunk",
        destructive: "border-stamp bg-transparent text-stamp hover:bg-stamp-soft",
        quiet:
          "border-transparent bg-transparent text-ironwork-soft underline underline-offset-4 hover:text-ironwork",
      },
      size: {
        sm: "px-2.5 py-1 text-xs",
        md: "px-3.5 py-2 text-sm",
      },
    },
    defaultVariants: { intent: "secondary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button>;

export function Button({ intent, size, className, ...props }: ButtonProps) {
  return <button className={twMerge(button({ intent, size }), className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="eyebrow mb-1.5 block">{label}</span>
      {children}
      {/* Errors say what happened and how to fix it, in the interface's voice.
          They never apologise and are never vague. */}
      {error ? (
        <span className="text-stamp mt-1 block text-xs">{error}</span>
      ) : hint ? (
        <span className="text-ironwork-faint mt-1 block text-xs">{hint}</span>
      ) : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-sheet border border-limestone-deep bg-white px-3 py-2 font-mono text-sm text-ironwork placeholder:text-ironwork-faint";

export const textareaClass =
  "w-full rounded-sheet border border-limestone-deep bg-white px-3 py-2 text-sm text-ironwork placeholder:text-ironwork-faint";
