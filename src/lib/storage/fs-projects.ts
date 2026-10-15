import type { Project } from '../plan/schemas';
import { InvalidProjectIdError, isValidProjectId } from './ids';
import { deleteProject, listProjects, loadProject, optionGroup, projectExists, saveProject, updateProject } from './projects';
import { ProjectNotFoundError, type ProjectStore, type ProjectSummary } from './store';

/** Projects as `<dataDir>/projects/<id>/project.json` — the local-dev and test backend. */
export class FsProjectStore implements ProjectStore {
  constructor(private readonly dataDir: string) {}

  async insert(project: Project): Promise<void> {
    if (!isValidProjectId(project.id)) throw new InvalidProjectIdError(project.id);
    if (projectExists(this.dataDir, project.id)) throw new Error(`project already exists: ${project.id}`);
    saveProject(this.dataDir, project);
  }

  async load(id: string): Promise<Project | null> {
    return isValidProjectId(id) && projectExists(this.dataDir, id) ? loadProject(this.dataDir, id) : null;
  }

  async update(id: string, update: (current: Project) => Project | Promise<Project>): Promise<Project> {
    if (!isValidProjectId(id) || !projectExists(this.dataDir, id)) throw new ProjectNotFoundError(id);
    return updateProject(this.dataDir, id, update);
  }

  async remove(id: string): Promise<boolean> {
    return isValidProjectId(id) ? deleteProject(this.dataDir, id) : false;
  }

  async list(): Promise<ProjectSummary[]> {
    return listProjects(this.dataDir);
  }

  async group(groupId: string): Promise<Project[]> {
    return optionGroup(this.dataDir, groupId);
  }
}
