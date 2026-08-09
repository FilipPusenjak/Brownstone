"use client";

import { useState, useTransition } from "react";
import { Button, Field, textareaClass } from "~/components/patterns/Button";
import { ACTION_LABEL, type ApprovalAction } from "~/lib/primitives/approvals";
import { actOnAlterationAction, commentAction } from "./actions";

/**
 * The decision panel and the comment thread.
 *
 * Which buttons appear comes from the shared approval state machine, computed
 * on the server and passed in, so the interface can never offer an action the
 * server would refuse. A denied request shows no buttons at all — a decision is
 * a record, not a setting.
 */
export function AlterationPanel({
  buildingSlug,
  alterationId,
  actions,
}: {
  buildingSlug: string;
  alterationId: string;
  actions: ApprovalAction[];
}) {
  const [open, setOpen] = useState<ApprovalAction | null>(null);
  const [note, setNote] = useState("");
  const [conditions, setConditions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function run(action: ApprovalAction): void {
    setError(null);
    setFieldError({});
    startTransition(async () => {
      const result = await actOnAlterationAction({
        buildingSlug,
        alterationId,
        action,
        note: note || null,
        conditions: conditions || null,
      });
      if (result.ok) {
        setOpen(null);
        setNote("");
        setConditions("");
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  return (
    <div className={actions.length === 0 ? "" : "mb-8"}>
      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      {actions.length === 0 ? null : open === null ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action}
              intent={
                action === "approve" || action === "approveWithConditions"
                  ? "primary"
                  : action === "deny"
                    ? "destructive"
                    : "secondary"
              }
              disabled={pending}
              onClick={() => (action === "startReview" ? run(action) : setOpen(action))}
            >
              {ACTION_LABEL[action]}
            </Button>
          ))}
        </div>
      ) : (
        <div className="sheet px-4 py-3">
          <p className="text-ironwork mb-3 text-sm font-medium">{ACTION_LABEL[open]}</p>

          {open === "approveWithConditions" ? (
            <Field
              label="Conditions"
              hint="These are the operative part of the decision — work hours, insurance, protection of common areas."
              error={fieldError["conditions"]}
            >
              <textarea
                rows={3}
                value={conditions}
                onChange={(event) => setConditions(event.target.value)}
                className={textareaClass}
                placeholder="Work between 9am and 5pm on weekdays only. Mover's COI naming the corporation on file before the first delivery."
              />
            </Field>
          ) : null}

          <div className={open === "approveWithConditions" ? "mt-3" : ""}>
            <Field
              label="Note"
              hint="Recorded with the decision, and visible to the shareholder."
            >
              <textarea
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className={textareaClass}
              />
            </Field>
          </div>

          <div className="mt-3 flex gap-2">
            <Button
              intent={open === "deny" ? "destructive" : "primary"}
              size="sm"
              disabled={pending}
              onClick={() => run(open)}
            >
              {pending ? "Recording…" : ACTION_LABEL[open]}
            </Button>
            <Button intent="quiet" size="sm" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Kept out of the decision panel and rendered with the thread instead. A reply
 * box floating three sections above the conversation it belongs to is the sort
 * of thing that reads as an unfinished page.
 */
export function CommentBox({
  buildingSlug,
  alterationId,
  canCommentInternally,
}: {
  buildingSlug: string;
  alterationId: string;
  canCommentInternally: boolean;
}) {
  const [body, setBody] = useState("");
  const [boardOnly, setBoardOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function post(): void {
    setError(null);
    startTransition(async () => {
      const result = await commentAction({
        buildingSlug,
        alterationId,
        body,
        boardOnly,
      });
      if (result.ok) {
        setBody("");
        setBoardOnly(false);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div className="mt-6">
      <Field label="Add a comment">
        <textarea
          rows={2}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className={textareaClass}
          placeholder="Ask a question, or record what was agreed."
        />
      </Field>

      <div className="mt-2 flex flex-wrap items-center gap-4">
        <Button size="sm" disabled={pending || body.trim().length === 0} onClick={post}>
          {pending ? "Posting…" : "Post comment"}
        </Button>

        {canCommentInternally ? (
          <label className="text-ironwork-soft flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={boardOnly}
              onChange={(event) => setBoardOnly(event.target.checked)}
              className="size-4 accent-[#0b6e62]"
            />
            {/* Boards need somewhere to say "ask about the riser" without it
                reading as a decision. */}
            Board only — the shareholder won&rsquo;t see this
          </label>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-stamp mt-1.5 text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
