import { ulid } from "ulid";
import { z } from "zod";

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const orgIdSchema = z.string().regex(/^org_[0-9A-HJKMNP-TV-Z]{26}$/);
export const projectIdSchema = z.string().regex(/^proj_[0-9A-HJKMNP-TV-Z]{26}$/);

const nameSchema = z.string().trim().min(1);
export const createOrgBodySchema = z.object({ name: nameSchema });
export const createProjectBodySchema = z.object({ name: nameSchema });

export function newOrgId(): string {
  return `org_${ulid()}`;
}

export function newProjectId(): string {
  return `proj_${ulid()}`;
}
