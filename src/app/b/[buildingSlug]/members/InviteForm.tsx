"use client";

import { useState, useTransition } from "react";
import type { Role } from "~/generated/prisma/enums";
import { Button, Field, inputClass, textareaClass } from "~/components/patterns/Button";
import { inviteMemberAction } from "./actions";

/**
 * Inviting a neighbour.
 *
 * Two roles offered by default, because that is the shape of a small co-op: a
 * person is a shareholder, and some of them are also an officer. The unit
 * picker matters — an invitation carrying a unit is what makes the new member's
 * own arrears and alteration requests visible to them and nobody else.
 */
export function InviteForm({
  buildingSlug,
  units,
  canAssignOfficerRoles,
}: {
  buildingSlug: string;
  units: Array<{ id: string; label: string }>;
  canAssignOfficerRoles: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [officer, setOfficer] = useState<Role | "">("");
  const [unitId, setUnitId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send(): void {
    setError(null);
    setFieldError({});
    setSentTo(null);
    setLink(null);

    const roles: Role[] = officer ? ["SHAREHOLDER", officer] : ["SHAREHOLDER"];

    startTransition(async () => {
      const result = await inviteMemberAction({
        buildingSlug,
        email,
        roles,
        unitIds: unitId ? [unitId] : [],
        note: note || null,
      });

      if (result.ok) {
        setSentTo(email);
        setLink(result.data.url);
        setEmail("");
        setOfficer("");
        setUnitId("");
        setNote("");
        setOpen(false);
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  return (
    <div>
      {sentTo ? (
        <div className="mb-4 border-l-2 border-complete-line bg-complete-soft px-3 py-2">
          <p className="text-sm text-ironwork">Invitation sent to {sentTo}.</p>
          {link ? (
            <p className="mt-1 text-xs text-ironwork-soft">
              If their mail bounces, you can pass this on by hand:{" "}
              <span className="font-mono break-all">{link}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mb-3 text-sm text-stamp">
          {error}
        </p>
      ) : null}

      {!open ? (
        <Button intent="primary" onClick={() => setOpen(true)}>
          Invite a neighbour
        </Button>
      ) : (
        <div className="sheet px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Email address"
              hint="The invitation only works for this address."
              error={fieldError["email"]}
            >
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
                placeholder="neighbour@example.com"
              />
            </Field>

            <Field label="Apartment" hint="So they can see their own records.">
              <select
                value={unitId}
                onChange={(event) => setUnitId(event.target.value)}
                className={inputClass}
              >
                <option value="">No apartment</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.label}
                  </option>
                ))}
              </select>
            </Field>

            {canAssignOfficerRoles ? (
              <Field
                label="Also an officer?"
                hint="Everyone is a shareholder. Officers get a second role."
                error={fieldError["roles"]}
              >
                <select
                  value={officer}
                  onChange={(event) => setOfficer(event.target.value as Role | "")}
                  className={inputClass}
                >
                  <option value="">No, just a shareholder</option>
                  <option value="PRESIDENT">President</option>
                  <option value="TREASURER">Treasurer</option>
                  <option value="SECRETARY">Secretary</option>
                  <option value="BOARD_MEMBER">Board member</option>
                  <option value="SUPER">Superintendent</option>
                  <option value="OBSERVER">Observer</option>
                </select>
              </Field>
            ) : null}
          </div>

          <div className="mt-3">
            <Field label="Note" hint="Included in the email. Optional.">
              <textarea
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className={textareaClass}
                placeholder="This is where we're keeping the boiler paperwork from now on."
              />
            </Field>
          </div>

          <div className="mt-4 flex gap-2">
            <Button intent="primary" size="sm" disabled={pending} onClick={send}>
              {pending ? "Sending…" : "Send the invitation"}
            </Button>
            <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
