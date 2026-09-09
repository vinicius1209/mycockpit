//! Manifesto efetivo de capabilities de um run.
//!
//! Este módulo é a fronteira entre intenção/configuração e o que realmente foi
//! materializado. Ele nunca serializa launch, env, headers ou credenciais: só
//! identidade pública, escopo, força da policy e inventário de tools.

use serde::{Deserialize, Serialize};

use crate::adapters::{
    Capabilities, CapabilityScope, PolicyEnforceability, ToolInventoryEvidence,
    ToolMaterializerDef, ToolMaterializerKind, ToolTransport,
};
use crate::mcp_control::{McpPlanIssueCode, McpRunPlan};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveRunManifest {
    pub schema_version: u8,
    pub agent_id: String,
    pub managed_external_mcp: bool,
    pub sources: Vec<EffectiveToolSource>,
    /// Instruções expandidas pelo frontend e revalidadas pelo runner contra o
    /// fingerprint aprovado antes do spawn.
    pub instructions: Vec<EffectiveInstructionSource>,
    pub resources: Vec<crate::resource_broker::EffectiveResourceAccess>,
    /// Há uma superfície do provider que a Frota não enumera por run. `true`
    /// evita que uma lista vazia de recursos pareça uma garantia de isolamento.
    pub unobserved_resources: bool,
    pub notices: Vec<String>,
    pub omissions: Vec<EffectiveCapabilityOmission>,
    /// Redução de permissão aceita explicitamente só para este envio.
    pub permission_override: Option<String>,
    /// Fonte, estado e instante da descoberta nativa usada no preflight.
    pub inventory_cache: Vec<crate::mcp_control::McpInventoryCacheObservation>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveCapabilityOmission {
    pub source_id: String,
    pub source_label: String,
    pub code: McpPlanIssueCode,
    pub detail: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstructionSourceKind {
    PluginSkill,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstructionSourceClaim {
    pub kind: InstructionSourceKind,
    pub plugin_key: String,
    pub fingerprint: String,
    pub contribution_id: String,
    pub invocation: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveInstructionSource {
    pub id: String,
    pub label: String,
    pub kind: InstructionSourceKind,
    pub scope: CapabilityScope,
    pub enforceability: PolicyEnforceability,
    pub invocation: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveToolSource {
    pub id: String,
    pub label: String,
    pub kind: ToolMaterializerKind,
    pub transport: ToolTransport,
    pub scope: CapabilityScope,
    pub enforceability: PolicyEnforceability,
    pub inventory: ToolInventoryEvidence,
    pub filters_per_run: bool,
    pub tool_names: Vec<String>,
    /// `None` é diferente de zero: significa que a fonte ainda não publicou a
    /// medida. O evento `session` pode completar a contagem nativa depois.
    pub observed_count: Option<usize>,
}

fn source(
    id: impl Into<String>,
    label: impl Into<String>,
    def: ToolMaterializerDef,
    inventory: ToolInventoryEvidence,
    tool_names: Vec<String>,
) -> EffectiveToolSource {
    let observed_count = matches!(
        inventory,
        ToolInventoryEvidence::Declared | ToolInventoryEvidence::Probe
    )
    .then_some(tool_names.len());
    EffectiveToolSource {
        id: id.into(),
        label: label.into(),
        kind: def.kind,
        transport: def.transport,
        scope: def.scope,
        enforceability: def.enforceability,
        inventory,
        filters_per_run: def.filters_per_run,
        tool_names,
        observed_count,
    }
}

fn gateway(id: &str, label: &str, tool_names: &[&str]) -> EffectiveToolSource {
    source(
        id,
        label,
        ToolMaterializerDef {
            kind: ToolMaterializerKind::FrotaGateway,
            transport: ToolTransport::Mcp,
            scope: CapabilityScope::Run,
            enforceability: PolicyEnforceability::Hard,
            inventory: ToolInventoryEvidence::Declared,
            filters_per_run: true,
        },
        ToolInventoryEvidence::Declared,
        tool_names.iter().map(|name| (*name).to_string()).collect(),
    )
}

fn catalog_gateway(tool_names: Vec<String>) -> EffectiveToolSource {
    source(
        crate::tool_gateway::MCP_SERVER_NAME,
        "Tools de plugins revisados",
        ToolMaterializerDef {
            kind: ToolMaterializerKind::FrotaGateway,
            transport: ToolTransport::Mcp,
            scope: CapabilityScope::Run,
            enforceability: PolicyEnforceability::Hard,
            inventory: ToolInventoryEvidence::Declared,
            filters_per_run: true,
        },
        ToolInventoryEvidence::Declared,
        stable_tool_names(&tool_names),
    )
}

fn stable_tool_names(names: &[String]) -> Vec<String> {
    let mut names = names.to_vec();
    names.sort();
    names.dedup();
    names
}

/// Aplicado antes de publicar: a lista acompanha a restrição efetiva do listener.
pub fn restrict_work_processes(manifest: &mut EffectiveRunManifest) {
    if let Some(source) = manifest
        .sources
        .iter_mut()
        .find(|source| source.id == crate::work_gateway::MCP_SERVER_NAME)
    {
        source
            .tool_names
            .retain(|name| !crate::work_gateway::is_process_tool(name));
        source.observed_count = Some(source.tool_names.len());
        source.label = "Planos e etapas".into();
    }
}

#[allow(clippy::too_many_arguments)]
pub fn build(
    agent_id: &str,
    caps: &Capabilities,
    approval_gateway: bool,
    context_gateway: bool,
    work_gateway: bool,
    tool_gateway: bool,
    tool_catalog: &crate::tool_gateway::ToolCatalogSnapshot,
    mcp_plan: &McpRunPlan,
    instructions: Vec<EffectiveInstructionSource>,
) -> EffectiveRunManifest {
    let materializers = caps.tool_materializers();
    let native = materializers
        .iter()
        .copied()
        .find(|item| item.kind == ToolMaterializerKind::ProviderNative)
        .expect("todo adapter declara sua superfície nativa");
    let mut sources = vec![source(
        "provider-native",
        "Tools nativas do provider",
        native,
        native.inventory,
        Vec::new(),
    )];

    if approval_gateway {
        sources.push(gateway(
            crate::approval::MCP_SERVER_NAME,
            "Decisões humanas",
            &[
                crate::approval::APPROVAL_TOOL,
                crate::approval::ASK_USER_TOOL,
            ],
        ));
    }
    if context_gateway {
        sources.push(gateway(
            crate::context_gateway::MCP_SERVER_NAME,
            "Contexto da conversa",
            &[
                crate::context_gateway::MANIFEST_TOOL,
                crate::context_gateway::SEARCH_TOOL,
                crate::context_gateway::READ_TOOL,
            ],
        ));
    }
    if work_gateway {
        sources.push(gateway(
            crate::work_gateway::MCP_SERVER_NAME,
            "Trabalho e processos",
            &[
                crate::work_gateway::PROCESS_START_TOOL,
                crate::work_gateway::PROCESS_POLL_TOOL,
                crate::work_gateway::PROCESS_STOP_TOOL,
                crate::work_gateway::WORK_PLAN_TOOL,
                crate::work_gateway::WORK_UPDATE_TOOL,
            ],
        ));
    }
    if tool_gateway {
        sources.push(catalog_gateway(tool_catalog.tool_names()));
    }

    if let Some(external) = materializers
        .iter()
        .copied()
        .find(|item| item.kind == ToolMaterializerKind::ExternalMcp)
    {
        if mcp_plan.managed {
            for server in &mcp_plan.selected {
                let inventory = if server.launch.transport == "stdio" {
                    ToolInventoryEvidence::Probe
                } else {
                    ToolInventoryEvidence::Opaque
                };
                sources.push(source(
                    format!("mcp:{}", server.runtime_name),
                    server.display_name.clone(),
                    external,
                    inventory,
                    stable_tool_names(&server.tool_names),
                ));
            }
        } else {
            // Sem binding explícito o runner preserva a configuração do CLI.
            // Ela pode conter MCPs, mas a Frota não deve fingir que enumerou ou
            // filtrou essa superfície neste run.
            sources.push(source(
                "provider-mcp",
                "MCPs configurados no provider",
                ToolMaterializerDef {
                    enforceability: PolicyEnforceability::Advisory,
                    filters_per_run: false,
                    ..external
                },
                ToolInventoryEvidence::Opaque,
                Vec::new(),
            ));
        }
        for server in &mcp_plan.contributed {
            let inventory = if server.launch.transport == "stdio" {
                ToolInventoryEvidence::Probe
            } else {
                ToolInventoryEvidence::Opaque
            };
            sources.push(source(
                format!("plugin-mcp:{}", server.runtime_name),
                server.display_name.clone(),
                external,
                inventory,
                stable_tool_names(&server.tool_names),
            ));
        }
    }

    EffectiveRunManifest {
        schema_version: 6,
        agent_id: agent_id.to_string(),
        managed_external_mcp: mcp_plan.managed,
        sources,
        instructions,
        resources: mcp_plan
            .resources
            .iter()
            .chain(tool_catalog.resources.iter())
            .cloned()
            .collect(),
        unobserved_resources: !mcp_plan.managed
            && materializers
                .iter()
                .any(|item| item.kind == ToolMaterializerKind::ExternalMcp),
        notices: mcp_plan
            .notices
            .iter()
            .chain(tool_catalog.notices.iter())
            .cloned()
            .collect(),
        omissions: mcp_plan
            .omissions
            .iter()
            .map(|issue| EffectiveCapabilityOmission {
                source_id: issue.source_id.clone(),
                source_label: issue.source_label.clone(),
                code: issue.code,
                detail: issue.detail.clone(),
            })
            .collect(),
        permission_override: mcp_plan.force_readonly.then(|| "leitura".into()),
        inventory_cache: mcp_plan.inventory_cache.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::{ToolMaterializerKind, CLAUDE_CAPS};
    use crate::mcp_control::{McpLaunchConfig, McpRuntimeServer};

    #[test]
    fn modo_restrito_declara_apenas_as_etapas_que_o_listener_aceita() {
        let mut manifest = build(
            "engine",
            &CLAUDE_CAPS,
            false,
            false,
            true,
            false,
            &crate::tool_gateway::ToolCatalogSnapshot::default(),
            &McpRunPlan::default(),
            Vec::new(),
        );
        restrict_work_processes(&mut manifest);
        let work = manifest
            .sources
            .iter()
            .find(|source| source.id == crate::work_gateway::MCP_SERVER_NAME)
            .unwrap();
        assert_eq!(work.observed_count, Some(2));
        assert_eq!(
            work.tool_names,
            [
                crate::work_gateway::WORK_PLAN_TOOL,
                crate::work_gateway::WORK_UPDATE_TOOL
            ]
        );
        assert_eq!(work.label, "Planos e etapas");
    }

    #[test]
    fn manifesto_separa_gateway_exato_mcp_probe_e_superficie_opaca() {
        let plan = McpRunPlan {
            managed: true,
            selected: vec![McpRuntimeServer {
                runtime_name: "playwright".into(),
                display_name: "Playwright".into(),
                launch: McpLaunchConfig {
                    transport: "stdio".into(),
                    ..Default::default()
                },
                tool_names: vec!["screenshot".into(), "navigate".into()],
            }],
            ..Default::default()
        };
        let manifest = build(
            "engine",
            &CLAUDE_CAPS,
            true,
            true,
            true,
            false,
            &crate::tool_gateway::ToolCatalogSnapshot::default(),
            &plan,
            Vec::new(),
        );

        let native = manifest
            .sources
            .iter()
            .find(|item| item.kind == ToolMaterializerKind::ProviderNative)
            .unwrap();
        assert_eq!(native.inventory, ToolInventoryEvidence::RuntimeCount);
        assert_eq!(native.observed_count, None);

        let work = manifest
            .sources
            .iter()
            .find(|item| item.id == crate::work_gateway::MCP_SERVER_NAME)
            .unwrap();
        assert_eq!(work.enforceability, PolicyEnforceability::Hard);
        assert_eq!(work.observed_count, Some(5));

        let playwright = manifest
            .sources
            .iter()
            .find(|item| item.id == "mcp:playwright")
            .unwrap();
        assert_eq!(playwright.inventory, ToolInventoryEvidence::Probe);
        assert_eq!(playwright.tool_names, vec!["navigate", "screenshot"]);
        assert!(!manifest.unobserved_resources);
    }

    #[test]
    fn plano_nao_gerenciado_nao_finge_inventario_do_cli() {
        let manifest = build(
            "engine",
            &CLAUDE_CAPS,
            false,
            false,
            false,
            false,
            &crate::tool_gateway::ToolCatalogSnapshot::default(),
            &McpRunPlan::default(),
            Vec::new(),
        );
        let source = manifest
            .sources
            .iter()
            .find(|item| item.id == "provider-mcp")
            .unwrap();
        assert_eq!(source.inventory, ToolInventoryEvidence::Opaque);
        assert_eq!(source.enforceability, PolicyEnforceability::Advisory);
        assert!(!source.filters_per_run);
        assert!(manifest.resources.is_empty());
        assert!(manifest.unobserved_resources);
    }

    #[test]
    fn omissao_opcional_fica_no_manifesto_sem_recurso_falso() {
        let plan = McpRunPlan {
            managed: true,
            omissions: vec![crate::mcp_control::McpPlanIssue {
                source_id: "playwright".into(),
                source_label: "Playwright".into(),
                code: crate::mcp_control::McpPlanIssueCode::BrowserOffline,
                disposition: crate::mcp_control::McpPlanDisposition::Omitted,
                detail: Some("o navegador deste projeto está desligado".into()),
            }],
            ..Default::default()
        };
        let manifest = build(
            "engine",
            &CLAUDE_CAPS,
            false,
            false,
            false,
            false,
            &crate::tool_gateway::ToolCatalogSnapshot::default(),
            &plan,
            Vec::new(),
        );
        assert!(manifest.resources.is_empty());
        assert_eq!(manifest.omissions.len(), 1);
        assert_eq!(manifest.omissions[0].source_label, "Playwright");
    }

    #[test]
    fn consentimento_somente_leitura_fica_explicito_no_manifesto() {
        let plan = McpRunPlan {
            managed: true,
            force_readonly: true,
            ..Default::default()
        };
        let manifest = build(
            "engine",
            &CLAUDE_CAPS,
            false,
            false,
            false,
            false,
            &crate::tool_gateway::ToolCatalogSnapshot::default(),
            &plan,
            Vec::new(),
        );
        assert_eq!(manifest.permission_override.as_deref(), Some("leitura"));
    }

    #[test]
    fn catalogo_de_plugin_publica_tools_e_claims_sem_expor_endpoint() {
        let catalog = crate::tool_gateway::ToolCatalogSnapshot {
            tools: vec![crate::tool_gateway::PluginToolSpec {
                name: "plugin__acme_quality__auditar".into(),
                title: "Quality: Auditar".into(),
                description: "Audita a página".into(),
                input_schema: serde_json::json!({ "type": "object" }),
                plugin_key: "acme.quality".into(),
                fingerprint: "hash".into(),
                tool_id: "auditar".into(),
            }],
            resources: vec![crate::resource_broker::EffectiveResourceAccess {
                id: "plugin:acme.quality:project-browser".into(),
                label: "Navegador do projeto".into(),
                kind: crate::resource_broker::ResourceKind::ProjectBrowser,
                owner: crate::resource_broker::ResourceOwner::Frota,
                scope: crate::adapters::CapabilityScope::Project,
                enforceability: crate::adapters::PolicyEnforceability::Hard,
                evidence: crate::resource_broker::ResourceEvidence::PluginManifest,
                state: crate::resource_broker::ResourceState::Ready,
                via: "acme.quality".into(),
            }],
            notices: vec!["catálogo revisado".into()],
        };
        let manifest = build(
            "engine",
            &CLAUDE_CAPS,
            false,
            false,
            false,
            true,
            &catalog,
            &McpRunPlan::default(),
            Vec::new(),
        );

        let source = manifest
            .sources
            .iter()
            .find(|item| item.id == crate::tool_gateway::MCP_SERVER_NAME)
            .unwrap();
        assert_eq!(source.tool_names, vec!["plugin__acme_quality__auditar"]);
        assert_eq!(source.enforceability, PolicyEnforceability::Hard);
        assert_eq!(manifest.resources.len(), 1);
        assert_eq!(
            manifest.resources[0].evidence,
            crate::resource_broker::ResourceEvidence::PluginManifest
        );
        assert_eq!(manifest.notices, vec!["catálogo revisado"]);
    }

    #[test]
    fn manifesto_distingue_skill_invocada_e_mcp_contribuido_do_legado_opaco() {
        let plan = McpRunPlan {
            contributed: vec![McpRuntimeServer {
                runtime_name: "plugin__acme_quality__docs".into(),
                display_name: "Quality · Docs".into(),
                launch: McpLaunchConfig {
                    transport: "stdio".into(),
                    ..Default::default()
                },
                tool_names: vec!["search".into()],
            }],
            ..Default::default()
        };
        let instruction = EffectiveInstructionSource {
            id: "plugin-skill:acme.quality:review".into(),
            label: "Quality · /acme.quality:review".into(),
            kind: InstructionSourceKind::PluginSkill,
            scope: CapabilityScope::User,
            enforceability: PolicyEnforceability::Hard,
            invocation: "acme.quality:review".into(),
        };
        let manifest = build(
            "engine",
            &CLAUDE_CAPS,
            false,
            false,
            false,
            false,
            &crate::tool_gateway::ToolCatalogSnapshot::default(),
            &plan,
            vec![instruction.clone()],
        );
        let contributed = manifest
            .sources
            .iter()
            .find(|source| source.id.starts_with("plugin-mcp:"))
            .unwrap();
        assert_eq!(contributed.enforceability, PolicyEnforceability::Hard);
        assert_eq!(contributed.tool_names, vec!["search"]);
        assert_eq!(manifest.instructions, vec![instruction]);
        assert!(manifest
            .sources
            .iter()
            .any(|source| source.id == "provider-mcp"));
    }
}
