//! Contribuições estáticas de plugins aprovados.
//!
//! Discovery não publica conteúdo. Esta camada reabre o pacote, confirma o
//! grant do fingerprint atual e só então transforma arquivos declarados em
//! instruções invocáveis. Nenhum diretório de provider é escrito.

use crate::plugin_manifest::{FileContribution, PluginPackage, PluginScan};
use crate::run_manifest::{
    EffectiveInstructionSource, InstructionSourceClaim, InstructionSourceKind,
};
use std::collections::{HashMap, HashSet};

const MAX_SKILL_BYTES: u64 = 256 * 1024;

#[derive(Clone, Debug)]
pub(crate) struct PluginSkillSpec {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) body: String,
    pub(crate) plugin_key: String,
    pub(crate) plugin_name: String,
    pub(crate) fingerprint: String,
    pub(crate) contribution_id: String,
}

pub(crate) fn enabled_packages(app: &tauri::AppHandle) -> Result<Vec<PluginPackage>, String> {
    let scans = crate::plugin_manifest::scan_plugins(app)?;
    let conn = crate::mcp_control::db(app)?;
    let mut packages = Vec::new();
    for scan in scans {
        if let PluginScan::Valid(package) = scan {
            if crate::plugin_grants::is_enabled(&conn, &package)? {
                packages.push(package);
            }
        }
    }
    packages.sort_by_key(PluginPackage::key);
    Ok(packages)
}

fn materialize_skill(
    package: &PluginPackage,
    contribution: &FileContribution,
) -> Result<PluginSkillSpec, String> {
    let path = crate::plugin_manifest::contained_file(&package.root, &contribution.path)?;
    if path.file_name().and_then(|name| name.to_str()) != Some("SKILL.md") {
        return Err(format!(
            "skill {} de {} precisa apontar para um arquivo SKILL.md",
            contribution.id,
            package.key()
        ));
    }
    let bytes = crate::plugin_manifest::read_capped(&path, MAX_SKILL_BYTES)?;
    let body = String::from_utf8(bytes).map_err(|_| {
        format!(
            "skill {} de {} precisa estar em UTF-8",
            contribution.id,
            package.key()
        )
    })?;
    if body.trim().is_empty() {
        return Err(format!(
            "skill {} de {} está vazia",
            contribution.id,
            package.key()
        ));
    }
    let description = crate::sources::frontmatter(&body, "description")
        .filter(|description| !description.trim().is_empty())
        .ok_or_else(|| {
            format!(
                "skill {} de {} precisa declarar description no frontmatter",
                contribution.id,
                package.key()
            )
        })?;
    if description.chars().count() > 512 {
        return Err(format!(
            "skill {} de {} excede 512 caracteres na description",
            contribution.id,
            package.key()
        ));
    }

    Ok(PluginSkillSpec {
        // O namespace é estável mesmo quando outro plugin instala uma skill
        // homônima. O ponto separa publisher/id; dois-pontos separa a skill.
        name: format!("{}:{}", package.key(), contribution.id),
        description,
        body,
        plugin_key: package.key(),
        plugin_name: package.manifest.name.clone(),
        fingerprint: package.fingerprint.clone(),
        contribution_id: contribution.id.clone(),
    })
}

/// Valida o conteúdo declarado antes de permitir revisão ou grant. O
/// fingerprint prova os mesmos bytes que chegaram aqui; logo, uma skill com
/// contrato quebrado nunca aparece como pacote pronto para habilitar.
pub(crate) fn validate_package(package: &PluginPackage) -> Result<(), String> {
    for contribution in &package.manifest.contributes.skills {
        materialize_skill(package, contribution)?;
    }
    Ok(())
}

pub(crate) fn skills(app: &tauri::AppHandle) -> Result<Vec<PluginSkillSpec>, String> {
    let mut skills = Vec::new();
    for package in enabled_packages(app)? {
        for contribution in &package.manifest.contributes.skills {
            skills.push(materialize_skill(&package, contribution)?);
        }
    }
    skills.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(skills)
}

pub(crate) fn verify_instruction_sources(
    app: &tauri::AppHandle,
    claims: Vec<InstructionSourceClaim>,
) -> Result<Vec<EffectiveInstructionSource>, String> {
    if claims.len() > 64 {
        return Err("o prompt excede o limite de 64 skills contribuídas".into());
    }
    let packages: HashMap<String, PluginPackage> = enabled_packages(app)?
        .into_iter()
        .map(|package| (package.key(), package))
        .collect();
    let mut seen = HashSet::new();
    let mut verified = Vec::new();
    for claim in claims {
        if claim.kind != InstructionSourceKind::PluginSkill {
            return Err("tipo de instrução contribuída não suportado".into());
        }
        let package = packages.get(&claim.plugin_key).ok_or_else(|| {
            format!(
                "a skill /{} não está mais habilitada; atualize o inventário e envie novamente",
                claim.invocation
            )
        })?;
        if package.fingerprint != claim.fingerprint {
            return Err(format!(
                "o plugin {} mudou depois da expansão; revise o novo fingerprint antes de enviar",
                claim.plugin_key
            ));
        }
        let contribution = package
            .manifest
            .contributes
            .skills
            .iter()
            .find(|item| item.id == claim.contribution_id)
            .ok_or_else(|| {
                format!(
                    "a skill {} não existe no manifesto revisado de {}",
                    claim.contribution_id, claim.plugin_key
                )
            })?;
        let skill = materialize_skill(package, contribution)?;
        if skill.name != claim.invocation {
            return Err("o nome invocado não corresponde à skill revisada".into());
        }
        let id = format!(
            "plugin-skill:{}:{}",
            claim.plugin_key, claim.contribution_id
        );
        if !seen.insert(id.clone()) {
            continue;
        }
        verified.push(EffectiveInstructionSource {
            id,
            label: format!("{} · /{}", package.manifest.name, skill.name),
            kind: InstructionSourceKind::PluginSkill,
            scope: crate::adapters::CapabilityScope::User,
            enforceability: crate::adapters::PolicyEnforceability::Hard,
            invocation: skill.name,
        });
    }
    verified.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(verified)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_manifest::{PluginContributions, PluginEngines, PluginManifest};
    use std::path::PathBuf;

    fn package(root: PathBuf) -> PluginPackage {
        PluginPackage {
            root: std::fs::canonicalize(root).unwrap(),
            fingerprint: "fingerprint-atual".into(),
            manifest: PluginManifest {
                schema: None,
                manifest_version: 1,
                plugin_api: 1,
                publisher: "acme".into(),
                id: "quality".into(),
                name: "Quality".into(),
                version: "1.0.0".into(),
                description: None,
                engines: PluginEngines {
                    frota: ">=0.1.0".into(),
                },
                main: None,
                capabilities: Vec::new(),
                contributes: PluginContributions::default(),
            },
        }
    }

    #[test]
    fn skill_aprovada_ganha_namespace_e_proveniencia_estaveis() {
        let root = std::env::temp_dir().join(format!(
            "frota-plugin-skill-{}-{}",
            std::process::id(),
            crate::plugin_manifest::MANIFEST_VERSION
        ));
        let skill_dir = root.join("skills/review");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\ndescription: Revise o código com evidências\n---\n\nFaça a revisão.\n",
        )
        .unwrap();
        let spec = materialize_skill(
            &package(root.clone()),
            &FileContribution {
                id: "review".into(),
                path: "skills/review/SKILL.md".into(),
            },
        )
        .unwrap();
        assert_eq!(spec.name, "acme.quality:review");
        assert_eq!(spec.plugin_key, "acme.quality");
        assert_eq!(spec.contribution_id, "review");
        assert_eq!(spec.description, "Revise o código com evidências");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn skill_sem_contrato_ou_grande_demais_falha_fechado() {
        let root =
            std::env::temp_dir().join(format!("frota-plugin-skill-invalid-{}", std::process::id()));
        std::fs::create_dir_all(root.join("skills")).unwrap();
        std::fs::write(root.join("skills/review.md"), "sem frontmatter").unwrap();
        let error = materialize_skill(
            &package(root.clone()),
            &FileContribution {
                id: "review".into(),
                path: "skills/review.md".into(),
            },
        )
        .unwrap_err();
        assert!(error.contains("SKILL.md"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
