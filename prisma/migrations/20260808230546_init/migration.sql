-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SHAREHOLDER', 'PRESIDENT', 'TREASURER', 'SECRETARY', 'BOARD_MEMBER', 'SUPER', 'OBSERVER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'FORMER');

-- CreateEnum
CREATE TYPE "UnitRelation" AS ENUM ('OWNER', 'OCCUPANT');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'STORAGE', 'COMMON');

-- CreateEnum
CREATE TYPE "Borough" AS ENUM ('MANHATTAN', 'BROOKLYN', 'QUEENS', 'BRONX', 'STATEN_ISLAND');

-- CreateEnum
CREATE TYPE "FloorNaming" AS ENUM ('BROWNSTONE', 'NUMERIC');

-- CreateEnum
CREATE TYPE "GasService" AS ENUM ('NONE', 'COOKING_ONLY', 'HEATING_AND_COOKING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SprinklerStatus" AS ENUM ('NONE', 'PARTIAL', 'FULL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AttributeSource" AS ENUM ('MANUAL', 'NYC_OPEN_DATA', 'MIXED');

-- CreateEnum
CREATE TYPE "Authority" AS ENUM ('DOB', 'HPD', 'FDNY', 'DEP', 'DSNY', 'DOHMH', 'DOF', 'OTHER');

-- CreateEnum
CREATE TYPE "RecurrenceType" AS ENUM ('NONE', 'FIXED_INTERVAL', 'CYCLICAL_BY_YEAR', 'ANCHORED_TO_COMPLETION');

-- CreateEnum
CREATE TYPE "AssessmentDecision" AS ENUM ('PROPOSED', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ObligationKind" AS ENUM ('COMPLIANCE', 'NOTICE', 'COI_EXPIRY', 'SUBLET_EXPIRY', 'DUTY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ObligationState" AS ENUM ('OPEN', 'COMPLETED', 'WAIVED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('BUILDING', 'MEMBERSHIP', 'UNIT', 'OBLIGATION', 'DOCUMENT', 'CERTIFICATE_OF_INSURANCE', 'APPROVAL_REQUEST', 'ALTERATION_REQUEST', 'SUBLET_REGISTRATION', 'CHARGE', 'PAYMENT', 'BOOKING', 'MEETING', 'TICKET', 'DUTY_ASSIGNMENT', 'NOTICE_CAMPAIGN', 'NOTICE_DELIVERY', 'INVITATION');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CERTIFICATE_OF_INSURANCE', 'INSPECTION_REPORT', 'FILING_RECEIPT', 'NOTICE_PROOF', 'ALTERATION_PLAN', 'TICKET_PHOTO', 'MEETING_MINUTES', 'PROPRIETARY_LEASE', 'HOUSE_RULES', 'OTHER');

-- CreateEnum
CREATE TYPE "CoiHolderKind" AS ENUM ('SHAREHOLDER', 'CONTRACTOR', 'MOVER', 'VENDOR');

-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('ALTERATION', 'SUBLET', 'TICKET_RESPONSIBILITY');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'APPROVED_WITH_CONDITIONS', 'DENIED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CommentVisibility" AS ENUM ('SHARED', 'BOARD_ONLY');

-- CreateEnum
CREATE TYPE "ChargeKind" AS ENUM ('MAINTENANCE', 'ASSESSMENT', 'LATE_FEE', 'SUBLET_FEE', 'DEPOSIT', 'MOVE_FEE', 'LEGAL_FEE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CHECK', 'ACH_MANUAL', 'CASH', 'MONEY_ORDER', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED');

-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('FREIGHT_ELEVATOR', 'ROOF_DECK', 'LAUNDRY', 'COMMON_ROOM', 'STORAGE', 'COURTYARD');

-- CreateEnum
CREATE TYPE "PrerequisiteType" AS ENUM ('DEPOSIT_PAID', 'VALID_COI', 'NO_ARREARS', 'APPROVED_ALTERATION');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HELD', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('ANNUAL', 'SPECIAL', 'BOARD');

-- CreateEnum
CREATE TYPE "AttendanceMode" AS ENUM ('IN_PERSON', 'REMOTE', 'PROXY');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'TRIAGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "Responsibility" AS ENUM ('UNDETERMINED', 'SHAREHOLDER', 'COOPERATIVE', 'SHARED');

-- CreateEnum
CREATE TYPE "DutyKind" AS ENUM ('TRASH_SET_OUT', 'RECYCLING_SET_OUT', 'SIDEWALK', 'OTHER');

-- CreateEnum
CREATE TYPE "NoticeType" AS ENUM ('WINDOW_GUARD', 'LEAD_PAINT', 'STOVE_KNOB_COVER', 'SPRINKLER_STATUS', 'BEDBUG_HISTORY', 'GAS_LEAK_PROCEDURE');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sessionToken" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Building" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "borough" "Borough" NOT NULL,
    "zip" TEXT NOT NULL,
    "bbl" TEXT,
    "bin" TEXT,
    "communityDistrict" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "floorNaming" "FloorNaming" NOT NULL DEFAULT 'BROWNSTONE',
    "unitCount" INTEGER NOT NULL,
    "stories" INTEGER NOT NULL,
    "yearBuilt" INTEGER,
    "grossSquareFeet" INTEGER,
    "hasElevator" BOOLEAN NOT NULL DEFAULT false,
    "gasService" "GasService" NOT NULL DEFAULT 'UNKNOWN',
    "oilTankPresent" BOOLEAN NOT NULL DEFAULT false,
    "sprinklerStatus" "SprinklerStatus" NOT NULL DEFAULT 'UNKNOWN',
    "facadeHeightFt" INTEGER,
    "isLandmarked" BOOLEAN NOT NULL DEFAULT false,
    "hasParapet" BOOLEAN NOT NULL DEFAULT true,
    "ownerOccupied" BOOLEAN NOT NULL DEFAULT true,
    "attributeSource" "AttributeSource" NOT NULL DEFAULT 'MANUAL',
    "attributesConfirmedAt" TIMESTAMP(3),
    "attributesConfirmedById" UUID,
    "subletCapPercent" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildingDataLookup" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildingDataLookup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "roles" "Role"[],
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT,
    "joinedOn" DATE NOT NULL,
    "endedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipUnit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "relation" "UnitRelation" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "roles" "Role"[],
    "unitIds" UUID[],
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" UUID,
    "revokedAt" TIMESTAMP(3),
    "invitedByMembershipId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "floorIndex" INTEGER NOT NULL,
    "line" TEXT,
    "unitType" "UnitType" NOT NULL DEFAULT 'RESIDENTIAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareAllocation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "shares" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitHolding" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "holderName" TEXT NOT NULL,
    "membershipId" UUID,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "certificateNo" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitHolding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authority" "Authority" NOT NULL,
    "citation" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "requirement" TEXT NOT NULL,
    "appliesWhen" TEXT NOT NULL,
    "applicability" JSONB NOT NULL,
    "recurrenceType" "RecurrenceType" NOT NULL,
    "intervalMonths" INTEGER,
    "cycleYears" INTEGER,
    "cycleAnchorYear" INTEGER,
    "cycleGroupSource" TEXT,
    "dueMonth" INTEGER,
    "dueDay" INTEGER,
    "windowOpensMonth" INTEGER,
    "windowOpensDay" INTEGER,
    "anchorOffsetMonths" INTEGER,
    "reminderOffsets" INTEGER[],
    "needsVerification" BOOLEAN NOT NULL DEFAULT false,
    "verificationNote" TEXT,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "supersededBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildingRuleAssessment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "engineVerdict" BOOLEAN NOT NULL,
    "engineReason" TEXT NOT NULL,
    "engineInputs" JSONB NOT NULL,
    "decision" "AssessmentDecision" NOT NULL DEFAULT 'PROPOSED',
    "decidedAt" TIMESTAMP(3),
    "decidedById" UUID,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildingRuleAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Obligation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "kind" "ObligationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "assessmentId" UUID,
    "ruleCode" TEXT,
    "dueOn" DATE NOT NULL,
    "opensOn" DATE,
    "recurrenceType" "RecurrenceType" NOT NULL DEFAULT 'NONE',
    "intervalMonths" INTEGER,
    "cycleYears" INTEGER,
    "cycleAnchorYear" INTEGER,
    "cycleGroup" TEXT,
    "dueMonth" INTEGER,
    "dueDay" INTEGER,
    "anchorOffsetMonths" INTEGER,
    "reminderOffsets" INTEGER[],
    "state" "ObligationState" NOT NULL DEFAULT 'OPEN',
    "completedOn" DATE,
    "completedById" UUID,
    "completionNote" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waivedReason" TEXT,
    "assigneeId" UUID,
    "subjectType" "EntityType",
    "subjectId" UUID,
    "parentObligationId" UUID,
    "needsVerification" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObligationReminder" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "obligationId" UUID NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "scheduledFor" DATE NOT NULL,
    "sentAt" TIMESTAMP(3),
    "notificationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObligationReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "uploadedById" UUID,
    "issuedOn" DATE,
    "expiresOn" DATE,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLink" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateOfInsurance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "documentId" UUID,
    "holderKind" "CoiHolderKind" NOT NULL,
    "holderName" TEXT NOT NULL,
    "unitId" UUID,
    "alterationRequestId" UUID,
    "carrier" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "coverageCents" INTEGER,
    "effectiveOn" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "additionalInsuredVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "note" TEXT,
    "obligationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificateOfInsurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "kind" "ApprovalKind" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedById" UUID NOT NULL,
    "assigneeId" UUID,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" UUID,
    "decisionNote" TEXT,
    "conditions" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalComment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "CommentVisibility" NOT NULL DEFAULT 'SHARED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlterationRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "approvalRequestId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "contractorName" TEXT,
    "contractorLicense" TEXT,
    "contractorPhone" TEXT,
    "wetOverDry" BOOLEAN NOT NULL DEFAULT false,
    "affectsStructure" BOOLEAN NOT NULL DEFAULT false,
    "affectsRiser" BOOLEAN NOT NULL DEFAULT false,
    "requiresDobPermit" BOOLEAN NOT NULL DEFAULT false,
    "dobJobNumber" TEXT,
    "plannedStart" DATE,
    "plannedEnd" DATE,
    "completedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlterationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "kind" "ChargeKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "dueOn" DATE NOT NULL,
    "postedOn" DATE NOT NULL,
    "memo" TEXT,
    "reversesChargeId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "receivedOn" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "memo" TEXT,
    "reversesPaymentId" UUID,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentPlan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "installmentCents" INTEGER NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "recipientUserId" UUID,
    "template" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "textBody" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "subjectType" "EntityType",
    "subjectId" UUID,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "actorUserId" UUID,
    "actorMembershipId" UUID,
    "action" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ResourceKind" NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 240,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourcePrerequisite" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "type" "PrerequisiteType" NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourcePrerequisite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'HELD',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingPrerequisiteCheck" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "prerequisiteId" UUID NOT NULL,
    "satisfied" BOOLEAN NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceType" "EntityType",
    "evidenceId" UUID,
    "note" TEXT,

    CONSTRAINT "BookingPrerequisiteCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" "MeetingType" NOT NULL DEFAULT 'ANNUAL',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "quorumBasisPoints" INTEGER NOT NULL DEFAULT 5000,
    "minutesDocumentId" UUID,
    "heldAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAttendance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "mode" "AttendanceMode" NOT NULL DEFAULT 'IN_PERSON',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proxy" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "holderId" UUID,
    "holderName" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "evidence" TEXT,

    CONSTRAINT "Proxy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resolution" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sharesFor" INTEGER NOT NULL DEFAULT 0,
    "sharesAgainst" INTEGER NOT NULL DEFAULT 0,
    "sharesAbstain" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Resolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubletRegistration" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "approvalRequestId" UUID,
    "subtenantName" TEXT NOT NULL,
    "termStart" DATE NOT NULL,
    "termEnd" DATE NOT NULL,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "obligationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubletRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "unitId" UUID,
    "reportedById" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "area" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "responsibility" "Responsibility" NOT NULL DEFAULT 'UNDETERMINED',
    "approvalRequestId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyRotation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DutyKind" NOT NULL DEFAULT 'TRASH_SET_OUT',
    "unitOrder" UUID[],
    "startsOn" DATE NOT NULL,
    "periodDays" INTEGER NOT NULL DEFAULT 7,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DutyRotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "rotationId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "obligationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DutyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DsnyFine" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "unitId" UUID,
    "ticketNumber" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "violation" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidOn" DATE,
    "contestedOn" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DsnyFine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeCampaign" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "noticeType" "NoticeType" NOT NULL,
    "year" INTEGER NOT NULL,
    "dueOn" DATE NOT NULL,
    "obligationId" UUID,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeDelivery" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "notificationId" UUID,
    "documentId" UUID,
    "respondedAt" TIMESTAMP(3),
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Building_slug_key" ON "Building"("slug");

-- CreateIndex
CREATE INDEX "BuildingDataLookup_buildingId_source_idx" ON "BuildingDataLookup"("buildingId", "source");

-- CreateIndex
CREATE INDEX "Membership_buildingId_idx" ON "Membership"("buildingId");

-- CreateIndex
CREATE INDEX "Membership_buildingId_status_idx" ON "Membership"("buildingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_buildingId_key" ON "Membership"("userId", "buildingId");

-- CreateIndex
CREATE INDEX "MembershipUnit_buildingId_idx" ON "MembershipUnit"("buildingId");

-- CreateIndex
CREATE INDEX "MembershipUnit_buildingId_unitId_idx" ON "MembershipUnit"("buildingId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipUnit_membershipId_unitId_key" ON "MembershipUnit"("membershipId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_buildingId_idx" ON "Invitation"("buildingId");

-- CreateIndex
CREATE INDEX "Invitation_buildingId_email_idx" ON "Invitation"("buildingId", "email");

-- CreateIndex
CREATE INDEX "Unit_buildingId_idx" ON "Unit"("buildingId");

-- CreateIndex
CREATE INDEX "Unit_buildingId_floorIndex_idx" ON "Unit"("buildingId", "floorIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_buildingId_label_key" ON "Unit"("buildingId", "label");

-- CreateIndex
CREATE INDEX "ShareAllocation_buildingId_idx" ON "ShareAllocation"("buildingId");

-- CreateIndex
CREATE INDEX "ShareAllocation_buildingId_unitId_effectiveFrom_idx" ON "ShareAllocation"("buildingId", "unitId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "UnitHolding_buildingId_idx" ON "UnitHolding"("buildingId");

-- CreateIndex
CREATE INDEX "UnitHolding_buildingId_unitId_effectiveFrom_idx" ON "UnitHolding"("buildingId", "unitId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceRule_code_key" ON "ComplianceRule"("code");

-- CreateIndex
CREATE INDEX "ComplianceRule_authority_idx" ON "ComplianceRule"("authority");

-- CreateIndex
CREATE INDEX "BuildingRuleAssessment_buildingId_idx" ON "BuildingRuleAssessment"("buildingId");

-- CreateIndex
CREATE INDEX "BuildingRuleAssessment_buildingId_decision_idx" ON "BuildingRuleAssessment"("buildingId", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "BuildingRuleAssessment_buildingId_ruleCode_key" ON "BuildingRuleAssessment"("buildingId", "ruleCode");

-- CreateIndex
CREATE INDEX "Obligation_buildingId_idx" ON "Obligation"("buildingId");

-- CreateIndex
CREATE INDEX "Obligation_buildingId_state_dueOn_idx" ON "Obligation"("buildingId", "state", "dueOn");

-- CreateIndex
CREATE INDEX "Obligation_buildingId_subjectType_subjectId_idx" ON "Obligation"("buildingId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "ObligationReminder_buildingId_idx" ON "ObligationReminder"("buildingId");

-- CreateIndex
CREATE INDEX "ObligationReminder_buildingId_scheduledFor_idx" ON "ObligationReminder"("buildingId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "ObligationReminder_obligationId_offsetDays_scheduledFor_key" ON "ObligationReminder"("obligationId", "offsetDays", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_buildingId_idx" ON "Document"("buildingId");

-- CreateIndex
CREATE INDEX "Document_buildingId_type_idx" ON "Document"("buildingId", "type");

-- CreateIndex
CREATE INDEX "Document_buildingId_expiresOn_idx" ON "Document"("buildingId", "expiresOn");

-- CreateIndex
CREATE INDEX "DocumentLink_buildingId_idx" ON "DocumentLink"("buildingId");

-- CreateIndex
CREATE INDEX "DocumentLink_buildingId_entityType_entityId_idx" ON "DocumentLink"("buildingId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLink_documentId_entityType_entityId_key" ON "DocumentLink"("documentId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "CertificateOfInsurance_buildingId_idx" ON "CertificateOfInsurance"("buildingId");

-- CreateIndex
CREATE INDEX "CertificateOfInsurance_buildingId_expiresOn_idx" ON "CertificateOfInsurance"("buildingId", "expiresOn");

-- CreateIndex
CREATE INDEX "CertificateOfInsurance_buildingId_unitId_idx" ON "CertificateOfInsurance"("buildingId", "unitId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_buildingId_idx" ON "ApprovalRequest"("buildingId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_buildingId_kind_status_idx" ON "ApprovalRequest"("buildingId", "kind", "status");

-- CreateIndex
CREATE INDEX "ApprovalComment_buildingId_idx" ON "ApprovalComment"("buildingId");

-- CreateIndex
CREATE INDEX "ApprovalComment_buildingId_requestId_idx" ON "ApprovalComment"("buildingId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AlterationRequest_approvalRequestId_key" ON "AlterationRequest"("approvalRequestId");

-- CreateIndex
CREATE INDEX "AlterationRequest_buildingId_idx" ON "AlterationRequest"("buildingId");

-- CreateIndex
CREATE INDEX "AlterationRequest_buildingId_unitId_idx" ON "AlterationRequest"("buildingId", "unitId");

-- CreateIndex
CREATE INDEX "Charge_buildingId_idx" ON "Charge"("buildingId");

-- CreateIndex
CREATE INDEX "Charge_buildingId_unitId_dueOn_idx" ON "Charge"("buildingId", "unitId", "dueOn");

-- CreateIndex
CREATE INDEX "Payment_buildingId_idx" ON "Payment"("buildingId");

-- CreateIndex
CREATE INDEX "Payment_buildingId_unitId_receivedOn_idx" ON "Payment"("buildingId", "unitId", "receivedOn");

-- CreateIndex
CREATE INDEX "PaymentPlan_buildingId_idx" ON "PaymentPlan"("buildingId");

-- CreateIndex
CREATE INDEX "PaymentPlan_buildingId_unitId_idx" ON "PaymentPlan"("buildingId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_buildingId_idx" ON "Notification"("buildingId");

-- CreateIndex
CREATE INDEX "Notification_buildingId_status_idx" ON "Notification"("buildingId", "status");

-- CreateIndex
CREATE INDEX "Notification_buildingId_subjectType_subjectId_idx" ON "Notification"("buildingId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AuditLog_buildingId_idx" ON "AuditLog"("buildingId");

-- CreateIndex
CREATE INDEX "AuditLog_buildingId_entityType_entityId_idx" ON "AuditLog"("buildingId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_buildingId_createdAt_idx" ON "AuditLog"("buildingId", "createdAt");

-- CreateIndex
CREATE INDEX "Resource_buildingId_idx" ON "Resource"("buildingId");

-- CreateIndex
CREATE INDEX "ResourcePrerequisite_buildingId_idx" ON "ResourcePrerequisite"("buildingId");

-- CreateIndex
CREATE INDEX "ResourcePrerequisite_buildingId_resourceId_idx" ON "ResourcePrerequisite"("buildingId", "resourceId");

-- CreateIndex
CREATE INDEX "Booking_buildingId_idx" ON "Booking"("buildingId");

-- CreateIndex
CREATE INDEX "Booking_buildingId_resourceId_startsAt_idx" ON "Booking"("buildingId", "resourceId", "startsAt");

-- CreateIndex
CREATE INDEX "BookingPrerequisiteCheck_buildingId_idx" ON "BookingPrerequisiteCheck"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingPrerequisiteCheck_bookingId_prerequisiteId_key" ON "BookingPrerequisiteCheck"("bookingId", "prerequisiteId");

-- CreateIndex
CREATE INDEX "Meeting_buildingId_idx" ON "Meeting"("buildingId");

-- CreateIndex
CREATE INDEX "Meeting_buildingId_scheduledFor_idx" ON "Meeting"("buildingId", "scheduledFor");

-- CreateIndex
CREATE INDEX "MeetingAttendance_buildingId_idx" ON "MeetingAttendance"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingAttendance_meetingId_unitId_key" ON "MeetingAttendance"("meetingId", "unitId");

-- CreateIndex
CREATE INDEX "Proxy_buildingId_idx" ON "Proxy"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "Proxy_meetingId_unitId_key" ON "Proxy"("meetingId", "unitId");

-- CreateIndex
CREATE INDEX "Resolution_buildingId_idx" ON "Resolution"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "SubletRegistration_approvalRequestId_key" ON "SubletRegistration"("approvalRequestId");

-- CreateIndex
CREATE INDEX "SubletRegistration_buildingId_idx" ON "SubletRegistration"("buildingId");

-- CreateIndex
CREATE INDEX "SubletRegistration_buildingId_termEnd_idx" ON "SubletRegistration"("buildingId", "termEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_approvalRequestId_key" ON "Ticket"("approvalRequestId");

-- CreateIndex
CREATE INDEX "Ticket_buildingId_idx" ON "Ticket"("buildingId");

-- CreateIndex
CREATE INDEX "Ticket_buildingId_status_idx" ON "Ticket"("buildingId", "status");

-- CreateIndex
CREATE INDEX "DutyRotation_buildingId_idx" ON "DutyRotation"("buildingId");

-- CreateIndex
CREATE INDEX "DutyAssignment_buildingId_idx" ON "DutyAssignment"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "DutyAssignment_rotationId_periodStart_key" ON "DutyAssignment"("rotationId", "periodStart");

-- CreateIndex
CREATE INDEX "DsnyFine_buildingId_idx" ON "DsnyFine"("buildingId");

-- CreateIndex
CREATE INDEX "NoticeCampaign_buildingId_idx" ON "NoticeCampaign"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "NoticeCampaign_buildingId_noticeType_year_key" ON "NoticeCampaign"("buildingId", "noticeType", "year");

-- CreateIndex
CREATE INDEX "NoticeDelivery_buildingId_idx" ON "NoticeDelivery"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "NoticeDelivery_campaignId_unitId_key" ON "NoticeDelivery"("campaignId", "unitId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingDataLookup" ADD CONSTRAINT "BuildingDataLookup_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipUnit" ADD CONSTRAINT "MembershipUnit_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipUnit" ADD CONSTRAINT "MembershipUnit_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipUnit" ADD CONSTRAINT "MembershipUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedByMembershipId_fkey" FOREIGN KEY ("invitedByMembershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareAllocation" ADD CONSTRAINT "ShareAllocation_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareAllocation" ADD CONSTRAINT "ShareAllocation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitHolding" ADD CONSTRAINT "UnitHolding_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitHolding" ADD CONSTRAINT "UnitHolding_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitHolding" ADD CONSTRAINT "UnitHolding_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingRuleAssessment" ADD CONSTRAINT "BuildingRuleAssessment_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingRuleAssessment" ADD CONSTRAINT "BuildingRuleAssessment_ruleCode_fkey" FOREIGN KEY ("ruleCode") REFERENCES "ComplianceRule"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingRuleAssessment" ADD CONSTRAINT "BuildingRuleAssessment_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "BuildingRuleAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_parentObligationId_fkey" FOREIGN KEY ("parentObligationId") REFERENCES "Obligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObligationReminder" ADD CONSTRAINT "ObligationReminder_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObligationReminder" ADD CONSTRAINT "ObligationReminder_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateOfInsurance" ADD CONSTRAINT "CertificateOfInsurance_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateOfInsurance" ADD CONSTRAINT "CertificateOfInsurance_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateOfInsurance" ADD CONSTRAINT "CertificateOfInsurance_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateOfInsurance" ADD CONSTRAINT "CertificateOfInsurance_alterationRequestId_fkey" FOREIGN KEY ("alterationRequestId") REFERENCES "AlterationRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateOfInsurance" ADD CONSTRAINT "CertificateOfInsurance_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateOfInsurance" ADD CONSTRAINT "CertificateOfInsurance_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalComment" ADD CONSTRAINT "ApprovalComment_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalComment" ADD CONSTRAINT "ApprovalComment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalComment" ADD CONSTRAINT "ApprovalComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlterationRequest" ADD CONSTRAINT "AlterationRequest_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlterationRequest" ADD CONSTRAINT "AlterationRequest_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlterationRequest" ADD CONSTRAINT "AlterationRequest_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_reversesChargeId_fkey" FOREIGN KEY ("reversesChargeId") REFERENCES "Charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversesPaymentId_fkey" FOREIGN KEY ("reversesPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorMembershipId_fkey" FOREIGN KEY ("actorMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourcePrerequisite" ADD CONSTRAINT "ResourcePrerequisite_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourcePrerequisite" ADD CONSTRAINT "ResourcePrerequisite_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingPrerequisiteCheck" ADD CONSTRAINT "BookingPrerequisiteCheck_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingPrerequisiteCheck" ADD CONSTRAINT "BookingPrerequisiteCheck_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingPrerequisiteCheck" ADD CONSTRAINT "BookingPrerequisiteCheck_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "ResourcePrerequisite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendance" ADD CONSTRAINT "MeetingAttendance_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendance" ADD CONSTRAINT "MeetingAttendance_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendance" ADD CONSTRAINT "MeetingAttendance_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resolution" ADD CONSTRAINT "Resolution_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resolution" ADD CONSTRAINT "Resolution_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubletRegistration" ADD CONSTRAINT "SubletRegistration_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubletRegistration" ADD CONSTRAINT "SubletRegistration_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubletRegistration" ADD CONSTRAINT "SubletRegistration_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyRotation" ADD CONSTRAINT "DutyRotation_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyAssignment" ADD CONSTRAINT "DutyAssignment_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyAssignment" ADD CONSTRAINT "DutyAssignment_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "DutyRotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyAssignment" ADD CONSTRAINT "DutyAssignment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyAssignment" ADD CONSTRAINT "DutyAssignment_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsnyFine" ADD CONSTRAINT "DsnyFine_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsnyFine" ADD CONSTRAINT "DsnyFine_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeCampaign" ADD CONSTRAINT "NoticeCampaign_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeCampaign" ADD CONSTRAINT "NoticeCampaign_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeDelivery" ADD CONSTRAINT "NoticeDelivery_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeDelivery" ADD CONSTRAINT "NoticeDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "NoticeCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeDelivery" ADD CONSTRAINT "NoticeDelivery_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeDelivery" ADD CONSTRAINT "NoticeDelivery_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
