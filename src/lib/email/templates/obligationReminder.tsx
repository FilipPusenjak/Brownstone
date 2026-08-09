import { Button, Section, Text } from "@react-email/components";
import { COLORS, EmailLayout, textStyles } from "./layout";

/**
 * The reminder that a filing is coming due.
 *
 * The subject line carries the whole message, because that is all most people
 * read: "Boiler inspection due in 9 days — The Adelaide". The body adds the
 * citation and a link, and says who it's assigned to so nobody assumes someone
 * else has it.
 *
 * Every template ships with a hand-written plain-text version rather than a
 * stripped-HTML one. The text is what gets stored in the notification log as
 * evidence of what was sent, so it has to read as a message someone wrote.
 */

export interface ObligationReminderProps {
  readonly buildingName: string;
  readonly title: string;
  readonly dueOn: string;
  readonly relative: string;
  readonly citation: string | null;
  readonly detail: string | null;
  readonly assigneeName: string | null;
  readonly needsVerification: boolean;
  readonly url: string;
  readonly overdue: boolean;
}

export function subjectFor(props: ObligationReminderProps): string {
  return props.overdue
    ? `Overdue: ${props.title} — ${props.buildingName}`
    : `${props.title} due ${props.relative} — ${props.buildingName}`;
}

export function ObligationReminderEmail(props: ObligationReminderProps) {
  const accent = props.overdue ? COLORS.stamp : COLORS.started;

  return (
    <EmailLayout preview={subjectFor(props)} buildingName={props.buildingName}>
      <Text style={textStyles.eyebrow}>{props.overdue ? "Overdue" : "Coming up"}</Text>

      <Text
        style={{
          margin: "0 0 14px",
          fontSize: "20px",
          fontWeight: 600,
          lineHeight: "1.3",
          color: COLORS.ironwork,
        }}
      >
        {props.title}
      </Text>

      <Text style={{ ...textStyles.body, color: accent, fontWeight: 600 }}>
        {props.overdue
          ? `Was due ${props.dueOn} — ${props.relative}.`
          : `Due ${props.dueOn}, ${props.relative}.`}
      </Text>

      {props.detail ? <Text style={textStyles.muted}>{props.detail}</Text> : null}

      <Text style={textStyles.muted}>
        {props.assigneeName
          ? `${props.assigneeName} is down to handle this.`
          : "Nobody is assigned to this yet."}
      </Text>

      {props.needsVerification ? (
        <Text
          style={{
            ...textStyles.muted,
            paddingLeft: "12px",
            borderLeft: `2px solid ${COLORS.brownstone}`,
          }}
        >
          The requirement is real, but we could not confirm this exact deadline. Check
          it with the agency before relying on the date.
        </Text>
      ) : null}

      <Section style={{ margin: "20px 0 6px" }}>
        <Button
          href={props.url}
          style={{
            display: "inline-block",
            padding: "11px 18px",
            backgroundColor: COLORS.verdigris,
            color: "#ffffff",
            fontSize: "14px",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Open it in Co-operator
        </Button>
      </Section>

      {props.citation ? (
        <Text
          style={{
            margin: "14px 0 0",
            fontSize: "12px",
            color: COLORS.ironworkFaint,
          }}
        >
          {props.citation}
        </Text>
      ) : null}
    </EmailLayout>
  );
}

/**
 * The plain-text rendering, written rather than derived.
 *
 * Stored verbatim in the notification log. When a board has to show what was
 * sent, this is the artefact, so it must read as prose — not as HTML with the
 * tags taken out.
 */
export function obligationReminderText(props: ObligationReminderProps): string {
  const lines = [
    props.overdue ? "OVERDUE" : "COMING UP",
    "",
    props.title,
    props.overdue
      ? `Was due ${props.dueOn} — ${props.relative}.`
      : `Due ${props.dueOn}, ${props.relative}.`,
    "",
  ];

  if (props.detail) lines.push(props.detail, "");

  lines.push(
    props.assigneeName
      ? `${props.assigneeName} is down to handle this.`
      : "Nobody is assigned to this yet.",
    "",
  );

  if (props.needsVerification) {
    lines.push(
      "Note: the requirement is real, but we could not confirm this exact",
      "deadline. Check it with the agency before relying on the date.",
      "",
    );
  }

  lines.push(props.url, "");
  if (props.citation) lines.push(props.citation, "");

  lines.push(
    `${props.buildingName} · Co-operator`,
    "Co-operator is a tracking tool, not legal advice. The board remains",
    "responsible for the building's filings.",
  );

  return lines.join("\n");
}
