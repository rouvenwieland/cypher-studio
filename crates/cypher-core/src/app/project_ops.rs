//! Projekte und Vorlagen (ARCHITEKTUR.md 2.11, 3.2, 5.6).

use std::path::{Path, PathBuf};

use crate::api::{
    EntityKind, HandleSource, ModuleKind, Project, ProjectAddAssetReq, ProjectAsset, ProjectCreateReq, ProjectDocument,
    ProjectFile, ProjectFileRef, ProjectFileReq, ProjectFolder, ProjectNewFileReq, ProjectOpenOutcome,
    ProjectOpenResult, ProjectReadDocumentReq, ProjectRef, ProjectSetCollectionReq, ProjectWriteDocumentReq,
    TemplateInfo, TemplateTarget,
};
use crate::error::CoreError;
use crate::projects::{self, NewFileContent, TemplateRecord};
use crate::state::ProjectIndexEntry;
use crate::util::now_iso;

use super::App;

fn not_found(entity: EntityKind, id: &str) -> CoreError {
    CoreError::NotFound { entity, id: id.to_owned() }
}

impl App {
    fn library_root_path(&self) -> Option<PathBuf> {
        self.settings.get().library_root.map(PathBuf::from)
    }

    /// Ordner der Projekte und ob er in der Bibliothek liegt.
    pub(crate) fn projects_root(&self) -> (PathBuf, bool) {
        let settings = self.settings.get();
        projects::projects_root(settings.library_root.as_deref().map(Path::new), Path::new(&settings.projects_dir))
    }

    fn all_projects(&self) -> Vec<(Project, PathBuf)> {
        let (root, in_library) = self.projects_root();
        let index = self.state.read(|s| s.project_index.clone());
        projects::list(&root, in_library, &index)
    }

    pub(crate) fn find_project(&self, id: &str) -> Result<(Project, PathBuf), CoreError> {
        self.all_projects().into_iter().find(|(p, _)| p.id == id).ok_or_else(|| not_found(EntityKind::Project, id))
    }

    fn touch_index(&self, project: &Project, dir: &Path, opened: bool) {
        let entry = ProjectIndexEntry {
            id: project.id.clone(),
            dir: dir.to_string_lossy().into_owned(),
            last_opened_at: if opened { Some(now_iso()) } else { None },
        };
        let _ = self.state.update(|s| {
            let previous = s.project_index.iter().find(|e| e.id == entry.id).and_then(|e| e.last_opened_at.clone());
            s.project_index.retain(|e| e.id != entry.id);
            let mut entry = entry;
            if entry.last_opened_at.is_none() {
                entry.last_opened_at = previous;
            }
            s.project_index.push(entry);
        });
    }

    pub(crate) fn template_records(&self) -> Vec<TemplateRecord> {
        projects::list_templates(&self.packs_root, self.library_root_path().as_deref())
    }

    pub fn templates_list(&self) -> Vec<TemplateInfo> {
        self.template_records().into_iter().map(|t| t.info).collect()
    }

    pub fn projects_list(&self) -> Vec<Project> {
        self.all_projects().into_iter().map(|(p, _)| p).collect()
    }

    pub fn project_create(&self, req: &ProjectCreateReq) -> Result<Project, CoreError> {
        let (root, in_library) = self.projects_root();
        std::fs::create_dir_all(&root)
            .map_err(|e| crate::error::IoError::new(crate::api::IoOp::CreateDir, &root, e))?;
        let author = self.settings.get().profile.display_name;
        let (project, dir) = projects::create(&root, in_library, &req.name, req.collection.as_deref(), &author)?;
        self.touch_index(&project, &dir, true);
        self.emit_projects(Some(project.id.clone()));
        Ok(project)
    }

    pub fn project_set_collection(&self, req: &ProjectSetCollectionReq) -> Result<Project, CoreError> {
        let (project, dir) = self.find_project(&req.project_id)?;
        let updated = projects::set_collection(&dir, project.in_library, req.collection.as_deref())?;
        self.emit_projects(Some(updated.id.clone()));
        Ok(updated)
    }

    /// Nur aus der Liste nehmen (Index); die Dateien bleiben. Projekte im Projektordner erscheinen immer wieder,
    /// dort gibt es nichts zu vergessen.
    pub fn project_forget(&self, req: &ProjectRef) -> Result<(), CoreError> {
        let (_, dir) = self.find_project(&req.project_id)?;
        let (root, _) = self.projects_root();
        if dir.parent() == Some(root.as_path()) {
            return Err(CoreError::invalid_input(
                "projectId",
                "Projekte im Projektordner lassen sich nur löschen, nicht vergessen",
            ));
        }
        self.state.update(|s| s.project_index.retain(|e| e.id != req.project_id))?;
        self.emit_projects(Some(req.project_id.clone()));
        Ok(())
    }

    pub fn project_new_file(&self, req: &ProjectNewFileReq) -> Result<ProjectFile, CoreError> {
        let (project, dir) = self.find_project(&req.project_id)?;
        let template = self
            .template_records()
            .into_iter()
            .find(|t| t.info.id == req.template_id)
            .ok_or_else(|| not_found(EntityKind::Template, &req.template_id))?;
        let content = match template.info.target {
            TemplateTarget::Program => {
                let file = template.file.as_deref().ok_or_else(|| CoreError::internal("Vorlage ohne Datei"))?;
                NewFileContent::CopyFrom(crate::platform::fsx::safe_join(&template.dir, file)?)
            }
            TemplateTarget::Social => {
                let id = template.social_template_id.as_deref().unwrap_or_default();
                let bundle = self.brand_bundle()?;
                let tpl = bundle
                    .socials
                    .iter()
                    .find(|t| t.id == id)
                    .ok_or_else(|| not_found(EntityKind::SocialTemplate, id))?;
                NewFileContent::Bytes(
                    serde_json::to_vec_pretty(&projects::social_document(tpl))
                        .map_err(|e| CoreError::internal(e.to_string()))?,
                )
            }
            TemplateTarget::Mockup => {
                let id = template.mockup_template_id.as_deref().unwrap_or_default();
                let bundle = self.brand_bundle()?;
                let tpl = bundle
                    .mockups
                    .iter()
                    .find(|t| t.id == id)
                    .ok_or_else(|| not_found(EntityKind::MockupTemplate, id))?;
                let width = self
                    .catalog
                    .current()
                    .catalog
                    .print_profile(&tpl.print_profile_id)
                    .map_or(280.0, |p| p.default_width_mm);
                NewFileContent::Bytes(
                    serde_json::to_vec_pretty(&projects::mockup_document(tpl, width))
                        .map_err(|e| CoreError::internal(e.to_string()))?,
                )
            }
        };
        let (file_ref, path) =
            projects::new_file(&dir, template.info.folder, &template.info.file_extension, &req.file_name, &content)?;
        let handle = self.handles.register(&path, HandleSource::Project)?;
        self.touch_index(&project, &dir, true);
        self.emit_projects(Some(project.id.clone()));
        Ok(ProjectFile { project_id: project.id, file_ref, handle })
    }

    fn open_in_project(&self, project_id: &str, dir: &Path, rel: &str) -> Result<ProjectOpenResult, CoreError> {
        let path = projects::resolve_file(dir, rel)?;
        if let Some(module) = projects::module_for(&path) {
            return Ok(ProjectOpenResult {
                outcome: ProjectOpenOutcome::Module {
                    module,
                    project_id: project_id.to_owned(),
                    rel_path: rel.replace('\\', "/"),
                },
            });
        }
        let Some(program) = projects::program_for(&path) else {
            return Err(CoreError::invalid_input(
                "relPath",
                "Für diese Dateiart gibt es kein Programm in Cypher Studio",
            ));
        };
        let Some(inst) = self.launchable_installation(program) else {
            return Ok(ProjectOpenResult {
                outcome: ProjectOpenOutcome::ProgramMissing { program_id: program.to_owned() },
            });
        };
        let launch = self.launch_installation(&inst, &[path], crate::api::LaunchMode::Normal)?;
        Ok(ProjectOpenResult { outcome: ProjectOpenOutcome::Launched { launch } })
    }

    pub fn project_open_file(&self, req: &ProjectFileReq) -> Result<ProjectOpenResult, CoreError> {
        let (project, dir) = self.find_project(&req.project_id)?;
        let result = self.open_in_project(&project.id, &dir, &req.rel_path)?;
        self.touch_index(&project, &dir, true);
        Ok(result)
    }

    pub fn project_open_last(&self, req: &ProjectRef) -> Result<ProjectOpenResult, CoreError> {
        let (project, dir) = self.find_project(&req.project_id)?;
        let last: ProjectFileRef = projects::last_file(&dir)
            .ok_or_else(|| CoreError::invalid_input("projectId", "Das Projekt hat noch keine Dateien"))?;
        let result = self.open_in_project(&project.id, &dir, &last.rel_path)?;
        self.touch_index(&project, &dir, true);
        Ok(result)
    }

    pub fn project_file_handle(&self, req: &ProjectFileReq) -> Result<crate::api::FileHandleInfo, CoreError> {
        let (_, dir) = self.find_project(&req.project_id)?;
        let path = projects::resolve_file(&dir, &req.rel_path)?;
        Ok(self.handles.register(&path, HandleSource::Project)?)
    }

    pub fn project_read_document(&self, req: &ProjectReadDocumentReq) -> Result<Option<ProjectDocument>, CoreError> {
        let (_, dir) = self.find_project(&req.project_id)?;
        Ok(projects::read_document(&dir, &req.rel_path)?)
    }

    pub fn project_write_document(&self, req: &ProjectWriteDocumentReq) -> Result<ProjectFileRef, CoreError> {
        let (project, dir) = self.find_project(&req.project_id)?;
        let r = projects::write_document(&dir, &req.rel_path, &req.document)?;
        self.emit_projects(Some(project.id));
        Ok(r)
    }

    pub fn project_add_asset(&self, req: &ProjectAddAssetReq) -> Result<ProjectAsset, CoreError> {
        let (project, dir) = self.find_project(&req.project_id)?;
        let src =
            self.handles.resolve(&req.handle_id).ok_or_else(|| not_found(EntityKind::FileHandle, &req.handle_id))?;
        let (mut asset, path) = projects::add_asset(&dir, &src, req.folder.unwrap_or(ProjectFolder::Motive))?;
        asset.handle = self.handles.register(&path, HandleSource::Project)?;
        self.emit_projects(Some(project.id));
        Ok(asset)
    }

    /// Modul eines Dokumentpfads (für Aufrufer, die nur den Pfad kennen).
    pub fn module_of(rel: &str) -> Option<ModuleKind> {
        projects::module_for(Path::new(rel))
    }
}
