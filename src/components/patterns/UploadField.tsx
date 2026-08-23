"use client";

import { useRef, useState, useTransition } from "react";
import type { DocumentType, EntityType } from "~/generated/prisma/enums";
import { Button } from "./Button";
import {
  attachDocumentAction,
  requestUploadAction,
} from "~/app/b/[buildingSlug]/documents/actions";

/**
 * Uploading a file.
 *
 * Three steps, and the middle one never touches the application: ask the server
 * to sign a PUT, send the bytes straight to storage, then tell the server it
 * landed. A 20 MB scan of a certificate should not pass through a serverless
 * function on its way to a bucket.
 *
 * Failures are reported in terms of what to do next — "that file is larger than
 * 25 MB, photograph the page instead" — because the person hitting them is a
 * board member with a scanner, not an engineer.
 */
export function UploadField({
  buildingSlug,
  entityType,
  entityId,
  documentType,
  label,
  onUploaded,
}: {
  buildingSlug: string;
  entityType: EntityType;
  entityId: string;
  documentType: DocumentType;
  label: string;
  onUploaded?: (documentId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function upload(file: File): void {
    setError(null);
    setDone(null);

    startTransition(async () => {
      const ticket = await requestUploadAction({
        buildingSlug,
        entityType,
        entityId,
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      if (!ticket.ok) {
        setError(ticket.message);
        return;
      }

      const response = await fetch(ticket.data.url, {
        method: "PUT",
        headers: ticket.data.headers,
        body: file,
      });

      if (!response.ok) {
        setError("The upload didn't finish. Check your connection and try again.");
        return;
      }

      const attached = await attachDocumentAction({
        buildingSlug,
        key: ticket.data.key,
        entityType,
        entityId,
        type: documentType,
        title: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      if (!attached.ok) {
        setError(attached.message);
        return;
      }

      setDone(file.name);
      if (inputRef.current) inputRef.current.value = "";
      onUploaded?.(attached.data.documentId);
    });
  }

  return (
    <div>
      <label className="eyebrow mb-1.5 block" htmlFor={`upload-${entityId}`}>
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id={`upload-${entityId}`}
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/heic,image/webp"
          disabled={pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload(file);
          }}
          className="text-ironwork-soft file:rounded-sheet file:border-limestone-deep file:bg-paper file:text-ironwork hover:file:bg-paper-sunk block w-full text-sm file:mr-3 file:border file:px-3 file:py-1.5 file:text-sm"
        />
        {pending ? (
          <span className="text-ironwork-faint font-mono text-xs">Uploading…</span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-stamp mt-1.5 text-xs">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="text-ironwork-soft mt-1.5 text-xs">{done} uploaded.</p>
      ) : null}
    </div>
  );
}

/** A download link. Every one is a fresh, short-lived, capability-checked URL. */
export function DocumentLink({
  buildingSlug,
  documentId,
  title,
}: {
  buildingSlug: string;
  documentId: string;
  title: string;
}) {
  return (
    <a
      href={`/api/files/${documentId}?building=${encodeURIComponent(buildingSlug)}`}
      className="text-verdigris underline underline-offset-4"
    >
      {title}
    </a>
  );
}

export function UploadButton({ children }: { children: React.ReactNode }) {
  return (
    <Button size="sm" type="button">
      {children}
    </Button>
  );
}
