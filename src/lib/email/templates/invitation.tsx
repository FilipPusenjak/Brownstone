import { Button, Section, Text } from "@react-email/components";
import type { Role } from "~/generated/prisma/enums";
import { describeRoles } from "~/lib/auth/roles";
import { COLORS, EmailLayout, textStyles } from "./layout";

/**
 * The invitation email.
 *
 * Says who invited them and what for, because an unexplained link from software
 * nobody has heard of is a link nobody clicks. Names the address the invitation
 * was sent to, since accepting requires signing in as that person and being
 * told so up front is kinder than being refused later.
 */

export interface InvitationProps {
  readonly buildingName: string;
  readonly invitedBy: string;
  readonly roles: Role[];
  readonly note: string | null;
  readonly url: string;
  readonly expiresInDays: number;
}

export function invitationSubject(props: InvitationProps): string {
  return `${props.invitedBy} has added you to ${props.buildingName} on Co-operator`;
}

export function InvitationEmail(props: InvitationProps) {
  return (
    <EmailLayout
      preview={invitationSubject(props)}
      buildingName={props.buildingName}
    >
      <Text style={textStyles.eyebrow}>An invitation</Text>

      <Text
        style={{
          margin: "0 0 14px",
          fontSize: "20px",
          fontWeight: 600,
          lineHeight: "1.3",
          color: COLORS.ironwork,
        }}
      >
        {props.invitedBy} has added you to {props.buildingName}
      </Text>

      <Text style={textStyles.body}>
        Co-operator is where the building keeps its compliance deadlines,
        insurance certificates, alteration requests and records. You&rsquo;ve
        been added as {describeRoles(props.roles)}.
      </Text>

      {props.note ? (
        <Text
          style={{
            ...textStyles.muted,
            paddingLeft: "12px",
            borderLeft: `2px solid ${COLORS.limestone}`,
          }}
        >
          {props.note}
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
          Accept the invitation
        </Button>
      </Section>

      <Text style={{ ...textStyles.muted, marginTop: "16px" }}>
        The link works for {props.expiresInDays} days, and only for this email
        address — you&rsquo;ll be asked to sign in with it. Don&rsquo;t forward
        it; if someone else should have access, ask {props.invitedBy} to invite
        them.
      </Text>
    </EmailLayout>
  );
}

export function invitationText(props: InvitationProps): string {
  return [
    "AN INVITATION",
    "",
    `${props.invitedBy} has added you to ${props.buildingName}.`,
    "",
    "Co-operator is where the building keeps its compliance deadlines,",
    "insurance certificates, alteration requests and records.",
    `You've been added as ${describeRoles(props.roles)}.`,
    "",
    ...(props.note ? [props.note, ""] : []),
    "Accept the invitation:",
    props.url,
    "",
    `The link works for ${props.expiresInDays} days, and only for this email`,
    "address — you'll be asked to sign in with it. Don't forward it; if someone",
    `else should have access, ask ${props.invitedBy} to invite them.`,
    "",
    `${props.buildingName} · Co-operator`,
    "Co-operator is a tracking tool, not legal advice. The board remains",
    "responsible for the building's filings.",
  ].join("\n");
}
