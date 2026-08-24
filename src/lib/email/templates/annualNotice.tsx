import { Text } from "@react-email/components";
import { NOTICES, type Answer, type NoticeType } from "~/lib/primitives/notices";
import { COLORS, EmailLayout, textStyles } from "./layout";

/**
 * The annual notice itself.
 *
 * Not a reminder and not a nudge — this is the document the law requires the
 * building to send, and the plain-text rendering of it is what the building
 * will produce if anyone ever asks what went out. So it says the question in
 * the law's terms, spells out what each answer means, gives a date to reply by,
 * and says plainly what happens if nobody does. That last paragraph is not a
 * threat; it is the rule, and a household that knows it is more likely to send
 * the form back.
 *
 * There is no link to click. The reply comes back on paper or in a sentence to
 * the board, and an officer records it — a household here may be a subtenant
 * with no account, and a notice that only works for people who can sign in is a
 * notice that does not reach the apartments most likely to need the guards.
 */

export interface AnnualNoticeProps {
  readonly buildingName: string;
  readonly noticeType: NoticeType;
  readonly year: number;
  readonly unitLabel: string;
  readonly recipientName: string;
  readonly respondBy: string;
  readonly replyTo: string;
}

export function annualNoticeSubject(props: AnnualNoticeProps): string {
  return `${NOTICES[props.noticeType].title} — ${props.buildingName}, ${props.year}`;
}

const ORDER: Answer[] = ["YES", "NO", "REQUESTED"];

export function AnnualNoticeEmail(props: AnnualNoticeProps) {
  const spec = NOTICES[props.noticeType];

  return (
    <EmailLayout preview={annualNoticeSubject(props)} buildingName={props.buildingName}>
      <Text style={textStyles.eyebrow}>
        Annual notice · {props.year} · Apartment {props.unitLabel}
      </Text>

      <Text
        style={{
          margin: "0 0 14px",
          fontSize: "20px",
          fontWeight: 600,
          lineHeight: "1.3",
          color: COLORS.ironwork,
        }}
      >
        {spec.title}
      </Text>

      <Text style={textStyles.body}>
        {props.recipientName}, the building is required to ask you this every year and
        to keep your answer on file.
      </Text>

      <Text
        style={{
          ...textStyles.body,
          fontWeight: 600,
          paddingLeft: "12px",
          borderLeft: `2px solid ${COLORS.verdigris}`,
        }}
      >
        {spec.question}
      </Text>

      {ORDER.map((answer) => (
        <Text key={answer} style={{ ...textStyles.muted, margin: "0 0 6px" }}>
          — {spec.answers[answer]}
        </Text>
      ))}

      <Text style={textStyles.body}>
        Reply to {props.replyTo} by <strong>{props.respondBy}</strong>, or hand the form
        back to a board member.
      </Text>

      <Text
        style={{
          ...textStyles.muted,
          paddingLeft: "12px",
          borderLeft: `2px solid ${COLORS.brownstone}`,
        }}
      >
        If we hear nothing from you: {spec.silenceMeans}
      </Text>

      <Text
        style={{ margin: "14px 0 0", fontSize: "12px", color: COLORS.ironworkFaint }}
      >
        {spec.citation}
      </Text>
    </EmailLayout>
  );
}

/**
 * The plain-text rendering, written rather than derived.
 *
 * Stored verbatim in the notification log before the message is handed to the
 * provider. When a shareholder says three years later that they never got the
 * window guard notice, this string — with its date and its address — is what
 * the building produces. It has to read as the notice, not as HTML with the
 * tags stripped out.
 */
export function annualNoticeText(props: AnnualNoticeProps): string {
  const spec = NOTICES[props.noticeType];

  return [
    spec.title.toUpperCase(),
    `${props.buildingName} — apartment ${props.unitLabel} — ${props.year}`,
    "",
    `${props.recipientName}, the building is required to ask you this every year and to keep your answer on file.`,
    "",
    spec.question,
    "",
    ...ORDER.map((answer) => `  [ ] ${spec.answers[answer]}`),
    "",
    `Reply to ${props.replyTo} by ${props.respondBy}, or hand the form back to a board member.`,
    "",
    `If we hear nothing from you: ${spec.silenceMeans}`,
    "",
    spec.citation,
    "",
  ].join("\n");
}
