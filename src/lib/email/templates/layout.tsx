import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

/**
 * The shell every Co-operator email sits in.
 *
 * Deliberately plain. Email clients are a decade behind browsers, so this is
 * tables, inline styles and web-safe stacks — the display face and the mono do
 * not survive the trip, and a message that renders as a broken layout in
 * Outlook is worse than one that renders as clean text everywhere.
 *
 * The palette still carries: plaster ground, limestone rules, brownstone
 * masthead. It should look like the same product.
 */

export const COLORS = {
  plaster: "#e7e9e2",
  paper: "#fbfbf8",
  limestone: "#cfccc0",
  brownstone: "#6e4a38",
  ironwork: "#16191a",
  ironworkSoft: "#4d5451",
  ironworkFaint: "#6f7671",
  verdigris: "#0b6e62",
  stamp: "#a32e24",
  started: "#8a6a00",
} as const;

const FONT =
  "ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

export function EmailLayout({
  preview,
  buildingName,
  children,
}: {
  preview: string;
  buildingName: string;
  children: React.ReactNode;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          padding: "32px 16px",
          backgroundColor: COLORS.plaster,
          fontFamily: FONT,
          color: COLORS.ironwork,
        }}
      >
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            backgroundColor: COLORS.paper,
            border: `1px solid ${COLORS.limestone}`,
          }}
        >
          <Section
            style={{
              padding: "20px 24px 16px",
              borderBottom: `3px solid ${COLORS.brownstone}`,
            }}
          >
            <Text
              style={{
                margin: 0,
                fontSize: "11px",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: COLORS.brownstone,
              }}
            >
              Co-operator
            </Text>
            <Text
              style={{
                margin: "6px 0 0",
                fontSize: "18px",
                fontWeight: 600,
                color: COLORS.ironwork,
              }}
            >
              {buildingName}
            </Text>
          </Section>

          <Section style={{ padding: "24px" }}>{children}</Section>

          <Hr style={{ margin: 0, borderColor: COLORS.limestone }} />

          <Section style={{ padding: "16px 24px" }}>
            <Text
              style={{
                margin: 0,
                fontSize: "12px",
                lineHeight: "1.5",
                color: COLORS.ironworkFaint,
              }}
            >
              Co-operator is a tracking tool, not legal advice. The board remains
              responsible for the building&rsquo;s filings.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export const textStyles = {
  body: {
    margin: "0 0 14px",
    fontSize: "15px",
    lineHeight: "1.55",
    color: COLORS.ironwork,
  },
  muted: {
    margin: "0 0 14px",
    fontSize: "14px",
    lineHeight: "1.5",
    color: COLORS.ironworkSoft,
  },
  eyebrow: {
    margin: "0 0 6px",
    fontSize: "11px",
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: COLORS.ironworkFaint,
  },
} as const;
