import type { Db } from "mongodb";
import {
  newOrgId,
  newProjectId,
  type Organization,
  type Project,
} from "./entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface ProjectContextRepository {
  createOrganization(name: string): Promise<Organization>;
  getOrganization(id: string): Promise<Organization | null>;
  createProject(organizationId: string, name: string): Promise<Project>;
  getProject(organizationId: string, id: string): Promise<Project | null>;
  listProjects(organizationId: string): Promise<Project[]>;
}

export function createRepository(db: Db): ProjectContextRepository {
  const orgs = () => db.collection<Organization>("organizations");
  const projects = () => db.collection<Project>("projects");

  return {
    async createOrganization(name) {
      const now = new Date().toISOString();
      const org: Organization = { id: newOrgId(), name, createdAt: now, updatedAt: now };
      await orgs().insertOne(org);
      return org;
    },
    async getOrganization(id) {
      return orgs().findOne({ id }, READ_OPTS) as Promise<Organization | null>;
    },
    async createProject(organizationId, name) {
      const now = new Date().toISOString();
      const project: Project = {
        id: newProjectId(),
        organizationId,
        name,
        createdAt: now,
        updatedAt: now,
      };
      await projects().insertOne(project);
      return project;
    },
    async getProject(organizationId, id) {
      return projects().findOne({ id, organizationId }, READ_OPTS) as Promise<Project | null>;
    },
    async listProjects(organizationId) {
      return projects().find({ organizationId }, READ_OPTS).toArray() as Promise<Project[]>;
    },
  };
}
